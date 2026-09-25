"""Tests for classify_sources_command (commands/classification_commands.py).

The LLM seam (_llm_classification_plan) and repo_query are stubbed, so no
model or database is touched; SQL text and persisted params are asserted.
"""

import re
from unittest.mock import AsyncMock, patch

import pytest
from langchain_core.exceptions import OutputParserException

from commands.classification_commands import (
    ClassificationPlan,
    ClassifySourcesInput,
    ClusterAssignment,
    classify_sources_command,
)

VIEW_ID = "source_view:ai_content"


def _plan(*groups):
    return ClassificationPlan(groups=list(groups))


def _source_row(source_id, title=None, file_path=None):
    return {
        "id": source_id,
        "title": title,
        "asset": {"file_path": file_path} if file_path else None,
    }


def _embedding_rows():
    # Two tight 2-D blobs: s1-s3 around [1, 0], s4-s6 around [0, 1]
    rows = []
    for i in range(1, 4):
        rows.append({"source": f"source:s{i}", "embedding": [0.99, 0.02]})
        rows.append({"source": f"source:s{i}", "embedding": [0.97, 0.05]})
    for i in range(4, 7):
        rows.append({"source": f"source:s{i}", "embedding": [0.01, 0.98]})
        rows.append({"source": f"source:s{i}", "embedding": [0.04, 0.96]})
    return rows


class QueryRecorder:
    """Routes SQL text to canned results and records every write."""

    def __init__(self, source_rows=None, embedding_rows=None, view_rows=None):
        self.source_rows = source_rows if source_rows is not None else [
            _source_row(f"source:s{i}", title=f"Doc {i}") for i in range(1, 7)
        ]
        self.embedding_rows = embedding_rows if embedding_rows is not None else _embedding_rows()
        self.view_rows = view_rows if view_rows is not None else [
            {"id": VIEW_ID, "view_type": "ai_content"}
        ]
        self.transactions = []
        self.progress_updates = []
        self.final_updates = []

    async def __call__(self, sql, params=None):
        if "FROM $view_id" in sql and "UPDATE" not in sql:
            return self.view_rows
        if "SELECT id, title, asset FROM source" in sql:
            return self.source_rows
        if "FROM source_embedding" in sql:
            return self.embedding_rows
        if "BEGIN TRANSACTION" in sql:
            self.transactions.append((sql, params))
            return []
        if "last_classified_at" in sql:
            self.final_updates.append(params)
            return []
        if "classify_progress = $progress" in sql:
            self.progress_updates.append(params["progress"])
            return []
        raise AssertionError(f"Unexpected query: {sql[:120]}")


async def _run_command(recorder, llm, method="content"):
    with (
        patch("commands.classification_commands.repo_query", new=recorder),
        patch(
            "commands.classification_commands._llm_classification_plan",
            new=llm,
        ),
    ):
        return await classify_sources_command(
            ClassifySourcesInput(view_id=VIEW_ID, method=method)
        )


