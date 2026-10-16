"""Acceptance tests for T3: multi-level GA anchor resolution.

resolve_ga_anchor resolves one tech+version through static table →
ga_anchor_cache → web search (hit cached) → None. prescreen_point_anchors
must never return "off_table": a pair the static table cannot date stays
"unknown" (or becomes pass/fail once a dynamic anchor resolves), so a real
scenario like "Flink 1.18" can be judged automatically once the web lookup
finds its GA month.

No real network here: web_search is mocked at
open_notebook.ai.project_env_pipeline.web_search and all DB access at
open_notebook.database.repository.repo_query /
open_notebook.domain.base.repo_create.
"""

from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.ai import project_env_pipeline as pipeline

REPO_QUERY = "open_notebook.database.repository.repo_query"
REPO_CREATE = "open_notebook.domain.base.repo_create"
WEB_SEARCH = "open_notebook.ai.project_env_pipeline.web_search"


RESOLVE_LLM = "open_notebook.ai.project_env_pipeline.resolve_ga_with_llm"


def _web_result(snippet: str, url: str = "https://flink.example/rel"):
    return [{"title": "Release", "url": url, "snippet": snippet}]


@pytest.fixture
def db_down():
    """Cache levels miss: repo_query degrades exactly like an outage."""
    with (
        patch(
            REPO_QUERY, new_callable=AsyncMock, side_effect=RuntimeError("db down")
        ) as query,
        patch(REPO_CREATE, new_callable=AsyncMock, return_value=[{}]) as create,
    ):
        yield query, create


class TestResolveGaWithLlm:
    @pytest.mark.asyncio
    async def test_resolve_ga_with_llm_returns_parsed_ga(self):
        resolution = pipeline.GaResolution(
            ga="2023.11", confidence="high", reasoning="Official release"
        )
        with patch.object(
            pipeline, "_invoke_json", new_callable=AsyncMock, return_value=resolution
        ):
            result = await pipeline.resolve_ga_with_llm(
                "flink", "1.18", "Apache Flink 1.18 released Nov 2023"
            )

        assert result is not None
        assert result.ga == "2023.11"

    @pytest.mark.asyncio
    async def test_resolve_ga_with_llm_returns_none_on_empty_or_failure(self):
        assert await pipeline.resolve_ga_with_llm("flink", "1.18", "") is None

        with patch.object(
            pipeline, "_invoke_json", new_callable=AsyncMock, return_value=None
        ):
            assert (
                await pipeline.resolve_ga_with_llm("flink", "1.18", "some snippet")
                is None
            )

    @pytest.mark.asyncio
    async def test_fetch_ga_anchor_online_prefers_llm_resolution(self):
        resolution = pipeline.GaResolution(
            ga="2023.11", confidence="web", reasoning="LLM resolved"
        )
        with (
            patch(
                WEB_SEARCH,
                new_callable=AsyncMock,
                return_value=_web_result(
                    "Blog dated 2025.01: Flink 1.18 released 2023.11"
                ),
            ),
            patch.object(
                pipeline,
                "_invoke_json",
                new_callable=AsyncMock,
                return_value=resolution,
            ),
        ):
            anchor = await pipeline.fetch_ga_anchor_online("flink", "1.18")

        assert anchor is not None
        assert anchor["ga"] == "2023.11"


