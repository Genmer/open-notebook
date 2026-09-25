"""
Unit tests for Source.set_embedding_state (open_notebook/domain/notebook.py).

The command writes per-batch embedding progress through this method; the
tests pin the 500-char error truncation (T1-2) and the best-effort contract
that keeps progress writes from breaking the command or the API polling path.
"""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.domain.notebook import Source


def _source() -> Source:
    return Source(
        id="source:1",
        title="t",
        full_text="text",
        created="2026-01-01",
        updated="2026-01-01",
    )


@pytest.mark.asyncio
async def test_set_embedding_state_truncates_error_to_500():
    """T1-2: permanent-failure error text is truncated to 500 chars on write."""
    source = _source()
    with patch(
        "open_notebook.domain.notebook.repo_query", new=AsyncMock(return_value=[])
    ) as repo_query:
        await source.set_embedding_state(
            status="failed", error="x" * 900, best_effort=False
        )

    assert repo_query.await_args is not None
    data = repo_query.await_args.args[1]["data"]
    assert data["embedding_status"] == "failed"
    assert data["embedding_error"] == "x" * 500


@pytest.mark.asyncio
async def test_set_embedding_state_best_effort_swallows_db_errors():
    """A progress write failing mid-run must not crash the command (and thus
    must never turn a good embed into a retry)."""
    source = _source()
    with patch(
        "open_notebook.domain.notebook.repo_query",
        new=AsyncMock(side_effect=RuntimeError("db down")),
    ):
        # Must not raise.
        await source.set_embedding_state(status="running", embedded_chunks=1, best_effort=True)

        # Strict mode still surfaces DB problems to the caller.
        with pytest.raises(RuntimeError):
            await source.set_embedding_state(status="running", embedded_chunks=1)


@pytest.mark.asyncio
async def test_set_embedding_state_skips_unknown_command_id():
    """'unknown' (no execution context) must not be written as a command link."""
    source = _source()
    with patch(
        "open_notebook.domain.notebook.repo_query", new=AsyncMock(return_value=[])
    ) as repo_query:
        await source.set_embedding_state(status="running", command_id="unknown")

    assert repo_query.await_args is not None
    data = repo_query.await_args.args[1]["data"]
    assert "embedding_command" not in data
