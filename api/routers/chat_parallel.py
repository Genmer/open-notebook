"""Parallel chat answers (PDR-004).

POST /api/chat/sessions/{session_id}/parallel streams one question fanned out
to up to 5 participants (default assistant / bound agents / explicit models,
encoded like the ChatParticipantSelector: 'default' | 'agent:<id>' |
'model:<id>').

Design points (PDR-004 §4 + review fixes):
- Execution lives in an orchestration task created with asyncio.create_task,
  decoupled from the SSE generator's lifetime: a client disconnect cancels
  the response scope, not the orchestration, so archiving always happens.
- The N runs are checkpoint-free: they replay the chat/system prompt directly
  instead of invoking the graph (concurrent invokes on one thread_id would
  clobber each other's checkpoints). Results are archived exactly once via
  graph.update_state after every run settles.
- Events flow through an unbounded asyncio.Queue; a None sentinel closes the
  generator. The generator's finally block never awaits (awaiting inside a
  cancelled scope re-raises CancelledError).
"""

import asyncio
import json
import traceback
import uuid
from typing import Any, Dict, List, Optional, Tuple

from ai_prompter import Prompter
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger
from pydantic import BaseModel, Field

from api.routers._chat_shared import (
    extract_chat_messages,
    get_session_or_404,
    resolve_agent_binding,
)
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage_sync
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.agent import Agent
from open_notebook.domain.notebook import Notebook
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.text_utils import extract_text_content

router = APIRouter()

MAX_PARALLEL_RUNS = 5


class SynthesizeRequest(BaseModel):
    group_id: str = Field(..., description="Parallel group to synthesize")
    instruction: Optional[str] = Field(
        None, description="Optional extra focus for the synthesis"
    )
    agent: Optional[str] = Field(
        None, description="Synthesizer participant key 'agent:<id>'"
    )
    model: Optional[str] = Field(
        None, description="Synthesizer participant key 'model:<id>'"
    )


class ParallelChatRequest(BaseModel):
    message: str = Field(..., description="User message content")
    context: Dict[str, Any] = Field(
        ..., description="Chat context with sources and notes"
    )
    runs: List[str] = Field(
        ...,
        description=(
            "Participants to answer in parallel, e.g. "
            "['default', 'agent:agent:1', 'model:model:gpt']; 1-5 entries"
        ),
    )


def _parse_run_key(key: str) -> Tuple[str, Optional[str]]:
    """'default' | 'agent:<id>' | 'model:<id>' -> (kind, id)."""
    if key == "default":
        return "default", None
    if key.startswith("agent:"):
        agent_id = key[len("agent:") :]
        if not agent_id:
            raise ValueError(f"missing agent id in run key: {key!r}")
        return "agent", agent_id
    if key.startswith("model:"):
        model_id = key[len("model:") :]
        if not model_id:
            raise ValueError(f"missing model id in run key: {key!r}")
        return "model", model_id
    raise ValueError(
        f"invalid run key {key!r}: expected 'default', 'agent:<id>' or 'model:<id>'"
    )


async def _answer_once(
    notebook: Optional[Notebook],
    context: Any,
    history: List[BaseMessage],
    message: str,
    agent: Optional[Agent],
    model_id: Optional[str],
    group_id: str,
) -> Tuple[AIMessage, Any, AIMessage]:
    """Checkpoint-free single answer, mirroring call_model_with_messages.

    Returns (archived_message, provisioned_model, raw_ai_message) — the raw
    message feeds usage recording, the archived copy carries the cleaned
    content plus run metadata.
    """
    # The Prompter template reads the ThreadState shape; supply the agent fields.
    render_state = {
        "messages": [*history, HumanMessage(content=message)],
        "notebook": notebook,
        "context": context,
        "agent_instructions": agent.system_prompt if agent else None,
    }
    system_prompt = Prompter(prompt_template="chat/system").render(data=render_state)
    payload = [SystemMessage(content=system_prompt)] + render_state["messages"]

    provision_kwargs: Dict[str, Any] = {"max_tokens": 8192}
    if agent is not None:
        if agent.temperature is not None:
            provision_kwargs["temperature"] = agent.temperature
        if agent.max_tokens is not None:
            provision_kwargs["max_tokens"] = agent.max_tokens

    prov = await provision_langchain_model_with_info(
        str(payload), model_id, "chat", **provision_kwargs
    )
    ai_message = await prov.langchain_model.ainvoke(payload)

    content = extract_text_content(ai_message.content)
    cleaned = clean_thinking_content(content)
    extra = dict(ai_message.additional_kwargs or {})
    extra.update(
        {
            "model_name": prov.model_name,
            "run_role": "answer",
            "group_id": group_id,
        }
    )
    if agent is not None:
        extra["agent_name"] = agent.name
    archived = ai_message.model_copy(
        update={"content": cleaned, "additional_kwargs": extra}
    )
    return archived, prov, ai_message


