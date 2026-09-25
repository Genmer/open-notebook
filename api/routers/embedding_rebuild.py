from typing import Dict

from fastapi import APIRouter, HTTPException
from loguru import logger
from surreal_commands import get_command_status

from api.command_service import CommandService
from api.models import (
    EmbeddingStatusSummary,
    RebuildProgress,
    RebuildRequest,
    RebuildResponse,
    RebuildStats,
    RebuildStatusResponse,
)
from open_notebook.database.repository import repo_query
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()

# Group-by normalization buckets; anything unlisted (incl. NULL) is not_embedded.
_KNOWN_STATUS_COUNTS = ("completed", "queued", "running", "failed", "partial")


@router.get("/status", response_model=EmbeddingStatusSummary)
async def get_embedding_status():
    """Per-status source counts for the 'embed all pending' panel."""
    try:
        # Aliasing the grouped field breaks GROUP BY here (returns one bogus
        # bucket) - group by the raw field name and read that key back.
        rows = await repo_query(
            """
            SELECT embedding_status, count() AS c FROM source
            WHERE full_text != NONE AND string::trim(full_text) != ''
            GROUP BY embedding_status
            """
        )
        counts: Dict[str, int] = {key: 0 for key in _KNOWN_STATUS_COUNTS}
        counts["not_embedded"] = 0
        for row in rows or []:
            status = row.get("embedding_status", row.get("s"))
            n = int(row.get("c") or 0)
            if status in counts:
                counts[status] += n
            else:
                # NULL / unknown values mean "never embedded"
                counts["not_embedded"] += n

        pending = counts["not_embedded"] + counts["failed"] + counts["partial"]
        return EmbeddingStatusSummary(
            total_sources=sum(counts.values()),
            completed=counts["completed"],
            queued=counts["queued"],
            running=counts["running"],
            failed=counts["failed"],
            partial=counts["partial"],
            not_embedded=counts["not_embedded"],
            pending=pending,
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to get embedding status: {e}")
        logger.exception(e)
        raise HTTPException(
            status_code=500, detail=f"Failed to get embedding status: {str(e)}"
        )


@router.post("/rebuild", response_model=RebuildResponse)
async def start_rebuild(request: RebuildRequest):
    """
    Start a background job to rebuild embeddings.

    - **mode**: "existing" (re-embed items with embeddings), "all" (embed everything)
      or "missing" (sources-only: embed sources without a completed embedding;
      include flags are ignored for notes/insights)
    - **include_sources**: Include sources in rebuild (default: true)
    - **include_notes**: Include notes in rebuild (default: true)
    - **include_insights**: Include insights in rebuild (default: true)

    Returns command ID to track progress and estimated item count.
    """
    include_notes = request.include_notes
    include_insights = request.include_insights
    if request.mode == "missing":
        # missing mode is sources-only; contradicting flags are silently dropped.
        include_notes = False
        include_insights = False

    try:
        logger.info(f"Starting rebuild request: mode={request.mode}")

        # Import commands to ensure they're registered
        import commands.embedding_commands  # noqa: F401

        # Estimate total items (quick count query)
        # This is a rough estimate before the command runs
        total_estimate = 0

        if request.include_sources:
            if request.mode == "existing":
                # Count sources with embeddings
                result = await repo_query(
                    """
                    SELECT VALUE count(array::distinct(
                        SELECT VALUE source.id
                        FROM source_embedding
                        WHERE embedding != none AND array::len(embedding) > 0
                    )) as count FROM {}
                    """
                )
            elif request.mode == "missing":
                result = await repo_query(
                    """
                    SELECT VALUE count() FROM source
                    WHERE full_text != NONE AND string::trim(full_text) != ''
                    AND (embedding_status IS NONE OR embedding_status IN ['not_embedded', 'failed', 'partial'])
                    GROUP ALL
                    """
                )
            else:
                # Count all sources with content
                result = await repo_query(
                    "SELECT VALUE count() as count FROM source WHERE full_text != none GROUP ALL"
                )

            if result and isinstance(result[0], dict):
                total_estimate += result[0].get("count", 0)
            elif result:
                total_estimate += result[0] if isinstance(result[0], int) else 0

        if include_notes:
            if request.mode == "existing":
                result = await repo_query(
                    "SELECT VALUE count() as count FROM note WHERE embedding != none AND array::len(embedding) > 0 GROUP ALL"
                )
            else:
                result = await repo_query(
                    "SELECT VALUE count() as count FROM note WHERE content != none GROUP ALL"
                )

            if result and isinstance(result[0], dict):
                total_estimate += result[0].get("count", 0)
            elif result:
                total_estimate += result[0] if isinstance(result[0], int) else 0

        if include_insights:
            if request.mode == "existing":
                result = await repo_query(
                    "SELECT VALUE count() as count FROM source_insight WHERE embedding != none AND array::len(embedding) > 0 GROUP ALL"
                )
            else:
                result = await repo_query(
                    "SELECT VALUE count() as count FROM source_insight GROUP ALL"
                )

            if result and isinstance(result[0], dict):
                total_estimate += result[0].get("count", 0)
            elif result:
                total_estimate += result[0] if isinstance(result[0], int) else 0

        logger.info(f"Estimated {total_estimate} items to process")

        # Submit command
        command_id = await CommandService.submit_command_job(
            "open_notebook",
            "rebuild_embeddings",
            {
                "mode": request.mode,
                "include_sources": request.include_sources,
                "include_notes": include_notes,
                "include_insights": include_insights,
            },
        )

        logger.info(f"Submitted rebuild command: {command_id}")

        return RebuildResponse(
            command_id=command_id,
            total_items=total_estimate,
            message=f"Rebuild operation started. Estimated {total_estimate} items to process.",
        )

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to start rebuild: {e}")
        logger.exception(e)
        raise HTTPException(
            status_code=500, detail=f"Failed to start rebuild operation: {str(e)}"
        )


@router.get("/rebuild/{command_id}/status", response_model=RebuildStatusResponse)
async def get_rebuild_status(command_id: str):
    """
    Get the status of a rebuild operation.

    Returns:
    - **status**: queued, running, completed, failed
    - **progress**: processed count, total count, percentage
    - **stats**: breakdown by type (sources, notes, insights, failed)
    - **timestamps**: started_at, completed_at
    """
    try:
        # Get command status from surreal_commands
        status = await get_command_status(command_id)

        if not status:
            raise HTTPException(status_code=404, detail="Rebuild command not found")

        # Build response based on status
        response = RebuildStatusResponse(
            command_id=command_id,
            status=status.status,
        )

        # Extract metadata from command result
        if status.result and isinstance(status.result, dict):
            result = status.result

            # Build progress info
            if "total_items" in result and "jobs_submitted" in result:
                total = result["total_items"]
                submitted = result["jobs_submitted"]
                response.progress = RebuildProgress(
                    processed=submitted,
                    total=total,
                    percentage=round((submitted / total * 100) if total > 0 else 0, 2),
                )

            # Build stats
            response.stats = RebuildStats(
                sources=result.get("sources_submitted", 0),
                notes=result.get("notes_submitted", 0),
                insights=result.get("insights_submitted", 0),
                failed=result.get("failed_submissions", 0),
            )

        # Add timestamps
        if hasattr(status, "created") and status.created:
            response.started_at = str(status.created)
        if hasattr(status, "updated") and status.updated:
            response.completed_at = str(status.updated)

        # Add error message if failed
        if (
            status.status == "failed"
            and status.result
            and isinstance(status.result, dict)
        ):
            response.error_message = status.result.get("error_message", "Unknown error")

        return response

    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to get rebuild status: {e}")
        logger.exception(e)
        raise HTTPException(
            status_code=500, detail=f"Failed to get rebuild status: {str(e)}"
        )
