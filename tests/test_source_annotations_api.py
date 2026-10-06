"""Tests for source annotations (domain model, CRUD router, delete backup).

The fake store below routes both the SQL surface (repo_query) and the SDK
surface (repo_create/update/delete) over one in-memory row dict, so the whole
stack — pydantic validation, ObjectModel.save, router mapping — runs for real.
"""

import json
import time
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from surrealdb import RecordID

from api.main import app
from open_notebook.domain.source_annotation import (
    ANNOTATION_SETTINGS_ID,
    SourceAnnotation,
    backup_source_annotations,
    build_annotation_backup_payload,
)

SOURCE_ID = "source:s1"
SOURCE_RECORD = RecordID("source", "s1")


class FakeAnnotationStore:
    def __init__(self):
        self.rows: dict = {}

    # --- repo_query surface -------------------------------------------
    async def query(self, sql, params=None):
        params = params or {}
        if sql == "SELECT * FROM $id":
            rid = str(params["id"])
            return [dict(self.rows[rid])] if rid in self.rows else []
        if sql.startswith("SELECT * FROM source_annotation WHERE source = $source_id"):
            rows = [
                dict(r)
                for r in self.rows.values()
                if r.get("table") == "source_annotation"
                and str(r["source"]) == str(params["source_id"])
            ]
            if " AND page = $page" in sql:
                rows = [r for r in rows if r.get("page") == params["page"]]
            rows.sort(
                key=lambda r: (
                    r.get("page") or 0,
                    r.get("start_offset") or 0,
                    str(r.get("created") or ""),
                )
            )
            return rows
        if sql.startswith("SELECT count() AS total"):
            total = sum(
                1
                for r in self.rows.values()
                if r.get("table") == "source_annotation"
                and str(r["source"]) == str(params["source_id"])
            )
            return [{"total": total}] if total else []
        if sql.startswith("UPSERT open_notebook:annotation_settings"):
            self.rows[ANNOTATION_SETTINGS_ID] = {
                "id": ANNOTATION_SETTINGS_ID,
                "table": "annotation_settings",
                "color_names": params["data"]["color_names"],
            }
            return []
        if sql.startswith("DELETE "):
            return []
        raise AssertionError(f"Unexpected query: {sql[:160]!r}")

    # --- SDK surface used by ObjectModel.save/delete -------------------
    async def create(self, table, data):
        rid = f"{table}:{uuid4().hex[:12]}"
        now = datetime.now(timezone.utc)
        row = {**data, "id": rid, "table": table, "created": now, "updated": now}
        self.rows[rid] = row
        return dict(row)

    async def update(self, table, rid, data):
        row = self.rows[str(rid)]
        row.update(data)
        row["updated"] = datetime.now(timezone.utc)
        return [dict(row)]

    async def delete(self, rid):
        self.rows.pop(str(rid), None)
        return True

    def annotations(self):
        return [r for r in self.rows.values() if r.get("table") == "source_annotation"]


@pytest.fixture
def store(monkeypatch, tmp_path):
    fake = FakeAnnotationStore()
    monkeypatch.setattr("open_notebook.domain.base.repo_query", fake.query)
    monkeypatch.setattr("open_notebook.domain.source_annotation.repo_query", fake.query)
    monkeypatch.setattr("open_notebook.domain.base.repo_create", fake.create)
    monkeypatch.setattr("open_notebook.domain.base.repo_update", fake.update)
    monkeypatch.setattr("open_notebook.domain.base.repo_delete", fake.delete)
    monkeypatch.setattr(
        "open_notebook.domain.source_annotation.ANNOTATION_BACKUP_FOLDER",
        str(tmp_path / "exports"),
    )
    source = SimpleNamespace(
        id=SOURCE_ID,
        title="真题册",
        asset=SimpleNamespace(url="https://example.com/book.pdf"),
        created=datetime(2026, 9, 1, tzinfo=timezone.utc),
        delete=AsyncMock(return_value=True),
    )
    fake.source = source
    fake.source_stub = AsyncMock(return_value=source)
    monkeypatch.setattr(
        "api.routers.source_annotations.Source",
        SimpleNamespace(get=fake.source_stub),
    )
    return fake


