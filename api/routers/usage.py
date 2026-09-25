from typing import Optional

from fastapi import APIRouter, Query

from api.models import (
    UsageClearResponse,
    UsageRecordsResponse,
    UsageSummaryResponse,
)
from api.usage_service import clear_usage_records, get_usage_summary, list_usage_records
from open_notebook.exceptions import InvalidInputError

router = APIRouter()


@router.get("/usage/summary", response_model=UsageSummaryResponse)
async def usage_summary(
    days: int = Query(30, ge=1, le=365),
    call_type: Optional[str] = None,
    tz_offset: int = Query(0, ge=-1440, le=1440),
):
    """Aggregate token usage over the last N days (empty DB returns zeros).

    tz_offset is the requester's UTC offset in minutes with JS sign
    (UTC+8 -> 480): day buckets and the window boundary follow local midnight.
    """
    return await get_usage_summary(
        days=days, call_type=call_type or None, tz_offset=tz_offset
    )


@router.get("/usage/records", response_model=UsageRecordsResponse)
async def usage_records(
    limit: int = Query(100),
    offset: int = Query(0, ge=0),
    call_type: Optional[str] = None,
):
    """Recent usage rows, newest first."""
    if not 1 <= limit <= 500:
        raise InvalidInputError("limit must be between 1 and 500")
    records, total = await list_usage_records(
        limit=limit, offset=offset, call_type=call_type or None
    )
    return UsageRecordsResponse(records=records, total=total)


@router.delete("/usage/records", response_model=UsageClearResponse)
async def clear_usage():
    """Delete every usage row (privacy: the data is local-only anyway)."""
    deleted = await clear_usage_records()
    return UsageClearResponse(deleted=deleted)
