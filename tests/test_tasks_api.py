"""Unit tests for the Task Center aggregation (api.task_service + router)."""

from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from api.task_service import list_tasks


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_shapes_rows_and_resolves_targets(repo_query):
    repo_query.side_effect = [
        # command rows (newest first)
        [
            {
                "id": "command:a",
                "name": "run_transformation",
                "args": {
                    "source_id": "source:s1",
                    "transformation_id": "transformation:t1",
                },
                "status": "completed",
                "error_message": None,
                "created": "2026-09-26T10:00:00Z",
                "updated": "2026-09-26T10:01:00Z",
            },
            {
                "id": "command:b",
                "name": "embed_source",
                "args": {"source_id": "source:s1"},
                "status": "running",
                "error_message": "",
                "created": None,
                "updated": None,
            },
            {
                "id": "command:c",
                "name": "mystery_command",
                "args": {},
                "status": "failed",
                "error_message": "x" * 1500,
            },
        ],
        # matched total (independent of page size)
        [{"n": 250}],
        # target titles
        [{"id": "source:s1", "title": "论文押题.pdf"}],
        # embedding progress for the running embed_source
        [{"embedding_status": "running", "embedded_chunks": 12, "total_chunks": 48}],
        # status counts
        [{"status": "completed", "n": 16}, {"status": "running", "n": 1}],
    ]

    result = await list_tasks()

    tasks = result["tasks"]
    assert [t["id"] for t in tasks] == ["command:a", "command:b", "command:c"]
    assert tasks[0]["type"] == "insight"
    assert tasks[0]["target"] == "论文押题.pdf"
    assert tasks[1]["type"] == "embedding"
    assert tasks[1]["target"] == "论文押题.pdf"
    # progress enrichment only for running rows
    assert tasks[1]["progress"] == {
        "kind": "embedding",
        "embedded_chunks": 12,
        "total_chunks": 48,
        "percent": 25,
    }
    assert tasks[0]["progress"] is None
    # unknown commands bucket as 'other'; long errors truncated to MAX_ERROR_LENGTH
    assert tasks[2]["type"] == "other"
    assert len(tasks[2]["error_message"]) == 1000
    # every row carries the static per-command retryable flag
    assert tasks[0]["retryable"] is True
    assert tasks[1]["retryable"] is True
    assert tasks[2]["retryable"] is False
    # total is the matched count from the DB, not the page length
    assert result["total"] == 250
    # counts include the active roll-up
    assert result["counts"] == {"completed": 16, "running": 1, "active": 1}


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_marks_retryable_commands(repo_query):
    """retryable mirrors the static RETRYABLE_COMMANDS set, regardless of status."""
    repo_query.side_effect = [
        [
            {
                "id": "command:e",
                "name": "embed_source",
                "args": {},
                "status": "failed",
                "error_message": None,
            },
            {
                "id": "command:p",
                "name": "generate_podcast",
                "args": {},
                "status": "failed",
                "error_message": None,
            },
        ],
        [{"n": 2}],
        [],
    ]

    result = await list_tasks()

    by_id = {t["id"]: t["retryable"] for t in result["tasks"]}
    assert by_id["command:e"] is True
    assert by_id["command:p"] is False


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_filters_by_name(repo_query):
    repo_query.side_effect = [
        [
            {
                "id": "command:a",
                "name": "export_data",
                "args": {},
                "status": "completed",
                "error_message": None,
            }
        ],
        [{"n": 42}],
        [{"status": "completed", "n": 42}],
    ]

    result = await list_tasks(name="export_data")

    query = repo_query.await_args_list[0].args[0]
    assert "name = $name" in query
    assert result["tasks"][0]["type"] == "data_transfer"
    assert result["total"] == 42


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_filters_by_multiple_statuses(repo_query):
    """Comma-separated statuses become a single server-side IN filter."""
    repo_query.side_effect = [
        [],
        [{"n": 3}],
        [],
    ]

    result = await list_tasks(status="new,queued,running")

    query = repo_query.await_args_list[0].args[0]
    params = repo_query.await_args_list[0].args[1]
    assert "status IN $statuses" in query
    assert params["statuses"] == ["new", "queued", "running"]
    count_query = repo_query.await_args_list[1].args[0]
    assert count_query.startswith("SELECT count()")
    assert result["total"] == 3


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_rejects_invalid_status(repo_query):
    with pytest.raises(ValueError):
        await list_tasks(status="completed; DROP TABLE command")
    repo_query.assert_not_called()


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_single_status_normalizes_to_equality(repo_query):
    """A lone status stays an equality filter; whitespace/case are normalized."""
    repo_query.side_effect = [
        [],
        [{"n": 7}],
        [],
    ]

    await list_tasks(status=" Completed ")

    query = repo_query.await_args_list[0].args[0]
    params = repo_query.await_args_list[0].args[1]
    assert "status = $status" in query
    assert "status IN" not in query
    assert params["status"] == "completed"


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_count_query_reuses_filters(repo_query):
    """Count must apply the same WHERE (with GROUP ALL) minus pagination params."""
    repo_query.side_effect = [
        [],
        [{"n": 9}],
        [],
    ]

    await list_tasks(name="embed_source", status="new,running", limit=50, offset=100)

    count_query = repo_query.await_args_list[1].args[0]
    count_params = repo_query.await_args_list[1].args[1]
    # SurrealDB 2.x returns per-row counts without GROUP ALL
    assert count_query.endswith("GROUP ALL")
    assert "name = $name" in count_query
    assert "status IN $statuses" in count_query
    assert count_params == {"name": "embed_source", "statuses": ["new", "running"]}


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
@pytest.mark.parametrize(
    "count_result",
    [
        pytest.param(RuntimeError("count down"), id="error"),
        pytest.param([], id="empty"),
    ],
)
async def test_list_tasks_total_falls_back_to_offset_plus_rows(
    repo_query, count_result
):
    """Without a usable count, total must include the skipped offset, not just this page."""
    rows: list[dict[str, Any]] = [
        {
            "id": f"command:{i}",
            "name": "export_data",
            "args": {},
            "status": "completed",
            "error_message": None,
        }
        for i in range(2)
    ]
    repo_query.side_effect = [rows, count_result, [{"status": "completed", "n": 99}]]

    result = await list_tasks(status="completed", limit=2, offset=100)

    assert result["total"] == 100 + len(rows)


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_list_command_jobs_returns_400_for_invalid_status(client):
    with patch(
        "api.routers.commands.list_tasks",
        new=AsyncMock(side_effect=ValueError("Invalid status filter: bogus")),
    ):
        response = client.get("/api/commands/jobs", params={"status": "bogus"})

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid status filter: bogus"


