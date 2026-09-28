"""Per-source chat context preferences, keyed by (notebook, folder, source).

The notebook chat context UI remembers which sources are pulled into the
conversation for each folder (mode: off/insights/full). Rows live in the
schemaless ``chat_context_pref`` table (migration 31); the record id is a
deterministic hash of the (notebook, folder, source) key so re-saving the
same triple is a true upsert. There is no DELETE endpoint by design: writing
a mode back to 'full' restores the default.
"""

import hashlib
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from loguru import logger
from pydantic import BaseModel, Field
from surrealdb import RecordID

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Notebook
from open_notebook.exceptions import NotFoundError, OpenNotebookError

router = APIRouter()

# Keep in sync with the frontend ContextMode union ('off' | 'insights' | 'full').
CONTEXT_MODES = ("off", "insights", "full")


class ContextPreferenceSelection(BaseModel):
    source_id: str = Field(..., description="Source record id, e.g. 'source:abc'")
    mode: str = Field(..., description="Context mode: off | insights | full")


class ContextPreferencesUpdate(BaseModel):
    folder_id: Optional[str] = Field(
        None,
        description="source_group record id scoping the selections; null = ungrouped bucket",
    )
    selections: List[ContextPreferenceSelection]


class ContextPreferencesResponse(BaseModel):
    prefs: Dict[str, str]


class ContextPreferencesSaveResponse(BaseModel):
    saved: int


def _folder_ref(folder_id: Optional[str]) -> Optional[RecordID]:
    """Normalize a folder id to a source_group record, None = ungrouped."""
    if not folder_id:
        return None
    value = folder_id.strip()
    if not value.startswith("source_group:"):
        value = f"source_group:{value}"
    try:
        return ensure_record_id(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid folder id: {folder_id}")


def _source_ref(source_id: str) -> RecordID:
    """Normalize a source id ('source:abc' or bare 'abc') to a record."""
    value = (source_id or "").strip()
    if not value.startswith("source:"):
        value = f"source:{value}"
    try:
        return ensure_record_id(value)
    except Exception:
        raise HTTPException(status_code=400, detail=f"Invalid source id: {source_id}")


def _pref_ref(notebook_ref: str, folder_ref: Optional[str], source_ref: str) -> RecordID:
    """Deterministic record id for the (notebook, folder, source) triple."""
    basis = "|".join((notebook_ref, folder_ref or "", source_ref))
    digest = hashlib.sha256(basis.encode("utf-8")).hexdigest()[:32]
    return ensure_record_id(f"chat_context_pref:{digest}")


async def _assert_notebook_exists(notebook_id: str) -> None:
    """Raise 404 when the notebook does not exist (ObjectModel.get raises
    NotFoundError, same handling as delete_notebook in api/routers/notebooks.py)."""
    await Notebook.get(notebook_id)


@router.get(
    "/notebooks/{notebook_id}/context-preferences",
    response_model=ContextPreferencesResponse,
)
async def get_context_preferences(
    notebook_id: str,
    folder_id: Optional[str] = Query(
        None,
        description="source_group record id scoping the prefs; omit for the ungrouped bucket",
    ),
):
    """Stored per-source context modes for one (notebook, folder) scope."""
    try:
        await _assert_notebook_exists(notebook_id)
        folder_param = _folder_ref(folder_id)
        notebook_param = ensure_record_id(notebook_id)
        params: Dict[str, Any] = {"notebook": notebook_param}
        if folder_param is None:
            folder_clause = "folder IS NONE"
        else:
            folder_clause = "folder = $folder"
            params["folder"] = folder_param

        rows = await repo_query(
            f"""
            SELECT id, source, mode FROM chat_context_pref
            WHERE notebook = $notebook AND {folder_clause};
            """,
            params,
        )
        prefs = {
            str(row.get("source")): str(row.get("mode"))
            for row in rows or []
            if row.get("source") is not None
        }
        return ContextPreferencesResponse(prefs=prefs)
    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error fetching context preferences for notebook {notebook_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail="Error fetching context preferences"
        )


@router.put(
    "/notebooks/{notebook_id}/context-preferences",
    response_model=ContextPreferencesSaveResponse,
)
async def save_context_preferences(
    notebook_id: str,
    request: ContextPreferencesUpdate,
):
    """Upsert per-source context modes for one (notebook, folder) scope.

    There is no DELETE endpoint: saving 'full' is the reset-to-default.
    """
    try:
        await _assert_notebook_exists(notebook_id)
    except NotFoundError:
        raise HTTPException(status_code=404, detail="Notebook not found")

    invalid_modes = sorted(
        {selection.mode for selection in request.selections if selection.mode not in CONTEXT_MODES}
    )
    if invalid_modes:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid mode(s): {', '.join(invalid_modes)}. "
                f"Allowed modes: {', '.join(CONTEXT_MODES)}"
            ),
        )

    try:
        notebook_param = ensure_record_id(notebook_id)
        folder_param = _folder_ref(request.folder_id)
        saved = 0
        for selection in request.selections:
            source_param = _source_ref(selection.source_id)
            pref_param = _pref_ref(
                str(notebook_param),
                str(folder_param) if folder_param else None,
                str(source_param),
            )
            # `SET folder = $folder` with a None binding clears the field, so the
            # ungrouped bucket rows match `folder IS NONE` on read. `created`
            # survives re-saves via the IF expression.
            await repo_query(
                """
                UPSERT $pref SET
                    notebook = $notebook,
                    source = $source,
                    folder = $folder,
                    mode = $mode,
                    updated = time::now(),
                    created = IF created IS NONE THEN time::now() ELSE created END;
                """,
                {
                    "pref": pref_param,
                    "notebook": notebook_param,
                    "source": source_param,
                    "folder": folder_param,
                    "mode": selection.mode,
                },
            )
            saved += 1
        return ContextPreferencesSaveResponse(saved=saved)
    except HTTPException:
        raise
    except OpenNotebookError:
        raise
    except Exception as e:
        logger.error(
            f"Error saving context preferences for notebook {notebook_id}: {e}"
        )
        raise HTTPException(
            status_code=500, detail="Error saving context preferences"
        )
