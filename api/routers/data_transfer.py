"""Data export/import endpoints (/api/data-transfer/*)."""

import os

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from loguru import logger

import api.data_transfer_service as data_transfer_service
from api.models import (
    DataTransferStartResponse,
    ExportStatusResponse,
    ImportStatusResponse,
    PackageDeleteResponse,
)
from open_notebook.exceptions import OpenNotebookError

router = APIRouter()


@router.post("/data-transfer/export", response_model=DataTransferStartResponse)
async def start_export():
    """Queue a full-data export job (single zip: tables + files + vectors)."""
    try:
        command_id = await data_transfer_service.start_export()
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


@router.post("/data-transfer/import", response_model=DataTransferStartResponse)
async def upload_import_package(file: UploadFile = File(...)):
    """Upload a package zip and queue the import job.

    The request body is capped by the 100MB upload middleware (see
    tests/test_max_body_size_middleware.py); oversized uploads get a 413 there.
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
        command_id = await data_transfer_service.start_import(path)
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