def test_list_command_jobs_passes_query_params_to_service(client):
    summary = {"tasks": [], "total": 0, "counts": {"active": 0}}
    with patch(
        "api.routers.commands.list_tasks",
        new_callable=AsyncMock,
        return_value=summary,
    ) as list_tasks_mock:
        response = client.get(
            "/api/commands/jobs",
            params={"status": "new,queued,running", "limit": 100, "offset": 100},
        )

    assert response.status_code == 200
    assert response.json() == summary
    list_tasks_mock.assert_awaited_once_with(
        name=None, status="new,queued,running", task_type=None, limit=100, offset=100
    )


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_survives_enrichment_failures(repo_query):
    """Progress/count lookup failures must not break the whole listing."""
    repo_query.side_effect = [
        [
            {
                "id": "command:a",
                "name": "embed_source",
                "args": {"source_id": "source:s1"},
                "status": "running",
                "error_message": None,
            }
        ],
        RuntimeError("count lookup down"),
        RuntimeError("titles lookup down"),
        RuntimeError("progress lookup down"),
        [],
    ]

    result = await list_tasks()

    assert len(result["tasks"]) == 1
    task = result["tasks"][0]
    assert task["target"] is None
    assert task["progress"] is None
    # count query failed: fall back to what this page actually shows
    assert result["total"] == 1
    assert result["counts"] == {"active": 0}


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_cancel_command_job_marks_running_canceled(repo_query):
    from api.command_service import CommandService

    repo_query.side_effect = [
        [{"status": "running"}],
        [{"status": "canceled"}],
    ]

    ok = await CommandService.cancel_command_job("command:stuck1")

    assert ok is True
    update_query, update_params = repo_query.await_args_list[1].args
    assert "canceled" in update_query


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_cancel_command_job_rejects_finished(repo_query):
    from api.command_service import CommandService
    from open_notebook.exceptions import ConflictError

    repo_query.side_effect = [[{"status": "completed"}]]

    with pytest.raises(ConflictError, match="completed"):
        await CommandService.cancel_command_job("command:done")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_cancel_command_job_404_for_missing(repo_query):
    from api.command_service import CommandService
    from open_notebook.exceptions import NotFoundError

    repo_query.side_effect = [[]]

    with pytest.raises(NotFoundError):
        await CommandService.cancel_command_job("command:nope")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
