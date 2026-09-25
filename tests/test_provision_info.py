"""
Unit tests for provision_langchain_model_with_info (open_notebook/ai/provision.py).

Verifies that the returned ProvisionedModel carries the metadata usage
tracking needs (model_name/provider/model_id) for every selection path.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from esperanto import LanguageModel

from open_notebook.ai.provision import (
    ProvisionedModel,
    provision_langchain_model,
    provision_langchain_model_with_info,
)
from open_notebook.exceptions import ConfigurationError


def _fake_esperanto_model(name: str = "test-model", provider: str = "openai") -> MagicMock:
    model = MagicMock(spec=LanguageModel)
    model.model_name = name
    model.provider = provider
    model.to_langchain.return_value = MagicMock(name="langchain_model")
    return model


@pytest.mark.asyncio
async def test_default_path_returns_model_metadata():
    fake = _fake_esperanto_model("gpt-4o-mini", "openai")
    with patch("open_notebook.ai.provision.model_manager") as manager:
        manager.get_default_model = AsyncMock(return_value=fake)
        prov = await provision_langchain_model_with_info("hello", None, "chat")

    assert isinstance(prov, ProvisionedModel)
    assert prov.model_name == "gpt-4o-mini"
    assert prov.provider == "openai"
    assert prov.model_id is None
    assert manager.get_default_model.await_args.args[0] == "chat"


@pytest.mark.asyncio
async def test_large_context_path_reports_large_context_model_name():
    fake = _fake_esperanto_model("gpt-4o-large", "openai")
    with (
        patch("open_notebook.ai.provision.model_manager") as manager,
        patch("open_notebook.ai.provision.token_count", return_value=200_000),
    ):
        manager.get_default_model = AsyncMock(return_value=fake)
        prov = await provision_langchain_model_with_info("tiny content", None, "chat")

    assert manager.get_default_model.await_args.args[0] == "large_context"
    assert prov.model_name == "gpt-4o-large"
    assert "large_context" in prov.selection_reason


@pytest.mark.asyncio
async def test_explicit_model_id_path_sets_model_id():
    fake = _fake_esperanto_model("custom", "ollama")
    with patch("open_notebook.ai.provision.model_manager") as manager:
        manager.get_model = AsyncMock(return_value=fake)
        prov = await provision_langchain_model_with_info("hello", "model:abc", "chat")

    assert prov.model_id == "model:abc"
    assert prov.model_name == "custom"
    manager.get_model.assert_awaited_once()


@pytest.mark.asyncio
async def test_thin_wrapper_returns_only_langchain_model():
    fake = _fake_esperanto_model()
    with patch("open_notebook.ai.provision.model_manager") as manager:
        manager.get_default_model = AsyncMock(return_value=fake)
        model = await provision_langchain_model("hello", None, "chat")

    assert model is fake.to_langchain.return_value


@pytest.mark.asyncio
async def test_missing_model_raises_configuration_error():
    with patch("open_notebook.ai.provision.model_manager") as manager:
        manager.get_default_model = AsyncMock(return_value=None)
        with pytest.raises(ConfigurationError):
            await provision_langchain_model_with_info("hello", None, "chat")
