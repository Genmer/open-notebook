"""Stale-command recovery: orphaned 'running' jobs must fail and unblock retry.

A worker that dies mid-job leaves its command row 'running' forever; readers
now fail it on sight (COMMAND_STALE_TIMEOUT_SECONDS without updates) so the
affected source can be retried instead of being blocked permanently.
"""

import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from api.command_service import CommandService
from open_notebook.domain.notebook import (
    COMMAND_STALE_TIMEOUT_SECONDS,
    STALE_COMMAND_ERROR_MESSAGE,
    Source,
    _is_stale_running,
)


def _status_result(status="running", updated=None, created=None):
    return SimpleNamespace(
        status=status,
        updated=updated,
        created=created,
        result=None,
        error_message=None,
    )


def _stale_time() -> datetime:
    return datetime.now(timezone.utc) - timedelta(
        seconds=COMMAND_STALE_TIMEOUT_SECONDS * 2
    )


def _fresh_time() -> datetime:
    return datetime.now(timezone.utc) - timedelta(seconds=10)


FROZEN_NOW = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


class _FrozenDatetime(datetime):
    """datetime whose now() is pinned, so exact-boundary ages stay exact."""

    @classmethod
    def now(cls, tz=None):  # noqa: ARG003
        return FROZEN_NOW


def _frozen(value: datetime) -> datetime:
    """Rebuild value as _FrozenDatetime so isinstance checks pass while patched."""
    return _FrozenDatetime(
        value.year,
        value.month,
        value.day,
        value.hour,
        value.minute,
        value.second,
        value.microsecond,
        tzinfo=value.tzinfo,
    )


class TestRecoverStaleCommands:
    @pytest.mark.asyncio
    async def test_marks_stale_running_commands_failed(self):
        stale_updated = _stale_time()
        row = {
            "id": "command:abc",
            "name": "process_source",
            "updated": stale_updated,
            "created": stale_updated - timedelta(minutes=5),
        }
        queries = []

        async def fake_repo_query(query, vars=None):
            queries.append((query, vars))
            if query.startswith("SELECT"):
                return [row]
            return [{"status": "failed"}]

        with patch("api.command_service.repo_query", new=fake_repo_query):
            recovered = await CommandService.recover_stale_commands()

        assert recovered == 1
        select_query, select_vars = queries[0]
        assert "status = 'running'" in select_query
        assert select_vars["cutoff"] < datetime.now(timezone.utc) - timedelta(
            seconds=COMMAND_STALE_TIMEOUT_SECONDS - 60
        )
        update_query, update_vars = queries[1]
        assert "status = 'running'" in update_query  # guarded UPDATE
        assert update_vars["id"] is not None

    @pytest.mark.asyncio
    async def test_no_stale_commands_returns_zero(self):
        with patch("api.command_service.repo_query", new=AsyncMock(return_value=[])):
            assert await CommandService.recover_stale_commands() == 0

    @pytest.mark.asyncio
    async def test_db_failure_returns_zero(self):
        with patch(
            "api.command_service.repo_query",
            new=AsyncMock(side_effect=RuntimeError("boom")),
        ):
            assert await CommandService.recover_stale_commands() == 0

    @pytest.mark.asyncio
    async def test_command_finished_between_select_and_update_not_counted(self):
        async def fake_repo_query(query, vars=None):
            if query.startswith("SELECT"):
                return [
                    {
                        "id": "command:abc",
                        "name": "process_source",
                        "updated": _stale_time(),
                        "created": _stale_time(),
                    }
                ]
            return []  # UPDATE matched nothing: job finished in between

        with patch("api.command_service.repo_query", new=fake_repo_query):
            assert await CommandService.recover_stale_commands() == 0

    @pytest.mark.asyncio
    async def test_row_without_id_is_skipped_without_update(self):
        async def fake_repo_query(query, vars=None):
            if query.startswith("SELECT"):
                return [{"name": "process_source", "updated": _stale_time()}]
            raise AssertionError("UPDATE must not run for a row without id")

        with patch("api.command_service.repo_query", new=fake_repo_query):
            assert await CommandService.recover_stale_commands() == 0


class TestStalenessBoundary:
    def test_running_at_exact_timeout_boundary_is_not_stale(self):
        exact_boundary = _frozen(
            FROZEN_NOW - timedelta(seconds=COMMAND_STALE_TIMEOUT_SECONDS)
        )
        with patch("open_notebook.domain.notebook.datetime", _FrozenDatetime):
            assert _is_stale_running(_status_result(updated=exact_boundary)) is False

    def test_running_one_second_past_timeout_is_stale(self):
        just_past = _frozen(
            FROZEN_NOW - timedelta(seconds=COMMAND_STALE_TIMEOUT_SECONDS + 1)
        )
        with patch("open_notebook.domain.notebook.datetime", _FrozenDatetime):
            assert _is_stale_running(_status_result(updated=just_past)) is True

    def test_terminal_statuses_are_never_stale(self):
        for status in ("completed", "failed", "canceled", "queued"):
            result = _status_result(
                status=status, updated=_stale_time(), created=_stale_time()
            )
            assert _is_stale_running(result) is False, status


