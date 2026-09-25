"""Tests for export_data/import_data (commands/data_transfer_commands.py).

repo_query/repo_upsert are stubbed (QueryRecorder pattern), so no database is
touched; the zip handling runs for real against tmp directories.
"""

import hashlib
import json
import os
import re
import shutil
import zipfile
from datetime import datetime, timezone
from types import SimpleNamespace
from typing import Any, Dict, List, Optional, Set, Tuple
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import commands.data_transfer_commands as dtc
from commands.data_transfer_commands import (
    ExportDataInput,
    ImportDataInput,
    export_data_command,
    import_data_command,
)

SOURCE_ID = "source:s1"
NOTEBOOK_ID = "notebook:n1"
NOTE_ID = "note:note1"
VIEW_ID = "source_view:v1"
GROUP_ID = "source_group:g1"
INSIGHT_ID = "source_insight:si1"
EMB_IDS = ["source_embedding:e1", "source_embedding:e2"]
TRANSFORMATION_ID = "transformation:t1"

_PAGE_RE = re.compile(
    r"^SELECT (.+?) FROM ([a-z_]+)(?: WHERE (.+?))? ORDER BY id LIMIT \$limit$"
)
_CONFIG_ROW_RE = re.compile(r"^SELECT \* FROM open_notebook:([a-z_]+) LIMIT 1$")


def _source_row(file_path: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": SOURCE_ID,
        "asset": {"file_path": file_path, "url": "https://example.com/report.pdf"}
        if file_path
        else None,
        "title": "Report",
        "topics": ["a"],
        "full_text": "report text",
        "last_viewed_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
        "embedding_status": "completed",
        "embedding_error": None,
        "total_chunks": 2,
        "embedded_chunks": 2,
        "created": datetime(2026, 9, 1, tzinfo=timezone.utc),
        "updated": datetime(2026, 9, 2, tzinfo=timezone.utc),
    }


def _default_rows() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "notebook": [{"id": NOTEBOOK_ID, "name": "Research", "description": "", "archived": False}],
        "transformation": [
            {"id": TRANSFORMATION_ID, "name": "Sum", "title": "Sum", "description": "d",
             "prompt": "p", "apply_default": False, "model_id": "model:m1"}
        ],
        "source_view": [
            {"id": "source_view:ai_content", "name": "AI Content", "view_type": "ai_content"},
            {"id": VIEW_ID, "name": "Custom", "view_type": "custom"},
        ],
        "source_group": [
            {"id": GROUP_ID, "name": "G", "source_view": VIEW_ID, "parent": None}
        ],
        "source": [_source_row()],
        "source_insight": [
            {"id": INSIGHT_ID, "source": SOURCE_ID, "insight_type": "Summary",
             "content": "insight", "embedding": [0.1, 0.2, 0.3]}
        ],
        "note": [
            {"id": NOTE_ID, "title": "N", "note_type": "human",
             "content": "note", "embedding": [0.4, 0.5, 0.6]}
        ],
        "reference": [{"id": "reference:r1", "in": SOURCE_ID, "out": NOTEBOOK_ID}],
        "artifact": [{"id": "artifact:a1", "in": NOTE_ID, "out": NOTEBOOK_ID}],
        "source_group_member": [
            {"id": "source_group_member:m1", "in": SOURCE_ID, "out": GROUP_ID}
        ],
        "source_embedding": [
            {"id": EMB_IDS[0], "source": SOURCE_ID, "order": 0,
             "content": "chunk 0", "embedding": [0.1, 0.2, 0.3]},
            {"id": EMB_IDS[1], "source": SOURCE_ID, "order": 1,
             "content": "chunk 1", "embedding": [0.4, 0.5, 0.6]},
        ],
        "content_settings": [{
            "id": "open_notebook:content_settings",
            "default_content_processing_engine_doc": "auto",
            "chunk_size": 800,
            "chunk_overlap": 100,
            "usage_tracking_enabled": True,
            "internal_runtime_state": "must not be exported",
        }],
        "default_prompts": [{
            "id": "open_notebook:default_prompts",
            "transformation_instructions": "Custom prompt test",
        }],
    }


