from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend import db_explorer
from backend.agent_run_log import write_agent_session_json
from backend.agent_runner import run_multi_turn_tool_agent
from backend.golden_save import save_golden_task_json
from backend.ideal_tool_invoke import invoke_ideal_tool
from backend.jira_store import JiraStore
from backend.jira_tools import ALL_JIRA_TOOL_NAMES, build_jira_tools, filter_tools
from backend.session_jira import (
    JiraDbFork,
    SessionJiraRegistry,
    parse_db_fork_header,
    sessions_dir_from_config,
    validate_session_id,
)
from backend.settings import REPO_ROOT, get_openai_key, load_config
from backend.trajectory_replay import sync_qc_view_state
from backend.prompt_generation import generate_task_prompt
from backend.verifier_generation import generate_verifiers_ai

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

config = load_config()
_sessions_root = sessions_dir_from_config(config)
_session_registry = SessionJiraRegistry(_sessions_root)

app = FastAPI(title="RL Platform JIRA Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "http://localhost:4173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _system_prompt_dir() -> Path:
    rel = (config.get("prompts") or {}).get("system_dir", "prompts/system")
    p = REPO_ROOT / rel
    return p.resolve()


def _read_system_prompt(filename: str) -> str:
    safe = Path(filename).name
    path = _system_prompt_dir() / safe
    if not path.is_file():
        raise HTTPException(400, f"Unknown system prompt: {safe}")
    return path.read_text(encoding="utf-8")


def get_rl_session_id(
    x_rl_session_id: Optional[str] = Header(None, alias="X-RL-Session-Id"),
) -> str:
    if not x_rl_session_id or not str(x_rl_session_id).strip():
        raise HTTPException(
            400,
            "Missing X-RL-Session-Id header. Send a per-tab UUID from the web UI; "
            "each episode uses isolated SQLite DBs (A / B / ideal) that reset after golden submit.",
        )
    try:
        return validate_session_id(str(x_rl_session_id))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def get_db_fork_required(
    x_rl_db_fork: Optional[str] = Header(None, alias="X-RL-Db-Fork"),
) -> JiraDbFork:
    """Explorer / SQL routes must send which fork to query."""
    if not x_rl_db_fork or not str(x_rl_db_fork).strip():
        raise HTTPException(
            400,
            "Missing X-RL-Db-Fork. Use A, B, or ideal (see web DB explorer).",
        )
    try:
        return parse_db_fork_header(str(x_rl_db_fork))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def get_db_fork_default_a(
    x_rl_db_fork: Optional[str] = Header(None, alias="X-RL-Db-Fork"),
) -> JiraDbFork:
    """Tool metadata only; default to fork A if header omitted."""
    if not x_rl_db_fork or not str(x_rl_db_fork).strip():
        return "A"
    try:
        return parse_db_fork_header(str(x_rl_db_fork))
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config-status")
def config_status() -> dict[str, Any]:
    key = get_openai_key(config)
    oa = config.get("openai") or {}
    return {
        "openai_configured": bool(key),
        "model": oa.get("model", "gpt-4o-mini"),
        "jira_sessions_dir": str(_sessions_root),
        "jira_db_forks": ["A", "B", "ideal"],
        "jira_session_note": (
            "Mutating routes require X-RL-Session-Id. Three SQLite files per session: "
            "{session}_A.sqlite3, {session}_B.sqlite3, {session}_ideal.sqlite3. "
            "Explorer sends X-RL-Db-Fork: A | B | ideal. All reset after POST /api/tasks/save-golden."
        ),
    }


@app.get("/api/prompts/system")
def list_system_prompts() -> dict[str, list[dict[str, str]]]:
    d = _system_prompt_dir()
    if not d.is_dir():
        return {"prompts": []}
    items: list[dict[str, str]] = []
    for p in sorted(d.glob("*.md")):
        items.append({"id": p.name, "label": p.stem.replace("_", " ").title()})
    return {"prompts": items}


@app.get("/api/tools/jira")
def list_jira_tools(
    session_id: str = Depends(get_rl_session_id),
    db_fork: JiraDbFork = Depends(get_db_fork_default_a),
) -> dict[str, Any]:
    store = _session_registry.get_store(session_id, db_fork)
    tools = build_jira_tools(store)
    return {
        "tools": [
            {"name": t.name, "description": t.description or ""} for t in tools
        ]
    }


@app.get("/api/db/tables")
def db_list_tables(
    session_id: str = Depends(get_rl_session_id),
    db_fork: JiraDbFork = Depends(get_db_fork_required),
) -> dict[str, Any]:
    p = _session_registry.get_store(session_id, db_fork).path
    return {
        "tables": db_explorer.list_tables(p),
        "db_fork": db_fork,
        "db_path": str(p),
    }


@app.get("/api/db/tables/{table}/columns")
def db_table_columns(
    table: str,
    session_id: str = Depends(get_rl_session_id),
    db_fork: JiraDbFork = Depends(get_db_fork_required),
) -> dict[str, Any]:
    p = _session_registry.get_store(session_id, db_fork).path
    return {
        "table": table,
        "columns": db_explorer.table_columns(p, table),
        "db_fork": db_fork,
    }


@app.get("/api/db/tables/{table}/rows")
def db_table_rows(
    table: str,
    limit: int = 100,
    offset: int = 0,
    session_id: str = Depends(get_rl_session_id),
    db_fork: JiraDbFork = Depends(get_db_fork_required),
) -> dict[str, Any]:
    p = _session_registry.get_store(session_id, db_fork).path
    return db_explorer.table_rows(p, table, limit, offset)


class SqlQueryBody(BaseModel):
    sql: str = Field(..., description="Read-only SELECT or WITH … SELECT")
    max_rows: int = Field(500, ge=1, le=1000)


@app.post("/api/db/query")
def db_run_query(
    body: SqlQueryBody,
    session_id: str = Depends(get_rl_session_id),
    db_fork: JiraDbFork = Depends(get_db_fork_required),
) -> dict[str, Any]:
    p = _session_registry.get_store(session_id, db_fork).path
    return db_explorer.run_select(p, body.sql, body.max_rows)


class AgentRunBody(BaseModel):
    prompt: str = ""
    user_turns: list[str] = Field(
        default_factory=list,
        description="Ordered user messages for a multi-turn conversation",
    )
    project_key: str = Field(..., description="Active JIRA project context")
    selected_tools: list[str] = Field(default_factory=list)
    system_prompt_file: str = "default.md"
    metadata_summary: Optional[str] = None


def _resolved_user_turns(body: AgentRunBody) -> list[str]:
    if body.user_turns:
        return [t.strip() for t in body.user_turns if t and t.strip()]
    if body.prompt.strip():
        return [body.prompt.strip()]
    return []


def _build_user_block(
    body: AgentRunBody,
    store: JiraStore,
    *,
    user_request: str,
    turn_index: int,
    turn_count: int,
) -> str:
    parts = [
        f"**Active project key:** {body.project_key.upper()}",
        "Prefer this project when creating issues unless the user specifies another.",
        "",
        f"**User message (turn {turn_index} of {turn_count}):**",
        user_request.strip() or "(empty)",
    ]
    if turn_index == 1:
        if body.metadata_summary:
            parts.extend(
                [
                    "",
                    "**CSV / task metadata (context only):**",
                    body.metadata_summary[:8000],
                ]
            )
        parts.extend(
            [
                "",
                "**Database snapshot (read-only hint):**",
                store.dump_snapshot_json(),
            ]
        )
    return "\n".join(parts)


def _build_turn_messages(body: AgentRunBody, store: JiraStore) -> list[str]:
    turns = _resolved_user_turns(body)
    if not turns:
        raise HTTPException(400, "At least one user turn is required")
    count = len(turns)
    return [
        _build_user_block(
            body,
            store,
            user_request=text,
            turn_index=i + 1,
            turn_count=count,
        )
        for i, text in enumerate(turns)
    ]


def _attach_raw_user_messages(
    run: dict[str, Any], raw_turns: list[str]
) -> dict[str, Any]:
    turns = run.get("turns") or []
    for i, turn in enumerate(turns):
        if i < len(raw_turns):
            turn["userMessage"] = raw_turns[i]
    run["turns"] = turns
    return run


def _to_trajectory(traj_id: str, label: str, run: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": traj_id,
        "label": label,
        "turns": run.get("turns") or [],
        "finalResponse": run["final_response"],
        "steps": run["steps"],
    }


@app.post("/api/agent/run")
def run_agent(
    body: AgentRunBody, session_id: str = Depends(get_rl_session_id)
) -> dict[str, Any]:
    api_key = get_openai_key(config)
    if not api_key:
        raise HTTPException(
            503,
            "OPENAI_API_KEY missing: set env or openai.api_key in config.yaml",
        )

    oa = config.get("openai") or {}
    model = oa.get("model", "gpt-4o-mini")
    t_a = float(oa.get("temperature_a", 0.2))
    t_b = float(oa.get("temperature_b", 0.55))
    max_rounds = int(oa.get("max_tool_rounds", 14))

    sel = body.selected_tools or None
    if sel:
        bad = [x for x in sel if x not in ALL_JIRA_TOOL_NAMES]
        if bad:
            raise HTTPException(400, f"Unknown tools: {bad}")

    try:
        system = _read_system_prompt(body.system_prompt_file)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e)) from e

    sp_file = Path(body.system_prompt_file).name

    # Fresh episode: separate DB files for A, B, and ideal (ideal re-seeded for new episode).
    _session_registry.reset(session_id)
    store_a = _session_registry.get_store(session_id, "A")
    turn_messages_a = _build_turn_messages(body, store_a)
    all_tools_a = build_jira_tools(store_a)
    tools_a = filter_tools(all_tools_a, sel)
    if not tools_a:
        raise HTTPException(400, "No tools left after filter")

    try:
        run_a = run_multi_turn_tool_agent(
            store=store_a,
            tools=tools_a,
            system_prompt=system,
            system_prompt_file=sp_file,
            turn_messages=turn_messages_a,
            api_key=api_key,
            model=model,
            temperature=t_a,
            max_tool_rounds=max_rounds,
            config=config,
        )
        store_b = _session_registry.get_store(session_id, "B")
        turn_messages_b = _build_turn_messages(body, store_b)
        all_tools_b = build_jira_tools(store_b)
        tools_b = filter_tools(all_tools_b, sel)
        if not tools_b:
            raise HTTPException(400, "No tools left after filter")
        run_b = run_multi_turn_tool_agent(
            store=store_b,
            tools=tools_b,
            system_prompt=system,
            system_prompt_file=sp_file,
            turn_messages=turn_messages_b,
            api_key=api_key,
            model=model,
            temperature=t_b,
            max_tool_rounds=max_rounds,
            config=config,
        )
    except Exception as e:
        log.exception("agent run failed")
        raise HTTPException(500, f"Agent error: {e}") from e

    raw_turns = _resolved_user_turns(body)
    run_a = _attach_raw_user_messages(run_a, raw_turns)
    run_b = _attach_raw_user_messages(run_b, raw_turns)

    log_payload: dict[str, Any] = {
        "log_version": 1,
        "written_at": datetime.now(timezone.utc).isoformat(),
        "rl_session_id": session_id,
        "request": body.model_dump(),
        "model": model,
        "system_prompt_file": sp_file,
        "system_prompt_text": system,
        "trajectory_system_prompt": {
            "file": sp_file,
            "text": system,
        },
        "user_turns": _resolved_user_turns(body),
        "user_context_blocks": {
            "A": turn_messages_a,
            "B": turn_messages_b,
        },
        "episode_note": (
            "Trajectory A mutations are in {session}_A.sqlite3; B in {session}_B.sqlite3. "
            "Both start from an identical seed; snapshots in user blocks match at run start."
        ),
        "jira_db_paths": {
            "A": str(store_a.path),
            "B": str(store_b.path),
            "ideal": str(_session_registry.db_path(session_id, "ideal")),
        },
        "openai_estimated_cost_usd": {
            "trajectory_a": run_a["model_log"].get(
                "total_estimated_openai_cost_usd", 0.0
            ),
            "trajectory_b": run_b["model_log"].get(
                "total_estimated_openai_cost_usd", 0.0
            ),
            "combined": round(
                float(run_a["model_log"].get("total_estimated_openai_cost_usd", 0.0))
                + float(run_b["model_log"].get("total_estimated_openai_cost_usd", 0.0)),
                8,
            ),
            "note": (
                "Per-step and per-assistant-turn detail is under runs.*.model_log.events "
                "and runs.*.steps; pricing from openai.pricing_usd_per_1m_tokens or defaults."
            ),
        },
        "runs": {
            "A": {
                "label": "Trajectory A",
                "temperature": t_a,
                "final_response": run_a["final_response"],
                "turns": run_a.get("turns") or [],
                "steps": run_a["steps"],
                "model_log": run_a["model_log"],
            },
            "B": {
                "label": "Trajectory B",
                "temperature": t_b,
                "final_response": run_b["final_response"],
                "turns": run_b.get("turns") or [],
                "steps": run_b["steps"],
                "model_log": run_b["model_log"],
            },
        },
    }
    agent_log_file: Optional[str] = None
    try:
        log_path = write_agent_session_json(config, log_payload)
        agent_log_file = str(log_path.relative_to(REPO_ROOT))
        log.info("Wrote agent session log to %s", agent_log_file)
    except Exception as e:
        log.warning("Could not write agent session log: %s", e)

    return {
        "A": _to_trajectory("A", "Trajectory A", run_a),
        "B": _to_trajectory("B", "Trajectory B", run_b),
        "model": model,
        "system_prompt_file": sp_file,
        "system_prompt_text": system,
        "agent_log_file": agent_log_file,
    }


