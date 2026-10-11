"""Quick-ask side chat (stateless SSE).

POST /api/chat_quick answers daily questions from the global side card:
an optional agent supplies the persona (system prompt + temperature /
max_tokens / model), an explicit model_id overrides the agent's model, and
optional context blocks carry text the user picked from the open page.

Deliberately stateless — no chat_session, no notebook, no server-side
persistence: the full history arrives in the request body (the frontend
keeps it in localStorage), so there is nothing to archive when the client
disconnects. That is why the render task is bound to the SSE generator's
lifetime (client disconnect cancels the in-flight model call) instead of
chat_parallel's decoupled orchestration.
"""

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from loguru import logger
from pydantic import BaseModel, Field

from api.routers._chat_shared import astream_usage_kwargs, resolve_agent_binding
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage_sync
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

router = APIRouter()

QUICK_CHAT_TIMEOUT_SECONDS = 300.0
_STREAM_KEEPALIVE_SECONDS = 15.0

# Silent caps documented in the request model: enough for a long daily Q&A,
# small enough that a runaway client cannot smuggle in a whole notebook.
MAX_MESSAGES = 40
MAX_CONTEXT_BLOCKS = 12
MAX_CONTEXT_BLOCK_CHARS = 8_000
MAX_CONTEXT_TOTAL_CHARS = 24_000

# Model-facing (not UI) prompt for the no-agent default persona.
DEFAULT_SYSTEM_PROMPT = (
    "You are the quick-ask assistant embedded in Open Notebook, a "
    "self-hosted research notebook. Answer directly and concisely, in the "
    "user's language. When the user provides page context, treat it as "
    "reference material from the page they are currently viewing."
)


class QuickChatMessage(BaseModel):
    role: str = Field(..., description="'user' or 'assistant'")
    content: str = Field(..., description="Message text")


class QuickContextBlock(BaseModel):
    label: str = Field("", description="Short label of the picked page element")
    text: str = Field(..., description="Text content extracted from the element")


class QuickChatRequest(BaseModel):
    messages: List[QuickChatMessage] = Field(
        ...,
        description="Conversation so far; the LAST entry must be the new user message",
    )
    model_id: Optional[str] = Field(
        None, description="Explicit model; overrides the agent's model"
    )
    agent_id: Optional[str] = Field(
        None, description="Agent whose system prompt/persona applies (optional)"
    )
    context_blocks: List[QuickContextBlock] = Field(
        default_factory=list,
        description="Page elements picked in the UI, attached to the final user message",
    )


def build_quick_chat_payload(
    messages: List[QuickChatMessage],
    agent: Optional[Any],
    context_blocks: List[QuickContextBlock],
) -> List[BaseMessage]:
    """Pure payload builder (kept separate for tests): system message from
    the agent (or the default persona), history as-is, context blocks folded
    into a preamble of the final user message."""
    system = agent.system_prompt if agent is not None else DEFAULT_SYSTEM_PROMPT
    payload: List[BaseMessage] = [SystemMessage(content=system)]

    for msg in messages[:-1]:
        payload.append(
            HumanMessage(content=msg.content)
            if msg.role == "user"
            else AIMessage(content=msg.content)
        )

    final = messages[-1]
    blocks = [
        b
        for b in context_blocks[:MAX_CONTEXT_BLOCKS]
        if b.text.strip() and len(b.text) <= MAX_CONTEXT_BLOCK_CHARS
    ]
    total = sum(len(b.text) for b in blocks)
    while blocks and total > MAX_CONTEXT_TOTAL_CHARS:
        total -= len(blocks[0].text)
        blocks.pop(0)
    if blocks:
        sections = "\n".join(
            f"--- [{b.label or 'element'}] ---\n{b.text}\n--- end ---" for b in blocks
        )
        preamble = (
            "The user selected the following content from the current page "
            f"as context:\n{sections}\n\n"
        )
        payload.append(HumanMessage(content=f"{preamble}{final.content}"))
    else:
        payload.append(HumanMessage(content=final.content))
    return payload


async def _answer(
    request: QuickChatRequest, queue: "asyncio.Queue[Optional[Dict[str, Any]]]"
) -> None:
    agent = await resolve_agent_binding(request.agent_id)
    model_id = request.model_id or (agent.model_id if agent is not None else None)

    messages = request.messages[-MAX_MESSAGES:]
    payload = build_quick_chat_payload(messages, agent, request.context_blocks)

    provision_kwargs: Dict[str, Any] = {"max_tokens": 8192}
    if agent is not None:
        if agent.temperature is not None:
            provision_kwargs["temperature"] = agent.temperature
        if agent.max_tokens is not None:
            provision_kwargs["max_tokens"] = agent.max_tokens

    try:
        prov = await provision_langchain_model_with_info(
            str(payload), model_id, "chat", **provision_kwargs
        )
        # Esperanto products carry an explicit streaming=False that
        # langchain-core treats as a hard opt-out; flip a throwaway copy
        # (same trick as the chat graph and chat_parallel).
        stream_model = prov.langchain_model.model_copy(update={"streaming": True})
        parts: List[str] = []
        raw_chunks: List[Any] = []

        async def _consume() -> None:
            async for chunk in stream_model.astream(
                payload, **astream_usage_kwargs(stream_model)
            ):
                raw_chunks.append(chunk)
                delta = extract_text_content(chunk.content)
                if delta:
                    parts.append(delta)
                    await queue.put({"type": "delta", "content": delta})

        await asyncio.wait_for(_consume(), timeout=QUICK_CHAT_TIMEOUT_SECONDS)
        full_text = clean_thinking_content("".join(parts))
        if not full_text.strip():
            raise RuntimeError("model returned an empty stream")
        ai_message = AIMessage(content="".join(parts))
        if raw_chunks:
            # usage bookkeeping must never fail the answer
            try:
                await asyncio.to_thread(
                    record_llm_usage_sync,
                    model=prov,
                    ai_message=ai_message,
                    call_type="chat",
                    correlation_id=f"quick:{uuid.uuid4()}",
                    success=True,
                    error=None,
                )
            except Exception as e:
                logger.warning(f"Failed to record quick chat usage: {e}")
        await queue.put({"type": "complete", "content": full_text})
    except asyncio.CancelledError:
        raise
    except ConfigurationError as e:
        await queue.put({"type": "error", "reason": "no_model", "message": str(e)})
    except asyncio.TimeoutError:
        await queue.put({"type": "error", "reason": "model_timeout"})
    except Exception as e:
        logger.warning(f"quick chat failed: {e}")
        await queue.put({"type": "error", "reason": "model_error"})
    finally:
        await queue.put(None)


@router.post("/chat_quick")
async def quick_chat(request: QuickChatRequest) -> StreamingResponse:
    messages = request.messages[-MAX_MESSAGES:]
    if not messages or messages[-1].role != "user" or not messages[-1].content.strip():
        raise HTTPException(
            422, {"message": "缺少有效的用户消息，无法发送", "reason": "no_message"}
        )

    queue: asyncio.Queue = asyncio.Queue()

    async def event_stream():
        task = asyncio.create_task(_answer(request, queue))
        try:
            while True:
                try:
                    item = await asyncio.wait_for(
                        queue.get(), timeout=_STREAM_KEEPALIVE_SECONDS
                    )
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            # Stateless: nothing to archive, so a client disconnect cancels
            # the in-flight model call instead of wasting the tokens.
            task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