class TestSourceStaleStatus:
    @pytest.mark.asyncio
    async def test_stale_running_reports_failed_and_fails_command(self):
        source = Source(id="source:abc", title="t", command="command:old")
        repo_mock = AsyncMock(return_value=[{"id": "command:old"}])

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_stale_time(), created=_stale_time()
                    )
                ),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            status = await source.get_status()

        assert status == "failed"
        assert repo_mock.await_count == 1
        assert repo_mock.await_args is not None
        assert "status = 'running'" in repo_mock.await_args.args[0]
        assert STALE_COMMAND_ERROR_MESSAGE in repo_mock.await_args.args[1]["msg"]

    @pytest.mark.asyncio
    async def test_stale_reported_failed_even_when_heal_write_fails(self):
        source = Source(id="source:abc", title="t", command="command:old")

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_stale_time(), created=_stale_time()
                    )
                ),
            ),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(side_effect=RuntimeError("db down")),
            ),
        ):
            assert await source.get_status() == "failed"

    @pytest.mark.asyncio
    async def test_naive_timestamp_treated_as_utc(self):
        source = Source(id="source:abc", title="t", command="command:old")
        naive_stale = _stale_time().replace(tzinfo=None)

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(return_value=_status_result(updated=naive_stale)),
            ),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[{"id": "command:old"}]),
            ),
        ):
            status = await source.get_status()

        assert status == "failed"

    @pytest.mark.asyncio
    async def test_stale_via_created_fallback_when_updated_missing(self):
        source = Source(id="source:abc", title="t", command="command:old")

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(updated=None, created=_stale_time())
                ),
            ),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[{"id": "command:old"}]),
            ),
        ):
            status = await source.get_status()

        assert status == "failed"

    @pytest.mark.asyncio
    async def test_fresh_running_not_failed(self):
        source = Source(id="source:abc", title="t", command="command:fresh")
        repo_mock = AsyncMock()

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_fresh_time(), created=_fresh_time()
                    )
                ),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            status = await source.get_status()

        assert status == "running"
        repo_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_completed_command_passes_through_without_db_write(self):
        source = Source(id="source:abc", title="t", command="command:done")
        repo_mock = AsyncMock()

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(return_value=_status_result(status="completed")),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            assert await source.get_status() == "completed"
        repo_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_unparseable_timestamps_not_marked_failed(self):
        source = Source(id="source:abc", title="t", command="command:old")
        repo_mock = AsyncMock()

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(return_value=_status_result(updated="not-a-timestamp")),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            assert await source.get_status() == "running"
        repo_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_processing_progress_stale_reports_failed(self):
        source = Source(id="source:abc", title="t", command="command:old")
        stale_result = _status_result(updated=_stale_time(), created=_stale_time())

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(return_value=stale_result),
            ),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(return_value=[{"id": "command:old"}]),
            ),
        ):
            progress = await source.get_processing_progress()

        assert progress is not None
        assert progress["status"] == "failed"
        assert progress["error"] == STALE_COMMAND_ERROR_MESSAGE


class TestReleaseStaleProcessing:
    @pytest.mark.asyncio
    async def test_stale_running_is_released(self):
        source = Source(id="source:abc", title="t", command="command:old")
        repo_mock = AsyncMock(return_value=[{"id": "command:old"}])

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_stale_time(), created=_stale_time()
                    )
                ),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            assert await source.release_stale_processing() is True
        assert repo_mock.await_count == 1

    @pytest.mark.asyncio
    async def test_fresh_running_is_not_released(self):
        source = Source(id="source:abc", title="t", command="command:fresh")
        repo_mock = AsyncMock()

        with (
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_fresh_time(), created=_fresh_time()
                    )
                ),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=repo_mock),
        ):
            assert await source.release_stale_processing() is False
        repo_mock.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_terminal_status_is_not_blocked(self):
        source = Source(id="source:abc", title="t", command="command:done")

        with patch(
            "surreal_commands.get_command_status",
            new=AsyncMock(return_value=_status_result(status="completed")),
        ):
            assert await source.release_stale_processing() is True


