import asyncio
import json
from typing import AsyncGenerator, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger
from pydantic import BaseModel, Field

from api.project_env_service import render_project_env_context
from api.routers._chat_shared import (
    ChatMessage,
    SuccessResponse,
    extract_chat_messages,
    get_source_or_404,
    get_verified_source_session,
    session_in_generation,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import ChatSession
from open_notebook.exceptions import (
    NotFoundError,
    OpenNotebookError,
)
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.graphs.source_chat import source_chat_graph as source_chat_graph
from open_notebook.utils.graph_utils import (
    get_session_message_count,
    invoke_chat_turn,
)
from open_notebook.utils.timestamps import utc_now_iso

router = APIRouter()

# Per-session in-flight guard for source streaming (mirrors chat_stream.py's
# notebook-stream guard; see its module docstring for the atomicity note).
# The membership check and the add happen with no await between them, and the
# ONLY removal path is the invoke wrapper task's done_callback — so a client
# disconnect cannot release the guard while the worker thread is still
# generating and writing the checkpoint.
_inflight: set[str] = set()

_IN_GENERATION_DETAIL = "A generation is already in progress for this session"


def inflight_session_ids() -> set[str]:
    """Read-only snapshot of sessions with an active source stream."""
    return set(_inflight)


# Request/Response models
class CreateSourceChatSessionRequest(BaseModel):
    source_id: str = Field(..., description="Source ID to create chat session for")
    title: Optional[str] = Field(None, description="Optional session title")
    model_override: Optional[str] = Field(
        None, description="Optional model override for this session"
    )


class UpdateSourceChatSessionRequest(BaseModel):
    title: Optional[str] = Field(None, description="New session title")
    model_override: Optional[str] = Field(
        None, description="Model override for this session"
    )


class ContextIndicator(BaseModel):
    sources: List[str] = Field(
        default_factory=list, description="Source IDs used in context"
    )
    insights: List[str] = Field(
        default_factory=list, description="Insight IDs used in context"
    )
    notes: List[str] = Field(
        default_factory=list, description="Note IDs used in context"
    )


class SourceChatSessionResponse(BaseModel):
    id: str = Field(..., description="Session ID")
    title: str = Field(..., description="Session title")
    source_id: str = Field(..., description="Source ID")
    model_override: Optional[str] = Field(
        None, description="Model override for this session"
    )
    project_env: Optional[str] = Field(
        None, description="Project env binding for this session (软考项目环境)"
    )
    created: str = Field(..., description="Creation timestamp")
    updated: str = Field(..., description="Last update timestamp")
    message_count: Optional[int] = Field(
        None, description="Number of messages in session"
    )


class SourceChatSessionWithMessagesResponse(SourceChatSessionResponse):
    messages: List[ChatMessage] = Field(
        default_factory=list, description="Session messages"
    )
    context_indicators: Optional[ContextIndicator] = Field(
        None, description="Context indicators from last response"
    )


class SendMessageRequest(BaseModel):
    message: str = Field(..., description="User message content")
    model_override: Optional[str] = Field(
        None, description="Optional model override for this message"
    )


@router.post(
    "/sources/{source_id}/chat/sessions", response_model=SourceChatSessionResponse
)
async def create_source_chat_session(
    request: CreateSourceChatSessionRequest,
    source_id: str = Path(..., description="Source ID"),
):
    """Create a new chat session for a source."""
    try:
        # Verify source exists (normalizes the ID and 404s if missing)
        full_source_id, _source = await get_source_or_404(source_id)

        # Create new session with model_override support
        session = ChatSession(
            title=request.title or f"Source Chat {asyncio.get_event_loop().time():.0f}",
            model_override=request.model_override,
        )
        await session.save()

        # Relate session to source using "refers_to" relation
        await session.relate("refers_to", full_source_id)

        return SourceChatSessionResponse(
            id=session.id or "",
            title=session.title or "Untitled Session",
            source_id=source_id,
            model_override=session.model_override,
            project_env=getattr(session, "project_env", None),
            created=str(session.created),
            updated=str(session.updated),
            message_count=0,
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error creating source chat session: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error creating source chat session: {str(e)}"
        )


@router.get(
    "/sources/{source_id}/chat/sessions", response_model=List[SourceChatSessionResponse]
)
async def get_source_chat_sessions(source_id: str = Path(..., description="Source ID")):
    """Get all chat sessions for a source."""
    try:
        # Verify source exists (normalizes the ID and 404s if missing)
        full_source_id, _source = await get_source_or_404(source_id)

        # Get sessions that refer to this source - first get relations, then sessions
        relations = await repo_query(
            "SELECT in FROM refers_to WHERE out = $source_id",
            {"source_id": ensure_record_id(full_source_id)},
        )

        sessions = []
        for relation in relations:
            session_id_raw = relation.get("in")
            if session_id_raw:
                session_id = str(session_id_raw)

                session_result = await repo_query(
                    "SELECT * FROM $id", {"id": ensure_record_id(session_id)}
                )
                if session_result and len(session_result) > 0:
                    session_data = session_result[0]

                    # Get message count from LangGraph state
                    msg_count = await get_session_message_count(
                        source_chat_graph, session_id
                    )

                    sessions.append(
                        SourceChatSessionResponse(
                            id=session_data.get("id") or "",
                            title=session_data.get("title") or "Untitled Session",
                            source_id=source_id,
                            model_override=session_data.get("model_override"),
                            project_env=session_data.get("project_env"),
                            created=str(session_data.get("created")),
                            updated=str(session_data.get("updated")),
                            message_count=msg_count,
                        )
                    )

        # Sort sessions by created date (newest first)
        sessions.sort(key=lambda x: x.created, reverse=True)
        return sessions
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source not found")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching source chat sessions: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching source chat sessions: {str(e)}"
        )


