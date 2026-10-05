import asyncio
import sqlite3
from typing import Annotated, Optional

from ai_prompter import Prompter
from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage_sync
from open_notebook.config import LANGGRAPH_CHECKPOINT_FILE
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import OpenNotebookError
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content


class ThreadState(TypedDict):
    messages: Annotated[list, add_messages]
    notebook: Optional[Notebook]
    context: Optional[str]
    context_config: Optional[dict]
    model_override: Optional[str]
    # Agent persona resolved by the API layer (PDR-004). Instructions are
    # injected into the chat/system prompt; sampling params override the
    # defaults when the bound agent defines them.
    agent_instructions: Optional[str]
    agent_name: Optional[str]
    agent_temperature: Optional[float]
    agent_max_tokens: Optional[int]


def call_model_with_messages(state: ThreadState, config: RunnableConfig) -> dict:
    prov = None
    thread_id = config.get("configurable", {}).get("thread_id")
    try:
        system_prompt = Prompter(prompt_template="chat/system").render(data=state)  # type: ignore[arg-type]
        payload = [SystemMessage(content=system_prompt)] + state.get("messages", [])
        model_id = config.get("configurable", {}).get("model_id") or state.get(
            "model_override"
        )

        # Agent sampling params (PDR-004) ride the provisioning kwargs into the
        # Esperanto config; absent values keep the existing defaults.
        provision_kwargs: dict = {"max_tokens": 8192}
        if state.get("agent_temperature") is not None:
            provision_kwargs["temperature"] = state["agent_temperature"]
        if state.get("agent_max_tokens") is not None:
            provision_kwargs["max_tokens"] = state["agent_max_tokens"]

        # Handle async model provisioning from sync context
        def run_in_new_loop():
            """Run the async function in a new event loop"""
            new_loop = asyncio.new_event_loop()
            try:
                asyncio.set_event_loop(new_loop)
                return new_loop.run_until_complete(
                    provision_langchain_model_with_info(
                        str(payload), model_id, "chat", **provision_kwargs
                    )
                )
            finally:
                new_loop.close()
                asyncio.set_event_loop(None)

        try:
            # Try to get the current event loop
            asyncio.get_running_loop()
            # If we're in an event loop, run in a thread with a new loop
            import concurrent.futures

            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(run_in_new_loop)
                prov = future.result()
        except RuntimeError:
            # No event loop running, safe to use asyncio.run()
            prov = asyncio.run(
                provision_langchain_model_with_info(
                    str(payload),
                    model_id,
                    "chat",
                    **provision_kwargs,
                )
            )
        model = prov.langchain_model

        # Token streaming (chat stream endpoint): caller opts in per-call via
        # config.configurable. Esperanto products always carry an explicit
        # streaming=False (to_langchain passes it through), which langchain-core's
        # _streaming_disabled treats as a hard opt-out overriding even an attached
        # streaming handler — messages-mode token events would never fire. Flipping
        # a throwaway copy re-enables the invoke->stream conversion for THIS call
        # only; callers without the flag (execute_chat, source chat) get the model
        # untouched, byte-identical behavior.
        if config.get("configurable", {}).get("stream_tokens"):
            model = model.model_copy(update={"streaming": True})

        ai_message = model.invoke(payload)

        # Clean thinking content from AI response (e.g., <think>...</think> tags)
        content = extract_text_content(ai_message.content)
        cleaned_content = clean_thinking_content(content)
        # Run metadata (PDR-004): which model/agent produced this message, so
        # the UI can badge it. Merged into existing kwargs, not replacing them.
        extra_kwargs = dict(ai_message.additional_kwargs or {})
        extra_kwargs.setdefault("model_name", prov.model_name)
        if state.get("agent_name"):
            extra_kwargs["agent_name"] = state["agent_name"]
        cleaned_message = ai_message.model_copy(
            update={
                "content": cleaned_content,
                "additional_kwargs": extra_kwargs,
            }
        )

        record_llm_usage_sync(
            model=prov,
            ai_message=ai_message,
            call_type="chat",
            correlation_id=str(thread_id) if thread_id else None,
        )

        return {"messages": cleaned_message}
    except OpenNotebookError:
        record_llm_usage_sync(
            model=prov,
            ai_message=None,
            call_type="chat",
            correlation_id=str(thread_id) if thread_id else None,
            success=False,
            error="provisioning failed",
        )
        raise
    except Exception as e:
        record_llm_usage_sync(
            model=prov,
            ai_message=None,
            call_type="chat",
            correlation_id=str(thread_id) if thread_id else None,
            success=False,
            error=str(e),
        )
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


conn = sqlite3.connect(
    LANGGRAPH_CHECKPOINT_FILE,
    check_same_thread=False,
)
memory = SqliteSaver(conn)

agent_state = StateGraph(ThreadState)
agent_state.add_node("agent", call_model_with_messages)
agent_state.add_edge(START, "agent")
agent_state.add_edge("agent", END)
graph = agent_state.compile(checkpointer=memory)
