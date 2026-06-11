from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from backend.jira_store import JiraStore
from backend.jira_tools import ALL_JIRA_TOOL_NAMES, build_jira_tools, filter_tools
from backend.settings import REPO_ROOT


def _task_prompts_dir() -> Path:
    return (REPO_ROOT / "prompts" / "task").resolve()


def _read_system_prompt() -> str:
    p = _task_prompts_dir() / "generate_system.md"
    if not p.is_file():
        raise FileNotFoundError(f"Missing task prompt file: {p}")
    return p.read_text(encoding="utf-8")


def _strip_wrapping(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        lines = t.splitlines()
        if len(lines) >= 2 and lines[-1].strip() == "```":
            t = "\n".join(lines[1:-1]).strip()
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        t = t[1:-1].strip()
    return t


def generate_task_prompt(
    *,
    api_key: str,
    model: str,
    project_key: str,
    selected_tools: list[str],
    metadata_summary: Optional[str],
    store: JiraStore,
    temperature: float = 0.7,
) -> dict[str, Any]:
    """
    Generate a user-facing JIRA task prompt via OpenAI.
    Returns ``prompt`` (string) and ``model`` used.
    """
    system = _read_system_prompt()
    all_tools = build_jira_tools(store)
    tools = filter_tools(all_tools, selected_tools or None)
    tool_lines = [
        f"- {t.name}: {(t.description or '').strip() or '(no description)'}"
        for t in tools
    ]
    if selected_tools:
        bad = [x for x in selected_tools if x not in ALL_JIRA_TOOL_NAMES]
        if bad:
            raise ValueError(f"Unknown tools: {bad}")

    human_parts = [
        f"**Active JIRA project key:** {project_key.upper()}",
        "",
        "**Allowed tools:**",
        "\n".join(tool_lines) if tool_lines else "(none — use general JIRA assistant tasks)",
    ]
    if metadata_summary:
        human_parts.extend(
            [
                "",
                "**CSV / task metadata (context only):**",
                metadata_summary[:8000],
            ]
        )
    human_parts.extend(
        [
            "",
            "**Database snapshot (read-only hint):**",
            store.dump_snapshot_json(),
            "",
            "Write the user task prompt now.",
        ]
    )
    human = "\n".join(human_parts)

    llm = ChatOpenAI(api_key=api_key, model=model, temperature=temperature)
    resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=human)])
    content = getattr(resp, "content", "") or ""
    if isinstance(content, list):
        content = "".join(
            block.get("text", "") if isinstance(block, dict) else str(block)
            for block in content
        )
    prompt = _strip_wrapping(str(content).strip())
    if not prompt:
        raise ValueError("Model returned an empty prompt")

    return {
        "prompt": prompt,
        "model": model,
        "system_prompt_file": "prompts/task/generate_system.md",
    }