class TestContentPipeline:
    @pytest.mark.asyncio
    async def test_valid_plan_persists_groups_in_one_transaction(self):
        recorder = QueryRecorder()
        plan = _plan(
            ClusterAssignment(name="Direction", cluster_ids=["0", "1", "2"], extra_source_ids=[])
        )
        llm = AsyncMock(return_value=plan)

        output = await _run_command(recorder, llm)

        assert output.success is True
        assert output.groups_created == 1
        assert output.sources_classified == 6
        assert output.unclassified == 0

        # One overwrite transaction carrying deletes + creates + membership links
        assert len(recorder.transactions) == 1
        sql, params = recorder.transactions[0]
        assert "DELETE source_group_member WHERE out IN" in sql
        assert "DELETE source_group WHERE source_view = $view" in sql
        assert "CREATE source_group:" in sql
        assert "->source_group_member->" in sql
        assert "Direction" in params.values()
        assert sql.count("RELATE ") == 6

        assert recorder.final_updates[-1]["progress"]["stage"] == "done"
        assert recorder.final_updates[-1]["progress"]["sources_classified"] == 6

    @pytest.mark.asyncio
    async def test_progress_stages_run_in_order(self):
        recorder = QueryRecorder()
        llm = AsyncMock(return_value=_plan())

        await _run_command(recorder, llm)

        stages = [p["stage"] for p in recorder.progress_updates]
        assert stages == ["clustering", "llm", "assigning"]

    @pytest.mark.asyncio
    async def test_zero_embeddings_falls_back_to_llm_without_error(self):
        recorder = QueryRecorder(embedding_rows=[])
        llm = AsyncMock(
            return_value=_plan(
                ClusterAssignment(
                    name="Everything", cluster_ids=[], extra_source_ids=[f"source:s{i}" for i in range(1, 7)]
                )
            )
        )

        output = await _run_command(recorder, llm)

        assert output.success is True
        assert output.groups_created == 1
        # The LLM received no clusters and every source as leftover
        data = llm.await_args_list[0].args[1]
        assert data["clusters"] == []
        assert len(data["leftover_sources"]) == 6
        assert len(recorder.transactions) == 1

    @pytest.mark.asyncio
    async def test_odd_dimension_sources_join_fallback_pool(self):
        recorder = QueryRecorder()
        # s7 has a stray 3-D embedding from a different provider
        recorder.embedding_rows = _embedding_rows() + [
            {"source": "source:s7", "embedding": [0.5, 0.5, 0.5]}
        ]
        recorder.source_rows = recorder.source_rows + [
            _source_row("source:s7", title="Odd one")
        ]
        llm = AsyncMock(
            return_value=_plan(
                ClusterAssignment(
                    name="All", cluster_ids=["0", "1", "2"], extra_source_ids=["source:s7"]
                )
            )
        )

        output = await _run_command(recorder, llm)

        data = llm.await_args_list[0].args[1]
        # s7 was not clustered (wrong dimension) but was offered to the LLM
        assert [s["source_id"] for s in data["leftover_sources"]] == ["source:s7"]
        assert output.sources_classified == 7


class TestLlmFailurePaths:
    @pytest.mark.asyncio
    async def test_parse_failure_retries_once_with_feedback_then_succeeds(self):
        recorder = QueryRecorder()
        plan = _plan(ClusterAssignment(name="G", cluster_ids=["0", "1", "2"], extra_source_ids=[]))
        llm = AsyncMock(side_effect=[OutputParserException("bad json"), plan])

        output = await _run_command(recorder, llm)

        assert output.success is True
        assert llm.await_count == 2
        # The retry carries a previous_error for the template feedback block
        assert "previous_error" in llm.await_args_list[1].args[1]

    @pytest.mark.asyncio
    async def test_double_parse_failure_is_terminal_and_keeps_old_groups(self):
        recorder = QueryRecorder()
        llm = AsyncMock(
            side_effect=[OutputParserException("bad"), OutputParserException("worse")]
        )

        with pytest.raises(ValueError):
            await _run_command(recorder, llm)

        assert llm.await_count == 2
        # Nothing was persisted: the old grouping survives untouched
        assert recorder.transactions == []
        assert recorder.final_updates == []
        assert recorder.progress_updates[-1]["stage"] == "failed"
        assert recorder.progress_updates[-1]["error"]

    @pytest.mark.asyncio
    async def test_missing_view_is_terminal(self):
        recorder = QueryRecorder(view_rows=[])
        llm = AsyncMock()

        with pytest.raises(ValueError, match="not found"):
            await _run_command(recorder, llm)

        llm.assert_not_awaited()
        assert recorder.transactions == []

    @pytest.mark.asyncio
    async def test_terminal_failure_progress_even_after_partial_work(self):
        recorder = QueryRecorder()
        llm = AsyncMock(side_effect=[OutputParserException("x"), OutputParserException("y")])

        with pytest.raises(ValueError):
            await _run_command(recorder, llm)

        # progress writes are best-effort: a failed one must not mask the terminal state
        failed = [p for p in recorder.progress_updates if p["stage"] == "failed"]
        assert len(failed) == 1
        assert failed[0]["percent"] == 100


