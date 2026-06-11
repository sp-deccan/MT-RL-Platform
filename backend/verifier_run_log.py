from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.settings import REPO_ROOT


def verifier_runs_dir(config: dict[str, Any]) -> Path:
    log_cfg = config.get("logging") or {}
    rel = log_cfg.get("verifier_runs_dir") or log_cfg.get(
        "agent_runs_dir", "json_logs"
    )
    return (REPO_ROOT / str(rel)).resolve()


def write_verifier_session_json(
    config: dict[str, Any],
    payload: dict[str, Any],
) -> Path:
    out_dir = verifier_runs_dir(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = out_dir / f"verifier_run_{stamp}.json"
    payload["written_log_file"] = str(path.relative_to(REPO_ROOT))
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path