class TestRetryEndpoint:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from api.main import app

        return TestClient(app)

    @pytest.mark.asyncio
    async def test_retry_allowed_for_stale_running_source(self, client):
        source = Source(
            id="source:stale",
            title="t",
            full_text="some text",
            command="command:stale",
        )
        queries = []

        async def fake_repo_query(query, vars=None):
            queries.append(query)
            if "UPDATE command" in query:
                return [{"status": "failed"}]
            if "FROM reference" in query:
                return ["notebook:1"]
            return []

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_stale_time(), created=_stale_time()
                    )
                ),
            ),
            patch("open_notebook.domain.notebook.repo_query", new=fake_repo_query),
            patch("api.routers.sources.repo_query", new=fake_repo_query),
            patch(
                "api.routers.sources.CommandService.submit_command_job",
                new=AsyncMock(return_value="command:new"),
            ),
            patch.object(Source, "save", new=AsyncMock()),
        ):
            response = await asyncio.to_thread(
                client.post, "/api/sources/source:stale/retry"
            )

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "queued"
        assert any("UPDATE command" in q for q in queries)

    @pytest.mark.asyncio
    async def test_retry_blocked_for_fresh_running_source(self, client):
        source = Source(
            id="source:fresh",
            title="t",
            full_text="some text",
            command="command:fresh",
        )

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch(
                "surreal_commands.get_command_status",
                new=AsyncMock(
                    return_value=_status_result(
                        updated=_fresh_time(), created=_fresh_time()
                    )
                ),
            ),
            patch(
                "open_notebook.domain.notebook.repo_query", new=AsyncMock()
            ) as repo_mock,
        ):
            response = await asyncio.to_thread(
                client.post, "/api/sources/source:fresh/retry"
            )

        assert response.status_code == 400
        assert "already processing" in response.json()["detail"]
        repo_mock.assert_not_awaited()


class TestStatusEndpointStaleRecovery:
    """The GET /status endpoint must fail an orphaned 'running' row on sight so
    the frontend's 2s poll shows the failure (and its retry button) instead of
    spinning forever."""

    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from api.main import app

        return TestClient(app)

    @staticmethod
    def _command_row(status="running", updated=None):
        return {
            "id": "command:stale",
            "status": status,
            "args": {"embed": False, "transformations": []},
            "error_message": None,
            "result": None,
            "updated": updated,
            "created": updated,
        }

    @pytest.mark.asyncio
    async def test_status_endpoint_reports_failed_for_stale_running_row(self, client):
        source = Source(
            id="source:stale",
            title="t",
            full_text="some text",
            command="command:stale",
        )
        queries = []

        async def fake_repo_query(query, vars=None):
            queries.append(query)
            if "FROM $command_id" in query:
                return [self._command_row(updated=_stale_time())]
            if "FROM command" in query:  # insight jobs listing
                return []
            raise AssertionError(f"Unexpected query: {query}")

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch("api.routers.sources.repo_query", new=fake_repo_query),
            patch("open_notebook.domain.notebook.repo_query", new=fake_repo_query),
        ):
            response = await asyncio.to_thread(
                client.get, "/api/sources/source:stale/status"
            )

        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "failed"
        assert body["message"] == "Source processing failed"
        assert body["processing_info"]["status"] == "failed"
        assert body["processing_info"]["error"] == STALE_COMMAND_ERROR_MESSAGE
        assert any("UPDATE command" in q and "status = 'running'" in q for q in queries)

    @pytest.mark.asyncio
    async def test_status_endpoint_keeps_running_for_fresh_row(self, client):
        source = Source(
            id="source:fresh",
            title="t",
            full_text="some text",
            command="command:fresh",
        )

        async def fake_repo_query(query, vars=None):
            if "FROM $command_id" in query:
                return [self._command_row(updated=_fresh_time())]
            if "FROM command" in query:
                return []
            raise AssertionError(f"Unexpected query: {query}")

        with (
            patch(
                "api.routers.sources.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch("api.routers.sources.repo_query", new=fake_repo_query),
            patch(
                "open_notebook.domain.notebook.repo_query",
                new=AsyncMock(),
            ) as domain_repo_mock,
        ):
            response = await asyncio.to_thread(
                client.get, "/api/sources/source:fresh/status"
            )

        assert response.status_code == 200
        assert response.json()["status"] == "running"
        domain_repo_mock.assert_not_awaited()


class TestProcessSourceTimeout:
    @pytest.mark.asyncio
    async def test_hung_graph_raises_timeout_error(self):
        from commands.source_commands import (
            SourceProcessingInput,
            process_source_command,
        )

        source = SimpleNamespace(id="source:abc", command=None, save=AsyncMock())

        async def hung_ainvoke(state):
            await asyncio.sleep(30)

        input_data = SourceProcessingInput(
            source_id="source:abc",
            content_state={"content": "hello"},
            notebook_ids=[],
            transformations=[],
            embed=False,
        )

        with (
            patch(
                "commands.source_commands.Source.get",
                new=AsyncMock(return_value=source),
            ),
            patch("commands.source_commands.source_graph.ainvoke", new=hung_ainvoke),
            patch.dict(os.environ, {"SOURCE_PROCESSING_TIMEOUT_SECONDS": "0.2"}),
        ):
            with pytest.raises(TimeoutError):
                await process_source_command(input_data)


class TestStartupRecovery:
    @pytest.mark.asyncio
    async def test_lifespan_recovers_stale_commands_on_startup(self):
        from api import main as api_main
        from api.command_service import CommandService

        recover_mock = AsyncMock(return_value=3)
        with (
            patch.object(api_main, "_run_database_migrations", new=AsyncMock()),
            patch.object(api_main, "refresh_embedding_params", new=AsyncMock()),
            patch.object(CommandService, "recover_stale_commands", new=recover_mock),
        ):
            async with api_main.lifespan(None):  # type: ignore[arg-type]
                pass

        recover_mock.assert_awaited_once_with()
