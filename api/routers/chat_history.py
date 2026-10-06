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
from typing import Any, Dict, List, Optional

from ai_prompter import Prompter
from fastapi import APIRouter, HTTPException
from langchain_core.exceptions import OutputParserException
from langchain_core.messages import HumanMessage, RemoveMessage
from langchain_core.output_parsers.pydantic import PydanticOutputParser
from langchain_core.runnables import RunnableConfig
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from loguru import logger
from pydantic import BaseModel, Field, ValidationError

from api.command_service import CommandService
from api.routers._chat_shared import (
    ChatMessage,
    extract_chat_messages,
    get_session_or_404,
    resolve_session_owner_kind,
    session_in_generation,
)
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.database.repository import repo_query
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.graphs.source_chat import (
    source_chat_graph as source_chat_graph,
)
from open_notebook.utils.text_utils import (
    clean_thinking_content,
    extract_text_content,
)

router = APIRouter()

# Upper bound on one delete request, keeping a single update_state write small.
MAX_DELETE_IDS = 500
# Same upper bound for one compression job: the command rewrites the whole
# history in a single update_state, so it must stay equally small.
MAX_COMPRESS_IDS = 500
# Topic classification sees at most the earliest N messages of one session;
# the response flags the remainder via `truncated`.
MAX_CLASSIFY_MESSAGES = 100
# Per-message ceilings inside the prompts: the LLM classifies/summarizes,
# it does not need verbatim megabytes.
MAX_CLASSIFY_CHARS_PER_MESSAGE = 400
MAX_TOPIC_NAME_CHARS = 60

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
        logger.error(f"Failed to delete history for session {full_session_id}: {e}")
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


# --- Compression (async job submitted here, executed by the worker) ----------


class CompressMessagesRequest(BaseModel):
    message_ids: List[str] = Field(
        ..., description="Checkpoint message ids to compress (2..500)"
    )


class CompressJobResponse(BaseModel):
    job_id: str = Field(..., description="Compression job id for status polling")
    session_id: str = Field(..., description="Normalized session ID")
    status: str = Field(..., description="Job status right after submission")


async def _reject_concurrent_compression(full_session_id: str) -> None:
    """409 when a compression job for this session is queued or running.

    The args matching happens Python-side (source_group_service's
    _reject_concurrent_classification precedent): the command table stores
    args as JSON, and SurrealQL cannot reach into them portably.
    """
    rows = await repo_query(
        "SELECT args FROM command WHERE app = 'open_notebook' "
        "AND name = 'compress_chat_history' AND status IN ['new', 'running']"
    )
    for row in rows or []:
        if (row.get("args") or {}).get("session_id") == full_session_id:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A compression job is already queued or running for this session"
                ),
            )


@router.post(
    "/chat/sessions/{session_id}/messages/compress",
    response_model=CompressJobResponse,
)
async def compress_chat_messages(session_id: str, request: CompressMessagesRequest):
    """Submit an async job that merges the selected messages into one summary.

    Poll GET /api/commands/jobs/{job_id} for the outcome; the command performs
    the only irreversible write after every validation passes.
    """
    try:
        full_session_id, _session = await get_session_or_404(session_id)

        # Dedupe while preserving order: a duplicated id means one message.
        ids = list(dict.fromkeys(request.message_ids))
        if len(ids) < 2:
            raise HTTPException(
                status_code=400, detail="message_ids 至少需要 2 条才能压缩"
            )
        if len(ids) > MAX_COMPRESS_IDS:
            raise HTTPException(
                status_code=400,
                detail=f"message_ids 不能超过 {MAX_COMPRESS_IDS} 条",
            )
        if session_in_generation(full_session_id):
            raise HTTPException(status_code=409, detail=_IN_GENERATION_DETAIL)
        await _reject_concurrent_compression(full_session_id)

        job_id = await CommandService.submit_command_job(
            "open_notebook",
            "compress_chat_history",
            {"session_id": full_session_id, "message_ids": ids},
        )
        return CompressJobResponse(
            job_id=job_id, session_id=full_session_id, status="submitted"
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting chat history compression: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error compressing chat messages: {e}"
        )


# --- AI topic classification (synchronous: one LLM call) ---------------------


class ChatTopicGroup(BaseModel):
    name: str = Field(..., description="Group name assigned by the model")
    message_ids: List[str] = Field(
        ..., description="Checkpoint message ids in this group"
    )


class ChatTopicPlan(BaseModel):
    """Schema the classification LLM must return (parser-enforced)."""

    groups: List[ChatTopicGroup] = Field(default_factory=list)


class ClassifyTopicsResponse(BaseModel):
    session_id: str = Field(..., description="Normalized session ID")
    groups: List[ChatTopicGroup] = Field(
        ..., description="Non-empty topic groups; ids not covered are ungrouped"
    )
    truncated: bool = Field(
        ...,
        description="Whether only the earliest MAX_CLASSIFY_MESSAGES messages "
        "were classified",
    )
    total_messages: int = Field(..., description="Total messages in the checkpoint")
    classified_messages: int = Field(
        ..., description="Distinct messages assigned to a group"
    )


