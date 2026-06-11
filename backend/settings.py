from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent


def _expand_env_in_str(s: str) -> str:
    def repl(m: re.Match[str]) -> str:
        return os.environ.get(m.group(1), "")

    return re.sub(r"\$\{([^}]+)\}", repl, s)


def _expand_env(obj: Any) -> Any:
    if isinstance(obj, str):
        return _expand_env_in_str(obj)
    if isinstance(obj, dict):
        return {k: _expand_env(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_expand_env(x) for x in obj]
    return obj


def load_config(path: Path | None = None) -> dict[str, Any]:
    cfg_path = path or REPO_ROOT / "config.yaml"
    if not cfg_path.is_file():
        example = REPO_ROOT / "config.example.yaml"
        if example.is_file():
            raw = example.read_text()
        else:
            raw = "{}"
    else:
        raw = cfg_path.read_text()
    raw = _expand_env_in_str(raw)
    data = yaml.safe_load(raw) or {}
    return _expand_env(data)


def get_openai_key(config: dict[str, Any]) -> str:
    key = (config.get("openai") or {}).get("api_key") or ""
    if not key.strip():
        key = os.environ.get("OPENAI_API_KEY", "")
    return key.strip()
