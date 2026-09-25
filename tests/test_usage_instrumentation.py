"""
Tests for the per-workflow usage instrumentation (T7-1).

Each graph node must hand the recorder a correctly attributed row payload:
call_type identifies the workflow, correlation_id identifies the thread or
source, and the AI message (carrying usage_metadata) is passed through so
the recorder can extract tokens. The recorder internals themselves are
covered by test_usage_recorder.py.
"""

from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage
from langchain_core.runnables import RunnableConfig

USAGE_MESSAGE = MagicMock(
    content="answer",
    usage_metadata={"input_tokens": 11, "output_tokens": 7, "total_tokens": 18},
)

EMPTY_CONFIG = cast(RunnableConfig, {"configurable": {}})


def _provision_returning(message=USAGE_MESSAGE):
    model = MagicMock()
    model.invoke = MagicMock(return_value=message)
    model.ainvoke = AsyncMock(return_value=message)
    prov = MagicMock()
    prov.model_name = "gpt-x"
    prov.provider = "openai"
    prov.model_id = "model:1"
    prov.langchain_model = model
    return prov


class TestChatInstrumentation:
    @pytest.mark.asyncio
    async def test_chat_node_records_chat_usage_with_thread_correlation(self):
        """T7-1: the chat node attributes its usage row to call_type=chat and
        the thread_id, passing the raw AI message for token extraction."""
        from open_notebook.graphs.chat import ThreadState, call_model_with_messages

        prov = _provision_returning()
        with (
            patch(
                "open_notebook.graphs.chat.provision_langchain_model_with_info",
                new=AsyncMock(return_value=prov),
            ),
            patch(
                "open_notebook.graphs.chat.record_llm_usage_sync"
            ) as record_sync,
        ):
            state = cast(ThreadState, {"messages": [HumanMessage("hi")]})
            config = cast(RunnableConfig, {"configurable": {"thread_id": "thread-42"}})
            call_model_with_messages(state, config)

        record_sync.assert_called_once()
        assert record_sync.call_args is not None
        kwargs = record_sync.call_args.kwargs
        assert kwargs["call_type"] == "chat"
        assert kwargs["correlation_id"] == "thread-42"
        assert kwargs["model"] is prov
        assert kwargs["ai_message"] is USAGE_MESSAGE
        assert kwargs.get("success", True) is True

    @pytest.mark.asyncio
    async def test_chat_provisioning_failure_records_failed_row_and_reraises(self):
        """A provisioning failure still lands a failed usage row for the thread."""
        from open_notebook.exceptions import ConfigurationError
        from open_notebook.graphs.chat import ThreadState, call_model_with_messages

        with (
            patch(
                "open_notebook.graphs.chat.provision_langchain_model_with_info",
                new=AsyncMock(side_effect=ConfigurationError("no model")),
            ),
            patch(
                "open_notebook.graphs.chat.record_llm_usage_sync"
            ) as record_sync,
        ):
            with pytest.raises(Exception):
                call_model_with_messages(
                    cast(ThreadState, {"messages": [HumanMessage("hi")]}),
                    cast(RunnableConfig, {"configurable": {"thread_id": "thread-7"}}),
                )

        assert record_sync.call_args is not None
        kwargs = record_sync.call_args.kwargs
        assert kwargs["call_type"] == "chat"
        assert kwargs["success"] is False
        assert kwargs["error"]


class TestSourceChatInstrumentation:
    @pytest.mark.asyncio
    async def test_source_chat_node_records_source_chat_usage(self):
        """T7-1: source_chat rows are their own call_type and correlate to the source."""
        from open_notebook.graphs.source_chat import (
            SourceChatState,
            _call_model_with_source_context_inner,
        )

        prov = _provision_returning()
        with (
            patch(
                "open_notebook.graphs.source_chat.build_source_context",
                new=AsyncMock(return_value={"sources": [], "insights": []}),
            ),
            patch(
                "open_notebook.graphs.source_chat._format_source_context",
                return_value="",
            ),
            patch(
                "open_notebook.graphs.source_chat.provision_langchain_model_with_info",
                new=AsyncMock(return_value=prov),
            ),
            patch(
                "open_notebook.graphs.source_chat.record_llm_usage_sync"
            ) as record_sync,
        ):
            state = cast(
                SourceChatState,
                {"source_id": "source:9", "messages": [HumanMessage("hi")]},
            )
            _call_model_with_source_context_inner(state, EMPTY_CONFIG)

        record_sync.assert_called_once()
        assert record_sync.call_args is not None
        kwargs = record_sync.call_args.kwargs
        assert kwargs["call_type"] == "source_chat"
        assert kwargs["correlation_id"] == "source:9"
        assert kwargs["model"] is prov
        assert kwargs["ai_message"] is USAGE_MESSAGE


