"""
Unit tests for the usage recorder (open_notebook/ai/usage.py).

Covers token extraction variants, the enable switch, never-fail behavior and
the estimated embedding tokens.
"""

import time
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.ai.usage import (
    extract_token_usage,
    record_embedding_usage,
    record_llm_usage,
    record_llm_usage_sync,
)


@pytest.fixture
def write_row(monkeypatch):
    mock = AsyncMock(return_value=[])
    monkeypatch.setattr("open_notebook.ai.usage.repo_insert", mock)
    return mock


def _tracking_rows(monkeypatch, enabled):
    """Stub the fresh settings read the recorder performs (deliberately not
    get_instance: the worker must see the toggle without a restart)."""
    mock = AsyncMock(return_value=[{"usage_tracking_enabled": enabled}])
    monkeypatch.setattr("open_notebook.database.repository.repo_query", mock)
    return mock


@pytest.fixture
def tracking_on(monkeypatch):
    return _tracking_rows(monkeypatch, True)


@pytest.fixture
def tracking_off(monkeypatch):
    return _tracking_rows(monkeypatch, False)


class TestExtractTokenUsage:
    def test_usage_metadata_variant(self):
        message = SimpleNamespace(
            usage_metadata={"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
            response_metadata={},
        )
        assert extract_token_usage(message) == (10, 4, 14)

    def test_response_metadata_token_usage_variant(self):
        message = SimpleNamespace(
            usage_metadata=None,
            response_metadata={
                "token_usage": {"prompt_tokens": 7, "completion_tokens": 3, "total_tokens": 10}
            },
        )
        assert extract_token_usage(message) == (7, 3, 10)

    def test_response_metadata_usage_variant(self):
        message = SimpleNamespace(
            usage_metadata=None,
            response_metadata={"usage": {"input_tokens": 1, "output_tokens": 2}},
        )
        assert extract_token_usage(message) == (1, 2, None)

    def test_no_usage_data_returns_nones(self):
        message = SimpleNamespace(usage_metadata=None, response_metadata={})
        assert extract_token_usage(message) == (None, None, None)


class TestRecordLlmUsage:
    @pytest.mark.asyncio
    async def test_writes_row_with_tokens(self, write_row, tracking_on):
        message = SimpleNamespace(
            usage_metadata={"input_tokens": 10, "output_tokens": 4, "total_tokens": 14},
            response_metadata={},
        )
        model = SimpleNamespace(model_name="m", provider="p", model_id="model:1")

        await record_llm_usage(
            model=model, ai_message=message, call_type="chat", correlation_id="thread:1"
        )

        write_row.assert_awaited_once()
        table, rows = write_row.await_args.args
        assert table == "model_usage"
        row = rows[0]
        assert row["input_tokens"] == 10
        assert row["output_tokens"] == 4
        assert row["total_tokens"] == 14
        assert row["model_name"] == "m"
        assert row["call_type"] == "chat"
        assert row["correlation_id"] == "thread:1"
        assert row["success"] is True
        assert row["is_estimated"] is False

    @pytest.mark.asyncio
    async def test_failure_row_truncates_error(self, write_row, tracking_on):
        await record_llm_usage(
            model=None,
            ai_message=None,
            call_type="chat",
            success=False,
            error="x" * 900,
        )
        row = write_row.await_args.args[1][0]
        assert row["success"] is False
        assert len(row["error"]) == 500

    @pytest.mark.asyncio
    async def test_switch_disabled_writes_nothing(self, write_row, tracking_off):
        await record_llm_usage(model=None, ai_message=None, call_type="chat")
        write_row.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_switch_read_is_fresh_not_singleton(self, write_row, tracking_off):
        """The toggle is read via a direct query each call - a worker process
        must observe the change without a restart (RecordModel singletons
        would otherwise pin the startup value)."""
        query_mock = tracking_off
        await record_llm_usage(model=None, ai_message=None, call_type="chat")
        query_mock.assert_awaited_once()
        assert "content_settings" in query_mock.await_args.args[0]

    @pytest.mark.asyncio
    async def test_switch_missing_row_fails_open(self, write_row, monkeypatch):
        """No settings record at all -> recording stays enabled."""
        monkeypatch.setattr(
            "open_notebook.database.repository.repo_query", AsyncMock(return_value=[])
        )
        await record_llm_usage(model=None, ai_message=None, call_type="chat")
        write_row.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_switch_value_none_fails_open(self, write_row, monkeypatch):
        """A settings row whose flag is NULL ('never configured') must also
        fail open - only an explicit False disables recording."""
        monkeypatch.setattr(
            "open_notebook.database.repository.repo_query",
            AsyncMock(return_value=[{"usage_tracking_enabled": None}]),
        )
        await record_llm_usage(model=None, ai_message=None, call_type="chat")
        write_row.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_repo_insert_error_does_not_propagate(self, tracking_on):
        with patch(
            "open_notebook.ai.usage.repo_insert", new=AsyncMock(side_effect=RuntimeError("db down"))
        ):
            await record_llm_usage(model=None, ai_message=None, call_type="chat")


class TestRecordLlmUsageSync:
    def test_sync_recorder_runs_and_does_not_raise(self, tracking_on):
        write_row = AsyncMock(return_value=[])
        with patch("open_notebook.ai.usage.repo_insert", write_row):
            record_llm_usage_sync(model=None, ai_message=None, call_type="chat")
            deadline = time.time() + 5
            while not write_row.await_count and time.time() < deadline:
                time.sleep(0.01)
        assert write_row.await_count == 1

    def test_sync_recorder_survives_repo_failure_without_blocking_caller(self, tracking_on):
        """Sync graph nodes (chat threads) must neither block nor crash when the
        usage write fails - the daemon thread swallows the error."""
        write_row = AsyncMock(side_effect=RuntimeError("db down"))
        with patch("open_notebook.ai.usage.repo_insert", write_row):
            record_llm_usage_sync(model=None, ai_message=None, call_type="chat")
            deadline = time.time() + 5
            while not write_row.await_count and time.time() < deadline:
                time.sleep(0.01)
        # The write was attempted (and failed inside the daemon thread); the
        # fact that we reached this point proves the caller did not raise.
        assert write_row.await_count == 1

    def test_sync_recorder_fail_open_when_settings_unavailable(self, monkeypatch):
        """A settings read problem must not silently disable recording."""
        monkeypatch.setattr(
            "open_notebook.database.repository.repo_query",
            AsyncMock(side_effect=RuntimeError("settings unavailable")),
        )
        write_row = AsyncMock(return_value=[])
        with patch("open_notebook.ai.usage.repo_insert", write_row):
            record_llm_usage_sync(model=None, ai_message=None, call_type="chat")
            deadline = time.time() + 5
            while not write_row.await_count and time.time() < deadline:
                time.sleep(0.01)
        assert write_row.await_count == 1


class TestTrackingSwitchEmbedding:
    @pytest.mark.asyncio
    async def test_switch_disabled_embedding_writes_nothing(self, write_row, tracking_off):
        """The switch gates the embedding path too: no new rows when off."""
        await record_embedding_usage(
            model=SimpleNamespace(model_name="embed", provider="openai"), texts=["a"]
        )
        write_row.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_embedding_fail_open_when_settings_read_fails(self, write_row, monkeypatch):
        """Fail-open: an unreadable settings read keeps recording enabled."""
        monkeypatch.setattr(
            "open_notebook.database.repository.repo_query",
            AsyncMock(side_effect=RuntimeError("settings unavailable")),
        )
        with patch("open_notebook.utils.token_utils.token_count", return_value=3):
            await record_embedding_usage(
                model=SimpleNamespace(model_name="embed", provider="openai"), texts=["a"]
            )
        write_row.assert_awaited_once()


class TestRecordEmbeddingUsage:
    @pytest.mark.asyncio
    async def test_estimates_tokens_locally(self, write_row, tracking_on):
        with patch(
            "open_notebook.utils.token_utils.token_count", return_value=5
        ) as token_count_mock:
            await record_embedding_usage(
                model=SimpleNamespace(model_name="embed", provider="openai"),
                texts=["a", "b"],
            )
        assert token_count_mock.call_count == 2
        row = write_row.await_args.args[1][0]
        assert row["input_tokens"] == 10
        assert row["total_tokens"] == 10
        assert row["is_estimated"] is True
        assert row["call_type"] == "embedding"

    @pytest.mark.asyncio
    async def test_failure_row(self, write_row, tracking_on):
        with patch("open_notebook.utils.token_utils.token_count", return_value=0):
            await record_embedding_usage(
                model=SimpleNamespace(model_name="embed"), texts=["a"], success=False, error="boom"
            )
        row = write_row.await_args.args[1][0]
        assert row["success"] is False
        assert row["error"] == "boom"