async def _record_usage(
    prov: Any, ai_message: Any, thread_id: str, error: Optional[str]
) -> None:
    try:
        await asyncio.to_thread(
            record_llm_usage_sync,
            model=prov,
            ai_message=ai_message,
            call_type="chat",
            correlation_id=thread_id,
            success=error is None,
            error=error,
        )
    except Exception as e:  # usage bookkeeping must never fail a run
        logger.warning(f"Failed to record parallel chat usage: {e}")


async def _orchestrate(
    queue: asyncio.Queue,
    full_session_id: str,
    session: Any,
    notebook: Optional[Notebook],
    context: Any,
    history: List[BaseMessage],
    message: str,
    participants: List[Dict[str, Any]],
    group_id: str,
) -> None:
    """Run all participants concurrently, archive once, then close the queue."""
    try:
        await queue.put(
            {
                "type": "runs_started",
                "group_id": group_id,
                "runs": [
                    {
                        "key": p["key"],
                        "kind": p["kind"],
                        "name": p["display_name"],
                    }
                    for p in participants
                ],
            }
        )

        async def run_participant(p: Dict[str, Any]) -> Optional[AIMessage]:
            if p["error"]:
                await queue.put(
                    {"type": "run_error", "key": p["key"], "message": p["error"]}
                )
                return None
            try:
                ai_message, prov, raw = await _answer_once(
                    notebook,
                    context,
                    history,
                    message,
                    p.get("agent"),
                    p.get("model_id"),
                    group_id,
                )
                await _record_usage(prov, raw, full_session_id, None)
                await queue.put(
                    {
                        "type": "run_complete",
                        "key": p["key"],
                        "group_id": group_id,
                        "content": ai_message.content,
                        "model_name": ai_message.additional_kwargs.get("model_name"),
                        "agent_name": ai_message.additional_kwargs.get("agent_name"),
                    }
                )
                return ai_message
            except Exception as e:
                logger.error(f"Parallel run {p['key']} failed: {e}")
                await _record_usage(None, None, full_session_id, str(e))
                await queue.put(
                    {"type": "run_error", "key": p["key"], "message": str(e)}
                )
                return None

        answers = await asyncio.gather(*(run_participant(p) for p in participants))

        # Archive exactly once: the human message + every successful answer
        # carry the group_id so the UI can render them as one comparison block.
        archive_messages: List[BaseMessage] = [
            HumanMessage(content=message, additional_kwargs={"group_id": group_id})
        ]
        archive_messages.extend(a for a in answers if a is not None)
        await asyncio.to_thread(
            chat_graph.update_state,
            RunnableConfig(configurable={"thread_id": full_session_id}),
            {"messages": archive_messages},
        )
        await session.save()

        await queue.put(
            {
                "type": "archived",
                "group_id": group_id,
                "messages": [
                    m.model_dump() for m in extract_chat_messages(archive_messages)
                ],
            }
        )
        await queue.put({"type": "complete", "group_id": group_id})
    except Exception as e:
        logger.error(
            f"Parallel chat orchestration failed: {e}\n{traceback.format_exc()}"
        )
        await queue.put({"type": "error", "message": str(e)})
    finally:
        await queue.put(None)


@router.post("/chat/sessions/{session_id}/parallel")
async def parallel_chat(session_id: str, request: ParallelChatRequest):
    """Fan one question out to up to 5 participants, stream results as SSE."""
    # Validate run keys up front so bad input 400s instead of streaming errors.
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message content is required")
    if not 1 <= len(request.runs) <= MAX_PARALLEL_RUNS:
        raise HTTPException(
            status_code=400,
            detail=f"runs must contain 1 to {MAX_PARALLEL_RUNS} entries",
        )
    try:
        parsed = [_parse_run_key(key) for key in request.runs]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if len(set(request.runs)) != len(request.runs):
        raise HTTPException(status_code=400, detail="runs contains duplicates")

    full_session_id, session = await get_session_or_404(session_id)

    # Fetch notebook linked to this session (same as /chat/execute).
    notebook: Optional[Notebook] = None
    notebook_query = await repo_query(
        "SELECT out FROM refers_to WHERE in = $session_id",
        {"session_id": ensure_record_id(full_session_id)},
    )
    if notebook_query:
        notebook = await Notebook.get(notebook_query[0]["out"])

    # Read history once; the orchestration task owns it afterwards.
    current_state = await asyncio.to_thread(
        chat_graph.get_state,
        config=RunnableConfig(configurable={"thread_id": full_session_id}),
    )
    history: List[BaseMessage] = (
        list(current_state.values.get("messages", [])) if current_state else []
    )

    # Resolve participants up front (agent lookups degrade per-run, not fatally).
    participants: List[Dict[str, Any]] = []
    for key, (kind, ref_id) in zip(request.runs, parsed):
        participant: Dict[str, Any] = {
            "key": key,
            "kind": kind,
            "model_id": None,
            "agent": None,
            "error": None,
            "display_name": key,
        }
        if kind == "agent":
            agent = await resolve_agent_binding(ref_id)
            if agent is None:
                participant["error"] = "Agent not available (deleted or disabled)"
            else:
                participant["agent"] = agent
                participant["model_id"] = agent.model_id
                participant["display_name"] = agent.name
        elif kind == "model":
            participant["model_id"] = ref_id
        participants.append(participant)

    # Pass the context object through untouched: the single-run execute path
    # hands the same dict to the system template, so answers stay comparable.
    context = request.context
    group_id = f"par_{uuid.uuid4().hex[:12]}"

    queue: asyncio.Queue = asyncio.Queue()
    asyncio.create_task(
        _orchestrate(
            queue=queue,
            full_session_id=full_session_id,
            session=session,
            notebook=notebook,
            context=context,
            history=history,
            message=request.message,
            participants=participants,
            group_id=group_id,
        )
    )

    async def event_stream():
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield f"data: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            # Never await here: on client disconnect Starlette cancels the
            # response scope and any await in this block re-raises
            # CancelledError. The orchestration task keeps running on the loop
            # and archives regardless.
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


