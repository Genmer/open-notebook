"""History-editing endpoints for chat sessions (PDR-005).

POST /api/chat/sessions/{session_id}/messages/delete removes selected
messages from the LangGraph checkpoint; POST .../messages/clear removes all
of them. Deletion is a HARD delete on the owning graph's checkpoint via
``update_state`` + ``RemoveMessage`` (``REMOVE_ALL_MESSAGES`` for clear), so
every checkpoint reader — stream complete, /chat/execute, session GET,
message counts, chat_parallel — stays on the single get_state data source
with zero reader-side changes.

Guard rails:
- 409 when a stream generation is in flight for the session (merged guard
  across the notebook and source stream routers).
- The target graph is resolved from the session's `refers_to` edge: the two
  graphs carry different state channels, and writing through the wrong one
  would blank the source-only channels.
- Deletion is atomic: if any requested id is missing from the checkpoint, the
  whole request 404s and nothing is removed.
- The session row is intentionally NOT re-saved: bumping `updated` would make
  the session jump to the top of the list on a mere content deletion.

Import note (langgraph): ``RemoveMessage`` comes from
``langchain_core.messages``, while the clear-all sentinel
``REMOVE_ALL_MESSAGES`` only exists in ``langgraph.graph.message``.
"""

import asyncio
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from langchain_core.messages import RemoveMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from loguru import logger
from pydantic import BaseModel, Field

from api.routers._chat_shared import (
    ChatMessage,
    extract_chat_messages,
    get_session_or_404,
    resolve_session_owner_kind,
    session_in_generation,
)
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.graphs.source_chat import (
    source_chat_graph as source_chat_graph,
)

router = APIRouter()

# Upper bound on one delete request, keeping a single update_state write small.
MAX_DELETE_IDS = 500

_IN_GENERATION_DETAIL = "A generation is already in progress for this session"


class DeleteMessagesRequest(BaseModel):
    message_ids: List[str] = Field(
        ..., description="Checkpoint message ids to delete (1..500)"
    )


class DeleteMessagesResponse(BaseModel):
    session_id: str = Field(..., description="Normalized session ID")
    deleted_count: int = Field(..., description="Number of messages removed")
    messages: List[ChatMessage] = Field(
        ..., description="Remaining messages after the deletion"
    )


def _graph_for_owner(owner_kind: str):
    """Map the session's parent kind to its owning LangGraph."""
    return source_chat_graph if owner_kind == "source" else chat_graph


def _remove_messages_payload(message_ids: Optional[List[str]]) -> dict:
    """Build the update_state payload for a hard delete.

    A single REMOVE_ALL_MESSAGES sentinel clears every message; otherwise one
    RemoveMessage per id.
    """
    if message_ids is None:
        return {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES)]}
    return {"messages": [RemoveMessage(id=message_id) for message_id in message_ids]}


async def _delete_history(
    session_id: str, message_ids: Optional[List[str]]
) -> DeleteMessagesResponse:
    """Shared implementation for the delete and clear endpoints.

    ``message_ids=None`` means "clear everything" (REMOVE_ALL_MESSAGES).
    """
    full_session_id, _session = await get_session_or_404(session_id)

    if session_in_generation(full_session_id):
        raise HTTPException(status_code=409, detail=_IN_GENERATION_DETAIL)

    owner_kind = await resolve_session_owner_kind(full_session_id)
    graph = _graph_for_owner(owner_kind)
    config = RunnableConfig(configurable={"thread_id": full_session_id})

    current_state = await asyncio.to_thread(graph.get_state, config=config)
    existing_ids = {
        getattr(msg, "id", None)
        for msg in (current_state.values.get("messages", []) if current_state else [])
    }
    existing_ids.discard(None)

    if message_ids is not None:
        if not message_ids:
            raise HTTPException(status_code=400, detail="message_ids 不能为空")
        if len(message_ids) > MAX_DELETE_IDS:
            raise HTTPException(
                status_code=400,
                detail=f"message_ids 不能超过 {MAX_DELETE_IDS} 条",
            )
        missing = [mid for mid in message_ids if mid not in existing_ids]
        if missing:
            # Atomicity: one missing id aborts the whole deletion.
            raise HTTPException(
                status_code=404, detail=f"Message not found: {missing[0]}"
            )
        deleted_count = len(message_ids)
    else:
        deleted_count = len(existing_ids)

    try:
        await asyncio.to_thread(
            graph.update_state,
            config,
            _remove_messages_payload(message_ids),
        )
    except Exception as e:
        # The operation did not take effect — keep it retryable.
        logger.error(
            f"Failed to delete history for session {full_session_id}: {e}"
        )
        raise

    # Authoritative read-back: the remaining messages come from the same
    # checkpoint every other reader serves.
    final_state = await asyncio.to_thread(graph.get_state, config=config)
    messages = extract_chat_messages(
        final_state.values.get("messages", []) if final_state else []
    )
    return DeleteMessagesResponse(
        session_id=full_session_id,
        deleted_count=deleted_count,
        messages=messages,
    )


@router.post(
    "/chat/sessions/{session_id}/messages/delete",
    response_model=DeleteMessagesResponse,
)
async def delete_chat_messages(session_id: str, request: DeleteMessagesRequest):
    """Delete selected messages from the session's checkpoint history."""
    try:
        return await _delete_history(session_id, request.message_ids)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting chat messages: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting chat messages: {e}"
        )


@router.post(
    "/chat/sessions/{session_id}/messages/clear",
    response_model=DeleteMessagesResponse,
)
async def clear_chat_messages(session_id: str):
    """Clear the session's entire checkpoint history."""
    try:
        return await _delete_history(session_id, None)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error clearing chat messages: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error clearing chat messages: {e}"
        )