class TransferRecorder:
    """Routes SQL to canned results and records every query/write."""

    def __init__(
        self,
        tables: Optional[Dict[str, List[Dict[str, Any]]]] = None,
        existing_ids: Optional[Dict[str, Set[str]]] = None,
        existing_pairs: Optional[Dict[str, Set[Tuple[str, str]]]] = None,
        models: Optional[List[str]] = None,
        embedding_lengths: Optional[List[int]] = None,
    ):
        self.tables = _default_rows() if tables is None else tables
        self.existing_ids = existing_ids or {}
        self.existing_pairs = existing_pairs or {}
        self.models = models or []
        self.embedding_lengths = embedding_lengths or []
        self.queries: List[Tuple[str, Optional[Dict[str, Any]]]] = []
        self.writes: List[Tuple[str, Optional[Dict[str, Any]]]] = []
        self.states: List[Tuple[str, Dict[str, Any]]] = []

    async def __call__(self, sql: str, params: Optional[Dict[str, Any]] = None):
        self.queries.append((sql, params))
        if sql.startswith("UPSERT $target SET"):
            data: Dict[str, Any] = {
                "kind": params["kind"],
                "progress": params["progress"],
            }
            if "command_id" in params:
                data["command_id"] = params["command_id"]
            if "result" in params:
                data["result"] = params["result"]
            self.states.append((str(params["target"]), data))
            return []
        if sql.startswith("UPSERT open_notebook:"):
            self.writes.append((sql, params))
            return []
        if sql.startswith(("CREATE", "RELATE")) or sql.startswith("UPDATE $id SET asset"):
            self.writes.append((sql, params))
            return []
        if "SELECT VALUE count()" in sql:
            table = sql.split("FROM ")[1].split()[0]
            return [{"count": len(self.tables.get(table, []))}]
        if "SELECT VALUE id FROM model" in sql:
            return list(self.models)
        if "SELECT VALUE id FROM " in sql:
            table = sql[len("SELECT VALUE id FROM ") :].strip()
            return sorted(self.existing_ids.get(table, set()))
        if "SELECT VALUE array::len" in sql:
            return list(self.embedding_lengths)
        if "SELECT in, out FROM " in sql:
            edge = sql[len("SELECT in, out FROM ") :].strip()
            return [
                {"in": a, "out": b} for a, b in sorted(self.existing_pairs.get(edge, set()))
            ]
        match = _CONFIG_ROW_RE.match(sql)
        if match:
            return self.tables.get(match.group(1), [])[:1]
        match = _PAGE_RE.match(sql)
        if match:
            _, table, where = match.groups()
            rows = list(self.tables.get(table, []))
            if where and "id NOT IN $defaults" in where and params:
                defaults = {str(d) for d in params.get("defaults", [])}
                rows = [r for r in rows if str(r["id"]) not in defaults]
            if where and "id > $last" in where and params and params.get("last"):
                last = str(params["last"])
                rows = [r for r in rows if str(r["id"]) > last]
            return rows
        raise AssertionError(f"Unexpected query: {sql[:160]!r}")

    def state_stages(self, kind: str) -> List[str]:
        prefix = f"data_transfer_state:{kind}"
        return [d["progress"]["stage"] for t, d in self.states if t == prefix]

    def state_percents(self, kind: str) -> List[int]:
        prefix = f"data_transfer_state:{kind}"
        return [d["progress"]["percent"] for t, d in self.states if t == prefix]


_DEFAULTS = SimpleNamespace(default_embedding_model="model:emb")


async def _run_export(recorder, exports, uploads, include_files=True):
    with patch.multiple(
        "commands.data_transfer_commands",
        repo_query=recorder,
        EXPORTS_FOLDER=exports,
        UPLOADS_FOLDER=uploads,
    ), patch.object(
        dtc.DefaultModels, "get_instance", new=AsyncMock(return_value=_DEFAULTS)
    ):
        return await export_data_command(ExportDataInput(include_files=include_files))


async def _run_import(recorder, uploads, package_path):
    with patch.multiple(
        "commands.data_transfer_commands",
        repo_query=recorder,
        UPLOADS_FOLDER=uploads,
    ), patch.object(
        dtc.DefaultModels, "get_instance", new=AsyncMock(return_value=_DEFAULTS)
    ), patch(
        "commands.data_transfer_commands.ensure_default_views",
        new=AsyncMock(return_value=None),
    ):
        return await import_data_command(ImportDataInput(package_path=str(package_path)))


