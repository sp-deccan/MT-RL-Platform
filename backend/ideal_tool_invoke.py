from __future__ import annotations

import json
from typing import Any

from pydantic import ValidationError

from backend.jira_store import JiraStore
from backend.jira_tools import ALL_JIRA_TOOL_NAMES, build_jira_tools


def _tool_schema_hint(tool: Any) -> str:
    parts: list[str] = []
    desc = getattr(tool, "description", None) or ""
    if desc.strip():
        parts.append(f"Tool description: {desc.strip()}")
    schema = getattr(tool, "args_schema", None)
    if schema is not None and hasattr(schema, "model_json_schema"):
        try:
            parts.append(
                "Expected parameters (JSON schema):\n"
                + json.dumps(schema.model_json_schema(), indent=2, default=str)
            )
        except Exception:
            pass
    return "\n\n".join(parts) if parts else "No schema available; use empty object {} for no-arg tools."


def _format_validation_error(err: ValidationError, tool: Any) -> str:
    lines = ["Parameter validation failed:"]
    for e in err.errors():
        loc = ".".join(str(x) for x in e.get("loc", ()))
        msg = e.get("msg", "")
        lines.append(f"  - {loc}: {msg}")
    lines.append("")
    lines.append("How to fix:")
    lines.append(_tool_schema_hint(tool))
    return "\n".join(lines)


def invoke_ideal_tool(
    store: JiraStore,
    tool_name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    """
    Run a single JIRA tool with dict arguments (from ideal step input JSON).
    Returns { ok, output? , error?, suggestion? }.
    """
    name = (tool_name or "").strip()
    if name not in ALL_JIRA_TOOL_NAMES:
        return {
            "ok": False,
            "error": f"Unknown tool: {name!r}",
            "suggestion": (
                "Use one of the registered JIRA tools: "
                + ", ".join(sorted(ALL_JIRA_TOOL_NAMES))
            ),
        }

    tools = build_jira_tools(store)
    tool = next((t for t in tools if t.name == name), None)
    if tool is None:
        return {
            "ok": False,
            "error": f"Tool {name} not bound",
            "suggestion": "Server misconfiguration; rebuild tool list.",
        }

    args = arguments if isinstance(arguments, dict) else {}

    try:
        raw = tool.invoke(args)
        out = raw if isinstance(raw, str) else str(raw)
        return {"ok": True, "output": out}
    except ValidationError as e:
        return {
            "ok": False,
            "error": str(e),
            "suggestion": _format_validation_error(e, tool),
        }
    except TypeError as e:
        return {
            "ok": False,
            "error": str(e),
            "suggestion": _tool_schema_hint(tool),
        }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "suggestion": (
                "Check argument types and required fields. "
                + _tool_schema_hint(tool)
            ),
        }