class InvokeIdealToolBody(BaseModel):
    tool: str
    arguments: dict[str, Any] = Field(default_factory=dict)


@app.post("/api/ideal/invoke-tool")
def ideal_invoke_tool(
    body: InvokeIdealToolBody, session_id: str = Depends(get_rl_session_id)
) -> dict[str, Any]:
    store = _session_registry.get_store(session_id, "ideal")
    return invoke_ideal_tool(store, body.tool, body.arguments)


class SyncQcViewBody(BaseModel):
    """
    Align SQLite with trajectories for QC: always replay A/B from ``steps_a`` /
    ``steps_b``, optionally replay ideal from ``steps_ideal``.
    """

    steps_a: list[dict[str, Any]] = Field(default_factory=list)
    steps_b: list[dict[str, Any]] = Field(default_factory=list)
    steps_ideal: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/api/session/sync-for-qc-view")
def session_sync_for_qc_view(
    body: SyncQcViewBody,
    session_id: str = Depends(get_rl_session_id),
) -> dict[str, Any]:
    out = sync_qc_view_state(
        _session_registry,
        session_id,
        steps_a=body.steps_a,
        steps_b=body.steps_b,
        steps_ideal=body.steps_ideal,
    )
    return {"ok": True, **out}


class ReplayDummyForksBody(BaseModel):
    """Legacy body — prefer ``/api/session/sync-for-qc-view`` (A/B + optional ideal)."""

    steps_a: list[dict[str, Any]] = Field(default_factory=list)
    steps_b: list[dict[str, Any]] = Field(default_factory=list)