class TestResolveGaAnchor:
    @pytest.fixture(autouse=True)
    def mock_llm_resolution(self):
        with patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None) as mock_llm:
            yield mock_llm

    @pytest.mark.asyncio
    async def test_should_return_static_table_anchor_without_cache_or_web(
        self, db_down
    ):
        query, _ = db_down
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            anchor = await pipeline.resolve_ga_anchor("Python", "3.13")

        assert anchor == {
            "ga": "2024.10",
            "source": "static_table",
            "confidence": "curated",
        }
        query.assert_not_awaited()
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_return_cache_anchor_when_static_table_misses(self):
        row = {
            "tech": "flink",
            "version": "1.18",
            "ga": "2023.11",
            "source": "web:https://flink.example/rel",
            "confidence": "web",
            "detail": None,
        }
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]),
            patch(REPO_CREATE, new_callable=AsyncMock, return_value=[{}]) as create,
            patch(WEB_SEARCH, new_callable=AsyncMock) as search,
        ):
            anchor = await pipeline.resolve_ga_anchor("flink", "1.18")

        assert anchor == {
            "ga": "2023.11",
            "source": "web:https://flink.example/rel",
            "confidence": "web",
        }
        search.assert_not_awaited()
        create.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_return_heuristic_confidence_verbatim_from_cache_row(self):
        # A heuristic anchor written by an earlier run must keep its confidence
        # on the cache read-back — callers rely on it staying an unverified
        # lane-B reference, never silently upgrading it to a confirmed "web".
        row = {
            "tech": "flink",
            "version": "1.18",
            "ga": "2025.03",
            "source": "web:https://flink.example/rel",
            "confidence": "heuristic",
            "detail": None,
        }
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]),
            patch(WEB_SEARCH, new_callable=AsyncMock) as search,
        ):
            anchor = await pipeline.resolve_ga_anchor("flink", "1.18")

        assert anchor is not None
        assert anchor["ga"] == "2025.03"
        assert anchor["confidence"] == "heuristic"
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_search_web_and_write_cache_when_static_and_cache_miss(
        self, db_down
    ):
        _, create = db_down
        with patch(
            WEB_SEARCH,
            new_callable=AsyncMock,
            return_value=_web_result("Apache Flink 1.18 released in November 2023"),
        ):
            anchor = await pipeline.resolve_ga_anchor("flink", "1.18")

        assert anchor == {
            "ga": "2023.11",
            "source": "web:https://flink.example/rel",
            "confidence": "heuristic",
        }
        create.assert_awaited_once()
        table, data = create.await_args.args
        assert table == "ga_anchor_cache"
        assert data["tech"] == "flink"
        assert data["version"] == "1.18"
        assert data["ga"] == "2023.11"

    @pytest.mark.asyncio
    async def test_should_return_none_when_every_level_misses(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock, return_value=[]):
            assert await pipeline.resolve_ga_anchor("flink", "1.18") is None

    @pytest.mark.asyncio
    async def test_should_return_none_without_any_lookup_when_key_or_version_blank(
        self, db_down
    ):
        query, _ = db_down
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            assert await pipeline.resolve_ga_anchor("", "1.18") is None
            assert await pipeline.resolve_ga_anchor("flink", "") is None
        query.assert_not_awaited()
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_ignore_cache_row_with_invalid_month_and_fall_through(self):
        row = {"tech": "flink", "version": "1.18", "ga": "not-a-month"}
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]),
            patch(REPO_CREATE, new_callable=AsyncMock, return_value=[{}]),
            patch(
                WEB_SEARCH,
                new_callable=AsyncMock,
                return_value=_web_result("released in November 2023"),
            ),
        ):
            anchor = await pipeline.resolve_ga_anchor("flink", "1.18")

        assert anchor is not None
        assert anchor["ga"] == "2023.11"
        assert anchor["source"] == "web:https://flink.example/rel"