@pytest.fixture
def client(store):
    return TestClient(app, raise_server_exceptions=False)


def _pdf_anchor(page=5):
    return {"page": page, "quads": [{"x1": 10, "y1": 700, "x2": 300, "y2": 715}]}


def _create_payload(**overrides):
    payload = {
        "source_id": SOURCE_ID,
        "color": "gold",
        "line_style": "wavy",
        "pdf_anchor": _pdf_anchor(),
    }
    payload.update(overrides)
    return payload


class TestCreateAndList:
    def test_create_pdf_annotation_syncs_page(self, client, store):
        resp = client.post("/api/source-annotations", json=_create_payload())
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["page"] == 5
        assert body["display_position"] is None
        assert body["source"] == SOURCE_ID
        assert len(store.annotations()) == 1

    def test_create_fills_quote_from_text_anchor(self, client):
        resp = client.post(
            "/api/source-annotations",
            json=_create_payload(
                pdf_anchor=None,
                text_anchor={
                    "quote": "需求分为功能性与非功能性",
                    "prefix": "前文",
                    "suffix": "后文",
                    "start_offset": 12,
                    "end_offset": 24,
                },
            ),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["quote"] == "需求分为功能性与非功能性"
        assert body["start_offset"] == 12

    def test_list_orders_and_filters_by_page(self, client):
        client.post(
            "/api/source-annotations", json=_create_payload(pdf_anchor=_pdf_anchor(5))
        )
        client.post(
            "/api/source-annotations",
            json=_create_payload(color="fern", pdf_anchor=_pdf_anchor(9)),
        )
        listed = client.get(f"/api/source-annotations?source_id={SOURCE_ID}")
        assert listed.status_code == 200
        assert len(listed.json()) == 2

        one_page = client.get(f"/api/source-annotations?source_id={SOURCE_ID}&page=9")
        assert one_page.status_code == 200
        rows = one_page.json()
        assert len(rows) == 1
        assert rows[0]["page"] == 9


class TestValidation:
    def test_requires_at_least_one_anchor(self, client):
        resp = client.post(
            "/api/source-annotations",
            json=_create_payload(pdf_anchor=None),
        )
        assert resp.status_code == 400
        assert "anchor" in resp.json()["detail"]

    def test_rejects_unknown_color(self, client):
        resp = client.post(
            "/api/source-annotations", json=_create_payload(color="crimson")
        )
        assert resp.status_code == 400

    def test_rejects_body_over_limit(self, client):
        resp = client.post(
            "/api/source-annotations", json=_create_payload(body="字" * 4001)
        )
        assert resp.status_code == 400

    def test_rejects_quote_over_limit(self, client):
        resp = client.post(
            "/api/source-annotations",
            json=_create_payload(
                text_anchor={"quote": "x" * 5001},
                pdf_anchor=None,
            ),
        )
        assert resp.status_code == 400

    def test_display_position_requires_body(self, client):
        # Direct domain check: the router path normalizes to NULL first, so
        # the non-NULL+body rule is exercised at the model layer (P1 resumes
        # enforcing it once the normalization is lifted).
        with pytest.raises(Exception):
            SourceAnnotation(
                source=SOURCE_ID,
                color="gold",
                line_style="wavy",
                display_position="margin",
                pdf_anchor=_pdf_anchor(),
            )

    def test_unknown_source_returns_404(self, client, store):
        from open_notebook.exceptions import NotFoundError

        store.source_stub.side_effect = NotFoundError("no such source")
        resp = client.post(
            "/api/source-annotations",
            json=_create_payload(source_id="source:missing"),
        )
        assert resp.status_code == 404


class TestMvpNormalization:
    def test_create_persists_null_display_position(self, client, store):
        resp = client.post(
            "/api/source-annotations",
            json=_create_payload(body="我的理解", display_position="margin"),
        )
        assert resp.status_code == 200
        assert resp.json()["display_position"] is None
        assert store.annotations()[0]["display_position"] is None

    def test_update_normalizes_display_position(self, client, store):
        created = client.post(
            "/api/source-annotations", json=_create_payload(body="批注")
        ).json()
        resp = client.put(
            f"/api/source-annotations/{created['id']}",
            json={"display_position": "inline"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_position"] is None


class TestUpdateDelete:
    def test_update_changes_color_and_refreshes_updated(self, client, store):
        created = client.post("/api/source-annotations", json=_create_payload()).json()
        before = created["updated"]
        # The updated-at assertion below needs the save to land on a later
        # timestamp; without a nudge both can fall inside the same clock tick.
        time.sleep(0.002)
        resp = client.put(
            f"/api/source-annotations/{created['id']}",
            json={"color": "plum", "line_style": "straight"},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["color"] == "plum"
        assert body["line_style"] == "straight"
        assert body["updated"] != before

    def test_update_missing_returns_404(self, client):
        resp = client.put(
            "/api/source-annotations/source_annotation:none",
            json={"color": "plum"},
        )
        assert resp.status_code == 404

    def test_delete_removes_annotation(self, client, store):
        created = client.post("/api/source-annotations", json=_create_payload()).json()
        resp = client.delete(f"/api/source-annotations/{created['id']}")
        assert resp.status_code == 200
        assert client.get(f"/api/source-annotations?source_id={SOURCE_ID}").json() == []


class TestSettings:
    def test_get_defaults_to_empty_names(self, client):
        resp = client.get("/api/annotation-settings")
        assert resp.status_code == 200
        assert resp.json() == {"id": ANNOTATION_SETTINGS_ID, "color_names": {}}

    def test_put_persists_and_gets_back(self, client):
        resp = client.put(
            "/api/annotation-settings",
            json={"color_names": {"gold": "重点", "clay": "易错"}},
        )
        assert resp.status_code == 200
        assert resp.json()["color_names"]["gold"] == "重点"
        assert client.get("/api/annotation-settings").json()["color_names"] == {
            "gold": "重点",
            "clay": "易错",
        }

    def test_put_rejects_unknown_color_and_blank_name(self, client):
        assert (
            client.put(
                "/api/annotation-settings", json={"color_names": {"teal": "AI"}}
            ).status_code
            == 400
        )
        assert (
            client.put(
                "/api/annotation-settings", json={"color_names": {"gold": " "}}
            ).status_code
            == 400
        )


class TestDeleteBackup:
    def _annotation(self, page):
        return SourceAnnotation(
            source=SOURCE_ID,
            color="gold",
            line_style="wavy",
            quote=f"P{page} 划线",
            pdf_anchor=_pdf_anchor(page),
        )

    def test_backup_payload_structure(self, store):
        payload = build_annotation_backup_payload(
            store.source, [self._annotation(3), self._annotation(7)]
        )
        assert payload["kind"] == "source_annotations_backup"
        assert payload["page_count"] == 8
        assert payload["page_count_basis"] == "max_annotated_page_plus_one"
        assert payload["annotation_count"] == 2
        assert payload["source"]["title"] == "真题册"
        assert payload["source"]["url"] == "https://example.com/book.pdf"
        assert len(payload["annotations"]) == 2

    @pytest.mark.asyncio
    async def test_backup_writes_file_and_skips_empty(self, store):
        path = await backup_source_annotations(store.source)
        assert path is None  # no annotations yet -> no file

        store.rows["source_annotation:x"] = {
            "id": "source_annotation:x",
            "table": "source_annotation",
            "source": SOURCE_RECORD,
            "color": "gold",
            "line_style": "wavy",
            "body": None,
            "display_position": None,
            "quote": "划线",
            "text_anchor": None,
            "pdf_anchor": _pdf_anchor(3),
            "page": 3,
            "start_offset": None,
            "created": datetime(2026, 10, 1, tzinfo=timezone.utc),
            "updated": datetime(2026, 10, 1, tzinfo=timezone.utc),
        }
        path = await backup_source_annotations(store.source)
        assert path is not None and path.endswith(".json")
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
        assert payload["annotation_count"] == 1
        assert payload["annotations"][0]["color"] == "gold"
        assert "source:s1" in path or "source-s1" in path
