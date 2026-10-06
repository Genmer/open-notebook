"""Chat-history compression as a surreal-commands async job.

`compress_chat_history` merges the selected checkpoint messages of one chat
session into a single AI summary message via one LLM call, then rebuilds the
history in ONE atomic `update_state` write (REMOVE_ALL_MESSAGES + kept
messages + summary). The write is the only irreversible step: every
validation failure raises before it, so the original history is untouched
and the command can be retried or re-submitted safely.

Concurrency protection (in order of actual effectiveness in production):
1. The submit endpoint (api/routers/chat_history.py) rejects a second
   compression job for the same session with 409 while one is queued or
   running — this check lives in the API process where the command table is
   queried, so it is the real gate.
2. The pre-write recheck below (step 8) re-reads the checkpoint and aborts
   when the ordered message ids changed since the snapshot — this catches a
   concurrent delete that raced the LLM call.
3. The in-flight generation check is defense-in-depth ONLY: the stream
   routers' in-flight sets are API-process memory and this command runs in
   the worker process, where those sets are always empty. It exists so that
   in-process callers (tests, future embedding) keep the documented
   semantics; it must not be relied upon as a concurrency guard.

Cross-graph dispatch mirrors the history-editing endpoints: source-bound
sessions must be written through source_chat_graph, or the source-only state
channels (context_indicators) would be blanked by a notebook-graph write.
"""

import asyncio
import time
from typing import Any, List, Optional
from uuid import uuid4

from ai_prompter import Prompter
from langchain_core.messages import AIMessage, HumanMessage, RemoveMessage
from langchain_core.runnables import RunnableConfig
from langgraph.graph.message import REMOVE_ALL_MESSAGES
from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from api.routers._chat_shared import (
    resolve_session_owner_kind,
    session_in_generation,
)
from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.domain.notebook import ChatSession
from open_notebook.exceptions import (
    ConfigurationError,
    ContextLengthExceededError,
    InvalidInputError,
    NotFoundError,
)
from open_notebook.graphs.chat import graph as chat_graph
from open_notebook.graphs.source_chat import (
    source_chat_graph as source_chat_graph,
)
from open_notebook.utils.text_utils import (
    clean_thinking_content,
    extract_text_content,
)
from open_notebook.utils.timestamps import utc_now_iso

# Same upper bound as one delete request: a single update_state write stays small.
MAX_COMPRESS_IDS = 500
# Per-message ceiling inside the compression prompt: the LLM summarizes, it
# does not need verbatim megabytes.
MAX_PROMPT_CHARS_PER_MESSAGE = 4000


class CompressChatHistoryInput(CommandInput):
    session_id: str
    message_ids: List[str]


class CompressChatHistoryOutput(CommandOutput):
    success: bool
    session_id: str
    summary_message_id: str = ""
    compressed_count: int = 0
    remaining_count: int = 0
    chars_before: int = 0
    chars_after: int = 0
    processing_time: float
    error_message: Optional[str] = None


def _history_chars(messages: List[Any]) -> int:
    """Serialized character count of a raw message list.

    extract_text_content instead of len(str(...)) so multimodal list/dict
    contents count their text payload, matching the breakdown accounting.
    """
    total = 0
    for msg in messages:
        total += len(extract_text_content(getattr(msg, "content", None)))
    return total


def _ordered_ids(messages: List[Any]) -> List[str]:
    """Checkpoint-order snapshot of the messages that carry an id."""
    ids: List[str] = []
    for msg in messages:
        msg_id = getattr(msg, "id", None)
        if msg_id:
            ids.append(msg_id)
    return ids


def _graph_for_owner(owner_kind: str):
    """Map the session's parent kind to its owning LangGraph (single source of
    truth with api/routers/chat_history.py: writing through the wrong graph
    would blank the source-only channels)."""
    return source_chat_graph if owner_kind == "source" else chat_graph