@pytest.mark.parametrize("status", ["new", "queued", "running"])
async def test_cancel_command_job_accepts_all_pending_statuses(repo_query, status):
    from surrealdb import RecordID

    from api.command_service import CommandService

    repo_query.side_effect = [[{"status": status}], [{"status": "canceled"}]]

    assert await CommandService.cancel_command_job("command:stuck1") is True

    update_query, update_params = repo_query.await_args_list[1].args
    assert update_query.startswith("UPDATE command SET")
    # the guard clause is what stops a just-finished job being rewritten
    assert "status NOT IN ['completed', 'failed', 'canceled']" in update_query
    assert update_params["msg"] == "Canceled from Task Center"
    # SELECT and UPDATE must both target the parsed RecordID, not a raw string
    select_params = repo_query.await_args_list[0].args[1]
    assert update_params["id"] == select_params["id"] == RecordID("command", "stuck1")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_cancel_command_job_conflict_when_finish_races_the_update(repo_query):
    from api.command_service import CommandService
    from open_notebook.exceptions import ConflictError

    # SELECT saw running, but the guarded UPDATE matched no rows: the job
    # finished in between and must not be rewritten as canceled.
    repo_query.side_effect = [[{"status": "running"}], []]

    with pytest.raises(ConflictError):
        await CommandService.cancel_command_job("command:racing")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
@pytest.mark.parametrize("status", ["completed", "failed", "canceled"])
async def test_cancel_command_job_conflicts_for_each_terminal_status(
    repo_query, status
):
    from api.command_service import CommandService
    from open_notebook.exceptions import ConflictError

    repo_query.side_effect = [[{"status": status}]]

    with pytest.raises(ConflictError, match=status):
        await CommandService.cancel_command_job("command:done")
    # terminal rows must never reach the UPDATE statement
    assert repo_query.await_count == 1


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_cancel_command_job_propagates_db_errors(repo_query):
    from api.command_service import CommandService

    repo_query.side_effect = RuntimeError("db down")

    with pytest.raises(RuntimeError, match="db down"):
        await CommandService.cancel_command_job("command:stuck1")


