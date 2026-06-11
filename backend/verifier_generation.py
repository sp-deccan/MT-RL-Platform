from __future__ import annotations

import json
import re
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from backend.openai_cost import estimate_chat_cost_usd
from backend.settings import REPO_ROOT
from backend.verifier_run_log import write_verifier_session_json


def _verifiers_dir() -> Path:
    return (REPO_ROOT / "prompts" / "verifiers").resolve()


def _read(name: str) -> str:
    p = _verifiers_dir() / name
    if not p.is_file():
        raise FileNotFoundError(f"Missing verifier prompt: {p}")
    return p.read_text(encoding="utf-8")


def _extract_json_object(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    t = t.strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", t)
        if not m:
            raise ValueError("Model output is not valid JSON") from None
        return json.loads(m.group())


def _step(
    name: str,
    *,
    ai_usage: bool = False,
    details: dict[str, Any],
) -> dict[str, Any]:
    return {
        "name": name,
        "ai_usage": ai_usage,
        "cost_usd": 0.0,
        "token_usage": None,
        "cost_breakdown": None,
        "details": details,
    }


def generate_verifiers_ai(
    *,
    api_key: str,
    model: str,
    project_key: str,
    user_prompt: str,
    ideal_steps: list[dict[str, Any]],
    ideal_final_response: str,
    config: dict[str, Any],
    temperature: float = 0.25,
) -> dict[str, Any]:
    """
    Generate trace + end-state verifier strings via OpenAI.
    Writes json_logs/verifier_run_*.json (or logging.verifier_runs_dir) with
    per-step details and AI cost for the model call step.

    Returns trace_verifier, end_state_verifier, and verifier_log_file (repo-relative).
    """
    written_at = datetime.now(timezone.utc).isoformat()

    base_payload: dict[str, Any] = {
        "log_version": 1,
        "kind": "verifier_generation",
        "written_at": written_at,
        "model_config": {
            "model": model,
            "temperature": temperature,
        },
        "request": {
            "project_key": project_key,
            "user_prompt": user_prompt,
            "ideal_steps": ideal_steps,
            "ideal_final_response": ideal_final_response,
        },
        "prompt_files_dir": str(_verifiers_dir()),
        "steps": [],
        "totals": {
            "ai_steps": 0,
            "total_estimated_cost_usd": 0.0,
            "total_prompt_tokens": 0,
            "total_completion_tokens": 0,
        },
        "status": "error",
        "result": None,
        "error": None,
    }

    steps_out: list[dict[str, Any]] = []
    order = 0

    def append_step(s: dict[str, Any]) -> None:
        nonlocal order
        order += 1
        s["step_order"] = order
        steps_out.append(s)
        base_payload["steps"] = steps_out

    try:
        # --- Step: load prompt files ---
        meta = _read("generate_meta_system.md")
        trace_inst = _read("trace_instructions.md")
        end_inst = _read("end_state_instructions.md")
        meta_rel = "prompts/verifiers/generate_meta_system.md"
        base_payload["verifier_generation_system_prompt"] = {
            "file": "generate_meta_system.md",
            "repo_relative_path": meta_rel,
            "text": meta,
        }
        append_step(
            _step(
                "load_verifier_prompt_files",
                details={
                    "files": {
                        "generate_meta_system.md": {
                            "path": str(_verifiers_dir() / "generate_meta_system.md"),
                            "chars": len(meta),
                            "content": meta,
                        },
                        "trace_instructions.md": {
                            "path": str(_verifiers_dir() / "trace_instructions.md"),
                            "chars": len(trace_inst),
                            "content": trace_inst,
                        },
                        "end_state_instructions.md": {
                            "path": str(
                                _verifiers_dir() / "end_state_instructions.md"
                            ),
                            "chars": len(end_inst),
                            "content": end_inst,
                        },
                    },
                },
            )
        )

        human = f"""## Project context
Active JIRA project key: {project_key}

## User task prompt
{user_prompt.strip() or "(empty)"}

## Ideal trajectory steps (JSON array, each step has tool, input, output)
{json.dumps(ideal_steps, indent=2, default=str)}

## Ideal final response (gold answer text)
{ideal_final_response.strip() or "(empty)"}

---

## Directions: trace verifier
{trace_inst}

---

## Directions: end-state verifier
{end_inst}

---

Produce the JSON object as specified in your system instructions.
"""

        append_step(
            _step(
                "compose_llm_messages",
                details={
                    "system_message": {
                        "role": "system",
                        "chars": len(meta),
                        "content": meta,
                    },
                    "human_message": {
                        "role": "user",
                        "chars": len(human),
                        "content": human,
                    },
                    "note": "Full texts above are exactly what was sent to the API.",
                },
            )
        )

        llm = ChatOpenAI(api_key=api_key, model=model, temperature=temperature)
        messages = [SystemMessage(content=meta), HumanMessage(content=human)]

        append_step(
            _step(
                "openai_chat_invoke",
                ai_usage=True,
                details={
                    "invocation": {
                        "class": "langchain_openai.ChatOpenAI",
                        "model": model,
                        "temperature": temperature,
                        "message_count": len(messages),
                    },
                },
            )
        )

        msg = llm.invoke(messages)
        content = msg.content
        text = content if isinstance(content, str) else json.dumps(content, default=str)

        meta_ai = getattr(msg, "response_metadata", None) or {}
        usage_meta = getattr(msg, "usage_metadata", None)
        token_usage = {}
        if isinstance(meta_ai.get("token_usage"), dict):
            token_usage = dict(meta_ai["token_usage"])
        elif isinstance(usage_meta, dict):
            # LangChain sometimes puts counts on usage_metadata
            token_usage = {
                k: usage_meta[k]
                for k in ("input_tokens", "output_tokens", "total_tokens")
                if k in usage_meta
            }
            if "input_tokens" in token_usage and "prompt_tokens" not in token_usage:
                token_usage["prompt_tokens"] = token_usage.get("input_tokens")
            if "output_tokens" in token_usage and "completion_tokens" not in token_usage:
                token_usage["completion_tokens"] = token_usage.get("output_tokens")

        pt = int(token_usage.get("prompt_tokens", 0) or 0)
        ct = int(token_usage.get("completion_tokens", 0) or 0)
        model_for_cost = (
            meta_ai.get("model_name") if isinstance(meta_ai, dict) else None
        ) or model

        cost_info = estimate_chat_cost_usd(model_for_cost, pt, ct, config)

        # Enrich the LLM step (last step) with response + usage + cost
        llm_step = steps_out[-1]
        llm_step["details"]["response"] = {
            "assistant_text": text,
            "assistant_chars": len(text),
            "langchain_response_metadata": meta_ai,
            "langchain_usage_metadata": usage_meta,
            "additional_kwargs": getattr(msg, "additional_kwargs", None),
        }
        llm_step["token_usage"] = token_usage
        llm_step["cost_breakdown"] = cost_info
        llm_step["cost_usd"] = float(cost_info["total_usd"])

        base_payload["totals"] = {
            "ai_steps": 1,
            "total_estimated_cost_usd": round(float(cost_info["total_usd"]), 8),
            "total_prompt_tokens": pt,
            "total_completion_tokens": ct,
            "total_tokens_reported": int(token_usage.get("total_tokens", pt + ct) or 0),
        }

        data = _extract_json_object(text)
        trace = data.get("trace_verifier")
        end = data.get("end_state_verifier")
        if not isinstance(trace, str) or not isinstance(end, str):
            raise ValueError(
                'JSON must contain string fields "trace_verifier" and "end_state_verifier"'
            )

        append_step(
            _step(
                "parse_verifier_json",
                details={
                    "parsed_keys": list(data.keys()),
                    "trace_verifier_chars": len(trace.strip()),
                    "end_state_verifier_chars": len(end.strip()),
                    "trace_verifier_preview": trace.strip()[:2000],
                    "end_state_verifier_preview": end.strip()[:2000],
                },
            )
        )

        base_payload["status"] = "ok"
        base_payload["result"] = {
            "trace_verifier": trace.strip(),
            "end_state_verifier": end.strip(),
        }

        write_verifier_session_json(config, base_payload)
        log_file_rel = str(base_payload["written_log_file"])

        return {
            "trace_verifier": trace.strip(),
            "end_state_verifier": end.strip(),
            "verifier_log_file": log_file_rel,
            "verifier_system_prompt_file": meta_rel,
            "verifier_system_prompt_text": meta,
        }

    except Exception as e:
        base_payload["status"] = "error"
        base_payload["error"] = {
            "type": type(e).__name__,
            "message": str(e),
            "traceback": traceback.format_exc(),
        }
        try:
            write_verifier_session_json(config, base_payload)
        except Exception as w:
            base_payload["log_write_error"] = str(w)
        raise
