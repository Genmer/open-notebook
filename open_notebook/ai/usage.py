"""
Local token usage recording for LLM and embedding calls.

Rows land in the model_usage table and never leave the database (privacy).
Recording is strictly never-fail: a tracking problem must not break the AI
call it observes, so every path swallows exceptions after logging.
"""

import asyncio
import threading
from datetime import datetime, timezone
from typing import Any, List, Optional

from loguru import logger

from open_notebook.database.repository import repo_insert

# Usage-key styles seen across providers: langchain's normalized
# usage_metadata, OpenAI-style token_usage, and generic usage dicts.
_INPUT_TOKEN_KEYS = ("input_tokens", "prompt_tokens")
_OUTPUT_TOKEN_KEYS = ("output_tokens", "completion_tokens")
_TOTAL_TOKEN_KEYS = ("total_tokens",)


def _first_int(source: Any, keys: tuple) -> Optional[int]:
    if not isinstance(source, dict):
        return None
    for key in keys:
        value = source.get(key)
        if isinstance(value, int):
            return value
    return None


def extract_token_usage(ai_message: Any) -> tuple[Optional[int], Optional[int], Optional[int]]:
    """Pull (input, output, total) tokens from an AI message, or (None, None, None)."""
    candidates = []
    usage_metadata = getattr(ai_message, "usage_metadata", None)
    if usage_metadata:
        candidates.append(usage_metadata)
    response_metadata = getattr(ai_message, "response_metadata", None)
    if isinstance(response_metadata, dict):
        for key in ("token_usage", "usage"):
            if response_metadata.get(key):
                candidates.append(response_metadata[key])

    for candidate in candidates:
        input_tokens = _first_int(candidate, _INPUT_TOKEN_KEYS)
        output_tokens = _first_int(candidate, _OUTPUT_TOKEN_KEYS)
        total_tokens = _first_int(candidate, _TOTAL_TOKEN_KEYS)
        if input_tokens is not None or output_tokens is not None or total_tokens is not None:
            return input_tokens, output_tokens, total_tokens
    return None, None, None


async def _usage_tracking_enabled() -> bool:
    # Fresh read on purpose: ContentSettings is a per-process RecordModel
    # singleton, so the worker would keep whatever it loaded at startup and
    # never see the UI toggle. One tiny SELECT per AI call is the price of the
    # switch actually working where the tokens are spent.
    try:
        from open_notebook.database.repository import repo_query

        rows = await repo_query(
            "SELECT usage_tracking_enabled FROM open_notebook:content_settings LIMIT 1"
        )
        value = rows[0].get("usage_tracking_enabled") if rows else None
        # Missing record/field means "never configured" -> default on (fail-open).
        return True if value is None else bool(value)
    except Exception as e:
        logger.debug(f"Could not read usage_tracking_enabled, assuming enabled: {e}")
        return True


async def _write_usage_row(row: dict) -> None:
    await repo_insert("model_usage", [row])


async def record_llm_usage(
    *,
    model: Optional[Any] = None,
    ai_message: Optional[Any] = None,
    call_type: str,
    correlation_id: Optional[str] = None,
    success: bool = True,
    error: Optional[str] = None,
) -> None:
    """Record one LLM call. model is a ProvisionedModel (or None when
    provisioning itself failed). Never raises."""
    try:
        if not await _usage_tracking_enabled():
            return

        input_tokens: Optional[int] = None
        output_tokens: Optional[int] = None
        total_tokens: Optional[int] = None
        if ai_message is not None:
            input_tokens, output_tokens, total_tokens = extract_token_usage(ai_message)

        await _write_usage_row(
            {
                "created": datetime.now(timezone.utc),
                "day": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "model_name": getattr(model, "model_name", None),
                "provider": getattr(model, "provider", None),
                "model_id": getattr(model, "model_id", None),
                "call_type": call_type,
                "correlation_id": correlation_id,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "total_tokens": total_tokens,
                "is_estimated": False,
                "success": success,
                "error": error[:500] if error else None,
            }
        )
    except Exception as e:
        logger.debug(f"Failed to record LLM usage: {e}")


def record_llm_usage_sync(**kwargs) -> None:
    """Fire-and-forget variant for sync graph nodes: runs the async recorder on
    a daemon thread with its own event loop so the caller never blocks."""
    def _run() -> None:
        try:
            asyncio.run(record_llm_usage(**kwargs))
        except Exception as e:  # pragma: no cover - defensive
            logger.debug(f"Failed to record LLM usage (sync): {e}")

    threading.Thread(target=_run, daemon=True).start()


async def record_embedding_usage(
    *,
    model: Any,
    texts: List[str],
    success: bool = True,
    error: Optional[str] = None,
) -> None:
    """Record one embedding batch. Provider APIs don't report embedding token
    counts, so tokens are estimated locally (is_estimated=True). Never raises."""
    try:
        if not await _usage_tracking_enabled():
            return

        from open_notebook.utils.token_utils import token_count

        estimated = sum(token_count(t) for t in texts)

        await _write_usage_row(
            {
                "created": datetime.now(timezone.utc),
                "day": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "model_name": getattr(model, "model_name", None),
                "provider": getattr(model, "provider", None),
                "model_id": None,
                "call_type": "embedding",
                "correlation_id": None,
                "input_tokens": estimated,
                "output_tokens": None,
                "total_tokens": estimated,
                "is_estimated": True,
                "success": success,
                "error": error[:500] if error else None,
            }
        )
    except Exception as e:
        logger.debug(f"Failed to record embedding usage: {e}")