def _participant_label(msg: BaseMessage, fallback: str) -> str:
    kwargs = getattr(msg, "additional_kwargs", None) or {}
    return kwargs.get("agent_name") or kwargs.get("model_name") or fallback


@router.post("/chat/sessions/{session_id}/synthesize")
async def synthesize_parallel(session_id: str, request: SynthesizeRequest):
    """Merge one parallel group's answers into a single synthesized answer.

    The synthesis run reads the archived group messages, renders
    chat/synthesis with them, runs one checkpoint-free model call, then
    appends the result to the same thread with run_role='synthesis' so the
    UI renders it as the group's conclusion.
    """
    from fastapi.responses import JSONResponse

    full_session_id, session = await get_session_or_404(session_id)

    agent = None
    model_id = None
    if request.agent:
        if not request.agent.startswith("agent:"):
            raise HTTPException(status_code=400, detail="agent must be 'agent:<id>'")
        agent = await resolve_agent_binding(request.agent[len("agent:") :])
        if agent is None:
            raise HTTPException(status_code=400, detail="Agent not available")
        model_id = agent.model_id
    elif request.model:
        if not request.model.startswith("model:"):
            raise HTTPException(status_code=400, detail="model must be 'model:<id>'")
        model_id = request.model[len("model:") :]

    current_state = await asyncio.to_thread(
        chat_graph.get_state,
        config=RunnableConfig(configurable={"thread_id": full_session_id}),
    )
    all_messages: List[BaseMessage] = (
        list(current_state.values.get("messages", [])) if current_state else []
    )
    group_messages = [
        m
        for m in all_messages
        if (getattr(m, "additional_kwargs", None) or {}).get("group_id")
        == request.group_id
    ]
    if not group_messages:
        raise HTTPException(status_code=404, detail="Parallel group not found")

    human_messages = [m for m in group_messages if getattr(m, "type", "") == "human"]
    ai_messages = [m for m in group_messages if getattr(m, "type", "") == "ai"]
    if not human_messages or not ai_messages:
        raise HTTPException(status_code=400, detail="Parallel group is incomplete")

    prompt = Prompter(prompt_template="chat/synthesis").render(
        data={
            "question": extract_text_content(human_messages[0].content),
            "answers": [
                {
                    "label": _participant_label(msg, f"Answer {i + 1}"),
                    "content": extract_text_content(msg.content),
                }
                for i, msg in enumerate(ai_messages)
            ],
            "instruction": request.instruction or None,
        }
    )

    provision_kwargs: Dict[str, Any] = {"max_tokens": 8192}
    if agent is not None:
        if agent.temperature is not None:
            provision_kwargs["temperature"] = agent.temperature
        if agent.max_tokens is not None:
            provision_kwargs["max_tokens"] = agent.max_tokens

    prov = await provision_langchain_model_with_info(
        prompt, model_id, "chat", **provision_kwargs
    )
    raw = await prov.langchain_model.ainvoke([HumanMessage(content=prompt)])
    content = clean_thinking_content(extract_text_content(raw.content))
    synthesis_message = raw.model_copy(
        update={
            "content": content,
            "additional_kwargs": {
                **(raw.additional_kwargs or {}),
                "model_name": prov.model_name,
                "run_role": "synthesis",
                "group_id": request.group_id,
                **({"agent_name": agent.name} if agent else {}),
            },
        }
    )
    await _record_usage(prov, raw, full_session_id, None)
    await asyncio.to_thread(
        chat_graph.update_state,
        RunnableConfig(configurable={"thread_id": full_session_id}),
        {"messages": [synthesis_message]},
    )
    await session.save()

    return JSONResponse(
        {
            "group_id": request.group_id,
            "content": content,
            "model_name": prov.model_name,
            "agent_name": agent.name if agent else None,
        }
    )
