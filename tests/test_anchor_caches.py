"""Acceptance tests for T2: migration 42 cache tables + domain-model lookups.

Two behaviors guarded here:
1. migration 42 defines ga_anchor_cache (unique tech+version) and
   ruankao_concept_cache (unique name), and both up/down files are registered
   in the migration manager;
2. GaAnchorCache.lookup / RuankaoConceptCache.lookup_many degrade to
   None / {} on any DB failure so a cache outage falls through to the web
   lookup instead of failing the verification run.
"""

from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from open_notebook.domain.ga_anchor_cache import GaAnchorCache
from open_notebook.domain.ruankao_concept_cache import RuankaoConceptCache

MIGRATIONS_DIR = (
    Path(__file__).parent.parent / "open_notebook" / "database" / "migrations"
)
ASYNC_MIGRATE = (
    Path(__file__).parent.parent / "open_notebook" / "database" / "async_migrate.py"
)

REPO_QUERY = "open_notebook.database.repository.repo_query"


# --- migration 42 text (no database needed) ---


class TestMigration42DefinesCacheTables:
    def test_ga_anchor_cache_has_unique_tech_version_index(self):
        sql = (MIGRATIONS_DIR / "42.surrealql").read_text()
        assert "DEFINE TABLE IF NOT EXISTS ga_anchor_cache" in sql
        assert "ON TABLE ga_anchor_cache TYPE string" in sql
        assert (
            "DEFINE INDEX IF NOT EXISTS idx_gac_tech_version "
            "ON TABLE ga_anchor_cache COLUMNS tech, version UNIQUE" in sql
        )

    def test_ruankao_concept_cache_has_unique_name_index(self):
        sql = (MIGRATIONS_DIR / "42.surrealql").read_text()
        assert "DEFINE TABLE IF NOT EXISTS ruankao_concept_cache" in sql
        assert "ON TABLE ruankao_concept_cache TYPE string" in sql
        assert (
            "DEFINE INDEX IF NOT EXISTS idx_rcc_name "
            "ON TABLE ruankao_concept_cache COLUMNS name UNIQUE" in sql
        )

    def test_migration_files_registered_in_manager(self):
        content = ASYNC_MIGRATE.read_text()
        assert "migrations/42.surrealql" in content
        assert "migrations/42_down.surrealql" in content


# --- GaAnchorCache.lookup ---


class TestGaAnchorCacheLookup:
    @pytest.mark.asyncio
    async def test_should_return_row_when_exact_tech_version_hit(self):
        row = {
            "tech": "flink",
            "version": "1.18",
            "ga": "2023.11",
            "source": "web:https://flink.example",
            "confidence": "web",
            "detail": None,
        }
        with patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]) as query:
            found = await GaAnchorCache.lookup("flink", "1.18")

        assert found is not None
        assert found.ga == "2023.11"
        assert found.source == "web:https://flink.example"
        assert query.await_args.args[1] == {"tech": "flink", "version": "1.18"}

    @pytest.mark.asyncio
    async def test_should_normalize_tech_key_and_version_before_query(self):
        row = {"tech": "flink", "version": "1.18", "ga": "2023.11"}
        with patch(REPO_QUERY, new_callable=AsyncMock, return_value=[row]) as query:
            found = await GaAnchorCache.lookup("  Flink ", " 1.18 ")

        assert found is not None
        assert query.await_args.args[1] == {"tech": "flink", "version": "1.18"}

    @pytest.mark.asyncio
    async def test_should_return_none_when_no_row(self):
        with patch(REPO_QUERY, new_callable=AsyncMock, return_value=[]):
            assert await GaAnchorCache.lookup("flink", "1.18") is None

    @pytest.mark.asyncio
    async def test_should_return_none_when_db_query_raises(self):
        with patch(
            REPO_QUERY, new_callable=AsyncMock, side_effect=RuntimeError("db down")
        ):
            assert await GaAnchorCache.lookup("flink", "1.18") is None

    @pytest.mark.asyncio
    async def test_should_return_none_when_row_shape_is_invalid(self):
        # missing required `ga`: a corrupt row must not break the lookup
        with patch(
            REPO_QUERY,
            new_callable=AsyncMock,
            return_value=[{"tech": "flink", "version": "1.18"}],
        ):
            assert await GaAnchorCache.lookup("flink", "1.18") is None

    @pytest.mark.asyncio
    async def test_should_return_none_without_query_when_key_or_version_blank(self):
        with patch(REPO_QUERY, new_callable=AsyncMock) as query:
            assert await GaAnchorCache.lookup("", "1.18") is None
            assert await GaAnchorCache.lookup("flink", "  ") is None
        query.assert_not_awaited()


# --- RuankaoConceptCache.lookup_many ---


class TestRuankaoConceptCacheLookupMany:
    @pytest.mark.asyncio
    async def test_should_return_name_to_row_mapping_when_rows_found(self):
        rows = [
            {"name": "微服务架构", "definition": "定义文本", "key_points": ["要点一"]},
            {"name": "负载均衡", "definition": "分流", "key_points": []},
        ]
        with patch(REPO_QUERY, new_callable=AsyncMock, return_value=rows) as query:
            found = await RuankaoConceptCache.lookup_many(["微服务架构", "负载均衡"])

        assert set(found) == {"微服务架构", "负载均衡"}
        assert found["微服务架构"]["definition"] == "定义文本"
        assert query.await_args.args[1] == {"names": ["微服务架构", "负载均衡"]}

    @pytest.mark.asyncio
    async def test_should_return_empty_dict_when_no_row(self):
        with patch(REPO_QUERY, new_callable=AsyncMock, return_value=[]):
            assert await RuankaoConceptCache.lookup_many(["微服务架构"]) == {}

    @pytest.mark.asyncio
    async def test_should_return_empty_dict_when_db_query_raises(self):
        with patch(
            REPO_QUERY, new_callable=AsyncMock, side_effect=RuntimeError("db down")
        ):
            assert await RuankaoConceptCache.lookup_many(["微服务架构"]) == {}

    @pytest.mark.asyncio
    async def test_should_return_empty_dict_without_query_when_names_blank(self):
        with patch(REPO_QUERY, new_callable=AsyncMock) as query:
            assert await RuankaoConceptCache.lookup_many([]) == {}
            assert await RuankaoConceptCache.lookup_many(["", "  "]) == {}
        query.assert_not_awaited()