def _build_package(
    path,
    rows: Dict[str, List[Dict[str, Any]]],
    files: Dict[str, bytes],
    manifest_overrides: Optional[Dict[str, Any]] = None,
    format_version: int = 1,
    member_extra: Optional[Dict[str, bytes]] = None,
):
    with zipfile.ZipFile(path, "w") as zf:
        for table, table_rows in rows.items():
            with zf.open(f"data/{table}.ndjson", "w") as member:
                for row in table_rows:
                    member.write((json.dumps(row, default=str) + "\n").encode("utf-8"))
        for name, content in files.items():
            zf.writestr(name, content)
        for name, content in (member_extra or {}).items():
            zf.writestr(name, content)
        manifest = {
            "format_version": format_version,
            "app_version": "test",
            "exported_at": "2026-09-23T00:00:00+00:00",
            "embedding": {"model_id": "model:emb", "dominant_dimension": 3},
            "counts": {t: len(r) for t, r in rows.items()},
            "files": {
                name: {
                    "sha256": hashlib.sha256(content).hexdigest(),
                    "size": len(content),
                }
                for name, content in files.items()
            },
        }
        manifest.update(manifest_overrides or {})
        zf.writestr("manifest.json", json.dumps(manifest))


def _package_rows() -> Dict[str, List[Dict[str, Any]]]:
    return {
        "notebook": [{"id": NOTEBOOK_ID, "name": "Research", "created": "2026-09-01T00:00:00+00:00"}],
        "transformation": [{"id": TRANSFORMATION_ID, "name": "Sum", "title": "Sum",
                             "description": "d", "prompt": "p", "apply_default": False,
                             "model_id": "model:m1"}],
        "source_view": [{"id": VIEW_ID, "name": "Custom", "view_type": "custom"}],
        "source_group": [{"id": GROUP_ID, "name": "G", "source_view": VIEW_ID}],
        "source": [{"id": SOURCE_ID, "title": "Report",
                     "asset": {"file_path": "/source-env/uploads/report.pdf",
                                "url": "https://example.com/report.pdf"},
                     "embedding_status": "completed", "total_chunks": 2,
                     "embedded_chunks": 2, "created": "2026-09-01T00:00:00+00:00"}],
        "source_insight": [{"id": INSIGHT_ID, "source": SOURCE_ID,
                             "insight_type": "Summary", "content": "insight",
                             "embedding": [0.1, 0.2, 0.3]}],
        "note": [{"id": NOTE_ID, "title": "N", "note_type": "human",
                   "content": "note", "embedding": [0.4, 0.5, 0.6]}],
        "reference": [{"in": SOURCE_ID, "out": NOTEBOOK_ID}],
        "artifact": [{"in": NOTE_ID, "out": NOTEBOOK_ID}],
        "source_group_member": [{"in": SOURCE_ID, "out": GROUP_ID}],
        "source_embedding": [
            {"id": EMB_IDS[0], "source": SOURCE_ID, "order": 0,
             "content": "chunk 0", "embedding": [0.1, 0.2, 0.3]},
            {"id": EMB_IDS[1], "source": SOURCE_ID, "order": 1,
             "content": "chunk 1", "embedding": [0.4, 0.5, 0.6]},
        ],
    }


def _all_existing() -> Dict[str, Set[str]]:
    rows = _package_rows()
    existing = {
        t: {str(r["id"]) for r in rows[t]}
        for t in dtc.DATA_TABLES + (dtc.EMBEDDING_TABLE,)
    }
    return existing


