from fastapi import APIRouter, HTTPException
from loguru import logger

from api.command_service import CommandService
from api.models import SourceSectionAnalysisRequest, SourceSectionAnalysisSubmitResponse
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()


@router.post(
    "/sources/{source_id}/sections/analyze",
    response_model=SourceSectionAnalysisSubmitResponse,
)
async def analyze_source_section_endpoint(
    source_id: str, request: SourceSectionAnalysisRequest
) -> SourceSectionAnalysisSubmitResponse:
    """Submit one section-analysis job and return immediately.

    The analysis runs as the `analyze_source_section` command: the model
    output streams into a live progress record (Task Center inspector), and
    the final markdown lands in the job result — poll GET /commands/jobs/{id}
    for status, error_message and result. OpenNotebookError subclasses reach
    the global handlers; anything else is a generic 500.
    """
    try:
        # Registry import so submit_command can validate the command name
        # (same pattern as api/routers/sources.py).
        import commands.source_commands  # noqa: F401

        job_id = await CommandService.submit_command_job(
            "open_notebook",
            "analyze_source_section",
            {
                "source_id": source_id,
                "section_title": request.section_title,
                "section_text": request.section_text,
                "page_start": request.page_start,
                "page_end": request.page_end,
                "locale": request.locale,
            },
        )
        return SourceSectionAnalysisSubmitResponse(job_id=job_id, status="submitted")
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error submitting section analysis for source {source_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to submit section analysis")
