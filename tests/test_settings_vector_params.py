"""
Tests for the runtime vectorization parameters (chunk_size / chunk_overlap /
min_chunk_size / embedding_batch_size): API validation, DB > env > default
resolution and the fail-open snapshot refresh.
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.models import SettingsUpdate
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.exceptions import ConfigurationError
from open_notebook.utils.embedding_config import (
    EmbeddingParams,
    get_embedding_params,
    refresh_embedding_params,
    reset_embedding_params_cache,
    resolve_params,
    validate_params,
)

ENV_VARS = {
    "chunk_size": "OPEN_NOTEBOOK_CHUNK_SIZE",
    "chunk_overlap": "OPEN_NOTEBOOK_CHUNK_OVERLAP",
    "min_chunk_size": "OPEN_NOTEBOOK_MIN_CHUNK_SIZE",
    "embedding_batch_size": "OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE",
}


@pytest.fixture(autouse=True)
def _clean_embedding_env(monkeypatch):
    for var in ENV_VARS.values():
        monkeypatch.delenv(var, raising=False)
    reset_embedding_params_cache()
    yield
    reset_embedding_params_cache()


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


class TestSettingsUpdateValidation:
    def test_rejects_small_chunk_size(self):
        with pytest.raises(ValidationError):
            SettingsUpdate(chunk_size=99)

    def test_rejects_negative_overlap(self):
        with pytest.raises(ValidationError):
            SettingsUpdate(chunk_overlap=-1)

    def test_rejects_zero_batch_size(self):
        with pytest.raises(ValidationError):
            SettingsUpdate(embedding_batch_size=0)

    def test_api_returns_422_for_field_violations(self, client):
        response = client.put("/api/settings", json={"chunk_size": 10})
        assert response.status_code == 422

    def test_api_returns_422_for_cross_field_violation(self, client, monkeypatch):
        """overlap >= chunk_size passes per-field checks but must fail the
        merged validation with 422 — stub the settings record so no DB is hit."""
        stub = SimpleNamespace(
            default_content_processing_engine_doc=None,
            default_content_processing_engine_url=None,
            default_embedding_option=None,
            auto_delete_files=None,
            docling_ocr=None,
            docling_formulas=None,
            docling_vision=None,
            usage_tracking_enabled=True,
            youtube_preferred_languages=None,
            chunk_size=None,
            chunk_overlap=None,
            min_chunk_size=None,
            embedding_batch_size=None,
        )

        async def _get_instance():
            return stub

        async def _update():
            return None

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.update", _update
        )
        response = client.put(
            "/api/settings", json={"chunk_size": 400, "chunk_overlap": 400}
        )
        assert response.status_code == 422

    def test_api_returns_200_for_min_chunk_size_with_derived_overlap(
        self, client, monkeypatch
    ):
        """chunk_size=100 is the smallest legal value; with no stored or env
        overlap it derives to 15 (15%) and must be accepted, not rejected."""
        stub = SimpleNamespace(
            default_content_processing_engine_doc=None,
            default_content_processing_engine_url=None,
            default_embedding_option=None,
            auto_delete_files=None,
            docling_ocr=None,
            docling_formulas=None,
            docling_vision=None,
            usage_tracking_enabled=True,
            youtube_preferred_languages=None,
            chunk_size=None,
            chunk_overlap=None,
            min_chunk_size=None,
            embedding_batch_size=None,
        )

        async def _update():
            return None

        stub.update = _update

        async def _get_instance():
            return stub

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        response = client.put("/api/settings", json={"chunk_size": 100})
        assert response.status_code == 200
        assert response.json()["effective_chunk_size"] == 100
        assert response.json()["effective_chunk_overlap"] == 15

    def test_api_returns_422_when_lowering_chunk_size_below_persisted_overlap(
        self, client, monkeypatch
    ):
        """chunk_size=1000 + overlap=500 are already stored; lowering only
        chunk_size to 100 would leave overlap >= chunk_size, so the merged
        validation must reject it with 422."""
        stub = SimpleNamespace(
            default_content_processing_engine_doc=None,
            default_content_processing_engine_url=None,
            default_embedding_option=None,
            auto_delete_files=None,
            docling_ocr=None,
            docling_formulas=None,
            docling_vision=None,
            usage_tracking_enabled=True,
            youtube_preferred_languages=None,
            chunk_size=1000,
            chunk_overlap=500,
            min_chunk_size=None,
            embedding_batch_size=None,
        )

        async def _update():
            return None

        stub.update = _update

        async def _get_instance():
            return stub

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        response = client.put("/api/settings", json={"chunk_size": 100})
        assert response.status_code == 422


class TestResolveParams:
    def test_defaults_when_no_env_no_db(self):
        assert resolve_params(None) == EmbeddingParams(
            chunk_size=400,
            chunk_overlap=60,
            min_chunk_size=5,
            embedding_batch_size=50,
        )

    def test_env_chunk_size_below_minimum_clamped_to_100(self, monkeypatch):
        """Legacy installs may carry OPEN_NOTEBOOK_CHUNK_SIZE < 100; clamp up."""
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "50")
        assert resolve_params(None).chunk_size == 100

    def test_env_invalid_chunk_size_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "abc")
        assert resolve_params(None).chunk_size == 400

    def test_env_overlap_ge_chunk_size_falls_back_to_15_percent(self, monkeypatch):
        """Stored/env combos that violate overlap < chunk_size degrade to 15%."""
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "512")
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_OVERLAP", "9999")
        assert resolve_params(None).chunk_overlap == 76  # int(512 * 0.15)

    def test_env_negative_overlap_clamped_to_zero(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_OVERLAP", "-5")
        assert resolve_params(None).chunk_overlap == 0

    def test_env_invalid_batch_size_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE", "0")
        assert resolve_params(None).embedding_batch_size == 50

    def test_env_overrides_defaults(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "512")
        monkeypatch.setenv("OPEN_NOTEBOOK_EMBEDDING_BATCH_SIZE", "10")
        params = resolve_params(None)
        assert params.chunk_size == 512
        assert params.embedding_batch_size == 10
        # Overlap has no explicit value: it derives from the final chunk size.
        assert params.chunk_overlap == 76  # int(512 * 0.15)
        assert params.min_chunk_size == 5

    def test_env_chunk_size_1500_derives_overlap_225(self, monkeypatch):
        """Legacy installs with only OPEN_NOTEBOOK_CHUNK_SIZE=1500 must keep
        the old 15% overlap behaviour (225), not a fixed default."""
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "1500")
        assert resolve_params(None).chunk_overlap == 225

    def test_env_chunk_size_100_boundary_derives_overlap_15(self, monkeypatch):
        """Lower boundary of the 15% rule: chunk_size=100 -> overlap=15."""
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "100")
        assert resolve_params(None).chunk_overlap == 15

    def test_db_overrides_env(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "512")
        settings = SimpleNamespace(
            chunk_size=800,
            chunk_overlap=None,
            min_chunk_size=2,
            embedding_batch_size=None,
        )
        params = resolve_params(settings)
        assert params.chunk_size == 800  # DB wins over env
        assert params.min_chunk_size == 2  # DB wins over default
        # Overlap derives from the FINAL chunk size (DB), not the env one.
        assert params.chunk_overlap == 120  # int(800 * 0.15)
        assert params.embedding_batch_size == 50

    def test_explicit_env_overlap_kept_when_db_sets_chunk_size(self, monkeypatch):
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_OVERLAP", "100")
        settings = SimpleNamespace(
            chunk_size=800,
            chunk_overlap=None,
            min_chunk_size=None,
            embedding_batch_size=None,
        )
        params = resolve_params(settings)
        assert params.chunk_overlap == 100


class TestValidateParams:
    def test_accepts_valid_params(self):
        validate_params(EmbeddingParams(400, 60, 5, 50))

    def test_rejects_overlap_ge_chunk_size(self):
        with pytest.raises(ConfigurationError):
            validate_params(EmbeddingParams(400, 400, 5, 50))

    def test_rejects_small_chunk_size(self):
        with pytest.raises(ConfigurationError):
            validate_params(EmbeddingParams(50, 0, 5, 50))

    def test_rejects_negative_min_chunk_size(self):
        with pytest.raises(ConfigurationError):
            validate_params(EmbeddingParams(400, 60, -1, 50))

    def test_rejects_zero_batch_size(self):
        with pytest.raises(ConfigurationError):
            validate_params(EmbeddingParams(400, 60, 5, 0))


class TestRefreshEmbeddingParams:
    @pytest.mark.asyncio
    async def test_refresh_stores_db_snapshot(self):
        settings = SimpleNamespace(
            chunk_size=600,
            chunk_overlap=80,
            min_chunk_size=10,
            embedding_batch_size=16,
        )
        refreshed = await refresh_embedding_params(settings)
        assert refreshed == EmbeddingParams(600, 80, 10, 16)
        assert get_embedding_params() == EmbeddingParams(600, 80, 10, 16)

    @pytest.mark.asyncio
    async def test_refresh_fails_open_on_db_error(self, monkeypatch):
        # Seed a known-good snapshot first.
        await refresh_embedding_params(
            SimpleNamespace(
                chunk_size=600,
                chunk_overlap=80,
                min_chunk_size=10,
                embedding_batch_size=16,
            )
        )

        async def _boom():
            raise RuntimeError("db unreachable")

        monkeypatch.setattr(ContentSettings, "get_instance", _boom)
        refreshed = await refresh_embedding_params()
        assert refreshed == EmbeddingParams(600, 80, 10, 16)

    @pytest.mark.asyncio
    async def test_refresh_fails_open_on_invalid_db_values(self):
        refreshed = await refresh_embedding_params(
            SimpleNamespace(
                chunk_size=400,
                chunk_overlap=4000,
                min_chunk_size=0,
                embedding_batch_size=50,
            )
        )
        # Falls back to env/default values instead of persisting a broken combo.
        assert refreshed == EmbeddingParams(400, 60, 5, 50)

    @pytest.mark.asyncio
    async def test_first_refresh_db_failure_keeps_env_values(self, monkeypatch):
        """No snapshot exists yet and the DB is unreachable: callers must still
        get usable env-derived values, and the snapshot stays unset."""
        monkeypatch.setenv("OPEN_NOTEBOOK_CHUNK_SIZE", "700")

        async def _boom():
            raise RuntimeError("db unreachable")

        monkeypatch.setattr(ContentSettings, "get_instance", _boom)
        refreshed = await refresh_embedding_params()
        assert refreshed.chunk_size == 700
        # Snapshot was never stored; env resolution keeps answering.
        assert get_embedding_params().chunk_size == 700


class TestGetSettingsShape:
    def test_get_returns_raw_none_plus_effective_values(self, client, monkeypatch):
        """GET must expose unset DB values as null (so the UI leaves the inputs
        blank instead of writing resolved values back) plus read-only
        effective_* values for display."""
        stub = SimpleNamespace(
            default_content_processing_engine_doc=None,
            default_content_processing_engine_url=None,
            default_embedding_option=None,
            auto_delete_files=None,
            docling_ocr=None,
            docling_formulas=None,
            docling_vision=None,
            usage_tracking_enabled=True,
            youtube_preferred_languages=None,
            chunk_size=None,
            chunk_overlap=None,
            min_chunk_size=None,
            embedding_batch_size=None,
        )

        async def _get_instance():
            return stub

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        response = client.get("/api/settings")
        assert response.status_code == 200
        data = response.json()
        assert data["chunk_size"] is None
        assert data["chunk_overlap"] is None
        assert data["min_chunk_size"] is None
        assert data["embedding_batch_size"] is None
        assert data["effective_chunk_size"] == 400
        assert data["effective_chunk_overlap"] == 60  # 15% of 400
        assert data["effective_min_chunk_size"] == 5
        assert data["effective_embedding_batch_size"] == 50


class TestPutUpdatesRuntimeSnapshot:
    def _stub_settings(self):
        return SimpleNamespace(
            default_content_processing_engine_doc="auto",
            default_content_processing_engine_url="auto",
            default_embedding_option="ask",
            auto_delete_files="no",
            docling_ocr=True,
            docling_formulas=False,
            docling_vision=False,
            youtube_preferred_languages=None,
            usage_tracking_enabled=True,
            chunk_size=None,
            chunk_overlap=None,
            min_chunk_size=None,
            embedding_batch_size=None,
        )

    def test_put_of_non_vector_field_does_not_set_vector_fields(
        self, client, monkeypatch
    ):
        """Saving unrelated settings must not freeze resolved env values into
        the DB — the vector fields stay unset so env vars keep priority."""
        stub = self._stub_settings()
        persisted: dict = {}

        async def _update():
            persisted.update(
                chunk_size=stub.chunk_size,
                chunk_overlap=stub.chunk_overlap,
                min_chunk_size=stub.min_chunk_size,
                embedding_batch_size=stub.embedding_batch_size,
            )

        stub.update = _update

        async def _get_instance():
            return stub

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        response = client.put(
            "/api/settings", json={"default_embedding_option": "always"}
        )
        assert response.status_code == 200
        assert persisted == {
            "chunk_size": None,
            "chunk_overlap": None,
            "min_chunk_size": None,
            "embedding_batch_size": None,
        }
        # Raw fields stay null in the response; effective values are resolved.
        data = response.json()
        assert data["chunk_size"] is None
        assert data["effective_chunk_size"] == 400

    def test_put_persists_and_runtime_snapshot_matches(self, client, monkeypatch):
        """After a valid PUT the response, the persisted settings and the live
        embedding params snapshot must all carry the new value (T1.3 contract)."""
        stub = self._stub_settings()

        async def _stub_update():
            return None

        stub.update = _stub_update

        async def _get_instance():
            return stub

        monkeypatch.setattr(
            "api.routers.settings.ContentSettings.get_instance", _get_instance
        )
        response = client.put("/api/settings", json={"chunk_size": 800})
        assert response.status_code == 200
        assert response.json()["chunk_size"] == 800
        assert response.json()["effective_chunk_size"] == 800
        # The runtime snapshot picked up the new value without a restart.
        assert get_embedding_params().chunk_size == 800


class TestDynamicEffectOnChunking:
    @pytest.mark.asyncio
    async def test_chunk_text_uses_refreshed_params_without_restart(self):
        """T1.3: after refresh, new chunking work uses the new granularity."""
        from open_notebook.utils.chunking import chunk_text
        from open_notebook.utils.token_utils import token_count

        fragment = "This is a sentence for the dynamic chunking test. "
        text = ""
        while token_count(text) <= 500:
            text += fragment  # > default 400, would be split by defaults

        assert len(chunk_text(text)) > 1  # split under default chunk_size=400

        await refresh_embedding_params(
            SimpleNamespace(
                chunk_size=2000,
                chunk_overlap=60,
                min_chunk_size=5,
                embedding_batch_size=50,
            )
        )
        # Same text now fits in one chunk under the refreshed params.
        assert chunk_text(text) == [text]

    def test_explicit_params_override_snapshot(self):
        """Callers may pass explicit params; they win over the shared snapshot."""
        from open_notebook.utils.chunking import chunk_text
        from open_notebook.utils.token_utils import token_count

        fragment = "Explicit params must take precedence over the snapshot. "
        text = ""
        while token_count(text) <= 300:
            text += fragment

        small = EmbeddingParams(
            chunk_size=100, chunk_overlap=0, min_chunk_size=0, embedding_batch_size=50
        )
        chunks = chunk_text(text, params=small)
        assert len(chunks) > 1
        assert all(token_count(c) <= 100 for c in chunks)