@command(
    "compress_chat_history",
    app="open_notebook",
    retry={
        "max_attempts": 5,
        "wait_strategy": "exponential_jitter",
        "wait_min": 1,
        "wait_max": 60,
        # Validation/config errors are permanent: don't burn retries on them.
        "stop_on": [ValueError, ConfigurationError, ContextLengthExceededError],
        "retry_log_level": "warning",
    },
)
async def compress_chat_history_command(
    input_data: CompressChatHistoryInput,
) -> CompressChatHistoryOutput:
    """Merge the selected messages of one chat session into a single AI
    summary message and rewrite the checkpoint history atomically."""
    start_time = time.time()

    # Dedupe while preserving order; a duplicated id means one message.
    message_ids = list(dict.fromkeys(input_data.message_ids))
    if not 2 <= len(message_ids) <= MAX_COMPRESS_IDS:
        raise ValueError(
            f"compress_chat_history needs 2 to {MAX_COMPRESS_IDS} message ids, "
            f"got {len(message_ids)}"
        )

    session_id = input_data.session_id
    try:
        await ChatSession.get(session_id)
    except (NotFoundError, InvalidInputError) as e:
        # Permanent: a retry cannot bring a missing session back.
        raise ValueError(f"Chat session {session_id} not found: {e}")

    logger.info(f"Compressing {len(message_ids)} messages of chat session {session_id}")

    owner_kind = await resolve_session_owner_kind(session_id)
    graph = _graph_for_owner(owner_kind)
    config = RunnableConfig(configurable={"thread_id": session_id})

    if session_in_generation(session_id):
        # Defense-in-depth only (see module docstring): in production the
        # worker process always sees an empty in-flight set.
        raise RuntimeError(
            "A generation is in progress for this session; compression aborted"
        )

    # --- Step 4: snapshot the history this job decided on -------------------
    current_state = await asyncio.to_thread(graph.get_state, config=config)
    messages: List[Any] = (
        list(current_state.values.get("messages", [])) if current_state else []
    )
    ids_before = _ordered_ids(messages)
    id_to_index = {msg_id: idx for idx, msg_id in enumerate(ids_before)}

    missing = [mid for mid in message_ids if mid not in id_to_index]
    if missing:
        # Permanent: the history moved on; the submitter must reselect.
        raise ValueError(f"Message not found in checkpoint: {missing[0]}")
    chars_before = _history_chars(messages)
    selected = set(message_ids)

    # --- Step 5: render the prompt (user content is a render variable, never
    # template source — see docs/7-DEVELOPMENT/security.md) ------------------
    prompt_messages = []
    for msg in messages:
        msg_id = getattr(msg, "id", None)
        if msg_id not in selected:
            continue
        role = "user" if getattr(msg, "type", "") == "human" else "assistant"
        content = extract_text_content(getattr(msg, "content", None))
        prompt_messages.append(
            {
                "index": id_to_index[msg_id] + 1,
                "role": role,
                "content": content[:MAX_PROMPT_CHARS_PER_MESSAGE],
            }
        )
    prompt = Prompter(prompt_template="chat/compress").render(
        data={"messages": prompt_messages}
    )

    # --- Steps 6-7: one LLM call, usage recorded on success -----------------
    prov = await provision_langchain_model_with_info(
        prompt, None, "chat", max_tokens=8192
    )
    response = await prov.langchain_model.ainvoke([HumanMessage(content=prompt)])
    summary_text = clean_thinking_content(
        extract_text_content(response.content)
    ).strip()
    if not summary_text:
        # Permanent: a retry burns another LLM call on the same history.
        raise ValueError("Model returned an empty chat-history summary")
    # record_llm_usage never raises (usage bookkeeping is best-effort).
    await record_llm_usage(
        model=prov,
        ai_message=response,
        call_type="chat_history",
        correlation_id=session_id,
    )

    # --- Step 8: pre-write recheck — the real race guard --------------------
    recheck_state = await asyncio.to_thread(graph.get_state, config=config)
    recheck_messages: List[Any] = (
        list(recheck_state.values.get("messages", [])) if recheck_state else []
    )
    if _ordered_ids(recheck_messages) != ids_before:
        # Transient on purpose: a retry re-reads everything against the new
        # history instead of writing a stale merge (e.g. the user deleted
        # messages while the LLM call was running).
        raise RuntimeError(
            "Chat history changed while the compression job was running; "
            "aborting without writing"
        )

    # --- Step 9: the ONLY irreversible write — one atomic rebuild -----------
    # REMOVE_ALL + full re-insertion, instead of per-id RemoveMessages + an
    # appended summary: add_messages would put an appended message at the END
    # of the history, not at the compressed position.
    summary_message = AIMessage(
        content=summary_text,
        id=str(uuid4()),
        additional_kwargs={
            "message_kind": "summary",
            "created_at": utc_now_iso(),
            "model_name": prov.model_name,
        },
    )
    min_selected_index = min(id_to_index[mid] for mid in message_ids)
    kept_with_summary: List[Any] = []
    summary_inserted = False
    for idx, msg in enumerate(recheck_messages):
        msg_id = getattr(msg, "id", None)
        if msg_id in selected:
            if not summary_inserted and idx == min_selected_index:
                kept_with_summary.append(summary_message)
                summary_inserted = True
            continue
        kept_with_summary.append(msg)
    if not summary_inserted:
        # Every message was selected: the summary becomes the whole history.
        kept_with_summary.insert(0, summary_message)

    # A transient sqlite lock (worker vs API process on the same checkpoint
    # file) surfaces here: the exception must propagate untouched so the
    # retry layer re-runs the command after its jittered wait.
    await asyncio.to_thread(
        graph.update_state,
        config,
        {"messages": [RemoveMessage(id=REMOVE_ALL_MESSAGES), *kept_with_summary]},
    )

    # --- Step 10: authoritative read-back -----------------------------------
    final_state = await asyncio.to_thread(graph.get_state, config=config)
    final_messages: List[Any] = (
        list(final_state.values.get("messages", [])) if final_state else []
    )
    remaining_count = len(final_messages)
    summary_id = str(summary_message.id) if summary_message.id else ""
    processing_time = time.time() - start_time
    logger.info(
        f"Compressed {len(selected)} messages of session {session_id} into "
        f"summary {summary_id}: {chars_before} -> "
        f"{_history_chars(final_messages)} chars in {processing_time:.2f}s"
    )
    return CompressChatHistoryOutput(
        success=True,
        session_id=session_id,
        summary_message_id=summary_id,
        compressed_count=len(selected),
        remaining_count=remaining_count,
        chars_before=chars_before,
        chars_after=_history_chars(final_messages),
        processing_time=processing_time,
    )