@app.post("/api/session/replay-dummy-forks")
def session_replay_dummy_forks(
    body: ReplayDummyForksBody,
    session_id: str = Depends(get_rl_session_id),
) -> dict[str, Any]:
    """Deprecated alias: A/B replay only, no ideal replay."""
    out = sync_qc_view_state(
        _session_registry,
        session_id,
        steps_a=body.steps_a,
        steps_b=body.steps_b,
        steps_ideal=[],
    )
    return {"ok": True, **out}


class GeneratePromptBody(BaseModel):
    project_key: str = Field(..., description="Active JIRA project context")
    selected_tools: list[str] = Field(default_factory=list)
    metadata_summary: Optional[str] = None


@app.post("/api/prompts/generate")
def prompts_generate(
    body: GeneratePromptBody, session_id: str = Depends(get_rl_session_id)
) -> dict[str, Any]:
    api_key = get_openai_key(config)
    if not api_key:
        raise HTTPException(
            503,
            "OPENAI_API_KEY missing: set env or openai.api_key in config.yaml",
        )
    oa = config.get("openai") or {}
    model = oa.get("model", "gpt-4o-mini")
    t_prompt = float(oa.get("prompt_generation_temperature", 0.7))
    if body.selected_tools:
        bad = [x for x in body.selected_tools if x not in ALL_JIRA_TOOL_NAMES]
        if bad:
            raise HTTPException(400, f"Unknown tools: {bad}")
    store = _session_registry.get_store(session_id, "A")
    try:
        return generate_task_prompt(
            api_key=api_key,
            model=model,
            project_key=body.project_key,
            selected_tools=body.selected_tools,
            metadata_summary=body.metadata_summary,
            store=store,
            temperature=t_prompt,
        )
    except FileNotFoundError as e:
        raise HTTPException(500, str(e)) from e
    except ValueError as e:
        raise HTTPException(502, f"Prompt generation failed: {e}") from e
    except Exception as e:
        log.exception("prompt generation failed")
        raise HTTPException(500, f"Prompt generation failed: {e}") from e


