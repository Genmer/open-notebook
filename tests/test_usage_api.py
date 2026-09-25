"""
Unit tests for the usage API (api/routers/usage.py + api/usage_service.py).

repo_query is faked with seeded rows so aggregation assembly, paging, clearing,
tz-aware day bucketing, previous-window totals and estimated-token rollups can
be verified without SurrealDB (the SurrealQL itself is probe-verified).
"""

from datetime import datetime, time, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

# repo_query call order inside get_usage_summary
Q_TOTALS, Q_BY_MODEL, Q_BY_DAY, Q_PIVOT, Q_PREVIOUS, Q_EST_MODEL, Q_EST_TOTALS = range(7)


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


def _seed_row(i: int, *, input_tokens=None, call_type="chat", model="gpt", day="2026-09-20"):
    return {
        "id": f"model_usage:row{i}",
        "created": f"2026-09-20T10:0{i}:00Z",
        "day": day,
        "model_name": model,
        "provider": "openai",
        "model_id": None,
        "call_type": call_type,
        "correlation_id": None,
        "input_tokens": input_tokens,
        "output_tokens": 5,
        "total_tokens": None if input_tokens is None else input_tokens + 5,
        "is_estimated": False,
        "success": True,
        "error": None,
    }


def _empty_repo(*extra):
    return AsyncMock(side_effect=[[], [], [], [], [], [], []])