@pytest.mark.asyncio
@patch("api.command_service.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_replays_original_args(repo_query, submit):
    from surrealdb import RecordID

    from api.command_service import CommandService

    repo_query.return_value = [
        {"name": "embed_source", "args": {"source_id": "source:s1"}}
    ]
    submit.return_value = "command:new1"

    result = await CommandService.retry_command_job("command:old1")

    assert result == {
        "job_id": "command:new1",
        "status": "submitted",
        "message": "Command 'embed_source' re-submitted successfully",
    }
    submit.assert_awaited_once_with(
        "open_notebook", "embed_source", {"source_id": "source:s1"}
    )
    # the SELECT must target a parsed RecordID, not a raw string
    assert repo_query.await_args.args[1]["id"] == RecordID("command", "old1")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_404_for_missing(repo_query):
    from api.command_service import CommandService
    from open_notebook.exceptions import NotFoundError

    repo_query.return_value = []

    with pytest.raises(NotFoundError):
        await CommandService.retry_command_job("command:nope")


@pytest.mark.asyncio
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_rejects_non_retryable(repo_query):
    from api.command_service import CommandService
    from open_notebook.exceptions import InvalidInputError

    repo_query.return_value = [{"name": "mystery_command", "args": {}}]

    with pytest.raises(InvalidInputError, match="not retryable"):
        await CommandService.retry_command_job("command:weird")


def test_retry_command_endpoint_returns_new_job(client):
    from api.command_service import CommandService

    with patch.object(
        CommandService,
        "retry_command_job",
        new_callable=AsyncMock,
        return_value={
            "job_id": "command:new1",
            "status": "submitted",
            "message": "Command 'embed_source' re-submitted successfully",
        },
    ) as retry:
        response = client.post("/api/commands/jobs/command:old1/retry")

    assert response.status_code == 200
    assert response.json() == {
        "job_id": "command:new1",
        "status": "submitted",
        "message": "Command 'embed_source' re-submitted successfully",
    }
    # no query param → plain replay, precheck off
    retry.assert_awaited_once_with("command:old1", check_recovery=False)


def test_retry_command_endpoint_404_for_missing_job(client):
    from api.command_service import CommandService
    from open_notebook.exceptions import NotFoundError

    with patch.object(
        CommandService,
        "retry_command_job",
        new_callable=AsyncMock,
        side_effect=NotFoundError("Command job command:gone not found"),
    ):
        response = client.post("/api/commands/jobs/command:gone/retry")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_retry_command_endpoint_400_for_non_retryable_command(client):
    from api.command_service import CommandService
    from open_notebook.exceptions import InvalidInputError

    with patch.object(
        CommandService,
        "retry_command_job",
        new_callable=AsyncMock,
        side_effect=InvalidInputError("Command 'mystery_command' is not retryable"),
    ):
        response = client.post("/api/commands/jobs/command:weird/retry")

    assert response.status_code == 400
    assert "not retryable" in response.json()["detail"]


def test_retry_command_endpoint_400_for_malformed_job_id(client):
    from api.command_service import CommandService

    # RecordID.parse raises ValueError on garbage ids; must surface as 400
    with patch.object(
        CommandService,
        "retry_command_job",
        new_callable=AsyncMock,
        side_effect=ValueError("Invalid record id: garbage"),
    ):
        response = client.post("/api/commands/jobs/garbage/retry")

    assert response.status_code == 400
    assert "Invalid record id" in response.json()["detail"]


# --- retry recovery precheck -------------------------------------------------


@pytest.mark.asyncio
@patch("api.command_service.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.command_service._recovery_status", new_callable=AsyncMock)
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_skips_when_recovered(repo_query, recovery, submit):
    from api.command_service import CommandService

    repo_query.return_value = [
        {"name": "embed_source", "args": {"source_id": "source:s1"}}
    ]
    recovery.return_value = {
        "recovered": True,
        "detail": "source now completed, 48/48 chunks",
    }

    result = await CommandService.retry_command_job("command:old1", check_recovery=True)

    assert result == {
        "job_id": None,
        "status": "skipped_recovered",
        "message": "Already recovered: source now completed, 48/48 chunks",
    }
    submit.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "recovery_result",
    [
        pytest.param(None, id="undeterminable"),
        pytest.param(
            {"recovered": False, "detail": "source now failed, 12/48 chunks"},
            id="not_recovered",
        ),
    ],
)
@patch("api.command_service.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.command_service._recovery_status", new_callable=AsyncMock)
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_replays_unless_recovered(
    repo_query, recovery, submit, recovery_result
):
    """An undeterminable or negative recovery check must fall through to replay."""
    from api.command_service import CommandService

    repo_query.return_value = [
        {"name": "embed_source", "args": {"source_id": "source:s1"}}
    ]
    recovery.return_value = recovery_result
    submit.return_value = "command:new1"

    result = await CommandService.retry_command_job("command:old1", check_recovery=True)

    assert result["status"] == "submitted"
    assert result["job_id"] == "command:new1"
    submit.assert_awaited_once_with(
        "open_notebook", "embed_source", {"source_id": "source:s1"}
    )


