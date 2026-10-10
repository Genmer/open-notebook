"""Model essay mark red-line isolation tests (mark.md 验收主线).

Marked essay content must never reach an AI generation context. The filter
landing points are text_search/vector_search (②), Notebook.get_context (③)
and build_notebook_context (④); build_source_context (single-source chat) and
reading a source by id are the sanctioned exception channels.

All database access is monkeypatched (conftest has no live SurrealDB), the
same approach as tests/test_search_api.py.
"""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from surrealdb import RecordID

MIGRATIONS_DIR = Path("open_notebook/database/migrations")


class FakeMarkDB:
    """Feeds the queries get_marked_source_ids()/_load_mark_state() issue."""

    def __init__(self, marks=(), groups=(), members=(), sources=()):
        self.marks = [dict(m) for m in marks]
        self.groups = [dict(g) for g in groups]
        self.members = list(members)  # (group_id, source_id) pairs
        self.sources = list(sources)  # live source ids

    def __call__(self, query, vars=None):
        q = " ".join(query.split())
        if "model_essay_mark" in q:
            return [dict(m) for m in self.marks]
        if "source_group_member" in q:
            outs = {str(o) for o in (vars or {}).get("ids", [])}
            return [sid for gid, sid in self.members if gid in outs]
        if "FROM source_group" in q:
            return [dict(g) for g in self.groups]
        if "FROM source WHERE" in q:
            requested = {str(i) for i in (vars or {}).get("ids", [])}
            return [sid for sid in self.sources if sid in requested]
        raise AssertionError(f"unexpected query: {q}")


def _group(gid, parent=None, name=None):
    return {"id": gid, "parent": parent, "name": name or gid.split(":")[-1]}


def _source_mark(sid, mark_id=None):
    return {
        "id": mark_id or f"model_essay_mark:{sid.split(':')[-1]}",
        "target_type": "source",
        "source": sid,
        "source_group": None,
    }


def _group_mark(gid, mark_id=None):
    return {
        "id": mark_id or f"model_essay_mark:{gid.split(':')[-1]}",
        "target_type": "source_group",
        "source": None,
        "source_group": gid,
    }