class TestPrescreenPointAnchors:
    """prescreen_point_anchors over a real off-table pair (Flink 1.18)."""

    @pytest.fixture(autouse=True)
    def mock_llm_resolution(self):
        with patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=None) as mock_llm:
            yield mock_llm

    @pytest.mark.asyncio
    async def test_should_return_unknown_never_off_table_when_pair_stays_undated(
        self, db_down
    ):
        with patch(WEB_SEARCH, new_callable=AsyncMock, return_value=[]):
            result = await pipeline.prescreen_point_anchors(
                "数据管道采用 Flink 1.18 计算。", "2025.01"
            )

        assert result["status"] == "unknown"
        assert result["status"] != "off_table"
        assert result["anchors"] == {}

    @pytest.mark.asyncio
    async def test_should_fail_when_web_resolved_anchor_is_after_period_start(
        self, db_down
    ):
        # LLM-confirmed anchor (confidence "web"): a confirmed GA after the
        # project start hard-fails the prescreen.
        confirmed = pipeline.GaResolution(ga="2025.03", reasoning="official release")
        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=_web_result("x")),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=confirmed),
        ):
            result = await pipeline.prescreen_point_anchors(
                "数据管道采用 Flink 1.18 计算。", "2025.01"
            )

        assert result["status"] == "fail"
        assert "is after project start" in result["message"]
        assert result["anchors"]["flink 1.18"]["ga"] == "2025.03"

    @pytest.mark.asyncio
    async def test_should_pass_when_web_resolved_anchor_is_before_period_start(
        self, db_down
    ):
        confirmed = pipeline.GaResolution(ga="2023.11", reasoning="official release")
        with (
            patch(WEB_SEARCH, new_callable=AsyncMock, return_value=_web_result("x")),
            patch(RESOLVE_LLM, new_callable=AsyncMock, return_value=confirmed),
        ):
            result = await pipeline.prescreen_point_anchors(
                "数据管道采用 Flink 1.18 计算。", "2025.01"
            )

        assert result["status"] == "pass"
        assert result["anchors"]["flink 1.18"]["ga"] == "2023.11"

    @pytest.mark.asyncio
    async def test_should_not_hard_fail_on_heuristic_anchor(self, db_down):
        # Light model unavailable (call failed) and the regex heuristic mined a
        # date after the period start: the anchor stays a lane-B reference and
        # the prescreen must stay "unknown" — an unverified date never
        # hard-fails the paragraph.
        with patch(
            WEB_SEARCH,
            new_callable=AsyncMock,
            return_value=_web_result("Apache Flink 1.18 released in March 2025"),
        ):
            result = await pipeline.prescreen_point_anchors(
                "数据管道采用 Flink 1.18 计算。", "2025.01"
            )

        assert result["status"] == "unknown"
        assert result["anchors"]["flink 1.18"]["ga"] == "2025.03"
        assert result["anchors"]["flink 1.18"]["confidence"] == "heuristic"

    @pytest.mark.asyncio
    async def test_should_stay_unknown_when_cached_anchor_is_heuristic(self):
        # The heuristic verdict survives the cache round-trip: a cached row
        # with confidence="heuristic" and a ga after period_start must still
        # keep the prescreen at "unknown" (lane-B reference), never a fail.
        row = {
            "tech": "flink",
            "version": "1.18",
            "ga": "2025.03",
            "source": "web:https://flink.example/rel",
            "confidence": "heuristic",
            "detail": None,
        }
        with (
            patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]),
            patch(WEB_SEARCH, new_callable=AsyncMock) as search,
        ):
            result = await pipeline.prescreen_point_anchors(
                "数据管道采用 Flink 1.18 计算。", "2025.01"
            )

        assert result["status"] == "unknown"
        assert result["anchors"]["flink 1.18"]["confidence"] == "heuristic"
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_fail_when_era_specific_tech_has_no_version(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "引入 DeepSeek 与开源模型做智能问答。", "2022.06"
            )

        assert result["status"] == "fail"
        assert "deepseek" in result["message"]
        assert "2023.11" in result["message"]
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_pass_era_specific_tech_after_its_birth(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "引入 DeepSeek 与开源模型做智能问答。", "2024.06"
            )

        assert result["status"] != "fail"
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_not_duplicate_era_message_for_versioned_mention(
        self, db_down
    ):
        # "Qwen 2.5" already goes through the versioned path; the bare-name
        # era scan must not add a second 时代专属 message for the same tech.
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "模型服务基于 Qwen 2.5 构建。", "2022.06"
            )

        assert result["status"] == "fail"
        era_messages = [m for m in result["message"].split("; ") if "时代专属" in m]
        assert len(era_messages) == 1
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_fail_when_static_table_anchor_violates_window(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "前端用 Python 3.13 编写工具链。", "2024.01"
            )

        assert result["status"] == "fail"
        assert "is after project start" in result["message"]
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_pass_when_static_table_anchor_is_within_window(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "前端用 Python 3.13 编写工具链。", "2025.01"
            )

        assert result["status"] == "pass"
        search.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_should_return_unspecified_when_quote_names_no_version(self, db_down):
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "整体架构采用微服务。", "2025.01"
            )

        assert result["status"] == "unspecified"
        search.assert_not_awaited()


