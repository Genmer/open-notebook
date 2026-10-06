"""Shared helpers for the chat and source-chat routers.

Both `api/routers/chat.py` and `api/routers/source_chat.py` operate on
`chat_session` records linked to their parent (notebook or source) via the
`refers_to` relation, and both convert LangGraph state messages into API
response models. This module holds the single definition of those pieces.

Behavior notes:
- The helpers raise exactly what the previously inlined blocks raised
  (`NotFoundError` propagates from `ObjectModel.get`, `HTTPException(404)` for
  a missing relation), so each router's existing try/except arms keep mapping
  them to the same status codes and messages as before.
"""

from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

from fastapi import HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import ChatSession, Source
from open_notebook.exceptions import InvalidInputError, NotFoundError
from open_notebook.utils import token_count


# Shared response models
class ChatMessage(BaseModel):
    id: str = Field(..., description="Message ID")
    type: str = Field(..., description="Message type (human|ai)")
    content: str = Field(..., description="Message content")
    timestamp: Optional[str] = Field(None, description="Message timestamp")
    model_name: Optional[str] = Field(
        None, description="Model that produced this AI message (PDR-004)"
    )
    agent_name: Optional[str] = Field(
        None, description="Agent persona that produced this AI message (PDR-004)"
    )
    run_role: Optional[str] = Field(
        None, description="Run role: answer (default) | synthesis (PDR-004)"
    )
    group_id: Optional[str] = Field(
        None, description="Parallel-run group this message belongs to (PDR-004)"
    )
    message_kind: Optional[str] = Field(
        None,
        description="Message kind marker, e.g. 'summary' for compression "
        "artifacts; None for regular messages",
    )


class SuccessResponse(BaseModel):
    success: bool = Field(True, description="Operation success status")
    message: str = Field(..., description="Success message")


def normalize_record_id(table: str, record_id: str) -> str:
    """Ensure a record ID carries its table prefix (`table:id`)."""
    prefix = f"{table}:"
    return record_id if record_id.startswith(prefix) else f"{prefix}{record_id}"


