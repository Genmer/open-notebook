"""Single-run notebook chat token streaming (graph-native, "Route B").

POST /api/chat/sessions/{session_id}/stream runs
``chat_graph.stream(..., stream_mode="messages")`` and forwards the agent
node's LLM token chunks as SSE ``delta`` events. The checkpoint is written by
the fully-consumed stream itself (equivalent to invoke), so the final
``complete`` event is read back from ``get_state`` — the same single data
source the GET session endpoint serves, which makes refresh replay identical
by construction.

Design points (mirrors chat_parallel.py):
- Execution lives in an orchestration task created with asyncio.create_task,
  decoupled from the SSE generator's lifetime: a client disconnect cancels
  the response scope, not the orchestration, so generation always runs to
  completion and the checkpoint lands.
- The sync graph stream runs in a worker thread (SqliteSaver checkpoints are
  sync); chunks cross back via loop.call_soon_threadsafe into an unbounded
  asyncio.Queue closed by a None sentinel. The generator's finally block
  never awaits (awaiting inside a cancelled scope re-raises CancelledError).
- In-flight guard: ``_inflight`` is a plain set — the membership check and
  the add have no await between them, so they are atomic within one event
  loop iteration (no TOCTOU window, no asyncio.Lock loop-ownership issues).
  It only guards stream-vs-stream; /chat/execute deliberately stays outside
  (red line: that endpoint is untouched).
"""

import asyncio
import json
import traceback
from typing import Any, Callable, Dict, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessageChunk, HumanMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger
from pydantic import BaseModel, Field

from api.routers._chat_shared import (
    extract_chat_messages,
    get_session_or_404,
    resolve_agent_binding,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.utils.text_utils import extract_text_content

router = APIRouter()

# Per-session in-flight guard (see module docstring for the atomicity note).
_inflight: set[str] = set()

# SSE keep-alive cadence: emit a ``: ping`` comment when the queue has been
# idle this long so intermediaries don't close the connection during long
# model calls. The frontend watchdog re-arms on ANY received bytes, including
# these comment lines (its SSE parser only recognizes ``data: `` lines).
_KEEPALIVE_SECONDS = 15.0


class StreamChatRequest(BaseModel):
    message: str = Field(..., description="User message content")
    context: Dict[str, Any] = Field(
        ..., description="Chat context with sources and notes"
    )
    model_override: Optional[str] = Field(
        None, description="Optional model override for this message"
    )
    agent_override: Optional[str] = Field(
        None, description="Optional agent for this message (PDR-004)"
    )


def _consume_graph_stream(
    graph: Any,
    state_values: Dict[str, Any],
    config: RunnableConfig,
    put_event: Callable[[Dict[str, Any]], None],
) -> None:
    """Run the sync graph stream inside the worker thread.

    Every LLM token chunk is forwarded to the event loop through
    ``put_event`` (a call_soon_threadsafe bridge). Full consumption of the
    stream is what writes the checkpoint — equivalent to invoke.
    """
    for chunk, meta in graph.stream(
        input=state_values,  # type: ignore[arg-type]
        config=config,
        stream_mode="messages",
    ):
        if (meta or {}).get("langgraph_node") != "agent":
            continue  # only the agent node's LLM tokens (official filter)
        if not isinstance(chunk, AIMessageChunk):
            # messages-mode chunks type as 'AIMessageChunk', not 'ai'
            # (langchain-core 1.4.7).
            continue
        # chunk.content can be a list/dict for multimodal providers.
        delta = extract_text_content(chunk.content)
        if not delta:
            continue
        put_event({"type": "delta", "content": delta})


async def _orchestrate(
    queue: asyncio.Queue,
    full_session_id: str,
    session: Any,
    state_values: Dict[str, Any],
    config: RunnableConfig,
) -> None:
    """Lifecycle owner, decoupled from the SSE generator's lifetime.

    A client disconnect only cancels the response scope; this task keeps
    running on the loop, fully consumes the graph stream (checkpoint lands),
    saves the session timestamp and only then closes the queue.
    """
    loop = asyncio.get_running_loop()

    def put_event(event: Dict[str, Any]) -> None:
        loop.call_soon_threadsafe(queue.put_nowait, event)

    try:
        # Sync stream in a thread (SqliteSaver is sync); full consumption
        # writes the checkpoint, exactly like invoke.
        await asyncio.to_thread(
            _consume_graph_stream, chat_graph, state_values, config, put_event
        )
        await session.save()
        final_state = await asyncio.to_thread(chat_graph.get_state, config=config)
        messages = extract_chat_messages(final_state.values.get("messages", []))
        await queue.put(
            {
                "type": "complete",
                "messages": [m.model_dump() for m in messages],
            }
        )
    except Exception as e:
        logger.error(f"Chat stream failed: {e}\n{traceback.format_exc()}")
        await queue.put({"type": "error", "message": str(e)})
    finally:
        await queue.put(None)


@router.post("/chat/sessions/{session_id}/stream")
async def stream_chat(session_id: str, request: StreamChatRequest) -> StreamingResponse:
    """Stream one chat turn as SSE: token deltas, then the authoritative
    message array read back from the checkpoint."""
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message content is required")
    full_session_id, session = await get_session_or_404(session_id)

    # —— Assembly below mirrors execute_chat (api/routers/chat.py) 1:1, no
    # logic rewrite. ——
    notebook: Optional[Notebook] = None
    notebook_query = await repo_query(
        "SELECT out FROM refers_to WHERE in = $session_id",
        {"session_id": ensure_record_id(full_session_id)},
    )
    if notebook_query:
        notebook = await Notebook.get(notebook_query[0]["out"])

    agent = await resolve_agent_binding(
        request.agent_override
        if request.agent_override is not None
        else getattr(session, "agent", None)
    )

    model_override = (
        request.model_override
        if request.model_override is not None
        else getattr(session, "model_override", None)
    ) or (agent.model_id if agent else None)

    current_state = await asyncio.to_thread(
        chat_graph.get_state,
        config=RunnableConfig(configurable={"thread_id": full_session_id}),
    )
    state_values = current_state.values if current_state else {}
    state_values["messages"] = state_values.get("messages", [])
    state_values["context"] = request.context
    state_values["notebook"] = notebook
    state_values["model_override"] = model_override
    state_values["agent_instructions"] = agent.system_prompt if agent else None
    state_values["agent_name"] = agent.name if agent else None
    state_values["agent_temperature"] = agent.temperature if agent else None
    state_values["agent_max_tokens"] = agent.max_tokens if agent else None
    state_values["messages"].append(HumanMessage(content=request.message))

    config = RunnableConfig(
        configurable={
            "thread_id": full_session_id,
            "model_id": model_override,
            # Sole trigger for the node-level streaming flip
            # (open_notebook/graphs/chat.py); execute_chat and source chat do
            # not pass it, so their model objects stay untouched.
            "stream_tokens": True,
        }
    )

    if full_session_id in _inflight:
        raise HTTPException(
            status_code=409,
            detail="A generation is already in progress for this session",
        )
    _inflight.add(full_session_id)

    queue: asyncio.Queue = asyncio.Queue()
    task = asyncio.create_task(
        _orchestrate(queue, full_session_id, session, state_values, config)
    )
    task.add_done_callback(lambda _t: _inflight.discard(full_session_id))

    async def event_stream():
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            # Never await here: on client disconnect Starlette cancels the
            # response scope and any await in this block re-raises
            # CancelledError. The orchestration task keeps running on the
            # loop and archives regardless.
            pass

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