class TestEraScanBoundaries:
    """_era_violations word-boundary and guard behaviour, exercised through
    both prescreen entry points (sync prescreen_quote, async
    prescreen_point_anchors)."""

    def test_should_flag_capitalized_chatgpt_in_prescreen_quote(self):
        # CamelCase mention hits the lowercase "chatgpt" era key: the scan
        # lowercases the quote before matching.
        result = pipeline.prescreen_quote("引入 ChatGPT 做智能客服。", "2022.06")

        assert result["status"] == "fail"
        assert "chatgpt" in result["message"]
        assert "2022.11" in result["message"]

    def test_should_not_flag_gpt_4o_as_bare_gpt_4(self):
        # "GPT-4o" must not hit the "gpt-4" era key: the trailing "o" breaks
        # the word boundary — no false era fail on a later model's name.
        result = pipeline.prescreen_quote("对话模块使用 GPT-4o 提升体验。", "2023.01")
        assert result["status"] != "fail"
        assert "gpt-4" not in result["message"]

        # bare "GPT-4" (era key 2023.03) with an earlier start still fails,
        # proving the boundary is what separates the two spellings.
        bare = pipeline.prescreen_quote("对话模块使用 GPT-4 提升体验。", "2023.01")
        assert bare["status"] == "fail"
        assert "gpt-4" in bare["message"]

    def test_should_not_raise_or_flag_when_period_start_is_not_a_month(self):
        result = pipeline.prescreen_quote("引入 ChatGPT 做智能问答。", "")
        assert result["status"] == "unspecified"

        # version pairs without a usable period stay "unknown", never a fail
        assert (
            pipeline.prescreen_quote("缓存采用 Redis 7.0。", "")["status"] == "unknown"
        )

    @pytest.mark.asyncio
    async def test_should_stay_quiet_when_period_start_is_not_a_month(self, db_down):
        query, _ = db_down
        with patch(WEB_SEARCH, new_callable=AsyncMock) as search:
            result = await pipeline.prescreen_point_anchors(
                "引入 ChatGPT 做智能问答。", ""
            )

        assert result["status"] == "unspecified"
        query.assert_not_awaited()
        search.assert_not_awaited()

    def test_should_not_duplicate_era_message_for_concatenated_qwen2_5(self):
        # "qwen2.5" (no space) still extracts the (qwen, 2.5) pair, so the
        # skip set keeps the bare-name scan from reporting the tech twice.
        result = pipeline.prescreen_quote("模型服务基于qwen2.5构建。", "2022.06")

        assert result["status"] == "fail"
        era_messages = [m for m in result["message"].split("; ") if "时代专属" in m]
        assert len(era_messages) == 1


class TestCleanupDirtyRecords:
    @pytest.mark.asyncio
    async def test_should_identify_dirty_records_in_dry_run(self):
        from open_notebook.domain.ga_anchor_cache import GaAnchorCache

        records = [
            GaAnchorCache(
                id="ga_anchor_cache:1", tech="siteId", version="1.0", ga="2024.01"
            ),
            GaAnchorCache(
                id="ga_anchor_cache:2", tech="flink", version="1.18", ga="bad-ga"
            ),
            GaAnchorCache(
                id="ga_anchor_cache:3", tech="flink", version="1.18", ga="2023.11"
            ),
        ]

        with patch.object(
            GaAnchorCache, "get_all", new_callable=AsyncMock, return_value=records
        ):
            result = await GaAnchorCache.cleanup_dirty_records(apply=False)

        assert result["scanned"] == 3
        assert result["dirty_count"] == 2
        assert result["deleted_count"] == 0
        assert result["applied"] is False
        reasons = [r["reason"] for r in result["dirty_records"]]
        assert any("invalid tech name" in r for r in reasons)
        assert any("invalid ga month format" in r for r in reasons)

    @pytest.mark.asyncio
    async def test_should_delete_dirty_records_when_apply_is_true(self):
        from open_notebook.domain.ga_anchor_cache import GaAnchorCache

        dirty_record = GaAnchorCache(
            id="ga_anchor_cache:1", tech="districtCode", version="2.0", ga="2024.01"
        )
        clean_record = GaAnchorCache(
            id="ga_anchor_cache:2", tech="redis", version="7.0", ga="2022.05"
        )

        with (
            patch.object(
                GaAnchorCache,
                "get_all",
                new_callable=AsyncMock,
                return_value=[dirty_record, clean_record],
            ),
            patch.object(
                GaAnchorCache, "delete", new_callable=AsyncMock, return_value=True
            ) as mock_delete,
        ):
            result = await GaAnchorCache.cleanup_dirty_records(apply=True)

        assert result["scanned"] == 2
        assert result["dirty_count"] == 1
        assert result["deleted_count"] == 1
        assert result["applied"] is True
        mock_delete.assert_awaited_once()
