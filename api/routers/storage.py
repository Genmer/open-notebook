"""Storage usage endpoint (/api/storage/*) backing the Storage settings page."""

from fastapi import APIRouter

from api.models import StorageSummaryResponse
from api.storage_service import collect_storage_summary

router = APIRouter()


@router.get("/storage/summary", response_model=StorageSummaryResponse)
async def storage_summary():
    """Estimated database sizes plus real on-disk usage and an export-size estimate."""
    return StorageSummaryResponse(**await collect_storage_summary())
