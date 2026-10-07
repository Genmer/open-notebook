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
# Streaming variant (on_delta) — used by the async command for live progress
# ---------------------------------------------------------------------------


def _streaming_provisioned(chunks):
    async def astream(_payload):
        for chunk in chunks:
            yield chunk

    return SimpleNamespace(
        langchain_model=SimpleNamespace(astream=astream),
        model_name="glm-4",
        provider="zhipu",
        model_id=None,
    )


async def _noop_delta(_delta: str) -> None:
    return None


@pytest.mark.asyncio
async def test_analyze_streaming_forwards_deltas_and_aggregates(model_mocks):
    from langchain_core.messages import AIMessageChunk

    source_cls, provision, record_usage = model_mocks
    chunks = [AIMessageChunk(content="第一段"), AIMessageChunk(content="第二段")]
    provision.return_value = _streaming_provisioned(chunks)

    deltas = []

    async def on_delta(delta: str):
        deltas.append(delta)

    result = await analyze_source_section(
        source_id="source:1",
        section_title="引言",
        section_text="本章介绍……",
        page_start=None,
        page_end=None,
        locale="zh-CN",
        on_delta=on_delta,
    )

    assert deltas == ["第一段", "第二段"]
    assert result["analysis_markdown"] == "第一段第二段"
    # Usage is metered from the aggregated stream message.
    aggregated = record_usage.await_args.kwargs["ai_message"]
    assert aggregated.content == "第一段第二段"


@pytest.mark.asyncio
async def test_analyze_streaming_empty_stream_raises(model_mocks):
    from open_notebook.exceptions import ExternalServiceError

    source_cls, provision, record_usage = model_mocks
    provision.return_value = _streaming_provisioned([])

    with pytest.raises(ExternalServiceError):
        await analyze_source_section(
            source_id="source:1",
            section_title="t",
            section_text="x",
            page_start=None,
            page_end=None,
            locale="en-US",
            on_delta=_noop_delta,
        )
    assert record_usage.await_args.kwargs["success"] is False


@pytest.mark.asyncio
async def test_analyze_streaming_timeout_maps_to_external_error(
    model_mocks, monkeypatch
):
    from langchain_core.messages import AIMessageChunk

    import api.source_analysis_service as service
    from open_notebook.exceptions import ExternalServiceError

    source_cls, provision, record_usage = model_mocks

    async def slow_astream(_payload):
        import asyncio

        for text in ["a", "b"]:
            await asyncio.sleep(0.05)
            yield AIMessageChunk(content=text)

    provision.return_value = SimpleNamespace(
        langchain_model=SimpleNamespace(astream=slow_astream),
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
            on_delta=_noop_delta,
        )
    assert record_usage.await_args.kwargs["success"] is False


# ---------------------------------------------------------------------------
# Command layer (commands/source_commands.analyze_section_command)
# ---------------------------------------------------------------------------


class SectionStateRecorder:
    """Records section_analysis_state writes; rejects anything else."""

    def __init__(self):
        self.writes = []
        self.deletes = []

    async def __call__(self, sql, params=None):
        if "UPSERT $target SET progress" in sql:
            self.writes.append(params["progress"])
            return []
        if "DELETE $target" in sql:
            self.deletes.append(str(params["target"]))
            return []
        raise AssertionError(f"Unexpected query: {sql[:120]}")


@pytest.mark.asyncio
async def test_section_command_writes_state_stream_and_cleans_up(monkeypatch):
    from commands.source_commands import AnalyzeSectionInput, analyze_section_command

    monkeypatch.setattr("commands.source_commands.SECTION_STATE_FLUSH_SECONDS", 0.0)
    recorder = SectionStateRecorder()

    async def fake_analyze(**kwargs):
        on_delta = kwargs["on_delta"]
        assert kwargs["source_id"] == "source:1"
        for piece in ["第一段", "第二段"]:
            await on_delta(piece)
        return {
            "analysis_markdown": "第一段第二段",
            "model_name": "glm-4",
            "provider": "zhipu",
            "truncated": False,
        }

    with (
        patch("commands.source_commands.repo_query", new=recorder),
        patch("api.source_analysis_service.analyze_source_section", new=fake_analyze),
    ):
        output = await analyze_section_command(
            AnalyzeSectionInput(
                source_id="source:1",
                section_title="引言",
                section_text="正文……",
                page_start=3,
                page_end=7,
                locale="zh-CN",
            )
        )

    assert output.success is True
    assert output.analysis_markdown == "第一段第二段"
    assert output.model_name == "glm-4"

    stages = [w["stage"] for w in recorder.writes]
    assert stages[0] == "fetching"
    assert "prompting" in stages
    streaming_writes = [w for w in recorder.writes if w["stage"] == "streaming"]
    assert streaming_writes, "delta flushes should land as streaming writes"
    assert any("第二段" in (w.get("stream_tail") or "") for w in streaming_writes)
    # State record is removed once the command settles.
    assert recorder.deletes == ["section_analysis_state:unknown"]


@pytest.mark.asyncio
async def test_section_command_cleans_state_on_failure(monkeypatch):
    from commands.source_commands import AnalyzeSectionInput, analyze_section_command

    recorder = SectionStateRecorder()

    async def failing_analyze(**_kwargs):
        raise RuntimeError("model down")

    with (
        patch("commands.source_commands.repo_query", new=recorder),
        patch(
            "api.source_analysis_service.analyze_source_section", new=failing_analyze
        ),
    ):
        with pytest.raises(RuntimeError):
            await analyze_section_command(
                AnalyzeSectionInput(
                    source_id="source:1",
                    section_title="t",
                    section_text="x",
                    locale="en-US",
                )
            )
    assert recorder.deletes == ["section_analysis_state:unknown"]


# ---------------------------------------------------------------------------
# HTTP endpoint wiring (async submission)
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_endpoint_submits_job_and_returns_job_id(client):
    with patch(
        "api.routers.source_analysis.CommandService.submit_command_job",
        new_callable=AsyncMock,
    ) as submit:
        submit.return_value = "command:job1"
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
    assert response.json() == {"job_id": "command:job1", "status": "submitted"}

    assert submit.await_args is not None
    module_name, command_name, command_args = submit.await_args.args
    assert module_name == "open_notebook"
    assert command_name == "analyze_source_section"
    assert command_args == {
        "source_id": "source:1",
        "section_title": "引言",
        "section_text": "正文……",
        "page_start": 1,
        "page_end": 2,
        "locale": "zh-CN",
    }


def test_endpoint_500_when_submission_fails(client):
    with patch(
        "api.routers.source_analysis.CommandService.submit_command_job",
        new_callable=AsyncMock,
        side_effect=RuntimeError("kaboom"),
    ):
        response = client.post(
            "/api/sources/source:1/sections/analyze",
            json={"section_title": "t", "section_text": "x", "locale": "en-US"},
        )
    assert response.status_code == 500
    assert response.json()["detail"] == "Failed to submit section analysis"


def test_endpoint_validates_section_title_length(client):
    response = client.post(
        "/api/sources/source:1/sections/analyze",
        json={"section_title": "t" * 301, "section_text": "x", "locale": "en-US"},
    )
    assert response.status_code == 422