_topic_parser: PydanticOutputParser[ChatTopicPlan] = PydanticOutputParser(
    pydantic_object=ChatTopicPlan
)
_TOPIC_FEEDBACK_ERROR = "The previous output could not be parsed as the requested JSON."


def _render_topic_prompt(data: Dict[str, Any]) -> str:
    # The ignore mirrors commands/classification_commands.py: Prompter's
    # `parser` annotation is looser than PydanticOutputParser.
    return Prompter(
        prompt_template="chat/classify_topics",
        parser=_topic_parser,  # type: ignore[arg-type]
    ).render(data=data)


async def _llm_topic_plan(prompt: str, session_id: str) -> ChatTopicPlan:
    """One classification call; usage recorded on both arms (record_llm_usage
    never raises, so the failure arm cannot mask the original error)."""
    prov = await provision_langchain_model_with_info(
        prompt, None, "chat", max_tokens=4096
    )
    try:
        ai_message = await prov.langchain_model.ainvoke([HumanMessage(content=prompt)])
        content = clean_thinking_content(extract_text_content(ai_message.content))
        plan = _topic_parser.parse(content)
        await record_llm_usage(
            model=prov,
            ai_message=ai_message,
            call_type="chat_classification",
            correlation_id=session_id,
        )
        return plan
    except Exception as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="chat_classification",
            correlation_id=session_id,
            success=False,
            error=str(e),
        )
        raise


async def _topic_plan_with_retry(
    data: Dict[str, Any], session_id: str
) -> ChatTopicPlan:
    """One feedback round with the parser error, then give up (the endpoint
    maps a second parse failure to a 500)."""
    try:
        return await _llm_topic_plan(_render_topic_prompt(data), session_id)
    except (OutputParserException, ValidationError):
        logger.warning(
            f"First topic classification attempt failed for session "
            f"{session_id}; retrying with parser feedback"
        )
        return await _llm_topic_plan(
            _render_topic_prompt({**data, "previous_error": _TOPIC_FEEDBACK_ERROR}),
            session_id,
        )


@router.post(
    "/chat/sessions/{session_id}/messages/classify",
    response_model=ClassifyTopicsResponse,
)
async def classify_chat_messages(session_id: str):
    """Group the session's checkpoint history by topic with one LLM call.

    Read-only: never writes the checkpoint. Unknown ids, cross-group
    duplicates and empty/blank-named groups are dropped; a duplicate id stays
    in the first group that claims it.
    """
    try:
        full_session_id, _session = await get_session_or_404(session_id)

        if session_in_generation(full_session_id):
            raise HTTPException(status_code=409, detail=_IN_GENERATION_DETAIL)

        # Read through the owning graph (harmless cross-graph for reads, but
        # the dispatch keeps one resolution path for every checkpoint reader).
        owner_kind = await resolve_session_owner_kind(full_session_id)
        graph = _graph_for_owner(owner_kind)
        config = RunnableConfig(configurable={"thread_id": full_session_id})
        state = await asyncio.to_thread(graph.get_state, config=config)
        messages: List[Any] = list(state.values.get("messages", [])) if state else []

        # Only id-carrying messages are referenceable by the response (and by
        # the frontend); the LLM sees the earliest MAX_CLASSIFY_MESSAGES of them.
        candidates = [m for m in messages if getattr(m, "id", None)]
        truncated = len(candidates) > MAX_CLASSIFY_MESSAGES
        selected = candidates[:MAX_CLASSIFY_MESSAGES]

        if not selected:
            return ClassifyTopicsResponse(
                session_id=full_session_id,
                groups=[],
                truncated=False,
                total_messages=len(messages),
                classified_messages=0,
            )

        render_data: Dict[str, Any] = {
            "messages": [
                {
                    "message_id": str(getattr(m, "id")),
                    "index": index + 1,
                    "role": "user"
                    if getattr(m, "type", "") == "human"
                    else "assistant",
                    "content": extract_text_content(getattr(m, "content", None))[
                        :MAX_CLASSIFY_CHARS_PER_MESSAGE
                    ],
                }
                for index, m in enumerate(selected)
            ]
        }
        plan = await _topic_plan_with_retry(render_data, full_session_id)

        valid_ids = {str(getattr(m, "id")) for m in selected}
        groups: List[ChatTopicGroup] = []
        seen: set[str] = set()
        for group in plan.groups:
            name = " ".join((group.name or "").split())[:MAX_TOPIC_NAME_CHARS]
            if not name:
                continue
            ids = [
                mid for mid in group.message_ids if mid in valid_ids and mid not in seen
            ]
            if not ids:
                continue
            seen.update(ids)
            groups.append(ChatTopicGroup(name=name, message_ids=ids))

        return ClassifyTopicsResponse(
            session_id=full_session_id,
            groups=groups,
            truncated=truncated,
            total_messages=len(messages),
            classified_messages=len(seen),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error classifying chat messages: {e}")
        raise HTTPException(
            status_code=500, detail=f"Error classifying chat messages: {e}"
        )