@pytest.mark.asyncio
@patch("api.command_service.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.command_service._recovery_status", new_callable=AsyncMock)
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_without_check_recovery_skips_lookup(
    repo_query, recovery, submit
):
    """Default behavior is exactly the old replay: no recovery query at all."""
    from api.command_service import CommandService

    repo_query.return_value = [
        {"name": "embed_source", "args": {"source_id": "source:s1"}}
    ]
    submit.return_value = "command:new1"

    result = await CommandService.retry_command_job("command:old1")

    recovery.assert_not_awaited()
    assert result["status"] == "submitted"
    submit.assert_awaited_once()


@pytest.mark.asyncio
@patch("api.command_service.CommandService.submit_command_job", new_callable=AsyncMock)
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
@patch("api.command_service.repo_query", new_callable=AsyncMock)
async def test_retry_command_job_precheck_uses_real_recovery_status(
    command_query, explain_query, submit
):
    """The precheck must run the production recovery logic, not a stub."""
    from api.command_service import CommandService

    command_query.return_value = [
        {"name": "embed_source", "args": {"source_id": "source:s1"}}
    ]
    explain_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": 48, "total_chunks": 48}
    ]

    result = await CommandService.retry_command_job("command:old1", check_recovery=True)

    assert result["status"] == "skipped_recovered"
    assert result["job_id"] is None
    submit.assert_not_awaited()


def test_retry_command_endpoint_passes_check_recovery_flag(client):
    from api.command_service import CommandService

    with patch.object(
        CommandService,
        "retry_command_job",
        new_callable=AsyncMock,
        return_value={
            "job_id": None,
            "status": "skipped_recovered",
            "message": "Already recovered: source now completed, 48/48 chunks",
        },
    ) as retry:
        response = client.post(
            "/api/commands/jobs/command:old1/retry", params={"check_recovery": "true"}
        )

    assert response.status_code == 200
    assert response.json()["job_id"] is None
    assert response.json()["status"] == "skipped_recovered"
    retry.assert_awaited_once_with("command:old1", check_recovery=True)


