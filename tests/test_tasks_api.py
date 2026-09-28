"""Unit tests for the Task Center aggregation (api.task_service)."""

from unittest.mock import AsyncMock, patch

import pytest

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
                "args": {"source_id": "source:s1", "transformation_id": "transformation:t1"},
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
                "error_message": "x" * 500,
            },
        ],
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
    # unknown commands bucket as 'other'; long errors truncated to 300 chars
    assert tasks[2]["type"] == "other"
    assert len(tasks[2]["error_message"]) == 300
    # counts include the active roll-up
    assert result["counts"] == {"completed": 16, "running": 1, "active": 1}


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
        [],  # no source ids to resolve
        [{"status": "completed", "count": 1}],
    ]

    result = await list_tasks(name="export_data")

    query = repo_query.await_args_list[0].args[0]
    assert "name = $name" in query
    assert result["tasks"][0]["type"] == "data_transfer"


@pytest.mark.asyncio
@patch("api.task_service.repo_query", new_callable=AsyncMock)
async def test_list_tasks_survives_enrichment_failures(repo_query):
    """Progress lookup failures must not break the whole listing."""
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
        RuntimeError("titles lookup down"),
        RuntimeError("progress lookup down"),
        [],
    ]

    result = await list_tasks()

    assert len(result["tasks"]) == 1
    task = result["tasks"][0]
    assert task["target"] is None
    assert task["progress"] is None
    assert result["counts"] == {"active": 0}
