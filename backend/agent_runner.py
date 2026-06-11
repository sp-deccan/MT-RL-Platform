from __future__ import annotations

import json
import uuid
from typing import Any, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langchain_openai import ChatOpenAI

from backend.jira_store import JiraStore
from backend.openai_cost import estimate_chat_cost_usd

# Avoid enormous log files from huge tool payloads.
_MAX_TOOL_OUTPUT_CHARS = 400_000


def _tool_call_chunks(tc: Any) -> list[dict[str, Any]]:
    """Normalize tool_calls from AIMessage across LangChain versions."""
    raw = getattr(tc, "tool_calls", None) or []
    out: list[dict[str, Any]] = []
    for x in raw:
        if isinstance(x, dict):
            out.append(
                {
                    "id": x.get("id") or str(uuid.uuid4()),
                    "name": x["name"],
                    "args": x.get("args") or {},
                }
            )
        else:
            out.append(
                {
                    "id": getattr(x, "id", None) or str(uuid.uuid4()),
                    "name": x.name,
                    "args": dict(x.args) if hasattr(x, "args") else {},
                }
            )
    return out


def _content_for_log(content: Any) -> str:
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, default=str)
    except TypeError:
        return str(content)


def _token_usage_from_ai_message(ai: AIMessage) -> dict[str, Any]:
    meta_ai = getattr(ai, "response_metadata", None) or {}
    usage_meta = getattr(ai, "usage_metadata", None)
    token_usage: dict[str, Any] = {}
    if isinstance(meta_ai.get("token_usage"), dict):
        token_usage = dict(meta_ai["token_usage"])
    elif isinstance(usage_meta, dict):
        token_usage = {
            k: usage_meta[k]
            for k in ("input_tokens", "output_tokens", "total_tokens")
            if k in usage_meta
        }
        if "input_tokens" in token_usage and "prompt_tokens" not in token_usage:
            token_usage["prompt_tokens"] = token_usage.get("input_tokens")
        if "output_tokens" in token_usage and "completion_tokens" not in token_usage:
            token_usage["completion_tokens"] = token_usage.get("output_tokens")
    return token_usage


def _maybe_truncate(s: str) -> dict[str, Any]:
    if len(s) <= _MAX_TOOL_OUTPUT_CHARS:
        return {"text": s, "truncated": False}
    return {
        "text": s[:_MAX_TOOL_OUTPUT_CHARS]
        + "\n\n...[output truncated for log file]...",
        "truncated": True,
        "original_chars": len(s),
    }


def _assistant_text_from_message(msg: Any) -> str:
    if not isinstance(msg, AIMessage) or not msg.content:
        return ""
    if isinstance(msg.content, str):
        return msg.content
    return json.dumps(msg.content, default=str)