# --- Live progress and enriched progress tests -------------------------------


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_enrich_progress_covers_all_commands_never_none(repo_query):
    """Every command, known or unknown, must return a rich progress dict instead of None."""
    from api.task_service import _enrich_progress

    all_commands = [
        ("embed_source", {"source_id": "source:s1"}),
        ("embed_note", {"note_id": "note:n1"}),
        ("embed_insight", {"insight_id": "insight:i1"}),
        ("rebuild_embeddings", {"mode": "all"}),
        ("import_data", {}),
        ("export_data", {}),
        ("classify_sources", {"view_id": "source_view:v1"}),
        ("generate_podcast", {"episode_name": "Test Ep"}),
        ("generate_artifact", {"artifact_type": "study_guide"}),
        ("process_source", {"source_id": "source:s1"}),
        ("run_transformation", {"source_id": "source:s1"}),
        ("create_insight", {"source_id": "source:s1"}),
        ("unrecognized_command_xyz", {}),
    ]

    # Return empty lists for subqueries so fallback paths are exercised
    repo_query.return_value = []

    for cmd_name, args in all_commands:
        row = {
            "id": f"command:{cmd_name}",
            "name": cmd_name,
            "args": args,
            "status": "running",
            "created": "2026-09-30T10:00:00Z",
            "updated": "2026-09-30T10:01:00Z",
        }
        progress = await _enrich_progress(cmd_name, row, {})
        assert progress is not None, f"Command {cmd_name} returned None!"
        assert "kind" in progress
        assert "percent" in progress or "stage" in progress
        assert isinstance(progress["kind"], str)


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_enrich_progress_extracts_from_dedicated_states(repo_query):
    """Enrich progress correctly parses dedicated state records."""
    from api.task_service import _enrich_progress

    # 1. Test data_transfer_state
    repo_query.return_value = [
        {
            "progress": {
                "stage": "写入记录",
                "percent": 65,
                "message": "正在写入数据表...",
            }
        }
    ]
    res_transfer = await _enrich_progress(
        "import_data",
        {"name": "import_data", "status": "running", "args": {}},
        {},
    )
    assert res_transfer is not None
    assert res_transfer["kind"] == "data_transfer"
    assert res_transfer["stage"] == "写入记录"
    assert res_transfer["percent"] == 65
    assert res_transfer["message"] == "正在写入数据表..."

    # 2. Test source_view classify_progress
    repo_query.return_value = [
        {
            "classify_progress": {
                "stage": "AI 命名",
                "percent": 50,
                "message": "正在命名主题分组...",
            }
        }
    ]
    res_classify = await _enrich_progress(
        "classify_sources",
        {
            "name": "classify_sources",
            "status": "running",
            "args": {"view_id": "source_view:v1"},
        },
        {},
    )
    assert res_classify is not None
    assert res_classify["kind"] == "classification"
    assert res_classify["stage"] == "AI 命名"
    assert res_classify["percent"] == 50

    # 3. Test podcast_episode
    repo_query.return_value = [
        {
            "id": "podcast_episode:ep1",
            "name": "Ep 1",
            "transcript": {"transcript": [{"speaker": "A", "text": "Hello"}]},
            "outline": {"sections": []},
            "audio_file": None,
        }
    ]
    res_podcast = await _enrich_progress(
        "generate_podcast",
        {
            "id": "command:p1",
            "name": "generate_podcast",
            "status": "running",
            "args": {"episode_name": "Ep 1"},
        },
        {},
    )
    assert res_podcast is not None
    assert res_podcast["kind"] == "podcast"
    assert res_podcast["stage"] == "语音合成"
    assert res_podcast["percent"] == 70


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_get_live_progress_service_returns_complete_telemetry(repo_query):
    """get_live_progress returns stage, stopwatch, tokens, and stream text."""
    from api.task_service import get_live_progress

    # Mock command row query
    cmd_row = {
        "id": "command:pod1",
        "name": "generate_podcast",
        "args": {"episode_name": "AI Future"},
        "status": "running",
        "error_message": None,
        "created": "2026-09-30T10:00:00Z",
        "updated": "2026-09-30T10:00:25Z",
    }
    # Mock episode query
    episode_row = {
        "id": "podcast_episode:e1",
        "transcript": {
            "transcript": [{"speaker": "Host", "text": "Welcome to AI Future podcast!"}]
        },
        "outline": {},
        "audio_file": None,
    }

    repo_query.side_effect = [
        [cmd_row],  # SELECT command
        [episode_row],  # _enrich_progress podcast_episode
        [],  # model_usage
        [episode_row],  # live progress stream_text episode
    ]

    result = await get_live_progress("command:pod1")

    assert result["job_id"] == "command:pod1"
    assert result["command"] == "generate_podcast"
    assert result["status"] == "running"
    assert result["stage"] == "语音合成"
    assert result["stage_index"] == 2
    assert result["total_stages"] == 4
    assert len(result["stages"]) == 4
    assert result["stages"][0]["status"] == "completed"
    assert result["stages"][1]["status"] == "completed"
    assert result["stages"][2]["status"] == "active"
    assert result["stages"][3]["status"] == "pending"

    # Stopwatch elapsed seconds
    assert result["elapsed_seconds"] >= 0
    assert ":" in result["stopwatch"]

    # Token telemetry
    assert result["token_count"] > 0
    assert result["tokens"]["is_model"] is True
    assert result["tokens"]["prompt_tokens"] > 0
    assert result["tokens"]["completion_tokens"] > 0
    assert result["tokens"]["total_tokens"] > 0

    # Stream text
    assert "Host" in result["stream_text"]
    assert "Welcome" in result["stream_text"]

    # Logs
    assert len(result["logs"]) >= 2
    assert any(log["level"] == "info" for log in result["logs"])


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_get_live_progress_404_for_missing_job(repo_query):
    """get_live_progress raises NotFoundError when job does not exist."""
    from api.task_service import get_live_progress
    from open_notebook.exceptions import NotFoundError

    repo_query.return_value = []

    with pytest.raises(NotFoundError, match="not found"):
        await get_live_progress("command:missing")