class TestExport:
    @pytest.mark.asyncio
    async def test_export_zip_contents_and_manifest(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        report = uploads / "report.pdf"
        report.write_bytes(b"fake pdf content")

        tables = _default_rows()
        tables["source"] = [_source_row(file_path=str(report))]
        recorder = TransferRecorder(tables=tables)
        exports = str(tmp_path / "exports")

        output = await _run_export(recorder, exports, str(uploads))

        assert output.success is True
        assert output.package_path and output.package_path.startswith(exports)
        assert output.package_size_bytes > 0
        assert output.files_skipped == 0

        with zipfile.ZipFile(output.package_path) as zf:
            names = zf.namelist()
            assert "manifest.json" in names
            assert "data/source.ndjson" in names
            assert "data/reference.ndjson" in names
            assert "files/s1/report.pdf" in names

            manifest = json.loads(zf.read("manifest.json"))
            assert manifest["format_version"] == 1
            assert manifest["counts"]["source"] == 1
            assert manifest["counts"]["source_embedding"] == 2
            assert manifest["counts"]["files"] == 1
            assert manifest["embedding"]["dominant_dimension"] == 3
            assert manifest["embedding"]["model_id"] == "model:emb"
            entry = manifest["files"]["files/s1/report.pdf"]
            assert entry["sha256"] == hashlib.sha256(b"fake pdf content").hexdigest()
            assert entry["size"] == len(b"fake pdf content")

            source_lines = [
                json.loads(line)
                for line in zf.read("data/source.ndjson").decode().splitlines()
            ]
            assert len(source_lines) == 1
            row = source_lines[0]
            assert row["id"] == SOURCE_ID
            assert "command" not in row
            assert "embedding_command" not in row
            assert row["embedding_status"] == "completed"

            view_lines = {
                json.loads(line)["id"]
                for line in zf.read("data/source_view.ndjson").decode().splitlines()
            }
            assert view_lines == {VIEW_ID}

            ref = json.loads(zf.read("data/reference.ndjson").decode().splitlines()[0])
            assert ref == {"in": SOURCE_ID, "out": NOTEBOOK_ID}

            emb_lines = zf.read("data/source_embedding.ndjson").decode().splitlines()
            assert len(emb_lines) == 2

            assert "data/content_settings.ndjson" in names
            assert "data/default_prompts.ndjson" in names
            assert manifest["counts"]["content_settings"] == 1
            assert manifest["counts"]["default_prompts"] == 1
            cs_row = json.loads(
                zf.read("data/content_settings.ndjson").decode().splitlines()[0]
            )
            assert cs_row["id"] == "open_notebook:content_settings"
            assert cs_row["chunk_size"] == 800
            assert cs_row["usage_tracking_enabled"] is True
            assert "internal_runtime_state" not in cs_row
            dp_row = json.loads(
                zf.read("data/default_prompts.ndjson").decode().splitlines()[0]
            )
            assert dp_row["id"] == "open_notebook:default_prompts"
            assert dp_row["transformation_instructions"] == "Custom prompt test"

        assert not [p for p in os.listdir(exports) if p.startswith(".export_")]

    @pytest.mark.asyncio
    async def test_export_never_queries_sensitive_tables(self, tmp_path):
        recorder = TransferRecorder()
        await _run_export(recorder, str(tmp_path / "exports"), str(tmp_path))

        forbidden = [
            "credential",
            "provider_configs",
            "model_usage",
            "chat_session",
            "refers_to",
            "command",
        ]
        for sql, _ in recorder.queries:
            # State writes carry a command_id field, never the command table.
            if sql.startswith("UPSERT $target SET"):
                continue
            for word in forbidden:
                assert word not in sql, f"sensitive table {word!r} in query: {sql[:120]}"

    @pytest.mark.asyncio
    async def test_export_stage_sequence_monotonic(self, tmp_path):
        recorder = TransferRecorder()
        await _run_export(recorder, str(tmp_path / "exports"), str(tmp_path))

        stages = recorder.state_stages("export")
        order = list(dtc.EXPORT_STAGES) + ["done"]
        indexes = [
            order.index(s) if s in order else order.index("collecting")
            for s in stages
            if s != "starting"
        ]
        assert indexes == sorted(indexes)
        percents = [
            p
            for s, p in zip(recorder.state_stages("export"), recorder.state_percents("export"))
            if s != "starting"
        ]
        assert percents == sorted(percents)
        assert recorder.state_stages("export")[-1] == "done"

    @pytest.mark.asyncio
    async def test_export_include_files_false_has_no_files_members(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        (uploads / "report.pdf").write_bytes(b"never exported")

        tables = _default_rows()
        tables["source"] = [_source_row(file_path=str(uploads / "report.pdf"))]
        recorder = TransferRecorder(tables=tables)

        output = await _run_export(
            recorder, str(tmp_path / "exports"), str(uploads), include_files=False
        )

        with zipfile.ZipFile(output.package_path) as zf:
            assert not [n for n in zf.namelist() if n.startswith("files/")]
        manifest_counts = output.counts
        assert manifest_counts["files"] == 0

    @pytest.mark.asyncio
    async def test_export_skips_missing_files(self, tmp_path):
        tables = _default_rows()
        tables["source"] = [_source_row(file_path=str(tmp_path / "missing.pdf"))]
        recorder = TransferRecorder(tables=tables)

        output = await _run_export(recorder, str(tmp_path / "exports"), str(tmp_path))

        assert output.files_skipped == 1
        with zipfile.ZipFile(output.package_path) as zf:
            assert not [n for n in zf.namelist() if n.startswith("files/")]


class TestRoundTrip:
    @pytest.mark.asyncio
    async def test_export_zip_reimports_and_second_pass_skips_all(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        (uploads / "report.pdf").write_bytes(b"round trip pdf")
        tables = _default_rows()
        tables["source"] = [_source_row(file_path=str(uploads / "report.pdf"))]
        export_recorder = TransferRecorder(tables=tables)
        exports = str(tmp_path / "exports")

        output = await _run_export(export_recorder, exports, str(uploads))
        assert output.success is True

        # A successful import deletes the uploaded package, so keep a copy for
        # the second pass.
        package_copy = tmp_path / "pkg_copy.zip"
        shutil.copy(output.package_path, package_copy)

        import_recorder = TransferRecorder(models=["model:m1"])
        first = await _run_import(
            import_recorder, str(tmp_path / "uploads2"), output.package_path
        )
        assert first.success is True
        assert first.imported["source"] == 1
        assert first.imported["source_embedding"] == 2
        assert first.imported["reference"] == 1
        assert first.warnings == []
        update = [
            p or {}
            for sql, p in import_recorder.writes
            if sql.startswith("UPDATE $id SET asset")
        ][0]
        assert update["asset"]["file_path"].startswith(str(tmp_path / "uploads2"))

        # Second pass over an environment holding every id: zero writes.
        second_recorder = TransferRecorder(
            existing_ids=_all_existing(),
            existing_pairs={
                "reference": {(SOURCE_ID, NOTEBOOK_ID)},
                "artifact": {(NOTE_ID, NOTEBOOK_ID)},
                "source_group_member": {(SOURCE_ID, GROUP_ID)},
            },
            models=["model:m1"],
        )
        second = await _run_import(
            second_recorder, str(tmp_path / "uploads3"), package_copy
        )
        # Data records skip whole, but config records re-apply via MERGE.
        assert second.imported == {"content_settings": 1, "default_prompts": 1}
        assert [sql for sql, _ in second_recorder.writes] == [
            "UPSERT open_notebook:content_settings MERGE $data;",
            "UPSERT open_notebook:default_prompts MERGE $data;",
        ]


class TestImport:
    @pytest.mark.asyncio
    async def test_full_import_creates_records_files_and_edges(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        content = b"imported pdf"
        package = tmp_path / "pkg.zip"
        _build_package(
            package,
            _package_rows(),
            {"files/s1/report.pdf": content},
        )
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(uploads), package)

        assert output.success is True
        assert output.imported["notebook"] == 1
        assert output.imported["source"] == 1
        assert output.imported["source_embedding"] == 2
        assert output.imported["reference"] == 1
        assert output.imported["artifact"] == 1
        assert output.imported["source_group_member"] == 1
        assert output.imported["transformation"] == 1
        assert output.warnings == []

        sql_text = "\n".join(sql for sql, _ in recorder.writes)
        assert "CREATE notebook:n1 SET" in sql_text
        assert "CREATE source:s1 SET" in sql_text
        assert "->reference->" in sql_text
        assert f"RELATE {SOURCE_ID}->reference->{NOTEBOOK_ID};" in sql_text

        # The source-env file_path must not be written; asset keeps url only.
        source_params = _params_of(recorder, "CREATE source:s1 SET")
        assert source_params["p0_asset"] == {"url": "https://example.com/report.pdf"}
        assert "p0_full_text" not in source_params  # absent in package row

        # Embeddings restored with the package's vectors.
        emb_params = _params_of(recorder, "CREATE source_embedding:e1 SET")
        assert emb_params["p0_source"].id == "s1"
        assert emb_params["p0_embedding"] == [0.1, 0.2, 0.3]
        insight_params = _params_of(recorder, "CREATE source_insight:si1 SET")
        assert insight_params["p0_embedding"] == [0.1, 0.2, 0.3]
        note_params = _params_of(recorder, "CREATE note:note1 SET")
        assert note_params["p0_embedding"] == [0.4, 0.5, 0.6]

        # File extracted into UPLOADS_FOLDER and asset updated with new path.
        update = [
            p or {} for sql, p in recorder.writes if sql.startswith("UPDATE $id SET asset")
        ][0]
        new_path = update["asset"]["file_path"]
        assert new_path.startswith(str(uploads))
        assert os.path.isfile(new_path)
        with open(new_path, "rb") as f:
            assert f.read() == content
        assert update["asset"]["url"] == "https://example.com/report.pdf"

        # Uploaded package is cleaned up after a successful import.
        assert not package.exists()

    @pytest.mark.asyncio
    async def test_import_never_submits_embed_commands(self, tmp_path):
        package = tmp_path / "pkg.zip"
        _build_package(package, _package_rows(), {})
        recorder = TransferRecorder(models=["model:m1"])

        with patch(
            "commands.data_transfer_commands.submit_command",
            create=True,
            new=MagicMock(),
        ) as submit:
            await _run_import(recorder, str(tmp_path / "uploads"), package)

        submit.assert_not_called()

    @pytest.mark.asyncio
    async def test_import_package_with_missing_table_members(self, tmp_path):
        rows = _package_rows()
        # A minimal package: no views/groups/edges/insights at all.
        for missing in ("source_view", "source_group", "source_insight", "note",
                        "reference", "artifact", "source_group_member",
                        "source_embedding", "transformation"):
            rows.pop(missing)
        package = tmp_path / "pkg.zip"
        _build_package(package, rows, {})
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.imported == {"notebook": 1, "source": 1}
        assert output.skipped.get("source") == 0
        assert output.warnings == []

    @pytest.mark.asyncio
    async def test_second_import_of_same_package_writes_nothing(self, tmp_path):
        package = tmp_path / "pkg.zip"
        _build_package(
            package, _package_rows(), {"files/s1/report.pdf": b"pdf bytes"}
        )
        recorder = TransferRecorder(
            existing_ids=_all_existing(),
            existing_pairs={
                "reference": {(SOURCE_ID, NOTEBOOK_ID)},
                "artifact": {(NOTE_ID, NOTEBOOK_ID)},
                "source_group_member": {(SOURCE_ID, GROUP_ID)},
            },
            models=["model:m1"],
        )

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.imported == {}
        assert output.skipped["source"] == 1
        assert output.skipped["notebook"] == 1
        assert output.skipped["source_embedding"] == 2
        assert output.skipped["reference"] == 1
        assert recorder.writes == []
        assert not (tmp_path / "uploads" / "report.pdf").exists()
        assert not package.exists()

    @pytest.mark.asyncio
    async def test_import_rewrites_file_path_with_conflict_suffix(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        (uploads / "report.pdf").write_bytes(b"existing file")
        package = tmp_path / "pkg.zip"
        _build_package(
            package, _package_rows(), {"files/s1/report.pdf": b"imported pdf"}
        )
        recorder = TransferRecorder(models=["model:m1"])

        await _run_import(recorder, str(uploads), package)

        update = [
            p or {} for sql, p in recorder.writes if sql.startswith("UPDATE $id SET asset")
        ][0]
        new_path = update["asset"]["file_path"]
        assert new_path.endswith("report (1).pdf")
        with open(new_path, "rb") as f:
            assert f.read() == b"imported pdf"
        # The pre-existing file was left untouched.
        assert (uploads / "report.pdf").read_bytes() == b"existing file"

    @pytest.mark.asyncio
    async def test_import_sha_mismatch_deletes_file_and_warns(self, tmp_path):
        uploads = tmp_path / "uploads"
        uploads.mkdir()
        package = tmp_path / "pkg.zip"
        _build_package(
            package,
            _package_rows(),
            {"files/s1/report.pdf": b"tampered"},
            manifest_overrides={
                "files": {"files/s1/report.pdf": {"sha256": "0" * 64, "size": 8}}
            },
        )
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(uploads), package)

        assert output.imported["source"] == 1
        assert any("sha256 mismatch" in w for w in output.warnings)
        assert not list(uploads.iterdir())
        assert not [sql for sql, _ in recorder.writes if sql.startswith("UPDATE $id SET asset")]

    @pytest.mark.asyncio
    async def test_import_creates_only_missing_edges(self, tmp_path):
        rows = _package_rows()
        rows["reference"] = [
            {"in": SOURCE_ID, "out": NOTEBOOK_ID},
            {"in": SOURCE_ID, "out": "notebook:n2"},
        ]
        rows["notebook"].append({"id": "notebook:n2", "name": "Two"})
        package = tmp_path / "pkg.zip"
        _build_package(package, rows, {})
        recorder = TransferRecorder(
            existing_pairs={"reference": {(SOURCE_ID, NOTEBOOK_ID)}},
            models=["model:m1"],
        )

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.imported["reference"] == 1
        ref_relates = [
            sql
            for sql, _ in recorder.writes
            if sql.startswith("RELATE") and "->reference->" in sql
        ]
        assert ref_relates == [f"RELATE {SOURCE_ID}->reference->notebook:n2;"]

    @pytest.mark.asyncio
    async def test_import_dangling_edge_counted_skipped_and_warned(self, tmp_path):
        rows = _package_rows()
        rows["source_group_member"] = [
            {"in": SOURCE_ID, "out": GROUP_ID},
            {"in": "source:ghost", "out": GROUP_ID},
        ]
        package = tmp_path / "pkg.zip"
        _build_package(package, rows, {})
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.imported["source_group_member"] == 1
        # The dangling edge must surface in both the count and the warnings,
        # not vanish silently between the precheck estimate and the writes.
        assert output.skipped["source_group_member"] == 1
        assert any("source:ghost" in w for w in output.warnings)
        actual_import = sum(output.imported.values())
        last_state = [d for t, d in recorder.states if t.startswith("data_transfer_state:import")][-1]
        assert last_state["progress"]["message"] == (
            f"Import complete: {actual_import} imported, {sum(output.skipped.values())} skipped"
        )

    @pytest.mark.asyncio
    async def test_final_state_written_with_field_wholesale_set(self, tmp_path):
        # Nested result dicts must be assigned via SET (wholesale), not
        # repo_upsert's MERGE, whose deep merge would keep the previous run's
        # counts inside a fresh empty result.
        package = tmp_path / "pkg.zip"
        _build_package(package, _package_rows(), {})
        recorder = TransferRecorder(
            existing_ids=_all_existing(),
            existing_pairs={
                "reference": {(SOURCE_ID, NOTEBOOK_ID)},
                "artifact": {(NOTE_ID, NOTEBOOK_ID)},
                "source_group_member": {(SOURCE_ID, GROUP_ID)},
            },
            models=["model:m1"],
        )

        await _run_import(recorder, str(tmp_path / "uploads"), package)

        final_sql, final_params = [
            (sql, p)
            for sql, p in recorder.queries
            if sql.startswith("UPSERT $target SET") and p and "result" in p
        ][0]
        assert "result = $result" in final_sql
        assert "MERGE" not in final_sql
        # A zero-write rerun must persist imported as the empty dict itself.
        assert final_params["result"]["imported"] == {}

    @pytest.mark.asyncio
    async def test_import_embedding_model_and_dimension_warnings(self, tmp_path):
        package = tmp_path / "pkg.zip"
        _build_package(package, _package_rows(), {})
        recorder = TransferRecorder(models=["model:missing"], embedding_lengths=[7, 7])

        other_defaults = SimpleNamespace(default_embedding_model="model:other")
        with patch.multiple(
            "commands.data_transfer_commands",
            repo_query=recorder,
            UPLOADS_FOLDER=str(tmp_path / "uploads"),
        ), patch.object(
            dtc.DefaultModels,
            "get_instance",
            new=AsyncMock(return_value=other_defaults),
        ), patch(
            "commands.data_transfer_commands.ensure_default_views",
            new=AsyncMock(return_value=None),
        ):
            output = await import_data_command(ImportDataInput(package_path=str(package)))

        joined = "\n".join(output.warnings)
        assert "model:emb" in joined and "model:other" in joined
        assert "dimension" in joined
        # model:m1 is the package's transformation model, absent from the env.
        assert "model:m1" in joined

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "kwargs",
        [
            {"member_extra": {"../evil.txt": b"x"}},
            {"format_version": 99},
            {"manifest_overrides": None, "skip_manifest": True},
        ],
    )
    async def test_import_rejects_bad_packages_before_any_write(self, tmp_path, kwargs):
        package = tmp_path / "pkg.zip"
        skip_manifest = kwargs.pop("skip_manifest", False)
        overrides = kwargs.pop("manifest_overrides", None)
        rows = _package_rows()
        with zipfile.ZipFile(package, "w") as zf:
            for table, table_rows in rows.items():
                with zf.open(f"data/{table}.ndjson", "w") as member:
                    for row in table_rows:
                        member.write((json.dumps(row, default=str) + "\n").encode())
            for name, content in kwargs.pop("member_extra", {}).items():
                zf.writestr(name, content)
            if not skip_manifest:
                manifest = {
                    "format_version": kwargs.pop("format_version", 1),
                    "embedding": {"model_id": "model:emb", "dominant_dimension": 3},
                    "counts": {},
                    "files": {},
                }
                manifest.update(overrides or {})
                zf.writestr("manifest.json", json.dumps(manifest))
        assert not kwargs  # test params must all be consumed

        recorder = TransferRecorder(models=["model:m1"])

        with pytest.raises(ValueError):
            await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert recorder.writes == []
        # No precheck reads ran: validation fails before any data query; only
        # the best-effort transfer-state upserts are allowed through.
        assert all(
            sql.startswith("UPSERT $target SET") for sql, _ in recorder.queries
        )
        assert recorder.state_stages("import")[-1] == "failed"
        assert not package.exists()


class TestConfigTables:
    @pytest.mark.asyncio
    async def test_import_merges_config_tables(self, tmp_path):
        rows = _package_rows()
        rows["content_settings"] = [{
            "id": "open_notebook:content_settings",
            "default_content_processing_engine_doc": "docling",
            "chunk_size": 800,
            "chunk_overlap": 100,
            "usage_tracking_enabled": True,
            "secret_field": "dropped",
        }]
        rows["default_prompts"] = [{
            "id": "open_notebook:default_prompts",
            "transformation_instructions": "Custom prompt test",
        }]
        package = tmp_path / "pkg.zip"
        _build_package(package, rows, {})
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.success is True
        assert output.imported["content_settings"] == 1
        assert output.imported["default_prompts"] == 1

        cs_sql, cs_params = [
            (sql, p)
            for sql, p in recorder.writes
            if sql.startswith("UPSERT open_notebook:content_settings MERGE")
        ][0]
        assert cs_sql.endswith("MERGE $data;")
        assert cs_params["data"]["chunk_size"] == 800
        assert cs_params["data"]["usage_tracking_enabled"] is True
        assert "secret_field" not in cs_params["data"]
        assert any(
            "secret_field" in w and "content_settings" in w for w in output.warnings
        )
        dp_params = _params_of(
            recorder, "UPSERT open_notebook:default_prompts MERGE"
        )
        assert dp_params["data"]["transformation_instructions"] == "Custom prompt test"

    @pytest.mark.asyncio
    async def test_import_legacy_package_without_config_members(self, tmp_path):
        # _package_rows() carries no config members: an older package format.
        package = tmp_path / "pkg.zip"
        _build_package(package, _package_rows(), {})
        recorder = TransferRecorder(models=["model:m1"])

        output = await _run_import(recorder, str(tmp_path / "uploads"), package)

        assert output.success is True
        assert "content_settings" not in output.imported
        assert "default_prompts" not in output.imported
        assert output.warnings == []
        assert not [sql for sql, _ in recorder.writes if "MERGE" in sql]


def _params_of(recorder: TransferRecorder, prefix: str) -> Dict[str, Any]:
    for sql, params in recorder.writes:
        if prefix in sql:
            return params or {}
    raise AssertionError(f"No write matching {prefix!r}")