class TestUsageSummary:
    def test_empty_db_returns_zeroed_summary(self, client):
        with patch("api.usage_service.repo_query", new=_empty_repo()):
            response = client.get("/api/usage/summary")
        assert response.status_code == 200
        body = response.json()
        assert body["totals"] == {
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "estimated_tokens": 0,
        }
        assert body["previous_totals"] == {
            "calls": 0,
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0,
            "estimated_tokens": 0,
        }
        assert body["by_model"] == []
        assert body["by_day"] == []
        assert body["daily_by_model"] == []

    def test_seed_rows_aggregate_with_null_tokens_as_zero(self, client):
        totals = {"calls": 3, "input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
        # Row without any token data: the `?? 0` coalescing maps it to 0.
        by_model = [
            {
                "model_name": "gpt",
                "provider": "openai",
                "calls": 2,
                "input_tokens": 100,
                "output_tokens": 50,
                "total_tokens": 150,
            },
            {
                "model_name": None,
                "provider": None,
                "calls": 1,
                "input_tokens": None,
                "output_tokens": None,
                "total_tokens": None,
            },
        ]
        by_day = [{"day": "2026-09-20", "calls": 3, "input_tokens": 100, "output_tokens": 50, "total_tokens": 150}]
        repo = AsyncMock(
            side_effect=[[totals], by_model, by_day, [], [], [], []]
        )

        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/summary?days=7")
        assert response.status_code == 200
        body = response.json()
        assert body["totals"]["calls"] == 3
        assert body["by_model"][0]["model_name"] == "gpt"
        assert body["by_model"][1]["input_tokens"] == 0  # null coalesced
        assert body["by_day"][0]["day"] == "2026-09-20"
        assert body["daily_by_model"] == []
        # No estimated rows matched -> zeroed everywhere it is reported.
        assert body["totals"]["estimated_tokens"] == 0
        assert body["by_model"][0]["estimated_tokens"] == 0

        # The window threshold is a UTC datetime bound instead of the old day string.
        vars_used = repo.await_args_list[Q_TOTALS].args[1]
        from_ts = vars_used["from_ts"]
        assert isinstance(from_ts, datetime)
        assert from_ts.time() == time(0)
        assert "WHERE created >= $from_ts" in repo.await_args_list[Q_TOTALS].args[0]

    def test_daily_by_model_pivot_across_models_and_days(self, client):
        totals = {"calls": 3, "input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
        by_model = [
            {"model_name": "gpt", "provider": "openai", "calls": 2, "input_tokens": 90, "output_tokens": 45, "total_tokens": 90},
            {"model_name": "claude", "provider": "anthropic", "calls": 1, "input_tokens": 10, "output_tokens": 5, "total_tokens": 60},
        ]
        by_day = [
            {"day": "2026-09-19", "calls": 1, "input_tokens": 40, "output_tokens": 20, "total_tokens": 40},
            {"day": "2026-09-20", "calls": 2, "input_tokens": 60, "output_tokens": 30, "total_tokens": 110},
        ]
        daily_by_model = [
            {"day": "2026-09-19", "model_name": "gpt", "total_tokens": 40},
            {"day": "2026-09-19", "model_name": None, "total_tokens": None},
            {"day": "2026-09-20", "model_name": "claude", "total_tokens": 60},
            {"day": "2026-09-20", "model_name": "gpt", "total_tokens": 50},
        ]
        repo = AsyncMock(
            side_effect=[[totals], by_model, by_day, daily_by_model, [], [], []]
        )

        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/summary?days=7")
        assert response.status_code == 200
        body = response.json()
        # Rows keep their (day, model) identity; null tokens coalesce to 0.
        assert body["daily_by_model"] == [
            {"day": "2026-09-19", "model_name": "gpt", "total_tokens": 40},
            {"day": "2026-09-19", "model_name": None, "total_tokens": 0},
            {"day": "2026-09-20", "model_name": "claude", "total_tokens": 60},
            {"day": "2026-09-20", "model_name": "gpt", "total_tokens": 50},
        ]

        pivot_sql = repo.await_args_list[Q_PIVOT].args[0]
        assert "GROUP BY day, model_name" in pivot_sql
        assert "ORDER BY day ASC" in pivot_sql

    def test_call_type_filter_is_passed_through(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?call_type=embedding")
        for call in repo.await_args_list:
            assert call.args[1]["call_type"] == "embedding"
            assert "call_type = $call_type" in call.args[0]


class TestTzOffset:
    def test_boundary_values_accepted(self, client):
        for tz in (-1440, 1440):
            repo = _empty_repo()
            with patch("api.usage_service.repo_query", repo):
                response = client.get(f"/api/usage/summary?tz_offset={tz}")
            assert response.status_code == 200

    @pytest.mark.parametrize("tz", [-1441, 1441, "abc"])
    def test_out_of_range_rejected(self, client, tz):
        response = client.get(f"/api/usage/summary?tz_offset={tz}")
        assert response.status_code == 422

    def test_zero_offset_matches_legacy_utc_day_boundary(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?days=7")
        from_ts = repo.await_args_list[Q_TOTALS].args[1]["from_ts"]
        today = datetime.now(timezone.utc).date()
        assert from_ts == datetime.combine(
            today - timedelta(days=6), time(0), tzinfo=timezone.utc
        )
        by_day_sql = repo.await_args_list[Q_BY_DAY].args[0]
        assert 'time::format(created, "%Y-%m-%d")' in by_day_sql

    def test_positive_offset_shifts_bucket_expression(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?tz_offset=480")
        for idx in (Q_BY_DAY, Q_PIVOT):
            sql = repo.await_args_list[idx].args[0]
            assert 'time::format(created + 480m, "%Y-%m-%d")' in sql

    def test_negative_offset_uses_binary_minus(self, client):
        # SurrealQL rejects `+ -300m`; the generated SQL must use `created - 300m`.
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?tz_offset=-300")
        sql = repo.await_args_list[Q_BY_DAY].args[0]
        assert 'time::format(created - 300m, "%Y-%m-%d")' in sql

    def test_from_ts_is_local_midnight_in_utc(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?days=3&tz_offset=480")
        vars_used = repo.await_args_list[Q_TOTALS].args[1]
        from_ts = vars_used["from_ts"]
        local_midnight = from_ts + timedelta(minutes=480)
        assert local_midnight.time() == time(0)
        local_today = (datetime.now(timezone.utc) + timedelta(minutes=480)).date()
        # days=3 window opens at local midnight two local days back.
        assert local_midnight.date() == local_today - timedelta(days=2)

    def test_local_day_bucketing_pairs_window_with_expression(self, client):
        # Same-local-day guarantee: a row at UTC 23:30 and one at UTC 00:30 next
        # day land in one bucket only when window + format share the offset; the
        # SQL shape here is probe-verified against SurrealDB in-situ.
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?days=1&tz_offset=480")
        from_ts = repo.await_args_list[Q_BY_DAY].args[1]["from_ts"]
        by_day_sql = repo.await_args_list[Q_BY_DAY].args[0]
        assert 'time::format(created + 480m' in by_day_sql
        # Window boundary translated back from the same local midnight.
        assert from_ts + timedelta(minutes=480) == (
            datetime.now(timezone.utc) + timedelta(minutes=480)
        ).replace(hour=0, minute=0, second=0, microsecond=0)

    def test_tz_offset_combines_with_call_type(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/summary?tz_offset=480&call_type=chat")
        assert response.status_code == 200
        for call in repo.await_args_list:
            assert call.args[1]["call_type"] == "chat"
            # Previous-window query bounds on $prev_from, everything else on $from_ts.
            assert "created >= $from_ts" in call.args[0] or (
                "created >= $prev_from AND created < $from_ts" in call.args[0]
            )
        for idx in (Q_BY_DAY, Q_PIVOT):
            assert "created + 480m" in repo.await_args_list[idx].args[0]


class TestPreviousTotals:
    def test_previous_window_aggregates_exclusively(self, client):
        current = {"calls": 10, "input_tokens": 400, "output_tokens": 100, "total_tokens": 500}
        previous = {"calls": 4, "input_tokens": 150, "output_tokens": 50, "total_tokens": 200}
        repo = AsyncMock(
            side_effect=[[current], [], [], [], [previous], [], []]
        )

        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/summary?days=7")
        body = response.json()
        assert body["totals"]["total_tokens"] == 500
        assert body["previous_totals"] == {
            "calls": 4,
            "input_tokens": 150,
            "output_tokens": 50,
            "total_tokens": 200,
            "estimated_tokens": 0,
        }

        prev_sql = repo.await_args_list[Q_PREVIOUS].args[0]
        assert "created >= $prev_from AND created < $from_ts" in prev_sql
        vars_used = repo.await_args_list[Q_PREVIOUS].args[1]
        assert vars_used["prev_from"] == vars_used["from_ts"] - timedelta(days=7)

    def test_days_one_previous_window_is_yesterday_only(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?days=1")
        vars_used = repo.await_args_list[Q_PREVIOUS].args[1]
        assert vars_used["from_ts"] - vars_used["prev_from"] == timedelta(days=1)


class TestEstimatedTokens:
    def test_estimated_sums_merged_into_by_model_and_totals(self, client):
        totals = {"calls": 5, "input_tokens": 300, "output_tokens": 90, "total_tokens": 390}
        by_model = [
            {"model_name": "text-embedding-v4", "provider": "openai", "calls": 3, "input_tokens": 200, "output_tokens": 0, "total_tokens": 200},
            {"model_name": "gpt", "provider": "openai", "calls": 2, "input_tokens": 100, "output_tokens": 90, "total_tokens": 190},
        ]
        est_by_model = [
            {"model_name": "text-embedding-v4", "provider": "openai", "estimated_tokens": 200},
        ]
        est_totals = [{"estimated_tokens": 200}]
        repo = AsyncMock(
            side_effect=[[totals], by_model, [], [], [], est_by_model, est_totals]
        )

        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/summary")
        body = response.json()
        assert body["totals"]["estimated_tokens"] == 200
        rows = {r["model_name"]: r for r in body["by_model"]}
        assert rows["text-embedding-v4"]["estimated_tokens"] == 200
        # Non-estimated model reported with an explicit zero.
        assert rows["gpt"]["estimated_tokens"] == 0

        est_sql = repo.await_args_list[Q_EST_MODEL].args[0]
        assert "(is_estimated ?? false) = true" in est_sql
        assert "estimated_tokens" in est_sql

    def test_estimated_queries_share_window_and_call_type(self, client):
        repo = _empty_repo()
        with patch("api.usage_service.repo_query", repo):
            client.get("/api/usage/summary?call_type=embedding&tz_offset=480")
        for idx in (Q_EST_MODEL, Q_EST_TOTALS):
            call = repo.await_args_list[idx]
            assert "created >= $from_ts" in call.args[0]
            assert "(is_estimated ?? false) = true" in call.args[0]
            assert "call_type = $call_type" in call.args[0]


class TestUsageRecords:
    def test_records_paged_newest_first(self, client):
        rows = [_seed_row(1), _seed_row(2, input_tokens=10)]
        repo = AsyncMock(side_effect=[rows, [{"total": 2}]])
        with patch("api.usage_service.repo_query", repo):
            response = client.get("/api/usage/records?limit=2&offset=5")
        assert response.status_code == 200
        body = response.json()
        assert body["total"] == 2
        assert len(body["records"]) == 2
        assert body["records"][0]["id"] == "model_usage:row1"
        # Tokens may be null -> surfaced as null, the UI renders "-".
        assert body["records"][1]["input_tokens"] == 10
        assert body["records"][0]["input_tokens"] is None
        limit_query, total_query = repo.await_args_list
        assert limit_query.args[1] == {"limit": 2, "offset": 5}

    def test_limit_above_500_rejected(self, client):
        response = client.get("/api/usage/records?limit=501")
        assert response.status_code == 400

    def test_limit_zero_rejected(self, client):
        response = client.get("/api/usage/records?limit=0")
        assert response.status_code == 400


class TestUsageClear:
    def test_clear_returns_deleted_count(self, client):
        repo = AsyncMock(side_effect=[[{"total": 7}], []])
        with patch("api.usage_service.repo_query", repo):
            response = client.delete("/api/usage/records")
        assert response.status_code == 200
        assert response.json() == {"deleted": 7}
        assert "DELETE" in repo.await_args_list[1].args[0]

    def test_clear_on_empty_db_skips_delete(self, client):
        repo = AsyncMock(side_effect=[[]])
        with patch("api.usage_service.repo_query", repo):
            response = client.delete("/api/usage/records")
        assert response.json() == {"deleted": 0}
        assert repo.await_count == 1
