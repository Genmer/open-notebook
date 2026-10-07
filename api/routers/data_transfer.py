"""Data export/import endpoints (/api/data-transfer/*)."""

import asyncio
import os
from typing import List, Optional

from fastapi import APIRouter, Body, File, Header, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from loguru import logger

import api.data_transfer_service as data_transfer_service
from api.models import (
    ChunkCompleteRequest,
    ChunkSessionCreateRequest,
    ChunkSessionResponse,
    ChunkUploadResponse,
    DataTransferStartResponse,
    ExportEstimateResponse,
    ExportStartRequest,
    ExportStatusResponse,
    ImportExecuteRequest,
    ImportScanResponse,
    ImportStatusResponse,
    PackageDeleteResponse,
)
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()


@router.post("/data-transfer/export", response_model=DataTransferStartResponse)
async def start_export(request: Optional[ExportStartRequest] = None):
    """Queue an export job; scope=models packages only the model configuration.

    scope=notebooks with notebook_ids exports a topic package restricted to
    those notebooks (.onbook-style subset of the full export).
    """
    payload = request or ExportStartRequest()
    try:
        command_id = await data_transfer_service.start_export(
            payload.scope, payload.include_models, payload.notebook_ids
        )
        return DataTransferStartResponse(
            command_id=command_id,
            message="Export started. Poll /data-transfer/export/status for progress.",
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to start data export: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to start export: {e}")


@router.get("/data-transfer/export/estimate", response_model=ExportEstimateResponse)
async def estimate_export(
    scope: str = Query("full", pattern="^(full|notebooks)$"),
    notebook_ids: Optional[List[str]] = Query(None),
):
    """Preview what an export would contain (counts, asset bytes, ~package size)."""
    try:
        return ExportEstimateResponse(
            **await data_transfer_service.estimate_export(scope, notebook_ids)
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to estimate data export: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to estimate export: {e}")


@router.get("/data-transfer/export/status", response_model=ExportStatusResponse)
async def get_export_status():
    try:
        return ExportStatusResponse(
            **await data_transfer_service.get_transfer_status("export")
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to get export status: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to get export status: {e}")


@router.get("/data-transfer/export/download")
async def download_export_package():
    """Download the most recent export package (404 once deleted)."""
    try:
        status = await data_transfer_service.get_transfer_status("export")
    except Exception as e:
        logger.error(f"Failed to read export state for download: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail="Failed to locate export package")
    summary = status.get("summary") or {}
    path = summary.get("package_path")
    filename = summary.get("package_filename") or "open_notebook_export.zip"
    if not path or not os.path.isfile(path):
        raise HTTPException(
            status_code=404, detail="No export package available (export first)"
        )
    return FileResponse(path, media_type="application/zip", filename=filename)


@router.delete("/data-transfer/export/package", response_model=PackageDeleteResponse)
async def delete_export_package():
    """Delete the export package from disk and reset the export state."""
    try:
        deleted = await data_transfer_service.delete_export_package()
        return PackageDeleteResponse(deleted=deleted)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete export package: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to delete package: {e}")


@router.post("/data-transfer/import", response_model=ImportScanResponse)
async def upload_import_package(file: UploadFile = File(...)):
    """Upload a package zip and scan its model configuration for conflicts.

    The request body is capped by the 1 GB upload middleware by default (see
    tests/test_max_body_size_middleware.py); oversized uploads get a 413 there.
    Returns the scan result; POST /data-transfer/import/execute starts the job.
    """
    try:
        path = await data_transfer_service.save_import_upload(file)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to save import upload: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to save upload: {e}")
    try:
        return await data_transfer_service.scan_import_package(path)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to scan import package: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to scan package: {e}")


@router.post("/data-transfer/import/chunk-session", response_model=ChunkSessionResponse)
async def create_chunk_session(request: ChunkSessionCreateRequest):
    """Start (or resume) a chunked upload; same client_key resumes in place."""
    try:
        meta = await asyncio.to_thread(
            data_transfer_service.create_chunk_session,
            request.filename,
            request.total_size,
            request.chunk_size,
            request.total_chunks,
            request.client_key,
        )
        return ChunkSessionResponse(
            upload_id=meta["upload_id"],
            filename=meta["filename"],
            total_size=meta["total_size"],
            chunk_size=meta["chunk_size"],
            total_chunks=meta["total_chunks"],
            uploaded_chunks=meta.get("uploaded_chunks", []),
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to create chunk session: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to create session: {e}")


@router.get(
    "/data-transfer/import/chunk-session/{upload_id}",
    response_model=ChunkSessionResponse,
)
async def get_chunk_session(upload_id: str):
    try:
        meta = await asyncio.to_thread(
            data_transfer_service._read_chunk_session, upload_id
        )
        return ChunkSessionResponse(
            upload_id=meta["upload_id"],
            filename=meta["filename"],
            total_size=meta["total_size"],
            chunk_size=meta["chunk_size"],
            total_chunks=meta["total_chunks"],
            uploaded_chunks=meta.get("uploaded_chunks", []),
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to read chunk session: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to read session: {e}")


@router.delete("/data-transfer/import/chunk-session/{upload_id}")
async def delete_chunk_session(upload_id: str):
    try:
        deleted = await asyncio.to_thread(
            data_transfer_service.delete_chunk_session, upload_id
        )
        return {"deleted": deleted}
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to delete chunk session: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to delete session: {e}")


@router.put(
    "/data-transfer/import/chunk-session/{upload_id}/chunks/{index}",
    response_model=ChunkUploadResponse,
)
async def upload_import_chunk(
    upload_id: str,
    index: int,
    data: bytes = Body(..., media_type="application/octet-stream"),
    x_chunk_sha256: Optional[str] = Header(None),
):
    """Upload one chunk (idempotent overwrite); integrity checked when the
    X-Chunk-Sha256 header is provided."""
    try:
        result = await asyncio.to_thread(
            data_transfer_service.save_import_chunk,
            upload_id,
            index,
            data,
            x_chunk_sha256,
        )
        return ChunkUploadResponse(**result)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to save chunk {index}: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to save chunk: {e}")


@router.post(
    "/data-transfer/import/chunk-session/{upload_id}/complete",
    response_model=ImportScanResponse,
)
async def complete_chunk_session(upload_id: str, request: ChunkCompleteRequest):
    """Merge all chunks into the pending slot, scan it, drop the session."""
    try:
        return await data_transfer_service.complete_chunk_session(
            upload_id, request.sha256
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to complete chunk session: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to complete upload: {e}")


@router.post("/data-transfer/import/execute", response_model=DataTransferStartResponse)
async def execute_import(request: ImportExecuteRequest):
    """Start the import job for a previously scanned package."""
    try:
        command_id = await data_transfer_service.execute_import(request)
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to start data import: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to start import: {e}")
    return DataTransferStartResponse(
        command_id=command_id,
        message="Import started. Poll /data-transfer/import/status for progress.",
    )


@router.get("/data-transfer/import/status", response_model=ImportStatusResponse)
async def get_import_status():
    try:
        return ImportStatusResponse(
            **await data_transfer_service.get_transfer_status("import")
        )
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(f"Failed to get import status: {e}")
        logger.exception(e)
        raise HTTPException(status_code=500, detail=f"Failed to get import status: {e}")