def test_get_live_progress_endpoint_200(client):
    """GET /api/commands/jobs/{job_id}/live-progress returns 200 with schema."""
    sample_progress = {
        "job_id": "command:live1",
        "command": "generate_artifact",
        "status": "running",
        "stage": "模型推理",
        "stage_index": 1,
        "total_stages": 4,
        "stages": [
            {
                "id": "prep",
                "title": "提取分析",
                "desc": "检索笔记",
                "status": "completed",
            },
            {
                "id": "prompt",
                "title": "模型推理",
                "desc": "生成工件",
                "status": "active",
            },
            {
                "id": "validate",
                "title": "格式校验",
                "desc": "格式检验",
                "status": "pending",
            },
            {
                "id": "save",
                "title": "沉淀笔记",
                "desc": "写入笔记",
                "status": "pending",
            },
        ],
        "percent": 45,
        "elapsed_seconds": 12.4,
        "stopwatch": "00:12",
        "token_count": 1650,
        "tokens": {
            "is_model": True,
            "prompt_tokens": 1200,
            "completion_tokens": 450,
            "total_tokens": 1650,
            "tokens_per_sec": 36.3,
            "tokens_per_second": 36.3,
            "model": "default-model",
            "chunks": None,
            "total_chunks": None,
        },
        "stream_text": "正在生成研究报告...",
        "message": "模型推理中",
        "logs": [{"id": "1", "time": "10:00:00", "level": "info", "message": "Init"}],
        "created": "2026-09-30T10:00:00Z",
        "updated": None,
        "error_message": None,
    }

    with patch(
        "api.routers.commands.get_live_progress",
        new_callable=AsyncMock,
        return_value=sample_progress,
    ):
        response = client.get("/api/commands/jobs/command:live1/live-progress")

    assert response.status_code == 200
    data = response.json()
    assert data["job_id"] == "command:live1"
    assert data["command"] == "generate_artifact"
    assert data["stage"] == "模型推理"
    assert data["stopwatch"] == "00:12"
    assert data["token_count"] == 1650
    assert data["tokens"]["prompt_tokens"] == 1200
    assert data["stream_text"] == "正在生成研究报告..."


def test_get_live_progress_endpoint_404(client):
    """GET /api/commands/jobs/{job_id}/live-progress returns 404 for missing jobs."""
    from open_notebook.exceptions import NotFoundError

    with patch(
        "api.routers.commands.get_live_progress",
        new_callable=AsyncMock,
        side_effect=NotFoundError("Command job command:ghost not found"),
    ):
        response = client.get("/api/commands/jobs/command:ghost/live-progress")

    assert response.status_code == 404
    assert "not found" in response.json()["detail"]


