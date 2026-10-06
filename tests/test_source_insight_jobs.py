"""Unit tests for the insight-jobs section of GET /sources/{id}/status."""

from unittest.mock import AsyncMock, patch

import pytest

from api.routers.sources import _collect_insight_jobs


@pytest.mark.asyncio
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
async def test_collect_insight_jobs_maps_rows_and_titles(repo_query):
    repo_query.side_effect = [
        [
            {
                "id": "command:aaa",
                "args": {
                    "source_id": "source:s1",
                    "transformation_id": "transformation:t1",
                },
                "status": "running",
                "error_message": None,
            },
            {
                "id": "command:bbb",
                "args": {"source_id": "source:s1"},
                "status": "failed",
                "error_message": "boom",
            },
        ],
        [{"id": "transformation:t1", "title": "Key Insights"}],
    ]

    jobs = await _collect_insight_jobs("source:s1")

    assert jobs == [
        {
            "command_id": "command:aaa",
            "transformation_id": "transformation:t1",
            "transformation_title": "Key Insights",
            "status": "running",
            "error_message": None,
        },
        {
            "command_id": "command:bbb",
            "transformation_id": None,
            "transformation_title": None,
            "status": "failed",
            "error_message": "boom",
        },
    ]


@pytest.mark.asyncio
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
async def test_collect_insight_jobs_swallows_query_errors(repo_query):
    """A command-table hiccup must not fail the whole status endpoint."""
    repo_query.side_effect = RuntimeError("db down")

    assert await _collect_insight_jobs("source:s1") == []


@pytest.mark.asyncio
@patch("api.routers.sources.repo_query", new_callable=AsyncMock)
async def test_collect_insight_jobs_skips_title_lookup_without_transformations(
    repo_query,
):
    repo_query.return_value = []

    jobs = await _collect_insight_jobs("source:s1")

    assert jobs == []
    assert repo_query.await_count == 1