def _run_single_user_turn(
    *,
    messages: list[Any],
    llm: Any,
    tool_map: dict[str, StructuredTool],
    model: str,
    max_tool_rounds: int,
    config: Optional[dict[str, Any]],
    events: list[dict[str, Any]],
    conversation_turn: int,
    step_order_start: int,
) -> tuple[list[dict[str, Any]], str, int, int, float]:
    """
    Execute tool-calling rounds for one user message already appended to
    ``messages``. Returns (turn_steps, assistant_text, llm_rounds_used,
    next_global_step_order, turn_cost_usd).
    """
    steps: list[dict[str, Any]] = []
    order = step_order_start
    rounds = 0
    turn_cost = 0.0

    while rounds < max_tool_rounds:
        rounds += 1
        ai: AIMessage = llm.invoke(messages)
        calls = _tool_call_chunks(ai)

        c = ai.content
        if isinstance(c, str):
            content_empty = len(c.strip()) == 0
        else:
            content_empty = not c

        token_usage = _token_usage_from_ai_message(ai)
        meta_ai = getattr(ai, "response_metadata", None) or {}
        pt = int(token_usage.get("prompt_tokens", 0) or 0)
        ct = int(token_usage.get("completion_tokens", 0) or 0)
        model_for_cost = (
            meta_ai.get("model_name") if isinstance(meta_ai, dict) else None
        ) or model
        cost_info = estimate_chat_cost_usd(model_for_cost, pt, ct, config)
        round_cost = float(cost_info["total_usd"])
        turn_cost += round_cost

        n_calls = len(calls)
        allocated_per_tool = round_cost / n_calls if n_calls else 0.0

        events.append(
            {
                "type": "assistant",
                "conversation_turn": conversation_turn,
                "llm_round": rounds,
                "content": _content_for_log(ai.content),
                "content_empty": content_empty,
                "tool_calls": calls,
                "response_metadata": getattr(ai, "response_metadata", None),
                "additional_kwargs": getattr(ai, "additional_kwargs", None),
                "token_usage": token_usage,
                "cost_breakdown": cost_info,
                "cost_usd": round_cost,
            }
        )
        messages.append(ai)

        if not calls:
            break

        for tc in calls:
            order += 1
            name = tc["name"]
            args = tc["args"]
            tid = tc["id"]
            inp = json.dumps(args, default=str)
            if name not in tool_map:
                out = json.dumps({"error": f"Unknown tool: {name}"})
            else:
                try:
                    raw_out = tool_map[name].invoke(args)
                    out = raw_out if isinstance(raw_out, str) else str(raw_out)
                except Exception as e:
                    out = json.dumps({"error": str(e)})

            out_wrapped = _maybe_truncate(out)
            events.append(
                {
                    "type": "tool_result",
                    "conversation_turn": conversation_turn,
                    "llm_round": rounds,
                    "step_order": order,
                    "tool_call_id": tid,
                    "tool_name": name,
                    "arguments": args,
                    "output": out_wrapped["text"],
                    "output_truncated_in_log": out_wrapped["truncated"],
                    "openai_tool_execution_cost_usd": 0.0,
                    "openai_llm_round_cost_allocated_usd": round(
                        allocated_per_tool, 8
                    ),
                    "openai_llm_round_cost_total_usd": round(round_cost, 8),
                    "openai_llm_round_tool_call_share": (
                        f"1/{n_calls}" if n_calls else "0/0"
                    ),
                    **(
                        {"output_original_chars": out_wrapped["original_chars"]}
                        if out_wrapped["truncated"]
                        else {}
                    ),
                }
            )

            steps.append(
                {
                    "id": f"step-{order}-{uuid.uuid4().hex[:8]}",
                    "order": order,
                    "tool": name,
                    "input": inp,
                    "output": out,
                    "turnOrder": conversation_turn,
                    "llm_round": rounds,
                    "openai_cost_allocated_usd": round(allocated_per_tool, 8),
                    "openai_cost_full_llm_round_usd": round(round_cost, 8),
                    "openai_cost_breakdown": cost_info,
                    "openai_cost_note": (
                        "Allocated share of this LLM completion when multiple "
                        "tools were requested in one call; sum of allocated "
                        "shares across tools in the round equals the round total."
                    ),
                }
            )
            messages.append(ToolMessage(content=out, tool_call_id=tid))

    last = messages[-1]
    if isinstance(last, ToolMessage):
        assistant_text = "(no assistant text after tools)"
    else:
        assistant_text = (
            _assistant_text_from_message(last)
            or "(no assistant text after tools)"
        )

    return steps, assistant_text, rounds, order, turn_cost