class TestGetMarkedSourceIds:
    """Effective set: direct marks ∪ marked-group subtree members."""

    @pytest.mark.asyncio
    async def test_direct_source_mark(self):
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[_source_mark("source:essay1")], sources=["source:essay1"]
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == {"source:essay1"}

    @pytest.mark.asyncio
    async def test_group_mark_covers_subtree_members(self):
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[_group_mark("source_group:root")],
            groups=[
                _group("source_group:root"),
                _group("source_group:child", "source_group:root"),
            ],
            members=[
                ("source_group:root", "source:direct_member"),
                ("source_group:child", "source:nested_member"),
                ("source_group:unmarked", "source:elsewhere"),
            ],
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == {
                "source:direct_member",
                "source:nested_member",
            }

    @pytest.mark.asyncio
    async def test_subtree_is_capped_five_levels_below_marked_root(self):
        """6th-level descendants are not pulled into the effective set (R8)."""
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        chain = ["source_group:g1"]
        for i in range(2, 8):
            chain.append(f"source_group:g{i}")
        groups = [_group("source_group:g1")]
        for i in range(2, 8):
            groups.append(_group(f"source_group:g{i}", f"source_group:g{i - 1}"))
        members = [(f"source_group:g{i}", f"source:level{i}") for i in range(1, 8)]

        fake = FakeMarkDB(
            marks=[_group_mark("source_group:g1")], groups=groups, members=members
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            effective = await get_marked_source_ids()

        # g6 sits 5 levels below the marked root g1 and is still covered;
        # g7 is the 6th level below and must not be pulled in.
        assert "source:level6" in effective
        assert "source:level7" not in effective

    @pytest.mark.asyncio
    async def test_membership_changes_follow_on_recompute(self):
        """No stored copy: adding/removing members changes the effective set."""
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[_group_mark("source_group:root")],
            groups=[_group("source_group:root")],
            members=[],
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == set()

            fake.members.append(("source_group:root", "source:new_member"))
            assert await get_marked_source_ids() == {"source:new_member"}

            fake.members.clear()
            assert await get_marked_source_ids() == set()

    @pytest.mark.asyncio
    async def test_dangling_marks_are_skipped_silently(self):
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[
                _source_mark("source:deleted"),  # source row is gone
                _group_mark("source_group:gone"),  # group row is gone
                _source_mark("source:alive"),
            ],
            groups=[],
            sources=["source:alive"],
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == {"source:alive"}

    @pytest.mark.asyncio
    async def test_unknown_target_type_row_is_ignored(self):
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[
                {
                    "id": "model_essay_mark:x",
                    "target_type": "weird",
                    "source": "source:a",
                    "source_group": None,
                }
            ],
            sources=["source:a"],
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == set()

    @pytest.mark.asyncio
    async def test_unmarked_source_still_covered_by_marked_group(self):
        from open_notebook.domain.model_essay_mark import get_marked_source_ids

        fake = FakeMarkDB(
            marks=[_source_mark("source:e1"), _group_mark("source_group:root")],
            groups=[_group("source_group:root")],
            members=[("source_group:root", "source:e1")],
            sources=["source:e1"],
        )
        with patch(
            "open_notebook.domain.model_essay_mark.repo_query",
            new_callable=AsyncMock,
            side_effect=fake,
        ):
            assert await get_marked_source_ids() == {"source:e1"}

            # Cancel the direct mark: still covered by the marked folder.
            fake.marks = [m for m in fake.marks if m["target_type"] != "source"]
            assert await get_marked_source_ids() == {"source:e1"}


def _essay_hit_rows():
    """All four source row shapes (title/full-text/chunk/insight) plus a note.

    fn::text_search / fn::vector_search source rows carry parent_id =
    source.id (migrations 24/25); note rows carry a note id.
    """
    return [
        {
            "id": "source:essay1",
            "parent_id": "source:essay1",
            "title": "范文-标题命中",
            "relevance": 4.0,
            "content": "范文标题",
        },
        {
            "id": "source:essay1",
            "parent_id": "source:essay1",
            "title": "范文-全文命中",
            "relevance": 3.0,
            "content": "范文正文",
        },
        {
            "id": "source_embedding:c1",
            "parent_id": "source:essay1",
            "title": "范文-切块命中",
            "relevance": 2.0,
            "content": "范文切块",
        },
        {
            "id": "source_insight:i1",
            "parent_id": "source:essay1",
            "title": "summary - 范文",
            "relevance": 1.0,
            "content": "范文洞察",
        },
        {
            "id": "note:n1",
            "parent_id": "note:n1",
            "title": "普通笔记",
            "relevance": 0.5,
            "content": "笔记内容",
        },
    ]


class TestSearchIsolationBeforeAndAfterMarking:
    """F3 acceptance: hits before marking, 0 hits after marking."""

    @pytest.mark.asyncio
    async def test_text_search_drops_all_four_shapes_after_marking(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        fake_db = FakeMarkDB()
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=_essay_hit_rows(),
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            before = await notebook_module.text_search("范文", 10)

        essay_rows = [r for r in before if str(r.get("parent_id")) == "source:essay1"]
        assert len(essay_rows) == 4  # title/full-text/chunk/insight all hit
        assert any(r["parent_id"] == "note:n1" for r in before)

        fake_db.marks.append(_source_mark("source:essay1"))
        fake_db.sources.append("source:essay1")
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=_essay_hit_rows(),
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            after = await notebook_module.text_search("范文", 10)

        assert not [r for r in after if str(r.get("parent_id")) == "source:essay1"]
        assert any(r["parent_id"] == "note:n1" for r in after)  # notes unaffected

    @pytest.mark.asyncio
    async def test_vector_search_drops_marked_rows_after_marking(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        rows = [
            {
                "id": "source_embedding:c1",
                "parent_id": "source:essay1",
                "title": "范文",
                "similarity": 0.9,
                "matches": ["范文切块"],
            },
            {
                "id": "source_insight:i1",
                "parent_id": "source:essay1",
                "title": "summary",
                "similarity": 0.8,
                "matches": ["范文洞察"],
            },
            {
                "id": "note:n1",
                "parent_id": "note:n1",
                "title": "普通笔记",
                "similarity": 0.7,
                "matches": ["笔记内容"],
            },
        ]
        fake_db = FakeMarkDB()
        with (
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            before = await notebook_module.vector_search("范文", 10)
        assert (
            len([r for r in before if str(r.get("parent_id")) == "source:essay1"]) == 2
        )

        fake_db.marks.append(_source_mark("source:essay1"))
        fake_db.sources.append("source:essay1")
        with (
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            after = await notebook_module.vector_search("范文", 10)
        assert [r["parent_id"] for r in after] == ["note:n1"]

    @pytest.mark.asyncio
    async def test_recordid_parent_id_is_normalized(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        rows = [
            {
                "id": "source:essay1",
                "parent_id": RecordID("source", "essay1"),
                "title": "范文",
                "relevance": 1.0,
            }
        ]
        fake_db = FakeMarkDB(
            marks=[_source_mark("source:essay1")], sources=["source:essay1"]
        )
        with (
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            assert await notebook_module.text_search("范文", 10) == []

    @pytest.mark.asyncio
    async def test_split_term_retry_is_filtered_too(self):
        """The sub-term retry path inherits the filter (all rows marked → 0)."""
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        # Only essay rows: the primary result filters to empty, which sends the
        # CJK keyword down the split-term retry — which must filter as well.
        rows = [r for r in _essay_hit_rows() if r["parent_id"] == "source:essay1"]
        fake_db = FakeMarkDB(
            marks=[_source_mark("source:essay1")],
            sources=["source:essay1"],
        )
        with (
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            result = await notebook_module.text_search("范文治理", 10)
        assert result == []


class TestFailClosed:
    """Filter computation failure must fail the call, never pass rows through."""

    @pytest.mark.asyncio
    async def test_text_search_raises_when_mark_query_fails(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=_essay_hit_rows(),
            ),
            patch.object(
                mark_module,
                "repo_query",
                new_callable=AsyncMock,
                side_effect=RuntimeError("mark table unreachable"),
            ),
        ):
            with pytest.raises(RuntimeError, match="mark table unreachable"):
                await notebook_module.text_search("范文", 10)

    @pytest.mark.asyncio
    async def test_vector_search_fails_closed(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.exceptions import DatabaseOperationError

        with (
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=[{"id": "source:essay1", "parent_id": "source:essay1"}],
            ),
            patch.object(
                mark_module,
                "repo_query",
                new_callable=AsyncMock,
                side_effect=RuntimeError("mark table unreachable"),
            ),
        ):
            # The filter sits inside vector_search's except-wrapped tail, so
            # the failure surfaces as the typed DatabaseOperationError.
            with pytest.raises(DatabaseOperationError):
                await notebook_module.vector_search("范文", 10)

    @pytest.mark.asyncio
    async def test_get_context_fails_closed(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.domain.notebook import Notebook

        notebook = Notebook(id="notebook:1", name="n")
        from open_notebook.domain.notebook import Source

        with (
            patch.object(
                Notebook,
                "get_sources",
                new_callable=AsyncMock,
                return_value=[Source(id="source:normal", title="t")],
            ),
            patch.object(
                notebook_module,
                "get_marked_source_ids",
                new_callable=AsyncMock,
                side_effect=RuntimeError("mark table unreachable"),
            ),
        ):
            with pytest.raises(RuntimeError, match="mark table unreachable"):
                await notebook.get_context()

    @pytest.mark.asyncio
    async def test_build_notebook_context_fails_closed(self):
        from open_notebook.domain.notebook import Notebook
        from open_notebook.utils import context_builder

        notebook = Notebook(id="notebook:1", name="n")
        with patch.object(
            context_builder,
            "get_marked_source_ids",
            new_callable=AsyncMock,
            side_effect=RuntimeError("mark table unreachable"),
        ):
            with pytest.raises(RuntimeError, match="mark table unreachable"):
                await context_builder.build_notebook_context(notebook, None)


class TestGetContextFilter:
    """Landing ③: marked sources (and their insights) leave notebook context."""

    @pytest.mark.asyncio
    async def test_marked_source_and_insights_excluded_notes_survive(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.domain.notebook import Note, Notebook, Source

        notebook = Notebook(id="notebook:1", name="n")
        sources = [
            Source(id="source:essay1", title="范文", full_text="范文正文不应该出现"),
            Source(id="source:normal", title="普通", full_text="普通正文会出现"),
        ]
        notes = [Note(id="note:n1", title="t", content="笔记内容会出现")]
        with (
            patch.object(
                Notebook, "get_sources", new_callable=AsyncMock, return_value=sources
            ),
            patch.object(
                Notebook, "get_notes", new_callable=AsyncMock, return_value=notes
            ),
            patch.object(
                notebook_module.SourceInsight,
                "get_for_sources",
                new_callable=AsyncMock,
                return_value={},
            ) as mock_insights,
            patch.object(
                notebook_module,
                "get_marked_source_ids",
                new_callable=AsyncMock,
                return_value={"source:essay1"},
            ),
        ):
            context = await notebook.get_context()

        assert "范文正文不应该出现" not in context
        assert "普通正文会出现" in context
        assert "笔记内容会出现" in context
        # Insights are only fetched for the sources that stayed: the marked
        # source's insights leave with it (R9).
        assert mock_insights.await_args is not None
        assert mock_insights.await_args.args[0] == ["source:normal"]


class TestBuildNotebookContextFilter:
    """Landing ④: both branches skip marked sources; build_source_context does not."""

    @pytest.mark.asyncio
    async def test_default_branch_filters_marked_sources(self):
        from open_notebook.domain.notebook import Notebook, Source
        from open_notebook.utils import context_builder

        notebook = Notebook(id="notebook:1", name="n")
        sources = [
            Source(id="source:essay1", title="范文", full_text="范文正文"),
            Source(id="source:normal", title="普通", full_text="普通正文"),
        ]
        with (
            patch.object(
                Notebook, "get_sources", new_callable=AsyncMock, return_value=sources
            ),
            patch.object(
                Notebook, "get_notes", new_callable=AsyncMock, return_value=[]
            ),
            patch.object(
                context_builder.SourceInsight,
                "get_for_sources",
                new_callable=AsyncMock,
                return_value={},
            ),
            patch.object(
                context_builder,
                "get_marked_source_ids",
                new_callable=AsyncMock,
                return_value={"source:essay1"},
            ),
        ):
            context_data, _ = await context_builder.build_notebook_context(
                notebook, None
            )

        assert [s["id"] for s in context_data["sources"]] == ["source:normal"]

    @pytest.mark.asyncio
    async def test_config_branch_filters_marked_sources(self):
        from open_notebook.domain.notebook import Notebook, Source
        from open_notebook.utils import context_builder

        notebook = Notebook(id="notebook:1", name="n")
        config = {
            "sources": {"essay1": "full content", "normal": "insights"},
            "notes": {},
        }

        async def fake_source_get(source_id):
            return Source(
                id=source_id, title=f"t-{source_id}", full_text=f"正文-{source_id}"
            )

        with (
            patch.object(
                context_builder.Source,
                "get",
                new_callable=AsyncMock,
                side_effect=fake_source_get,
            ),
            patch.object(
                Source,
                "get_insights",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch.object(
                context_builder,
                "get_marked_source_ids",
                new_callable=AsyncMock,
                return_value={"source:essay1"},
            ),
        ):
            context_data, _ = await context_builder.build_notebook_context(
                notebook, config
            )

        # Even an explicit "full content" status cannot pull a marked essay in.
        assert [s["id"] for s in context_data["sources"]] == ["source:normal"]

    @pytest.mark.asyncio
    async def test_build_source_context_is_the_single_source_exception(self):
        from open_notebook.domain.notebook import Source
        from open_notebook.utils import context_builder

        essay = Source(id="source:essay1", title="范文", full_text="范文全文例外通道")
        with (
            patch.object(
                context_builder.Source,
                "get",
                new_callable=AsyncMock,
                return_value=essay,
            ),
            patch.object(
                Source,
                "get_insights",
                new_callable=AsyncMock,
                return_value=[],
            ),
            patch.object(
                context_builder,
                "get_marked_source_ids",
                new_callable=AsyncMock,
                return_value={"source:essay1"},
            ),
        ):
            result = await context_builder.build_source_context("source:essay1")

        assert result["sources"][0]["full_text"] == "范文全文例外通道"


class TestIndirectPaths:
    """Paths ① (gather_evidence) and ⑤ (ask/mcp) flow into the same public
    search functions, so the filter covers them automatically."""

    @pytest.mark.asyncio
    async def test_gather_evidence_contains_no_marked_essay(self):
        from open_notebook.ai.project_env_pipeline import gather_evidence
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module

        fake_db = FakeMarkDB(
            marks=[_source_mark("source:essay1")], sources=["source:essay1"]
        )
        rows = [
            {
                "id": "source:essay1",
                "parent_id": "source:essay1",
                "content": "范文证据片段",
                "relevance": 1.0,
            },
            {
                "id": "source:normal",
                "parent_id": "source:normal",
                "content": "正常证据片段",
                "relevance": 0.9,
            },
        ]
        with (
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
        ):
            evidence = await gather_evidence("范文")

        assert "范文证据片段" not in evidence
        assert "正常证据片段" in evidence

    @pytest.mark.asyncio
    async def test_ask_provide_answer_returns_no_answers_for_marked_essay(self):
        """With every hit filtered out the node returns before any model call."""
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.graphs.ask import provide_answer

        rows = [
            {
                "id": "source:essay1",
                "parent_id": "source:essay1",
                "title": "范文",
                "similarity": 0.9,
            }
        ]
        fake_db = FakeMarkDB(
            marks=[_source_mark("source:essay1")], sources=["source:essay1"]
        )
        with (
            patch.object(
                notebook_module, "repo_query", new_callable=AsyncMock, return_value=rows
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
            patch(
                "open_notebook.utils.embedding.generate_embedding",
                new_callable=AsyncMock,
                return_value=[0.1],
            ),
        ):
            result = await provide_answer(
                # 检索被 mock 成只剩已标记行，节点在结果为空时提前返回，其余键不参与
                {
                    "question": "范文",
                    "term": "范文",
                    "instructions": "",
                    "results": {},
                    "answer": "",
                    "ids": [],
                    "notebook_ids": [],
                },
                {},
            )
        assert result == {"answers": []}

    @pytest.mark.asyncio
    async def test_mcp_search_returns_no_marked_rows(self):
        from open_notebook.domain import model_essay_mark as mark_module
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.mcp_server import search as mcp_search

        fake_db = FakeMarkDB(
            marks=[_source_mark("source:essay1")], sources=["source:essay1"]
        )
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                return_value=_essay_hit_rows(),
            ),
            patch.object(
                mark_module, "repo_query", new_callable=AsyncMock, side_effect=fake_db
            ),
        ):
            results = await mcp_search("范文")

        assert all(str(r.get("parent_id")) != "source:essay1" for r in results)
        assert any(r["parent_id"] == "note:n1" for r in results)


class TestReverseChannel:
    """Reading by id is the second sanctioned exception channel."""

    @pytest.mark.asyncio
    async def test_get_essay_full_text_reads_marked_source(self):
        from open_notebook.domain import notebook as notebook_module
        from open_notebook.domain.model_essay_mark import get_essay_full_text
        from open_notebook.domain.notebook import Source

        essay = Source(id="source:essay1", title="范文", full_text="范文全文照常可读")
        with (
            patch.object(
                notebook_module.Source,
                "get",
                new_callable=AsyncMock,
                return_value=essay,
            ),
            patch.object(
                Source,
                "get_insights",
                new_callable=AsyncMock,
                return_value=[],
            ),
        ):
            result = await get_essay_full_text("source:essay1")

        assert result["full_text"] == "范文全文照常可读"


class TestMigration41:
    """Table shape + EVENT cascade + manager registration (hard-coded list)."""

    def test_migration_files_exist(self):
        assert (MIGRATIONS_DIR / "41.surrealql").is_file()
        assert (MIGRATIONS_DIR / "41_down.surrealql").is_file()

    def test_manager_registers_migration_41(self):
        from open_notebook.database.async_migrate import AsyncMigrationManager

        manager = AsyncMigrationManager()
        assert len(manager.up_migrations) >= 41
        assert len(manager.up_migrations) == len(manager.down_migrations)
        assert "model_essay_mark" in manager.up_migrations[40].sql
        assert "model_essay_mark" in manager.down_migrations[40].sql

    def test_table_is_schemafull_without_content_fields(self):
        sql = (MIGRATIONS_DIR / "41.surrealql").read_text()

        assert "DEFINE TABLE IF NOT EXISTS model_essay_mark SCHEMAFULL" in sql
        # Red line: no content-bearing field beyond the two record references.
        for line in sql.splitlines():
            if (
                line.strip().startswith("DEFINE FIELD")
                and "ON TABLE model_essay_mark" in line
            ):
                assert "string" in line or "record<" in line or "time::now" in line, (
                    line
                )
        assert "TYPE option<record<source>>" in sql
        assert "TYPE option<record<source_group>>" in sql

    def test_events_cascade_on_target_delete(self):
        sql = (MIGRATIONS_DIR / "41.surrealql").read_text()

        assert "model_essay_mark_source_cleanup ON TABLE source" in sql
        assert "model_essay_mark_group_cleanup ON TABLE source_group" in sql
        assert "delete model_essay_mark where source == $before.id" in sql
        assert "delete model_essay_mark where source_group == $before.id" in sql

    def test_down_removes_table_and_events(self):
        sql = (MIGRATIONS_DIR / "41_down.surrealql").read_text()

        assert "REMOVE TABLE IF EXISTS model_essay_mark" in sql
        assert "REMOVE EVENT IF NOT EXISTS model_essay_mark_source_cleanup" in sql
        assert "REMOVE EVENT IF NOT EXISTS model_essay_mark_group_cleanup" in sql
