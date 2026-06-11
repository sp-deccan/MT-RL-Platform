from __future__ import annotations

import re
from typing import Any

# Default USD per 1M tokens (adjust via config openai.pricing_usd_per_1m_tokens).
# Sourced from public OpenAI pricing; override in config when rates change.
_DEFAULT_RATES: dict[str, dict[str, float]] = {
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "gpt-4o": {"input": 2.50, "output": 10.00},
    "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    "gpt-3.5-turbo": {"input": 0.50, "output": 1.50},
    "gpt-4.1": {"input": 2.00, "output": 8.00},
    "gpt-4.1-mini": {"input": 0.40, "output": 1.60},
    "o1-mini": {"input": 3.00, "output": 12.00},
    "o1": {"input": 15.00, "output": 60.00},
}


def _normalize_model_key(model: str) -> str:
    """Map API names like gpt-4o-mini-2024-07-18 → gpt-4o-mini."""
    m = (model or "").strip().lower()
    if not m:
        return ""
    # Strip dated / snapshot suffixes OpenAI appends
    m = re.sub(r"-\d{4}-\d{2}-\d{2}$", "", m)
    m = re.sub(r"-\d{8}$", "", m)
    return m


def _resolve_rates(model: str, config: dict[str, Any] | None) -> tuple[dict[str, float], str]:
    """
    Returns (rates dict with input/output per 1M USD, matched_key).
    """
    key = _normalize_model_key(model)
    custom = ((config or {}).get("openai") or {}).get("pricing_usd_per_1m_tokens")
    if isinstance(custom, dict):
        for candidate in (key, model.strip().lower()):
            if not candidate:
                continue
            entry = custom.get(candidate)
            if isinstance(entry, dict):
                inp = float(entry.get("input", 0) or 0)
                out = float(entry.get("output", 0) or 0)
                return {"input": inp, "output": out}, candidate

    for prefix in sorted(_DEFAULT_RATES.keys(), key=len, reverse=True):
        if key == prefix or key.startswith(prefix + "-"):
            return dict(_DEFAULT_RATES[prefix]), prefix
    return {"input": 0.0, "output": 0.0}, key or "unknown"


def estimate_chat_cost_usd(
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
    config: dict[str, Any] | None = None,
) -> dict[str, Any]:
    rates, matched = _resolve_rates(model, config)
    pin = max(0, int(prompt_tokens or 0))
    cout = max(0, int(completion_tokens or 0))
    in_usd = pin / 1_000_000.0 * rates["input"]
    out_usd = cout / 1_000_000.0 * rates["output"]
    total = in_usd + out_usd
    return {
        "currency": "USD",
        "model_requested": model,
        "pricing_matched_key": matched,
        "rates_usd_per_1m_tokens": rates,
        "prompt_tokens": pin,
        "completion_tokens": cout,
        "input_usd": round(in_usd, 8),
        "output_usd": round(out_usd, 8),
        "total_usd": round(total, 8),
        "pricing_known": rates["input"] > 0 or rates["output"] > 0,
    }
