"""
Tests for the Zhipu (BigModel) provider: esperanto profile registration,
base URL resolution (default paas/v4 vs Coding Plan endpoint) and model
type classification.
"""

import pytest
from esperanto import AIFactory

import open_notebook.ai  # noqa: F401 — registers the zhipu profile
from open_notebook.ai.model_discovery import classify_model_type

DEFAULT_BASE_URL = "https://open.bigmodel.cn/api/paas/v4"
CODING_BASE_URL = "https://open.bigmodel.cn/api/coding/paas/v4"


@pytest.fixture(autouse=True)
def _clean_zhipu_env(monkeypatch):
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)
    monkeypatch.delenv("ZHIPU_API_BASE", raising=False)


class TestZhipuProfile:
    def test_create_language_model(self):
        model = AIFactory.create_language(
            "zhipu", "glm-4-flash", {"api_key": "test-key"}
        )
        assert model.base_url == DEFAULT_BASE_URL

    def test_create_embedding_model(self):
        model = AIFactory.create_embedding(
            "zhipu", "embedding-3", {"api_key": "test-key"}
        )
        assert model.base_url == DEFAULT_BASE_URL

    def test_config_base_url_overrides_profile_default(self):
        """A Coding Plan key only works against the coding endpoint, so an
        explicit credential base_url must win over the profile default."""
        model = AIFactory.create_language(
            "zhipu",
            "glm-4.6",
            {"api_key": "test-key", "base_url": CODING_BASE_URL},
        )
        assert model.base_url == CODING_BASE_URL

    def test_api_key_from_env(self, monkeypatch):
        monkeypatch.setenv("ZHIPU_API_KEY", "env-key")
        model = AIFactory.create_language("zhipu", "glm-4-flash", {})
        assert model.api_key == "env-key"

    def test_base_url_from_env(self, monkeypatch):
        monkeypatch.setenv("ZHIPU_API_BASE", CODING_BASE_URL)
        model = AIFactory.create_language(
            "zhipu", "glm-4-flash", {"api_key": "test-key"}
        )
        assert model.base_url == CODING_BASE_URL


class TestZhipuModelClassification:
    def test_embedding_models(self):
        assert classify_model_type("embedding-2", "zhipu") == "embedding"
        assert classify_model_type("embedding-3", "zhipu") == "embedding"

    def test_language_models(self):
        assert classify_model_type("glm-4.6", "zhipu") == "language"
        assert classify_model_type("glm-4-flash", "zhipu") == "language"