@router.get(
    "/sources/{source_id}/chat/sessions/{session_id}",
    response_model=SourceChatSessionWithMessagesResponse,
)
async def get_source_chat_session(
    source_id: str = Path(..., description="Source ID"),
    session_id: str = Path(..., description="Session ID"),
):
    """Get a specific source chat session with its messages."""
    try:
        # Verify source + session exist and are related (404s otherwise)
        (
            _full_source_id,
            _source,
            full_session_id,
            session,
        ) = await get_verified_source_session(source_id, session_id)

        # Get session state from LangGraph to retrieve messages
        # Use sync get_state() in a thread since SqliteSaver doesn't support async
        thread_state = await asyncio.to_thread(
            source_chat_graph.get_state,
            config=RunnableConfig(configurable={"thread_id": full_session_id}),
        )

        # Extract messages from state
        messages: list[ChatMessage] = []
        context_indicators = None

        if thread_state and thread_state.values:
            # Extract messages
            if "messages" in thread_state.values:
                messages = extract_chat_messages(thread_state.values["messages"])

            # Extract context indicators from the last state
            if "context_indicators" in thread_state.values:
                context_data = thread_state.values["context_indicators"]
                context_indicators = ContextIndicator(
                    sources=context_data.get("sources", []),
                    insights=context_data.get("insights", []),
                    notes=context_data.get("notes", []),
                )

        return SourceChatSessionWithMessagesResponse(
            id=session.id or "",
            title=session.title or "Untitled Session",
            source_id=source_id,
            model_override=getattr(session, "model_override", None),
            project_env=getattr(session, "project_env", None),
            created=str(session.created),
            updated=str(session.updated),
            message_count=len(messages),
            messages=messages,
            context_indicators=context_indicators,
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source or session not found")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error fetching source chat session: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error fetching source chat session: {str(e)}"
        )


