from fastapi import APIRouter, HTTPException
from loguru import logger

from api.models import SourceSectionAnalysisRequest, SourceSectionAnalysisResponse
from api.source_analysis_service import analyze_source_section
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()


@router.post(
    "/sources/{source_id}/sections/analyze",
    response_model=SourceSectionAnalysisResponse,
)
async def analyze_source_section_endpoint(
    source_id: str, request: SourceSectionAnalysisRequest
) -> SourceSectionAnalysisResponse:
    """Analyze one document section with the transformation model.

    Synchronous by design (user clicked "analyze" and waits for the answer).
    OpenNotebookError subclasses reach the global handlers (NotFoundError →
    404, ConfigurationError → 422, ExternalServiceError → 502); anything else
    is a generic 500.
    """
    try:
        result = await analyze_source_section(
            source_id=source_id,
            section_title=request.section_title,
            section_text=request.section_text,
            page_start=request.page_start,
            page_end=request.page_end,
            locale=request.locale,
        )
        return SourceSectionAnalysisResponse(**result)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Error analyzing section of source {source_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to analyze section")