def run_multi_turn_tool_agent(
    *,
    store: JiraStore,
    tools: list[StructuredTool],
    system_prompt: str,
    system_prompt_file: Optional[str] = None,
    turn_messages: list[str],
    api_key: str,
    model: str,
    temperature: float,
    max_tool_rounds: int,
    config: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Run a multi-turn conversation: each user message may trigger tool calls
    before the assistant replies and the next user turn begins.
    """
    _ = store
    if not turn_messages:
        raise ValueError("turn_messages must not be empty")

    tool_map = {t.name: t for t in tools}
    llm = ChatOpenAI(
        api_key=api_key,
        model=model,
        temperature=temperature,
    ).bind_tools(tools)

    messages: list[Any] = [SystemMessage(content=system_prompt)]
    all_steps: list[dict[str, Any]] = []
    turns: list[dict[str, Any]] = []
    total_llm_rounds = 0
    total_estimated_openai_cost_usd = 0.0
    global_step_order = 0

    session_meta: dict[str, Any] = {
        "type": "session",
        "model": model,
        "temperature": temperature,
        "max_tool_rounds": max_tool_rounds,
        "conversation_turns": len(turn_messages),
        "tools_bound": sorted(tool_map.keys()),
        "system_prompt_text": system_prompt,
    }
    if system_prompt_file:
        session_meta["system_prompt_file"] = system_prompt_file
    events: list[dict[str, Any]] = [session_meta]

    for turn_idx, user_text in enumerate(turn_messages, start=1):
        messages.append(HumanMessage(content=user_text))
        events.append(
            {
                "type": "user_turn",
                "conversation_turn": turn_idx,
                "content": user_text,
            }
        )

        turn_steps, assistant_text, rounds_used, next_order, turn_cost = (
            _run_single_user_turn(
                messages=messages,
                llm=llm,
                tool_map=tool_map,
                model=model,
                max_tool_rounds=max_tool_rounds,
                config=config,
                events=events,
                conversation_turn=turn_idx,
                step_order_start=global_step_order,
            )
        )
        global_step_order = next_order
        total_llm_rounds += rounds_used
        total_estimated_openai_cost_usd += turn_cost
        all_steps.extend(turn_steps)

        turn_record = {
            "id": f"turn-{turn_idx}-{uuid.uuid4().hex[:8]}",
            "order": turn_idx,
            "userMessage": user_text,
            "assistantMessage": assistant_text,
            "steps": turn_steps,
        }
        turns.append(turn_record)
        if isinstance(messages[-1], ToolMessage):
            messages.append(AIMessage(content=assistant_text))

        events.append(
            {
                "type": "turn_end",
                "conversation_turn": turn_idx,
                "assistant_message": assistant_text,
                "tool_steps_in_turn": len(turn_steps),
                "llm_rounds_in_turn": rounds_used,
            }
        )

    final_text = turns[-1]["assistantMessage"] if turns else ""
    finish_reason = "completed_multi_turn"

    events.append(
        {
            "type": "session_end",
            "finish_reason": finish_reason,
            "conversation_turns": len(turns),
            "llm_rounds_executed": total_llm_rounds,
            "tool_steps": global_step_order,
            "total_estimated_openai_cost_usd": round(
                total_estimated_openai_cost_usd, 8
            ),
            "openai_cost_note": (
                "USD estimates from token usage × config/default pricing; "
                "not invoice-precise. Tool execution has no OpenAI marginal cost."
            ),
        }
    )

    return {
        "final_response": final_text or "(no assistant text after tools)",
        "turns": turns,
        "steps": all_steps,
        "model_log": {
            "events": events,
            "finish_reason": finish_reason,
            "llm_rounds": total_llm_rounds,
            "conversation_turns": len(turns),
            "total_estimated_openai_cost_usd": round(
                total_estimated_openai_cost_usd, 8
            ),
        },
    }


def run_tool_agent(
    *,
    store: JiraStore,
    tools: list[StructuredTool],
    system_prompt: str,
    system_prompt_file: Optional[str] = None,
    user_content: str,
    api_key: str,
    model: str,
    temperature: float,
    max_tool_rounds: int,
    config: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Single-turn wrapper around :func:`run_multi_turn_tool_agent`."""
    return run_multi_turn_tool_agent(
        store=store,
        tools=tools,
        system_prompt=system_prompt,
        system_prompt_file=system_prompt_file,
        turn_messages=[user_content],
        api_key=api_key,
        model=model,
        temperature=temperature,
        max_tool_rounds=max_tool_rounds,
        config=config,
    )
