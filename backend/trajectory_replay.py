from __future__ import annotations

import json
import logging
from typing import Any

from backend.ideal_tool_invoke import invoke_ideal_tool
from backend.jira_store import JiraStore
from backend.session_jira import SessionJiraRegistry

log = logging.getLogger(__name__)


def replay_trajectory_steps_on_store(
    store: JiraStore,
    steps: list[dict[str, Any]],
    *,
    fork_label: str,
) -> list[dict[str, Any]]:
    """
    Execute each step's tool on ``store`` (used for dummy offline → SQLite sync).

    Returns a list of per-step error dicts; empty list means all invocations ok.
    """
    errors: list[dict[str, Any]] = []
    for i, step in enumerate(steps):
        tool = str(step.get("tool") or "").strip()
        raw_in = step.get("input")
        raw = raw_in if isinstance(raw_in, str) else ""
        try:
            args = json.loads(raw) if raw.strip() else {}
            if not isinstance(args, dict):
                raise ValueError("input JSON must be an object")
        except (json.JSONDecodeError, ValueError, TypeError) as e:
            errors.append(
                {
                    "step_index": i,
                    "tool": tool,
                    "error": f"Invalid JSON input: {e}",
                }
            )
            continue
        if not tool:
            errors.append({"step_index": i, "error": "Missing tool name"})
            continue
        result = invoke_ideal_tool(store, tool, args)
        if not result.get("ok"):
            errors.append(
                {
                    "step_index": i,
                    "tool": tool,
                    "error": result.get("error", "unknown"),
                }
            )
    if errors:
        log.warning(
            "Replay on fork %s finished with %d error(s)",
            fork_label,
            len(errors),
        )
    return errors


def replay_dummy_forks_ab(
    registry: SessionJiraRegistry,
    session_id: str,
    steps_a: list[dict[str, Any]],
    steps_b: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Reset only forks A and B (ideal untouched), re-seed, replay dummy trajectories.

    Mirrors server-side effects so QC / DB explorer match offline dummy traces.
    """
    registry.reset_fork(session_id, "A")
    registry.reset_fork(session_id, "B")
    store_a = registry.get_store(session_id, "A")
    err_a = replay_trajectory_steps_on_store(store_a, steps_a, fork_label="A")
    store_b = registry.get_store(session_id, "B")
    err_b = replay_trajectory_steps_on_store(store_b, steps_b, fork_label="B")
    return {"errors_a": err_a, "errors_b": err_b}


def replay_ideal_fork_only(
    registry: SessionJiraRegistry,
    session_id: str,
    steps: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Reset ideal fork, then replay steps so SQLite matches the ideal trajectory JSON."""
    registry.reset_fork(session_id, "ideal")
    store = registry.get_store(session_id, "ideal")
    return replay_trajectory_steps_on_store(store, steps, fork_label="ideal")


def sync_qc_view_state(
    registry: SessionJiraRegistry,
    session_id: str,
    *,
    steps_a: list[dict[str, Any]],
    steps_b: list[dict[str, Any]],
    steps_ideal: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Align session SQLite with what QC should display.

    **Always** reset forks A and B and replay ``steps_a`` / ``steps_b`` so QC matches
    the annotator trajectories (whether they came from dummy generation or from
    ``/api/agent/run``). Relying on the live agent SQLite alone was brittle (session
    mismatch, ordering); replay from JSON is the source of truth for QC.

    If ``steps_ideal`` is non-empty, reset the ideal fork and replay those steps.
    """
    ab = replay_dummy_forks_ab(registry, session_id, steps_a, steps_b)
    errors_ideal: list[dict[str, Any]] = []
    synced_ideal = False

    if steps_ideal:
        errors_ideal = replay_ideal_fork_only(registry, session_id, steps_ideal)
        synced_ideal = True

    return {
        "errors_a": ab["errors_a"],
        "errors_b": ab["errors_b"],
        "errors_ideal": errors_ideal,
        "synced_ab": True,
        "synced_ideal": synced_ideal,
    }