class GenerateVerifiersBody(BaseModel):
    project_key: str
    user_prompt: str
    ideal_steps: list[dict[str, Any]] = Field(default_factory=list)
    ideal_final_response: str = ""


@app.post("/api/verifiers/generate")
def verifiers_generate_ai(body: GenerateVerifiersBody) -> dict[str, Any]:
    api_key = get_openai_key(config)
    if not api_key:
        raise HTTPException(
            503,
            "OPENAI_API_KEY missing: set env or openai.api_key in config.yaml",
        )
    oa = config.get("openai") or {}
    model = oa.get("model", "gpt-4o-mini")
    t_ver = float(oa.get("verifier_temperature", 0.25))
    try:
        out = generate_verifiers_ai(
            api_key=api_key,
            model=model,
            project_key=body.project_key,
            user_prompt=body.user_prompt,
            ideal_steps=body.ideal_steps,
            ideal_final_response=body.ideal_final_response,
            config=config,
            temperature=t_ver,
        )
        lf = out.get("verifier_log_file")
        if lf:
            log.info("Wrote verifier generation log to %s", lf)
        return out
    except FileNotFoundError as e:
        raise HTTPException(500, str(e)) from e
    except ValueError as e:
        raise HTTPException(502, f"Verifier model output invalid: {e}") from e
    except Exception as e:
        log.exception("verifier generation failed")
        raise HTTPException(500, f"Verifier generation failed: {e}") from e


@app.post("/api/tasks/save-golden")
def save_golden_task(
    payload: dict[str, Any] = Body(...),
    session_id: str = Depends(get_rl_session_id),
) -> dict[str, Any]:
    try:
        path = save_golden_task_json(config, payload)
        rel = str(path.relative_to(REPO_ROOT))
        log.info("Saved golden task to %s", rel)
        _session_registry.reset(session_id)
        log.info("Reset JIRA session DB for rl_session_id=%s after golden submit", session_id)
        return {"saved_to": rel, "session_db_reset": True}
    except Exception as e:
        log.exception("golden save failed")
        raise HTTPException(500, f"Could not save golden task: {e}") from e