def test_task_entry_and_progress_model_backward_compatibility():
    """Verify TaskProgress and TaskEntry maintain strict backward compatibility."""
    from api.models import TaskEntry, TaskProgress

    # Old style TaskProgress
    old_prog = TaskProgress(
        kind="embedding",
        embedded_chunks=10,
        total_chunks=20,
        percent=50,
    )
    assert old_prog.kind == "embedding"
    assert old_prog.embedded_chunks == 10
    assert old_prog.stage is None
    assert old_prog.stopwatch is None

    # Enhanced style TaskProgress
    new_prog = TaskProgress(
        kind="podcast",
        stage="语音合成",
        percent=70,
        message="正在合成语音",
        elapsed_seconds=18.5,
        stopwatch="00:18",
        token_count=2100,
        stream_text="[Host] Hello world",
    )
    assert new_prog.kind == "podcast"
    assert new_prog.stopwatch == "00:18"
    assert new_prog.token_count == 2100

    # TaskEntry serialization
    entry = TaskEntry(
        id="command:123",
        name="generate_podcast",
        type="podcast",
        status="running",
        retryable=False,
        progress=new_prog,
    )
    dumped = entry.model_dump()
    assert dumped["id"] == "command:123"
    assert dumped["progress"]["stopwatch"] == "00:18"
    assert dumped["progress"]["token_count"] == 2100


# ---------------------------------------------------------------------------
# Section analysis (analyze_source_section) live progress
# ---------------------------------------------------------------------------


class SectionLiveRecorder:
    """SQL router for get_live_progress on an analyze_source_section row."""

    def __init__(self, command_row, state_rows=None, usage_rows=None):
        self.command_row = command_row
        self.state_rows = state_rows if state_rows is not None else []
        self.usage_rows = usage_rows if usage_rows is not None else []
        self.state_reads = 0

    async def __call__(self, sql, params=None):
        if "FROM command WHERE id = $id" in sql:
            return [self.command_row]
        if "SELECT id, title FROM source" in sql:
            return [{"id": "source:s1", "title": "真题册.pdf"}]
        if "SELECT progress FROM $rid" in sql:
            self.state_reads += 1
            return self.state_rows
        if "FROM model_usage" in sql:
            return self.usage_rows
        raise AssertionError(f"Unexpected query: {sql[:120]}")


def _section_command_row(status="running"):
    return {
        "id": "command:sec1",
        "name": "analyze_source_section",
        "args": {"source_id": "source:s1"},
        "status": status,
        "error_message": None,
        "result": None,
        "created": "2026-10-02T10:00:00Z",
        "updated": "2026-10-02T10:00:30Z",
    }


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_section_analysis_live_progress_streams_tail(repo_query):
    from api.task_service import get_live_progress

    tail = "x" * 600 + "章节小结：需求工程两分类。"  # 500-char window keeps the tail
    recorder = SectionLiveRecorder(
        _section_command_row(),
        state_rows=[
            {
                "progress": {
                    "stage": "streaming",
                    "percent": 64,
                    "message": "Model is analyzing the section",
                    "stream_tail": tail,
                }
            }
        ],
    )

    async def _route(sql, params=None):
        return await recorder(sql, params)

    repo_query.side_effect = _route

    data = await get_live_progress("command:sec1")

    assert data["status"] == "running"
    assert data["percent"] == 64
    assert data["stream_text"].endswith("章节小结：需求工程两分类。")
    assert len(data["stream_text"]) <= 500
    # 4-stage pipeline with the streaming stage active
    assert [s["id"] for s in data["stages"]] == [
        "fetching",
        "prompting",
        "streaming",
        "done",
    ]
    assert data["stage_index"] == 2
    assert data["stages"][2]["status"] == "active"
    # Section analysis is an LLM task: token telemetry is enabled
    assert data["tokens"]["is_model"] is True


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_section_analysis_live_progress_completed_skips_state(repo_query):
    from api.task_service import get_live_progress

    recorder = SectionLiveRecorder(_section_command_row(status="completed"))

    async def _route(sql, params=None):
        return await recorder(sql, params)

    repo_query.side_effect = _route

    data = await get_live_progress("command:sec1")

    assert data["status"] == "completed"
    assert data["percent"] == 100
    assert data["stage_index"] == 3
    assert recorder.state_reads == 0
    assert "章节分析已完成" in data["stream_text"]