@router.put(
    "/sources/{source_id}/chat/sessions/{session_id}",
    response_model=SourceChatSessionResponse,
)
async def update_source_chat_session(
    request: UpdateSourceChatSessionRequest,
    source_id: str = Path(..., description="Source ID"),
    session_id: str = Path(..., description="Session ID"),
):
    """Update source chat session title and/or model override."""
    try:
        # Verify source + session exist and are related (404s otherwise)
        (
            _full_source_id,
            _source,
            full_session_id,
            session,
        ) = await get_verified_source_session(source_id, session_id)

        # Update session fields
        if request.title is not None:
            session.title = request.title
        if request.model_override is not None:
            session.model_override = request.model_override

        await session.save()

        # Get message count from LangGraph state
        msg_count = await get_session_message_count(source_chat_graph, full_session_id)

        return SourceChatSessionResponse(
            id=session.id or "",
            title=session.title or "Untitled Session",
            source_id=source_id,
            model_override=getattr(session, "model_override", None),
            project_env=getattr(session, "project_env", None),
            created=str(session.created),
            updated=str(session.updated),
            message_count=msg_count,
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source or session not found")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error updating source chat session: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error updating source chat session: {str(e)}"
        )


@router.delete(
    "/sources/{source_id}/chat/sessions/{session_id}", response_model=SuccessResponse
)
async def delete_source_chat_session(
    source_id: str = Path(..., description="Source ID"),
    session_id: str = Path(..., description="Session ID"),
):
    """Delete a source chat session."""
    try:
        # Verify source + session exist and are related (404s otherwise)
        (
            _full_source_id,
            _source,
            full_session_id,
            session,
        ) = await get_verified_source_session(source_id, session_id)

        # Never delete out from under an active generation (merged guard
        # across the notebook and source stream routers).
        if session_in_generation(full_session_id):
            raise HTTPException(status_code=409, detail=_IN_GENERATION_DETAIL)

        await session.delete()

        # Same degradation contract as the notebook session delete: the row
        # is already gone and unretryable, so a checkpoint cleanup failure is
        # a logged gap instead of an error response. Both savers share the
        # same sqlite file; chat_graph's checkpointer covers every thread.
        try:
            await asyncio.to_thread(
                chat_graph.checkpointer.delete_thread,  # type: ignore[union-attr]
                full_session_id,
            )
        except Exception as e:
            logger.warning(
                f"Failed to delete LangGraph checkpoint for session "
                f"{full_session_id}: {e}"
            )

        return SuccessResponse(
            success=True, message="Source chat session deleted successfully"
        )
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Source or session not found")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error deleting source chat session: {str(e)}")
        raise HTTPException(
            status_code=500, detail=f"Error deleting source chat session: {str(e)}"
        )


