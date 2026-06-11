from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.settings import REPO_ROOT


def golden_tasks_dir(config: dict[str, Any]) -> Path:
    rel = (config.get("golden") or {}).get(
        "tasks_dir",
        "Golden_trajecoty",
    )
    return (REPO_ROOT / str(rel)).resolve()


def save_golden_task_json(config: dict[str, Any], payload: dict[str, Any]) -> Path:
    out_dir = golden_tasks_dir(config)
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S-%fZ")
    path = out_dir / f"golden_task_{stamp}.json"
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return path