class TestOverwriteRerun:
    @pytest.mark.asyncio
    async def test_second_run_replaces_groups(self):
        recorder = QueryRecorder()
        llm = AsyncMock(
            return_value=_plan(ClusterAssignment(name="G", cluster_ids=["0", "1", "2"], extra_source_ids=[]))
        )

        await _run_command(recorder, llm)
        llm.return_value = _plan(
            ClusterAssignment(name="H", cluster_ids=["0"], extra_source_ids=[]),
            ClusterAssignment(name="I", cluster_ids=["1", "2"], extra_source_ids=[]),
        )
        output = await _run_command(recorder, llm)

        assert output.groups_created == 2
        assert len(recorder.transactions) == 2
        # Each run deletes the previous generation first
        for sql, _ in recorder.transactions:
            assert "DELETE source_group WHERE source_view = $view" in sql


class TestTitlePipeline:
    @pytest.mark.asyncio
    async def test_batches_share_group_names_and_untitled_count_unclassified(self, monkeypatch):
        import commands.classification_commands as mod

        monkeypatch.setattr(mod, "_TITLE_BATCH_SIZE", 2)
        recorder = QueryRecorder(
            source_rows=[
                _source_row("source:s1", title="Alpha paper"),
                _source_row("source:s2", title="Beta paper"),
                _source_row("source:s3", title="Gamma report"),
                _source_row("source:s4", title=None, file_path="/uploads/delta.pdf"),
                _source_row("source:s5", title=None),
            ],
            embedding_rows=[],
        )

        async def llm_side_effect(template, data, view_id):
            if len(data["items"]) and data["items"][0]["source_id"] == "source:s1":
                assert data["existing_groups"] == []
                return _plan(ClusterAssignment(name="Papers", cluster_ids=[], extra_source_ids=["source:s1", "source:s2"]))
            assert data["existing_groups"] == ["Papers"]
            return _plan(
                ClusterAssignment(name="Papers", cluster_ids=[], extra_source_ids=["source:s3"]),
                ClusterAssignment(name="Reports", cluster_ids=[], extra_source_ids=["source:s4"]),
            )

        llm = AsyncMock(side_effect=llm_side_effect)

        with (
            patch("commands.classification_commands.repo_query", new=recorder),
            patch("commands.classification_commands._llm_classification_plan", new=llm),
        ):
            output = await classify_sources_command(
                ClassifySourcesInput(view_id=VIEW_ID, method="title")
            )

        assert output.success is True
        assert output.groups_created == 2
        assert output.sources_classified == 4
        # s5 has no title and no asset: it stays unclassified
        assert output.unclassified == 1

        sql, params = recorder.transactions[0]
        creates = re.findall(r"CREATE (source_group:\S+) CONTENT \{ name: \$(\w+),", sql)
        id_to_name = {gid: params[param] for gid, param in creates}
        assert set(id_to_name.values()) == {"Papers", "Reports"}
        counts = {
            name: sql.count(f"->source_group_member->{gid};")
            for gid, name in id_to_name.items()
        }
        # Cross-batch "Papers" reuse merged s3 into the batch-1 group
        assert sorted(counts.values()) == [1, 3]

    @pytest.mark.asyncio
    async def test_title_pipeline_ignores_view_type_and_runs(self):
        recorder = QueryRecorder(view_rows=[{"id": VIEW_ID, "view_type": "ai_title"}])
        llm = AsyncMock(return_value=_plan())

        with (
            patch("commands.classification_commands.repo_query", new=recorder),
            patch("commands.classification_commands._llm_classification_plan", new=llm),
        ):
            output = await classify_sources_command(
                ClassifySourcesInput(view_id=VIEW_ID, method="title")
            )

        assert output.success is True
        assert output.groups_created == 0
        assert output.sources_classified == 0
        assert output.unclassified == 6