async def stream_source_chat_response(
    session_id: str,
    source_id: str,
    message: str,
    model_override: Optional[str] = None,
    project_env_context: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """Stream the source chat response as Server-Sent Events."""
    # The invoke wrapper task created below owns the guard release through its
    # done_callback; a disconnect therefore cannot free the session for edits
    # while the worker thread is still generating. This fallback only covers
    # failures before the task exists (cancelled during the preparatory
    # awaits) so the set can never leak.
    invoke_task: Optional[asyncio.Task] = None
    try:
        # Get current state
        # Use sync get_state() in a thread since SqliteSaver doesn't support async
        current_state = await asyncio.to_thread(
            source_chat_graph.get_state,
            config=RunnableConfig(configurable={"thread_id": session_id}),
        )

        # Prepare state for execution
        state_values = current_state.values if current_state else {}
        state_values["messages"] = state_values.get("messages", [])
        state_values["source_id"] = source_id
        state_values["model_override"] = model_override
        state_values["project_env_context"] = project_env_context

        # Add user message to state
        # Explicit id so a failed turn can remove it from the checkpoint.
        # created_at stamps the message for the history time-grouping view.
        user_message = HumanMessage(
            content=message,
            id=str(uuid4()),
            additional_kwargs={"created_at": utc_now_iso()},
        )
        state_values["messages"].append(user_message)

        # Send user message event
        user_event = {"type": "user_message", "content": message, "timestamp": None}
        yield f"data: {json.dumps(user_event)}\n\n"

        # Run the synchronous LangGraph invoke in a thread so it doesn't block the
        # event loop. While blocked, even the already-yielded SSE events can't
        # flush and every other request stalls until the LLM finishes. Mirrors the
        # get_state() calls above.
        # invoke_chat_turn also drops the question from the checkpoint when the
        # turn fails, so a retry doesn't add it twice. The thread cannot be
        # cancelled, so the blocking invoke must outlive a client disconnect and
        # still land its checkpoint: the explicit task decouples it from this
        # generator's lifetime, and the done_callback — not a generator finally —
        # releases the in-flight guard only when the invoke has truly finished.
        invoke_task = asyncio.create_task(
            asyncio.to_thread(
                invoke_chat_turn,
                source_chat_graph,
                state_values,
                RunnableConfig(
                    configurable={"thread_id": session_id, "model_id": model_override}
                ),
                user_message,
            )
        )
        invoke_task.add_done_callback(lambda _t: _inflight.discard(session_id))
        # shield: Task.cancel() cancels the awaited inner future too, so a
        # plain await would cancel this wrapper on client disconnect, fire
        # the done_callback early and reopen the very lost-update window
        # this guard closes. The shield keeps the wrapper task running (the
        # worker thread cannot be cancelled and must still land its
        # checkpoint); the CancelledError still propagates to the generator,
        # and only the invoke's true completion releases the guard.
        result = await asyncio.shield(invoke_task)

        # Stream this turn's AI response. result["messages"] is the full
        # checkpointed history, so only the last message is new.
        if result.get("messages"):
            msg = result["messages"][-1]
            if getattr(msg, "type", None) == "ai":
                ai_event = {
                    "type": "ai_message",
                    "content": msg.content if hasattr(msg, "content") else str(msg),
                    "timestamp": None,
                }
                yield f"data: {json.dumps(ai_event)}\n\n"

        # Stream context indicators
        if "context_indicators" in result:
            context_event = {
                "type": "context_indicators",
                "data": result["context_indicators"],
            }
            yield f"data: {json.dumps(context_event)}\n\n"

        # Send completion signal
        completion_event = {"type": "complete"}
        yield f"data: {json.dumps(completion_event)}\n\n"

    except Exception as e:
        from open_notebook.utils.error_classifier import classify_error

        # Typed errors already carry a user-facing message; only raw provider
        # exceptions need classifying.
        if isinstance(e, OpenNotebookError):
            error_message = str(e)
        else:
            _, error_message = classify_error(e)
        logger.error(f"Error in source chat streaming: {str(e)}")
        error_event = {"type": "error", "message": error_message}
        yield f"data: {json.dumps(error_event)}\n\n"
    finally:
        if invoke_task is None:
            _inflight.discard(session_id)


@router.post("/sources/{source_id}/chat/sessions/{session_id}/messages")
async def send_message_to_source_chat(
    request: SendMessageRequest,
    source_id: str = Path(..., description="Source ID"),
    session_id: str = Path(..., description="Session ID"),
):
    """Send a message to source chat session with SSE streaming response."""
    try:
        # Verify source + session exist and are related (404s otherwise)
        (
            full_source_id,
            _source,
            full_session_id,
            session,
        ) = await get_verified_source_session(source_id, session_id)

        if not request.message:
            raise HTTPException(status_code=400, detail="Message content is required")

        # Determine model override (request override takes precedence over session override)
        model_override = request.model_override or getattr(
            session, "model_override", None
        )

        # Project env gate (软考): verified snapshot text or None
        env_context = await render_project_env_context(
            getattr(session, "project_env", None)
        )

        # Update session timestamp
        await session.save()

        # In-flight guard: the membership check and the add have no await
        # between them (atomic within one event loop iteration, mirroring
        # chat_stream.py), so concurrent sends can't both slip through.
        # Discard happens via the invoke wrapper task's done_callback.
        if full_session_id in _inflight:
            raise HTTPException(status_code=409, detail=_IN_GENERATION_DETAIL)
        _inflight.add(full_session_id)

        # Return streaming response
        return StreamingResponse(
            stream_source_chat_response(
                session_id=full_session_id,
                source_id=full_source_id,
                message=request.message,
                model_override=model_override,
                project_env_context=env_context["text"] if env_context else None,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error sending message to source chat: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error sending message: {str(e)}")
