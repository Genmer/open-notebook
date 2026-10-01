"""Tests for the section-analysis endpoint (api.source_analysis_service + router)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.source_analysis_service import (
    MAX_SECTION_CHARS,
    analyze_source_section,
)

MODEL_OUTPUT = """## 本章内容理解
这一章讲了需求工程的基础概念。
## 重点提炼
- 需求分为功能性与非功能性两类。
## 记忆方向
- 结合课程案例复述两类需求的差异。"""

SOURCE_ROW = {"id": "source:1"}


def _provisioned(output: str = MODEL_OUTPUT):
    invoke = MagicMock(return_value=SimpleNamespace(content=output))
    return SimpleNamespace(
        langchain_model=SimpleNamespace(invoke=invoke),
        model_name="glm-4",
        provider="zhipu",
        model_id=None,
    )


@pytest.fixture
def model_mocks():
    """Patch everything the service touches beyond the source existence check."""
    with (
        patch("api.source_analysis_service.Source") as source_cls,
        patch(
            "api.source_analysis_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
        ) as provision,
        patch(
            "api.source_analysis_service.record_llm_usage", new_callable=AsyncMock
        ) as record_usage,
    ):
        source_cls.get = AsyncMock(return_value=SimpleNamespace(id="source:1"))
        yield source_cls, provision, record_usage


@pytest.mark.asyncio
async def test_analyze_happy_path(model_mocks):
    source_cls, provision, record_usage = model_mocks
    provision.return_value = _provisioned()

    result = await analyze_source_section(
        source_id="source:1",
        section_title="引言",
        section_text="本章介绍……",
        page_start=3,
        page_end=7,
        locale="zh-CN",
    )

    assert result["analysis_markdown"] == MODEL_OUTPUT
    assert result["model_name"] == "glm-4"
    assert result["provider"] == "zhipu"
    assert result["truncated"] is False

    # Prompt carries the template materials incl. the locale-derived language.
    prompt = provision.await_args.args[0]
    assert "引言" in prompt
    assert "3-7" in prompt
    assert "Simplified Chinese" in prompt
    assert "本章介绍……" in prompt

    # Usage row: dedicated call_type keyed to the source.
    record_usage.assert_awaited_once_with(
        model=provision.return_value,
        ai_message=provision.return_value.langchain_model.invoke.return_value,
        call_type="source_section_analysis",
        correlation_id="source:1",
    )


@pytest.mark.asyncio
async def test_analyze_404_for_missing_source(model_mocks):
    from open_notebook.exceptions import NotFoundError

    source_cls, provision, record_usage = model_mocks
    source_cls.get = AsyncMock(return_value=None)

    with pytest.raises(NotFoundError):
        await analyze_source_section(
            source_id="source:gone",
            section_title="t",
            section_text="x",
            page_start=None,
            page_end=None,
            locale="en-US",
        )
    provision.assert_not_awaited()
    record_usage.assert_not_awaited()


@pytest.mark.asyncio
async def test_analyze_flags_truncation_over_max_chars(model_mocks):
    source_cls, provision, _ = model_mocks
    provision.return_value = _provisioned()

    long_text = "§" * (MAX_SECTION_CHARS + 1)
    result = await analyze_source_section(
        source_id="source:1",
        section_title="Big",
        section_text=long_text,
        page_start=None,
        page_end=None,
        locale="en-US",
    )

    assert result["truncated"] is True
    # The prompt only carries the capped text — exactly MAX_SECTION_CHARS fillers
    # (§ appears nowhere in the prompt template itself).
    prompt = provision.await_args.args[0]
    assert prompt.count("§") == MAX_SECTION_CHARS


@pytest.mark.asyncio
async def test_analyze_records_failure_and_reraises_on_model_error(model_mocks):
    source_cls, provision, record_usage = model_mocks
    provision.side_effect = RuntimeError("provider exploded")

    with pytest.raises(RuntimeError):
        await analyze_source_section(
            source_id="source:1",
            section_title="t",
            section_text="x",
            page_start=None,
            page_end=None,
            locale="en-US",
        )

    # Failure is still metered (success=False) before propagating.
    record_usage.assert_awaited_once()
    kwargs = record_usage.await_args.kwargs
    assert kwargs["call_type"] == "source_section_analysis"
    assert kwargs["correlation_id"] == "source:1"
    assert kwargs["success"] is False
    assert "provider exploded" in kwargs["error"]


@pytest.mark.asyncio
async def test_analyze_unconfigured_model_raises_configuration_error(model_mocks):
    from open_notebook.exceptions import ConfigurationError

    source_cls, provision, record_usage = model_mocks
    provision.side_effect = ConfigurationError(
        "No model configured for default for type=transformation. "
        "Please go to Manage → Models and configure a default model for 'transformation'."
    )

    with pytest.raises(ConfigurationError):
        await analyze_source_section(
            source_id="source:1",
            section_title="t",
            section_text="x",
            page_start=None,
            page_end=None,
            locale="en-US",
        )
    record_usage.assert_awaited_once()


@pytest.mark.asyncio
async def test_analyze_timeout_maps_to_external_service_error(model_mocks, monkeypatch):
    import api.source_analysis_service as service
    from open_notebook.exceptions import ExternalServiceError

    source_cls, provision, record_usage = model_mocks

    def slow_invoke(_payload):
        import time

        time.sleep(0.2)
        return SimpleNamespace(content="late")

    provision.return_value = SimpleNamespace(
        langchain_model=SimpleNamespace(invoke=slow_invoke),
        model_name="glm-4",
        provider="zhipu",
        model_id=None,
    )
    monkeypatch.setattr(service, "SECTION_ANALYSIS_TIMEOUT_SECONDS", 0.01)

    with pytest.raises(ExternalServiceError):
        await analyze_source_section(
            source_id="source:1",
            section_title="t",
            section_text="x",
            page_start=None,
            page_end=None,
            locale="en-US",
        )
    assert record_usage.await_args.kwargs["success"] is False


# ---------------------------------------------------------------------------
# HTTP endpoint wiring
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_endpoint_200_returns_analysis(client):
    with (
        patch("api.source_analysis_service.Source") as source_cls,
        patch(
            "api.source_analysis_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
        ) as provision,
        patch("api.source_analysis_service.record_llm_usage", new_callable=AsyncMock),
    ):
        source_cls.get = AsyncMock(return_value=SimpleNamespace(id="source:1"))
        provision.return_value = _provisioned()

        response = client.post(
            "/api/sources/source:1/sections/analyze",
            json={
                "section_title": "引言",
                "section_text": "正文……",
                "page_start": 1,
                "page_end": 2,
                "locale": "zh-CN",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["analysis_markdown"] == MODEL_OUTPUT
    assert body["model_name"] == "glm-4"
    assert body["provider"] == "zhipu"
    assert body["truncated"] is False


def test_endpoint_404_for_unknown_source(client):
    with patch("api.source_analysis_service.Source") as source_cls:
        source_cls.get = AsyncMock(return_value=None)
        response = client.post(
            "/api/sources/source:gone/sections/analyze",
            json={"section_title": "t", "section_text": "x", "locale": "en-US"},
        )
    assert response.status_code == 404


def test_endpoint_422_when_no_model_configured(client):
    from open_notebook.exceptions import ConfigurationError

    with (
        patch("api.source_analysis_service.Source") as source_cls,
        patch(
            "api.source_analysis_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            side_effect=ConfigurationError(
                "No model configured for default for type=transformation. "
                "Please go to Manage → Models and configure a default model for 'transformation'."
            ),
        ),
        patch("api.source_analysis_service.record_llm_usage", new_callable=AsyncMock),
    ):
        source_cls.get = AsyncMock(return_value=SimpleNamespace(id="source:1"))
        response = client.post(
            "/api/sources/source:1/sections/analyze",
            json={"section_title": "t", "section_text": "x", "locale": "en-US"},
        )
    # Global handler maps ConfigurationError → 422 (api/main.py) with the
    # Manage → Models guidance from provision.py.
    assert response.status_code == 422
    assert "Manage" in response.json()["detail"]


def test_endpoint_500_for_unexpected_model_error(client):
    with (
        patch("api.source_analysis_service.Source") as source_cls,
        patch(
            "api.source_analysis_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            side_effect=RuntimeError("kaboom"),
        ),
        patch("api.source_analysis_service.record_llm_usage", new_callable=AsyncMock),
    ):
        source_cls.get = AsyncMock(return_value=SimpleNamespace(id="source:1"))
        response = client.post(
            "/api/sources/source:1/sections/analyze",
            json={"section_title": "t", "section_text": "x", "locale": "en-US"},
        )
    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to analyze section"


def test_endpoint_validates_section_title_length(client):
    response = client.post(
        "/api/sources/source:1/sections/analyze",
        json={"section_title": "t" * 301, "section_text": "x", "locale": "en-US"},
    )
    assert response.status_code == 422
