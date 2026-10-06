"""
Unit tests for the Chinese compound-word degradation in text_search
(open_notebook/domain/notebook.py).

SurrealDB's full-text index matches whole analyzer tokens, so a compound
like 微服务治理 returns nothing while its parts (微服务, 治理) are all over
the corpus — verified live: POST /api/search "微服务治理" -> total_count=0,
"微服务" -> 3 hits. When the primary query comes back empty, text_search
retries with the split terms and merges the rows, mirroring the
position-overflow -> vector_search fallback.
"""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.domain import notebook as notebook_module
from open_notebook.exceptions import DatabaseOperationError


class TestSplitSearchTerms:
    def test_four_char_compound_splits_into_2grams(self):
        assert notebook_module.split_search_terms("微服务治理") == [
            "微服",
            "服务",
            "务治",
            "治理",
        ]

    def test_three_char_cjk_splits_into_2grams(self):
        assert notebook_module.split_search_terms("微服务") == ["微服", "服务"]

    def test_two_char_cjk_cannot_degrade(self):
        # The whole query is one minimal token; there is nothing to split.
        assert notebook_module.split_search_terms("治理") == []

    def test_mixed_script_keeps_latin_tokens_and_cjk_grams(self):
        assert notebook_module.split_search_terms("DDD 微服务") == [
            "DDD",
            "微服务",
            "微服",
            "服务",
        ]

    def test_non_cjk_query_returns_no_terms(self):
        assert notebook_module.split_search_terms("hello world") == []

    @pytest.mark.parametrize("blank", ["", "   "])
    def test_blank_query_returns_no_terms(self, blank):
        assert notebook_module.split_search_terms(blank) == []

    def test_terms_are_capped(self):
        terms = notebook_module.split_search_terms("微服务治理平台架构实践")
        assert len(terms) == 8
        assert notebook_module.split_search_terms(
            "微服务治理平台架构实践", max_terms=3
        ) == ["微服", "服务", "务治"]


class TestTextSearchSubTermFallback:
    @pytest.mark.asyncio
    async def test_primary_hit_runs_no_extra_queries(self):
        rows = [{"id": "source:a", "relevance": 1.0}]
        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            return_value=rows,
        ) as mock_query:
            result = await notebook_module.text_search("微服务", 10)

        assert result == rows
        assert mock_query.await_count == 1

    @pytest.mark.asyncio
    async def test_empty_result_degrades_to_split_terms_and_dedupes(self):
        def by_keyword(query, params):
            keyword = params["keyword"]
            if keyword == "微服务治理":
                return []
            if keyword == "微服":
                return [{"id": "source:a", "relevance": 0.5}]
            if keyword == "服务":
                return [
                    {"id": "source:a", "relevance": 0.4},
                    {"id": "source:b", "relevance": 0.9},
                ]
            return []  # 务治 / 治理

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            side_effect=by_keyword,
        ) as mock_query:
            result = await notebook_module.text_search("微服务治理", 10)

        # Rows matched by more sub-terms rank first (a matched 微服+服务, b only 服务).
        assert [row["id"] for row in result] == ["source:a", "source:b"]
        keywords = [call.args[1]["keyword"] for call in mock_query.await_args_list]
        assert keywords == ["微服务治理", "微服", "服务", "务治", "治理"]

    @pytest.mark.asyncio
    async def test_merges_are_truncated_to_requested_limit(self):
        def by_keyword(query, params):
            keyword = params["keyword"]
            if keyword == "微服务治理":
                return []
            return [{"id": f"source:{keyword}-{n}", "relevance": 1.0} for n in range(2)]

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            side_effect=by_keyword,
        ):
            result = await notebook_module.text_search("微服务治理", 2)

        assert len(result) == 2

    @pytest.mark.asyncio
    async def test_failing_sub_term_is_skipped_not_fatal(self):
        def by_keyword(query, params):
            if params["keyword"] == "微服":
                raise DatabaseOperationError("db hiccup")
            if params["keyword"] == "服务":
                return [{"id": "source:b", "relevance": 0.9}]
            return []

        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            side_effect=by_keyword,
        ):
            result = await notebook_module.text_search("微服务", 10)

        assert [row["id"] for row in result] == ["source:b"]

    @pytest.mark.asyncio
    async def test_scope_and_flags_are_forwarded_to_sub_queries(self):
        with patch.object(
            notebook_module,
            "repo_query",
            new_callable=AsyncMock,
            return_value=[],
        ) as mock_query:
            await notebook_module.text_search(
                "微服务治理",
                7,
                source=True,
                note=False,
                notebook_ids=["notebook:a"],
            )

        for call in mock_query.await_args_list:
            params = call.args[1]
            assert params["results"] == 7
            assert params["note"] is False
            assert params["notebook_ids"] == [
                notebook_module.ensure_record_id("notebook:a")
            ]

    @pytest.mark.asyncio
    async def test_position_overflow_fallback_still_applies_to_primary(self):
        overflow = RuntimeError("position overflow: 2545 - len: 1965")
        with (
            patch.object(
                notebook_module,
                "repo_query",
                new_callable=AsyncMock,
                side_effect=overflow,
            ),
            patch.object(
                notebook_module,
                "vector_search",
                new_callable=AsyncMock,
                return_value=[{"id": "source:1"}],
            ) as mock_vector,
        ):
            result = await notebook_module.text_search("微服务治理", 10)

        assert result == [{"id": "source:1"}]
        mock_vector.assert_awaited_once_with(
            "微服务治理", 10, True, True, notebook_ids=None
        )