class TestAskInstrumentation:
    @pytest.mark.asyncio
    async def test_all_three_ask_nodes_record_ask_usage(self):
        """T7-1: strategy, answer and synthesis each record call_type=ask."""
        from open_notebook.graphs.ask import (
            Strategy,
            SubGraphState,
            ThreadState,
            call_model_with_messages,
            provide_answer,
            write_final_answer,
        )

        strategy_prov = _provision_returning(
            MagicMock(
                content='{"reasoning": "r", "searches": [{"term": "rag", "instructions": "i"}]}',
                usage_metadata=USAGE_MESSAGE.usage_metadata,
            )
        )
        plain_prov = _provision_returning()

        with patch("open_notebook.graphs.ask.record_llm_usage", new=AsyncMock()) as record:
            with patch(
                "open_notebook.graphs.ask.provision_langchain_model_with_info",
                new=AsyncMock(return_value=strategy_prov),
            ):
                await call_model_with_messages(
                    cast(ThreadState, {"question": "q"}), EMPTY_CONFIG
                )
            assert record.await_args is not None
            assert record.await_args.kwargs["call_type"] == "ask"
            assert record.await_args.kwargs["model"].model_name == "gpt-x"

            record.reset_mock()
            with (
                patch(
                    "open_notebook.graphs.ask.vector_search",
                    new=AsyncMock(return_value=[{"id": "source:1", "content": "x"}]),
                ),
                patch(
                    "open_notebook.graphs.ask.provision_langchain_model_with_info",
                    new=AsyncMock(return_value=plain_prov),
                ),
            ):
                await provide_answer(
                    cast(
                        SubGraphState,
                        {"question": "q", "term": "rag", "instructions": "i"},
                    ),
                    EMPTY_CONFIG,
                )
            assert record.await_args is not None
            assert record.await_args.kwargs["call_type"] == "ask"

            record.reset_mock()
            with patch(
                "open_notebook.graphs.ask.provision_langchain_model_with_info",
                new=AsyncMock(return_value=plain_prov),
            ):
                await write_final_answer(
                    cast(
                        ThreadState,
                        {
                            "question": "q",
                            "strategy": Strategy(reasoning="r", searches=[]),
                            "answers": ["a"],
                        },
                    ),
                    EMPTY_CONFIG,
                )
            assert record.await_args is not None
            assert record.await_args.kwargs["call_type"] == "ask"


class TestTransformationAndPromptInstrumentation:
    @pytest.mark.asyncio
    async def test_transformation_node_records_transformation_usage(self):
        """T7-1: transformations attribute rows to call_type=transformation and
        the source as correlation id."""
        from open_notebook.graphs.transformation import run_transformation

        prov = _provision_returning()
        transformation = MagicMock()
        transformation.prompt = "summarize"
        transformation.title = "Summary"

        with (
            patch(
                "open_notebook.graphs.transformation.provision_langchain_model_with_info",
                new=AsyncMock(return_value=prov),
            ),
            patch(
                "open_notebook.graphs.transformation.record_llm_usage",
                new=AsyncMock(),
            ) as record,
        ):
            await run_transformation(
                {
                    "input_text": "hello world",
                    "source": None,
                    "transformation": transformation,
                    "output": None,
                },
                EMPTY_CONFIG,
            )

        assert record.await_args is not None
        kwargs = record.await_args.kwargs
        assert kwargs["call_type"] == "transformation"
        assert kwargs["model"] is prov
        assert kwargs["ai_message"] is USAGE_MESSAGE

    @pytest.mark.asyncio
    async def test_prompt_node_records_prompt_usage(self):
        """T7-1: one-off pattern prompts record call_type=prompt."""
        from open_notebook.graphs.prompt import call_model

        prov = _provision_returning()
        with (
            patch(
                "open_notebook.graphs.prompt.provision_langchain_model_with_info",
                new=AsyncMock(return_value=prov),
            ),
            patch(
                "open_notebook.graphs.prompt.record_llm_usage", new=AsyncMock()
            ) as record,
        ):
            await call_model(
                {"prompt": "do", "input_text": "text", "parser": None, "output": None},
                EMPTY_CONFIG,
            )

        assert record.await_args is not None
        kwargs = record.await_args.kwargs
        assert kwargs["call_type"] == "prompt"
        assert kwargs["model"] is prov
        assert kwargs["ai_message"] is USAGE_MESSAGE
