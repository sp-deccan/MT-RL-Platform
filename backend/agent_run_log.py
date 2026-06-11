from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.settings import REPO_ROOT


def agent_runs_dir(config: dict[str, Any]) -> Path:
    log_cfg = config.get("logging") or {}
    rel = log_cfg.get("agent_runs_dir", "json_logs")
    return (REPO_ROOT / str(rel)).resolve()


def write_agent_session_json(
    config: dict[str, Any],
    payload: dict[str, Any],
) -> Path:
    """Write one JSON file per agent/session request; returns path written."""
    out_dir = agent_runs_dir(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = out_dir / f"agent_run_{stamp}.json"
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path
