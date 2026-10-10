"""Ruankao essay library mark endpoints (软考范文库标记).

Four endpoints under /api/ruankao/essay-marks: library listing, toggle, mark
listing (with per-source status) and manual dangling cleanup. The red-line
filter itself lives in open_notebook.domain.model_essay_mark — these
endpoints only manage the marks.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException
from loguru import logger

from api.models import (
    DanglingCleanupResponse,
    EssayMarksLibraryResponse,
    EssayMarksResponse,
    EssayMarkToggleRequest,
    EssayMarkToggleResponse,
)
from api.ruankao_essay_mark_service import (
    cleanup_dangling_marks,
    get_library,
    list_marks,
    toggle_mark,
)
from open_notebook.exceptions import InvalidInputError, OpenNotebookError

router = APIRouter()


@router.get("/ruankao/essay-marks/library", response_model=EssayMarksLibraryResponse)
async def read_essay_marks_library(view_id: str = "") -> EssayMarksLibraryResponse:
    try:
        data = await get_library(view_id)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.exception(f"Error building essay marks library: {e}")
        raise HTTPException(
            status_code=500, detail="Error building essay marks library"
        )
    return EssayMarksLibraryResponse(**data)


@router.post("/ruankao/essay-marks/toggle", response_model=EssayMarkToggleResponse)
async def toggle_essay_mark(request: EssayMarkToggleRequest) -> EssayMarkToggleResponse:
    try:
        result = await toggle_mark(request.target_type, request.target_id)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.exception(f"Error toggling essay mark: {e}")
        raise HTTPException(status_code=500, detail="Error toggling essay mark")
    return EssayMarkToggleResponse(**result)


@router.get("/ruankao/essay-marks", response_model=EssayMarksResponse)
async def read_essay_marks(source_id: Optional[str] = None) -> EssayMarksResponse:
    try:
        data = await list_marks(source_id)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.exception(f"Error listing essay marks: {e}")
        raise HTTPException(status_code=500, detail="Error listing essay marks")
    return EssayMarksResponse(**data)


@router.delete("/ruankao/essay-marks", response_model=DanglingCleanupResponse)
async def cleanup_essay_marks(dangling: bool = False) -> DanglingCleanupResponse:
    # dangling=true is the only supported mode: a bare DELETE must not become
    # an accidental "clear all marks".
    if not dangling:
        raise InvalidInputError("dangling=true is required for this endpoint")
    try:
        removed = await cleanup_dangling_marks()
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.exception(f"Error cleaning up dangling essay marks: {e}")
        raise HTTPException(
            status_code=500, detail="Error cleaning up dangling essay marks"
        )
    return DanglingCleanupResponse(removed=removed)