async def get_source_or_404(source_id: str) -> Tuple[str, Source]:
    """Normalize a source ID and fetch the source, 404 if missing."""
    full_source_id = normalize_record_id("source", source_id)
    source = await Source.get(full_source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return full_source_id, source


async def get_session_or_404(session_id: str) -> Tuple[str, ChatSession]:
    """Normalize a session ID and fetch the chat session, 404 if missing."""
    full_session_id = normalize_record_id("chat_session", session_id)
    session = await ChatSession.get(full_session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return full_session_id, session


async def get_verified_source_session(
    source_id: str, session_id: str
) -> Tuple[str, Source, str, ChatSession]:
    """Verify the source exists, the session exists, and the session refers to
    the source. Returns the normalized IDs plus both records."""
    full_source_id, source = await get_source_or_404(source_id)
    full_session_id, session = await get_session_or_404(session_id)

    relation_query = await repo_query(
        "SELECT * FROM refers_to WHERE in = $session_id AND out = $source_id",
        {
            "session_id": ensure_record_id(full_session_id),
            "source_id": ensure_record_id(full_source_id),
        },
    )
    if not relation_query:
        raise HTTPException(status_code=404, detail="Session not found for this source")

    return full_source_id, source, full_session_id, session


def extract_chat_messages(raw_messages: Iterable[Any]) -> List[ChatMessage]:
    """Convert LangGraph/LangChain state messages into `ChatMessage` models."""

    def _clean_str(value: Any) -> Optional[str]:
        # Legacy messages carry neither key; malformed values (non-strings,
        # empties) degrade to None instead of breaking history loading.
        return value if isinstance(value, str) and value else None

    messages: List[ChatMessage] = []
    for msg in raw_messages:
        kwargs = getattr(msg, "additional_kwargs", None) or {}
        # LangChain messages expose `.id` as None (not missing) when unset.
        msg_id = getattr(msg, "id", None) or f"msg_{len(messages)}"
        messages.append(
            ChatMessage(
                id=msg_id,
                type=msg.type if hasattr(msg, "type") else "unknown",
                content=msg.content if hasattr(msg, "content") else str(msg),
                # Written by the routers/graphs as additional_kwargs.created_at
                # (UTC ISO); None for everything stored before that change.
                timestamp=_clean_str(kwargs.get("created_at")),
                model_name=kwargs.get("model_name"),
                agent_name=kwargs.get("agent_name"),
                run_role=kwargs.get("run_role"),
                group_id=kwargs.get("group_id"),
                message_kind=_clean_str(kwargs.get("message_kind")),
            )
        )
    return messages


async def resolve_agent_binding(agent_id: Optional[str]) -> Optional[Any]:
    """Resolve a chat_session agent reference to a live Agent (PDR-004).

    Dangling ids (agent deleted) and disabled agents degrade to None — the
    default assistant — instead of erroring, so history sessions never get
    stuck. ObjectModel.get raises NotFoundError rather than returning None,
    hence the explicit except arm.
    """
    if not agent_id:
        return None
    try:
        from open_notebook.domain.agent import Agent

        agent = await Agent.get(agent_id)
        if not agent.enabled:
            logger.warning(f"Agent {agent_id} is disabled; using default assistant")
            return None
        return agent
    except (NotFoundError, InvalidInputError):
        # NotFoundError: agent deleted. InvalidInputError: a stored reference
        # that no longer resolves to a table (schema drift / foreign garbage) —
        # ObjectModel.get raises it instead of masking as NotFound (ADR-013).
        logger.warning(f"Agent {agent_id} no longer exists; using default assistant")
        return None


# --- In-flight guard helpers (history-edit mutual exclusion) ------------------
#
# The notebook stream router (chat_stream.py) and the source stream router
# (source_chat.py) each own a module-level in-flight set. History-editing
# endpoints (chat_history.py, session deletion) must treat the two as one
# merged guard, so a delete cannot race a generation on either stream path.


def get_merged_inflight_session_ids() -> set[str]:
    """Snapshot the union of both stream routers' in-flight session ids.

    The imports are lazy on purpose: chat_stream/source_chat import from this
    module, so module-level imports here would create a router import cycle.
    """
    from api.routers.chat_stream import inflight_session_ids as notebook_stream_ids
    from api.routers.source_chat import inflight_session_ids as source_stream_ids

    return notebook_stream_ids() | source_stream_ids()


def session_in_generation(session_id: str) -> bool:
    """Whether any stream generation is currently running for the session."""
    return session_id in get_merged_inflight_session_ids()


# --- Session ownership dispatch ----------------------------------------------

# The two chat graphs checkpoint into the SAME sqlite file but carry different
# state channels (graphs/chat.py ThreadState vs graphs/source_chat.py
# SourceChatState). Writing history through the wrong graph would blank the
# source-only channels, so every history read/write resolves the parent via
# the session's `refers_to` edge first.

_OWNER_NOTEBOOK = "notebook"
_OWNER_SOURCE = "source"


async def resolve_session_owner_kind(full_session_id: str) -> str:
    """Return "notebook" or "source" for the session's parent record.

    Notebook-bound sessions (and orphans with no `refers_to` edge — logged,
    defaulting to the notebook graph, matching every pre-existing reader)
    return "notebook"; source-bound sessions return "source".
    """
    rows = await repo_query(
        "SELECT out FROM refers_to WHERE in = $session_id",
        {"session_id": ensure_record_id(full_session_id)},
    )
    if rows:
        out_id = str(rows[0]["out"])
        if out_id.startswith("source:"):
            return _OWNER_SOURCE
        if out_id.startswith("notebook:"):
            return _OWNER_NOTEBOOK
    logger.warning(
        f"No notebook/source relationship found for session {full_session_id} "
        "- treating it as a notebook session"
    )
    return _OWNER_NOTEBOOK


# --- Context breakdown (POST /chat/context `breakdown` field) ----------------
#
# Serialization-character accounting (PDR-005): every segment counts
# len(str(...)) of exactly the object that build_notebook_context /
# execute_chat put into the prompt, so the sources+notes segments always
# reconcile with the response's top-level char_count. No tokenizer is
# introduced; token figures reuse the existing token_count as an estimate.


class HistoryBreakdownItem(BaseModel):
    message_id: str = Field(..., description="Checkpoint message id (deletion key)")
    role: str = Field(..., description="Message role (human|ai)")
    chars: int = Field(..., description="Serialized character count")
    percent: float = Field(..., description="Share of total context chars")


class SourceBreakdownItem(BaseModel):
    id: Optional[str] = Field(None, description="Source ID")
    title: Optional[str] = Field(None, description="Source title")
    mode: Optional[str] = Field(
        None,
        description="Participation mode from the request config; None on the "
        "default (no-config) path",
    )
    chars: int = Field(..., description="Serialized character count")
    percent: float = Field(..., description="Share of total context chars")


class NoteBreakdownItem(BaseModel):
    id: Optional[str] = Field(None, description="Note ID")
    title: Optional[str] = Field(None, description="Note title")
    chars: int = Field(..., description="Serialized character count")
    percent: float = Field(..., description="Share of total context chars")


BreakdownItem = Union[HistoryBreakdownItem, SourceBreakdownItem, NoteBreakdownItem]


class ContextBreakdownSegment(BaseModel):
    key: str = Field(
        ..., description="Segment key: system_prompt|history|sources|notes"
    )
    chars: int = Field(..., description="Serialized character count")
    percent: float = Field(..., description="Share of total context chars")
    message_count: Optional[int] = Field(
        None, description="Message count (history segment only)"
    )
    items: Optional[List[BreakdownItem]] = Field(
        None, description="Per-item detail (history/sources/notes segments)"
    )


class ContextBreakdown(BaseModel):
    total_chars: int = Field(..., description="Sum of all four segment char counts")
    estimated_tokens: int = Field(
        ..., description="Rough token estimate over the full prompt payload"
    )
    segments: List[ContextBreakdownSegment] = Field(
        ..., description="Fixed order: system_prompt, history, sources, notes"
    )


def _render_system_skeleton(agent_instructions: Optional[str], notebook: Any) -> str:
    """Render the chat/system prompt skeleton WITHOUT the CONTEXT block.

    Mirrors open_notebook/graphs/chat.py's node rendering, but pins
    context=None so the context payload is counted once (sources/notes
    segments) instead of twice. The template only consumes these three
    variables.
    """
    from ai_prompter import Prompter

    return Prompter(prompt_template="chat/system").render(
        data={
            "agent_instructions": agent_instructions,
            "notebook": notebook,
            "context": None,
        }
    )


def compute_context_breakdown(
    notebook: Any,
    agent_instructions: Optional[str],
    context_data: Dict[str, list],
    total_content: str,
    history_messages: List[ChatMessage],
    context_config: Optional[Dict[str, Any]],
) -> ContextBreakdown:
    """Compute the four-segment context composition breakdown.

    Pure computation over data already assembled by build_notebook_context —
    no extra DB queries, no second assembly path. Percentages use serialized
    character counts relative to the four-segment total.
    """
    system_rendered = _render_system_skeleton(agent_instructions, notebook)
    system_chars = len(system_rendered)
    history_chars = sum(len(m.content) for m in history_messages)

    # Config status lookup keyed by the fully-prefixed record id (request
    # configs may carry bare or prefixed ids). The default path (falsy
    # config) has no statuses, so every mode stays None.
    source_modes: Dict[str, str] = {}
    if context_config:
        for source_key, status in (context_config.get("sources") or {}).items():
            source_modes[normalize_record_id("source", str(source_key))] = str(status)

    source_items: List[SourceBreakdownItem] = []
    source_chars = 0
    for item in context_data.get("sources", []):
        item_id = item.get("id") if isinstance(item, dict) else None
        chars = len(str(item))
        source_chars += chars
        source_items.append(
            SourceBreakdownItem(
                id=item_id,
                title=item.get("title") if isinstance(item, dict) else None,
                mode=source_modes.get(item_id or ""),
                chars=chars,
                percent=0.0,
            )
        )

    note_items: List[NoteBreakdownItem] = []
    note_chars = 0
    for item in context_data.get("notes", []):
        chars = len(str(item))
        note_chars += chars
        note_items.append(
            NoteBreakdownItem(
                id=item.get("id") if isinstance(item, dict) else None,
                title=item.get("title") if isinstance(item, dict) else None,
                chars=chars,
                percent=0.0,
            )
        )

    history_items = [
        HistoryBreakdownItem(
            message_id=m.id,
            role=m.type,
            chars=len(m.content),
            percent=0.0,
        )
        for m in history_messages
    ]

    total_chars = system_chars + history_chars + source_chars + note_chars

    def pct(chars: int) -> float:
        return round(chars / total_chars * 100, 2) if total_chars else 0.0

    for item in source_items:
        item.percent = pct(item.chars)
    for item in note_items:
        item.percent = pct(item.chars)
    for item in history_items:
        item.percent = pct(item.chars)

    estimated_tokens = token_count(
        system_rendered + total_content + "".join(m.content for m in history_messages)
    )

    segments = [
        ContextBreakdownSegment(
            key="system_prompt", chars=system_chars, percent=pct(system_chars)
        ),
        ContextBreakdownSegment(
            key="history",
            chars=history_chars,
            percent=pct(history_chars),
            message_count=len(history_messages),
            items=history_items,
        ),
        ContextBreakdownSegment(
            key="sources",
            chars=source_chars,
            percent=pct(source_chars),
            items=source_items,
        ),
        ContextBreakdownSegment(
            key="notes",
            chars=note_chars,
            percent=pct(note_chars),
            items=note_items,
        ),
    ]
    return ContextBreakdown(
        total_chars=total_chars,
        estimated_tokens=estimated_tokens,
        segments=segments,
    )
