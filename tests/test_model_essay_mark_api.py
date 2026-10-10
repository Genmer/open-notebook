"""Essay-marks API tests: library / toggle / list / dangling cleanup.

All database access is monkeypatched with an in-memory fake serving both the
service module's queries and the domain mark-state queries.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


class FakeRuankaoDB:
    """In-memory SurrealDB stand-in for every query this feature issues."""

    def __init__(
        self, marks=(), groups=(), members=(), source_ids=(), source_rows=None
    ):
        self.marks = [dict(m) for m in marks]
        self.groups = [dict(g) for g in groups]
        self.members = list(members)  # (group_id, source_id)
        self.source_ids = list(source_ids)
        self.source_rows = source_rows
        self.deleted_mark_ids = []

    def __call__(self, query, vars=None):
        q = " ".join(query.split())
        variables = vars or {}

        if "model_essay_mark" in q:
            if q.startswith("CREATE"):
                mark_id = f"model_essay_mark:auto{len(self.marks) + 1}"
                row = {
                    "id": mark_id,
                    "target_type": str(variables.get("target_type")),
                    "source": str(variables["source"])
                    if variables.get("source")
                    else None,
                    "source_group": (
                        str(variables["source_group"])
                        if variables.get("source_group")
                        else None
                    ),
                    "created": "2026-01-01T00:00:00Z",
                }
                self.marks.append(row)
                return [row]
            if q.startswith("DELETE"):
                mark_id = str(variables.get("id"))
                self.deleted_mark_ids.append(mark_id)
                self.marks = [m for m in self.marks if str(m["id"]) != mark_id]
                return []
            if "WHERE source_group =" in q:
                field, target = "source_group", str(variables.get("target"))
            elif "WHERE source =" in q:
                field, target = "source", str(variables.get("target"))
            else:
                return [dict(m) for m in self.marks]
            return [
                {"id": m["id"]}
                for m in self.marks
                if m.get(field) and str(m[field]) == target
            ]

        if "source_group_member" in q:
            outs = {str(o) for o in variables.get("ids", [])}
            if "VALUE in" in q:
                return [sid for gid, sid in self.members if gid in outs]
            return [{"in": sid, "out": gid} for gid, sid in self.members if gid in outs]

        if "FROM source_group" in q:
            if "source_view = $view" in q:
                view = str(variables.get("view"))
                return [
                    dict(g) for g in self.groups if str(g.get("source_view")) == view
                ]
            return [dict(g) for g in self.groups]

        if q.startswith("SELECT VALUE id FROM source WHERE"):
            requested = {str(i) for i in variables.get("ids", [])}
            return [sid for sid in self.source_ids if sid in requested]

        if q.startswith("SELECT id, title, asset, updated FROM source"):
            if self.source_rows is not None:
                return [dict(r) for r in self.source_rows]
            return [
                {
                    "id": sid,
                    "title": f"title-{sid}",
                    "asset": None,
                    "updated": "2026-01-01",
                }
                for sid in self.source_ids
            ]

        raise AssertionError(f"unexpected query: {q}")


def _mark_db(fake):
    return patch(
        "open_notebook.domain.model_essay_mark.repo_query",
        new_callable=AsyncMock,
        side_effect=fake,
    )


def _service_db(fake):
    return patch(
        "api.ruankao_essay_mark_service.repo_query",
        new_callable=AsyncMock,
        side_effect=fake,
    )


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestLibraryEndpoint:
    def test_library_returns_groups_sources_stats_and_dangling(self, client):
        fake = FakeRuankaoDB(
            marks=[
                {
                    "id": "model_essay_mark:m1",
                    "target_type": "source",
                    "source": "source:essay1",
                    "source_group": None,
                },
                {
                    "id": "model_essay_mark:m2",
                    "target_type": "source_group",
                    "source": None,
                    "source_group": "source_group:folder",
                },
                {
                    "id": "model_essay_mark:m3",
                    "target_type": "source",
                    "source": "source:gone",
                    "source_group": None,
                },
            ],
            groups=[
                {
                    "id": "source_group:folder",
                    "name": "希赛范文",
                    "parent": None,
                    "source_view": "source_view:ai_content",
                },
                {
                    "id": "source_group:sub",
                    "name": "2023上",
                    "parent": "source_group:folder",
                    "source_view": "source_view:ai_content",
                },
                {
                    "id": "source_group:other_view",
                    "name": "别的视图",
                    "parent": None,
                    "source_view": "source_view:ai_title",
                },
            ],
            members=[("source_group:sub", "source:essay2")],
            source_ids=["source:essay1", "source:essay2", "source:normal"],
            source_rows=[
                {
                    "id": "source:essay1",
                    "title": "2023上-论文.md",
                    "asset": {"file_path": "/data/2023上-论文.md"},
                    "updated": "2026-02-01",
                },
                {
                    "id": "source:essay2",
                    "title": "子文件夹成员",
                    "asset": None,
                    "updated": "2026-02-02",
                },
                {
                    "id": "source:normal",
                    "title": "普通来源",
                    "asset": None,
                    "updated": "2026-02-03",
                },
            ],
        )
        with _mark_db(fake), _service_db(fake):
            response = client.get("/api/ruankao/essay-marks/library")

        assert response.status_code == 200
        body = response.json()
        # Direct mark on essay1 (live) + folder subtree member essay2.
        assert body["stats"] == {
            "marked_sources": 1,
            "marked_groups": 1,
            "effective_total": 2,
        }
        groups = {g["id"]: g for g in body["groups"]}
        assert set(groups) == {"source_group:folder", "source_group:sub"}  # view-scoped
        assert groups["source_group:folder"]["marked"] is True
        assert groups["source_group:folder"]["depth"] == 1
        assert groups["source_group:sub"]["depth"] == 2
        assert groups["source_group:sub"]["parent_id"] == "source_group:folder"
        sources = {s["id"]: s for s in body["sources"]}
        assert sources["source:essay1"]["marked_direct"] is True
        assert sources["source:essay1"]["extension"] == "md"
        assert sources["source:essay2"]["marked_direct"] is False
        assert sources["source:essay2"]["via_group_ids"] == ["source_group:folder"]
        assert sources["source:normal"]["marked_direct"] is False
        # The mark on the deleted source is reported, not hidden.
        assert body["dangling_marks"] == [
            {
                "id": "model_essay_mark:m3",
                "target_type": "source",
                "target_id": "source:gone",
            }
        ]

    def test_library_requires_no_view_id(self, client):
        fake = FakeRuankaoDB()
        with _mark_db(fake), _service_db(fake):
            response = client.get("/api/ruankao/essay-marks/library")
        assert response.status_code == 200
        assert response.json()["stats"]["effective_total"] == 0


class TestToggleEndpoint:
    def test_invalid_target_type_returns_400(self, client):
        fake = FakeRuankaoDB()
        with _mark_db(fake), _service_db(fake):
            response = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={"target_type": "folder", "target_id": "source:x"},
            )
        assert response.status_code == 400

    def test_wrong_table_target_id_returns_400(self, client):
        fake = FakeRuankaoDB()
        with _mark_db(fake), _service_db(fake):
            response = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={"target_type": "source", "target_id": "source_group:x"},
            )
        assert response.status_code == 400

    def test_missing_target_returns_404(self, client):
        from open_notebook.domain.notebook import Source
        from open_notebook.exceptions import NotFoundError

        fake = FakeRuankaoDB()
        with (
            _mark_db(fake),
            _service_db(fake),
            patch.object(
                Source, "get", new_callable=AsyncMock, side_effect=NotFoundError("gone")
            ),
        ):
            response = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={"target_type": "source", "target_id": "source:gone"},
            )
        assert response.status_code == 404

    def test_toggle_creates_then_removes_the_mark(self, client):
        from open_notebook.domain.notebook import Source

        fake = FakeRuankaoDB()
        with (
            _mark_db(fake),
            _service_db(fake),
            patch.object(Source, "get", new_callable=AsyncMock, return_value=object()),
        ):
            on = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={"target_type": "source", "target_id": "source:essay1"},
            )
            assert on.status_code == 200
            assert on.json() == {
                "marked": True,
                "target_type": "source",
                "target_id": "source:essay1",
            }
            assert len(fake.marks) == 1

            off = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={"target_type": "source", "target_id": "source:essay1"},
            )
            assert off.status_code == 200
            assert off.json()["marked"] is False
            assert fake.marks == []
            assert fake.deleted_mark_ids  # the DELETE statement ran

    def test_toggle_group_target(self, client):
        from open_notebook.domain.source_grouping import SourceGroup

        fake = FakeRuankaoDB()
        with (
            _mark_db(fake),
            _service_db(fake),
            patch.object(
                SourceGroup, "get", new_callable=AsyncMock, return_value=object()
            ),
        ):
            response = client.post(
                "/api/ruankao/essay-marks/toggle",
                json={
                    "target_type": "source_group",
                    "target_id": "source_group:folder",
                },
            )
        assert response.status_code == 200
        assert response.json()["marked"] is True
        assert fake.marks[0]["source_group"] == "source_group:folder"


class TestListMarksEndpoint:
    def test_list_marks_with_source_status(self, client):
        fake = FakeRuankaoDB(
            marks=[
                {
                    "id": "model_essay_mark:m1",
                    "target_type": "source",
                    "source": "source:essay1",
                    "source_group": None,
                    "created": "2026-01-01T00:00:00Z",
                },
                {
                    "id": "model_essay_mark:m2",
                    "target_type": "source_group",
                    "source": None,
                    "source_group": "source_group:folder",
                    "created": "2026-01-02T00:00:00Z",
                },
            ],
            groups=[{"id": "source_group:folder", "parent": None}],
            members=[("source_group:folder", "source:essay2")],
            source_ids=["source:essay1"],
        )
        with _mark_db(fake), _service_db(fake):
            response = client.get("/api/ruankao/essay-marks?source_id=source:essay2")

        assert response.status_code == 200
        body = response.json()
        assert len(body["marks"]) == 2
        assert body["stats"]["effective_total"] == 2
        assert body["effective_source_ids"] == ["source:essay1", "source:essay2"]
        assert body["source"] == {
            "id": "source:essay2",
            "marked_direct": False,
            "via_group_ids": ["source_group:folder"],
            "effective": True,
        }

    def test_list_marks_without_source_id(self, client):
        fake = FakeRuankaoDB()
        with _mark_db(fake), _service_db(fake):
            response = client.get("/api/ruankao/essay-marks")
        assert response.status_code == 200
        assert response.json()["source"] is None


class TestDanglingCleanupEndpoint:
    def test_cleanup_removes_dangling_marks(self, client):
        fake = FakeRuankaoDB(
            marks=[
                {
                    "id": "model_essay_mark:m1",
                    "target_type": "source",
                    "source": "source:alive",
                    "source_group": None,
                },
                {
                    "id": "model_essay_mark:m2",
                    "target_type": "source",
                    "source": "source:gone",
                    "source_group": None,
                },
                {
                    "id": "model_essay_mark:m3",
                    "target_type": "source_group",
                    "source": None,
                    "source_group": "source_group:gone",
                },
            ],
            groups=[],
            source_ids=["source:alive"],
        )
        with _mark_db(fake), _service_db(fake):
            response = client.delete("/api/ruankao/essay-marks?dangling=true")

        assert response.status_code == 200
        assert response.json() == {"removed": 2}
        assert fake.deleted_mark_ids == ["model_essay_mark:m2", "model_essay_mark:m3"]
        assert [m["id"] for m in fake.marks] == ["model_essay_mark:m1"]

    def test_cleanup_requires_dangling_true(self, client):
        fake = FakeRuankaoDB()
        with _mark_db(fake), _service_db(fake):
            response = client.delete("/api/ruankao/essay-marks")
        assert response.status_code == 400

        with _mark_db(fake), _service_db(fake):
            response = client.delete("/api/ruankao/essay-marks?dangling=false")
        assert response.status_code == 400
