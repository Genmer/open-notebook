"""Aggregation and retrieval for the local model_usage table (privacy: local-only data)."""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from api.models import (
    UsageByDay,
    UsageByModel,
    UsageDayModel,
    UsageRecord,
    UsageSummaryResponse,
    UsageTotals,
)
from open_notebook.database.repository import repo_query

# Token columns may be missing on schemaless rows; coalesce to 0 before summing.
_TOKEN_SUMS = (
    "math::sum(input_tokens ?? 0) AS input_tokens, "
    "math::sum(output_tokens ?? 0) AS output_tokens, "
    "math::sum(total_tokens ?? 0) AS total_tokens"
)


def _from_ts(days: int, tz_offset: int) -> datetime:
    # Window opens at local midnight (tz_offset in minutes, JS sign: UTC+8 -> 480)
    # translated back to UTC, then rolled back days-1.
    local_now = datetime.now(timezone.utc) + timedelta(minutes=tz_offset)
    local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    return local_midnight - timedelta(minutes=tz_offset) - timedelta(days=days - 1)


def _local_day_expr(tz_offset: int) -> str:
    # SurrealQL rejects `+ -300m`; negative offsets need binary minus.
    if tz_offset > 0:
        return f"created + {tz_offset}m"
    if tz_offset < 0:
        return f"created - {-tz_offset}m"
    return "created"


def _day_filter(
    call_type: Optional[str],
    estimated_only: bool = False,
    previous: bool = False,
) -> str:
    clause = (
        "WHERE created >= $prev_from AND created < $from_ts"
        if previous
        else "WHERE created >= $from_ts"
    )
    if estimated_only:
        clause += " AND (is_estimated ?? false) = true"
    if call_type:
        clause += " AND call_type = $call_type"
    return clause


def _vars(
    from_ts: datetime, call_type: Optional[str], prev_from: datetime
) -> Dict[str, Any]:
    vars: Dict[str, Any] = {"from_ts": from_ts, "prev_from": prev_from}
    if call_type:
        vars["call_type"] = call_type
    return vars


def _totals(row: Optional[Dict[str, Any]]) -> UsageTotals:
    row = row or {}
    return UsageTotals(
        calls=row.get("calls") or 0,
        input_tokens=row.get("input_tokens") or 0,
        output_tokens=row.get("output_tokens") or 0,
        total_tokens=row.get("total_tokens") or 0,
    )


async def get_usage_summary(
    days: int = 30, call_type: Optional[str] = None, tz_offset: int = 0
) -> UsageSummaryResponse:
    from_ts = _from_ts(days, tz_offset)
    prev_from = from_ts - timedelta(days=days)
    vars = _vars(from_ts, call_type, prev_from)
    day_filter = _day_filter(call_type)
    local_day = (
        f'time::format({_local_day_expr(tz_offset)}, "%Y-%m-%d") AS day'
    )

    totals_rows = await repo_query(
        f"SELECT count() AS calls, {_TOKEN_SUMS} FROM model_usage {day_filter} GROUP ALL;",
        vars,
    )
    by_model_rows = await repo_query(
        f"""
        SELECT model_name, provider, count() AS calls, {_TOKEN_SUMS}
        FROM model_usage {day_filter} GROUP BY model_name, provider
        ORDER BY total_tokens DESC;
        """,
        vars,
    )
    # Local-day bucketing: SurrealDB can't GROUP BY the time::format expression
    # itself (parse error), so the aliased projection is the grouping idiom.
    by_day_rows = await repo_query(
        f"""
        SELECT {local_day}, count() AS calls, {_TOKEN_SUMS}
        FROM model_usage {day_filter} GROUP BY day ORDER BY day ASC;
        """,
        vars,
    )
    daily_by_model_rows = await repo_query(
        f"""
        SELECT {local_day}, model_name, math::sum(total_tokens ?? 0) AS total_tokens
        FROM model_usage {day_filter} GROUP BY day, model_name
        ORDER BY day ASC;
        """,
        vars,
    )
    previous_rows = await repo_query(
        f"""
        SELECT count() AS calls, {_TOKEN_SUMS}
        FROM model_usage {_day_filter(call_type, previous=True)}
        GROUP ALL;
        """,
        vars,
    )
    estimated_filter = _day_filter(call_type, estimated_only=True)
    estimated_by_model_rows = await repo_query(
        f"""
        SELECT model_name, provider, math::sum(total_tokens ?? 0) AS estimated_tokens
        FROM model_usage {estimated_filter} GROUP BY model_name, provider;
        """,
        vars,
    )
    estimated_totals_rows = await repo_query(
        f"""
        SELECT math::sum(total_tokens ?? 0) AS estimated_tokens
        FROM model_usage {estimated_filter} GROUP ALL;
        """,
        vars,
    )

    estimated_by_model = {
        (row.get("model_name"), row.get("provider")): row.get("estimated_tokens") or 0
        for row in estimated_by_model_rows
    }
    totals = _totals(totals_rows[0] if totals_rows else None)
    totals.estimated_tokens = (
        estimated_totals_rows[0].get("estimated_tokens") or 0
        if estimated_totals_rows
        else 0
    )

    by_model = sorted(
        (
            UsageByModel(
                model_name=row.get("model_name"),
                provider=row.get("provider"),
                calls=row.get("calls") or 0,
                input_tokens=row.get("input_tokens") or 0,
                output_tokens=row.get("output_tokens") or 0,
                total_tokens=row.get("total_tokens") or 0,
                estimated_tokens=estimated_by_model.get(
                    (row.get("model_name"), row.get("provider")), 0
                ),
            )
            for row in by_model_rows
        ),
        key=lambda m: (m.total_tokens, m.calls),
        reverse=True,
    )

    return UsageSummaryResponse(
        totals=totals,
        previous_totals=_totals(previous_rows[0] if previous_rows else None),
        by_model=by_model,
        by_day=[
            UsageByDay(
                day=row.get("day") or "",
                calls=row.get("calls") or 0,
                input_tokens=row.get("input_tokens") or 0,
                output_tokens=row.get("output_tokens") or 0,
                total_tokens=row.get("total_tokens") or 0,
            )
            for row in by_day_rows
        ],
        daily_by_model=[
            UsageDayModel(
                day=row.get("day") or "",
                model_name=row.get("model_name"),
                total_tokens=row.get("total_tokens") or 0,
            )
            for row in daily_by_model_rows
        ],
    )


def _to_record(row: Dict[str, Any]) -> UsageRecord:
    data = dict(row)
    data["id"] = str(data.pop("id", None)) if data.get("id") else None
    return UsageRecord(**data)


async def list_usage_records(
    limit: int = 100, offset: int = 0, call_type: Optional[str] = None
) -> tuple[List[UsageRecord], int]:
    vars: Dict[str, Any] = {"limit": limit, "offset": offset}
    where = "WHERE call_type = $call_type" if call_type else ""
    if call_type:
        vars["call_type"] = call_type

    rows = await repo_query(
        f"SELECT * FROM model_usage {where} ORDER BY created DESC LIMIT $limit START $offset;",
        vars,
    )
    total_rows = await repo_query(
        f"SELECT count() AS total FROM model_usage {where} GROUP ALL;",
        {"call_type": call_type} if call_type else None,
    )
    total = total_rows[0].get("total") or 0 if total_rows else 0
    return [_to_record(row) for row in rows], total


async def clear_usage_records() -> int:
    total_rows = await repo_query("SELECT count() AS total FROM model_usage GROUP ALL;")
    total = total_rows[0].get("total") or 0 if total_rows else 0
    if total:
        await repo_query("DELETE FROM model_usage;")
    return total
