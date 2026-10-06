"""Tests for the task-failure explain endpoint (api.explain_service + router)."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.explain_service import (
    NO_RETRY_COMMANDS,
    RETRYABLE_COMMANDS,
    SAME_ENTITY_RECOVERY_KEYS,
    _filter_suggestions,
    _recovery_status,
    explain_failed_command,
)

MODEL_OUTPUT = """**What happened** — The embedding task failed.
**Likely root cause** — Invalid credentials (user_fixable).
**How to fix** — 1. Open credentials settings and fix the key.
**Next actions** — Open credentials settings.
{"category":"user_fixable","suggestions":[{"action":"open_credentials"},{"action":"bogus"}]}"""

COMMAND_ROW = {
    "id": "command:x1",
    "name": "classify_sources",
    "args": {},
    "status": "failed",
    "error_message": "Provider returned 401",
}


def _provisioned(output: str = MODEL_OUTPUT):
    invoke = MagicMock(return_value=SimpleNamespace(content=output))
    return SimpleNamespace(langchain_model=SimpleNamespace(invoke=invoke))


@pytest.fixture(autouse=True)
def _clear_cache():
    from api import explain_service

    explain_service._explain_cache.clear()
    yield
    explain_service._explain_cache.clear()


@pytest.fixture
def model_mocks():
    """Patch everything the service touches beyond the command SELECT."""
    with (
        patch("api.explain_service.repo_query", new_callable=AsyncMock) as repo_query,
        patch("api.explain_service.DefaultModels") as defaults_cls,
        patch(
            "api.explain_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
        ) as provision,
        patch(
            "api.explain_service.record_llm_usage", new_callable=AsyncMock
        ) as record_usage,
    ):
        defaults_cls.get_instance = AsyncMock(return_value=SimpleNamespace())
        yield repo_query, provision, record_usage


@pytest.mark.asyncio
async def test_explain_happy_path_shape(model_mocks):
    repo_query, provision, record_usage = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.return_value = _provisioned()

    result = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    assert result["mode"] == "explain"
    assert result["classification"] == "user_fixable"
    assert result["degraded"] is False
    assert result["from_cache"] is False
    assert result["explanation_markdown"].startswith("**What happened**")
    # bogus model suggestion filtered, allowed one carries a label_key; the
    # retry backstop prepends retry for retryable, not-recovered commands
    assert result["suggestions"] == [
        {"action": "retry", "label_key": "tasks.explain.actionRetry"},
        {
            "action": "open_credentials",
            "label_key": "tasks.explain.actionOpenCredentials",
        },
    ]
    facts = {f["label_key"]: f["value"] for f in result["facts"]}
    assert facts["tasks.explain.factCommand"] == "classify_sources"
    assert facts["tasks.explain.factStatus"] == "failed"
    # prompt carries the template materials
    prompt = provision.await_args.args[0]
    assert "classify_sources" in prompt
    assert "## Error message (redacted)" in prompt
    assert "Provider returned 401" in prompt
    record_usage.assert_awaited_once_with(
        model=provision.return_value,
        ai_message=provision.return_value.langchain_model.invoke.return_value,
        call_type="qa_explain",
        correlation_id="command:x1",
    )


@pytest.mark.asyncio
async def test_explain_question_switches_to_followup(model_mocks):
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.return_value = _provisioned()

    result = await explain_failed_command(
        "command:x1", "Can I just retry it?", [], "en-US", refresh=False
    )

    assert result["mode"] == "followup"
    prompt = provision.await_args.args[0]
    assert "User follow-up question" in prompt
    assert "Can I just retry it?" in prompt


@pytest.mark.asyncio
async def test_explain_cache_hit_and_refresh(model_mocks):
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.return_value = _provisioned()

    first = await explain_failed_command("command:x1", None, [], "en-US", refresh=False)
    second = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    assert first["from_cache"] is False
    assert second["from_cache"] is True
    assert provision.await_count == 1

    refreshed = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=True
    )
    assert refreshed["from_cache"] is False
    assert provision.await_count == 2


@pytest.mark.asyncio
async def test_explain_cache_key_includes_locale(model_mocks):
    """Switching locale within the TTL must not serve a cached answer in the wrong language."""
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.return_value = _provisioned()

    english = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )
    chinese = await explain_failed_command(
        "command:x1", None, [], "zh-CN", refresh=False
    )

    assert english["from_cache"] is False
    assert chinese["from_cache"] is False
    assert provision.await_count == 2


@pytest.mark.asyncio
async def test_explain_degrades_on_provision_failure(model_mocks):
    from open_notebook.exceptions import ConfigurationError

    repo_query, provision, record_usage = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.side_effect = ConfigurationError(
        "No model configured for default for type=qa. "
        "Please go to Manage → Models and configure a default model."
    )

    result = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    assert result["degraded"] is True
    assert result["classification"] == "user_fixable"
    actions = [s["action"] for s in result["suggestions"]]
    assert "open_credentials" in actions
    assert "open_models_settings" in actions
    assert result["mode"] == "explain"
    record_usage.assert_awaited_once()
    assert record_usage.await_args.kwargs["success"] is False
    assert record_usage.await_args.kwargs["model"] is None


@pytest.mark.asyncio
async def test_explain_degraded_markdown_is_redacted(model_mocks):
    # unclassified error: classify_error passes the original text through,
    # so this is the path where a secret can reach the degraded markdown
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    provision.side_effect = RuntimeError("boom sk-AbCdEf12345678 rejected")

    result = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    assert result["degraded"] is True
    assert "sk-AbCdEf12345678" not in result["explanation_markdown"]
    assert "[REDACTED]" in result["explanation_markdown"]


@pytest.mark.asyncio
async def test_explain_redacts_secrets_before_prompt(model_mocks):
    repo_query, provision, _ = model_mocks
    row = {
        **COMMAND_ROW,
        "error_message": "401 for Bearer tok123secret and sk-AbCdEf12345678",
    }
    repo_query.return_value = [row]
    provision.return_value = _provisioned()

    await explain_failed_command("command:x1", None, [], "en-US", refresh=False)

    prompt = provision.await_args.args[0]
    assert "tok123secret" not in prompt
    assert "sk-AbCdEf12345678" not in prompt
    assert "[REDACTED]" in prompt


@pytest.mark.asyncio
async def test_explain_redacts_model_output(model_mocks):
    """Secrets echoed back by the model must never reach the response body."""
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [COMMAND_ROW]
    output = MODEL_OUTPUT.replace(
        "The embedding task failed.",
        "The call to sk-ModelKey12345678 with Bearer leak-me-token failed.",
    )
    provision.return_value = _provisioned(output)

    result = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    markdown = result["explanation_markdown"]
    assert "sk-ModelKey12345678" not in markdown
    assert "leak-me-token" not in markdown
    assert "[REDACTED]" in markdown
    # the trailing JSON still parses after redaction
    assert result["classification"] == "user_fixable"


@pytest.mark.asyncio
async def test_explain_filters_retry_for_non_retryable_command(model_mocks):
    repo_query, provision, _ = model_mocks
    repo_query.return_value = [{**COMMAND_ROW, "name": "mystery_command"}]
    output = MODEL_OUTPUT.replace('"open_credentials"', '"retry"')
    provision.return_value = _provisioned(output)

    result = await explain_failed_command(
        "command:x1", None, [], "en-US", refresh=False
    )

    assert result["suggestions"] == []


def test_filter_suggestions_whitelist_and_dedup():
    raw = [
        {"action": "retry"},
        {"action": "retry"},  # dedup
        {"action": "delete_everything"},  # not whitelisted
        "nonsense",
        {"action": "report_issue"},
    ]
    suggestions = _filter_suggestions(raw, "embed_source")
    assert [s["action"] for s in suggestions] == ["retry", "report_issue"]
    assert suggestions[0]["label_key"] == "tasks.explain.actionRetry"


def test_filter_suggestions_backstops_retry_when_model_omits_it():
    # Retryable + not recovered: retry must be present even if the model
    # suggested nothing (LLM output varies run to run).
    suggestions = _filter_suggestions([], "embed_source")
    assert suggestions[0]["action"] == "retry"
    # Model already suggested other actions: retry is prepended, not appended.
    suggestions = _filter_suggestions([{"action": "report_issue"}], "embed_source")
    assert [s["action"] for s in suggestions] == ["retry", "report_issue"]


def test_filter_suggestions_no_backstop_for_recovered_or_non_retryable():
    # Recovered or non-retryable commands never get the backstop retry.
    assert _filter_suggestions([], "embed_source", recovered=True) == []
    assert _filter_suggestions([], "generate_podcast") == []


def test_retryable_commands_cover_the_registry():
    """Guard: every registered command must be classified retryable or not."""
    from surreal_commands import registry

    import commands  # noqa: F401 — imports register every command

    registered = {item.name for item in registry.get_all_commands()}
    assert registered == RETRYABLE_COMMANDS | NO_RETRY_COMMANDS


def test_generate_podcast_is_not_retryable():
    """Generic replay would create a duplicate episode; its retry goes through
    the dedicated podcast endpoint that deletes the failed record first."""
    assert "generate_podcast" not in RETRYABLE_COMMANDS
    assert NO_RETRY_COMMANDS == {"generate_podcast", "import_data"}
    assert _filter_suggestions([{"action": "retry"}], "generate_podcast") == []
    # The import worker deletes the uploaded package on permanent failure; a
    # task-center retry would only FileNotFoundError through every attempt.
    assert "import_data" not in RETRYABLE_COMMANDS
    assert _filter_suggestions([{"action": "retry"}], "import_data") == []


@pytest.mark.asyncio
async def test_explain_missing_command_raises_not_found(model_mocks):
    from open_notebook.exceptions import NotFoundError

    repo_query, provision, _ = model_mocks
    repo_query.return_value = []

    with pytest.raises(NotFoundError):
        await explain_failed_command("command:nope", None, [], "en-US", refresh=False)
    provision.assert_not_awaited()


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app, raise_server_exceptions=False)


def test_explain_endpoint_rejects_bad_resource_type(client):
    response = client.post(
        "/api/explain",
        json={"resource_type": "note", "resource_id": "note:1", "locale": "en-US"},
    )
    assert response.status_code == 400
    assert "resource_type" in response.json()["detail"]


def test_explain_endpoint_404_for_unknown_command(client):
    with patch(
        "api.explain_service.repo_query", new_callable=AsyncMock, return_value=[]
    ):
        response = client.post(
            "/api/explain",
            json={
                "resource_type": "failed_command",
                "resource_id": "command:gone",
                "locale": "en-US",
            },
        )
    assert response.status_code == 404


def test_explain_endpoint_400_for_malformed_command_id(client):
    # RecordID.parse raises ValueError on garbage ids; must surface as 400
    with patch(
        "api.routers.explain.explain_failed_command",
        new_callable=AsyncMock,
        side_effect=ValueError("Invalid record id: garbage"),
    ):
        response = client.post(
            "/api/explain",
            json={
                "resource_type": "failed_command",
                "resource_id": "garbage",
                "locale": "en-US",
            },
        )
    assert response.status_code == 400
    assert "Invalid record id" in response.json()["detail"]


def test_explain_endpoint_returns_200_degraded_when_model_unconfigured(client):
    """A missing qa model must answer 200 with degraded=true, never a 5xx."""
    from open_notebook.exceptions import ConfigurationError

    with (
        patch("api.explain_service.repo_query", new_callable=AsyncMock) as repo_query,
        patch(
            "api.explain_service.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            side_effect=ConfigurationError(
                "No model configured for default for type=qa."
            ),
        ),
    ):
        repo_query.return_value = [COMMAND_ROW]
        response = client.post(
            "/api/explain",
            json={
                "resource_type": "failed_command",
                "resource_id": "command:x1",
                "locale": "en-US",
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["degraded"] is True
    assert body["classification"] is not None
    assert body["explanation_markdown"]
    assert [s["action"] for s in body["suggestions"]] == [
        "retry",  # backstop for retryable, not-recovered commands
        "open_credentials",
        "open_models_settings",
    ]


def test_explain_endpoint_passes_request_through(client):
    payload = {
        "mode": "explain",
        "classification": "transient",
        "explanation_markdown": "text",
        "suggestions": [{"action": "retry", "label_key": "tasks.explain.actionRetry"}],
        "facts": [{"label_key": "tasks.explain.factCommand", "value": "embed_source"}],
        "recovery": None,
        "degraded": False,
        "from_cache": False,
    }
    with patch(
        "api.routers.explain.explain_failed_command",
        new_callable=AsyncMock,
        return_value=payload,
    ) as service:
        response = client.post(
            "/api/explain",
            json={
                "resource_type": "failed_command",
                "resource_id": "command:x1",
                "question": "why?",
                "history": [{"role": "user", "content": "earlier"}],
                "locale": "zh-CN",
                "refresh": True,
            },
        )

    assert response.status_code == 200
    assert response.json() == payload
    service.assert_awaited_once_with(
        command_id="command:x1",
        question="why?",
        history=[{"role": "user", "content": "earlier"}],
        locale="zh-CN",
        refresh=True,
    )


# --- recovery detection ----------------------------------------------------


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_completed(repo_query):
    repo_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": 1384, "total_chunks": 1384}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result == {
        "recovered": True,
        "detail": "source now completed, 1384/1384 chunks",
    }


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_chunks_incomplete(repo_query):
    repo_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": 12, "total_chunks": 48}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result is not None
    assert result["recovered"] is False
    assert "12/48" in result["detail"]


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_status_not_completed(repo_query):
    repo_query.return_value = [
        {"embedding_status": "failed", "embedded_chunks": 0, "total_chunks": 48}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result is not None
    assert result["recovered"] is False


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_total_zero_only_status_counts(repo_query):
    repo_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": 0, "total_chunks": 0}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result is not None
    assert result["recovered"] is True


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_process_source_with_embed_uses_embedding_state(repo_query):
    """process+embed combo: the embedding counters are evidence for this failure."""
    repo_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": 48, "total_chunks": 48}
    ]

    result = await _recovery_status(
        "process_source", {"source_id": "source:s1", "embed": True}
    )

    assert result is not None
    assert result["recovered"] is True


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_process_source_without_embed_is_undeterminable(repo_query):
    """embedding_status is written by the separate fire-and-forget embed_source
    job; a stale 'completed' must not mask a processing failure — the retry
    entry must stay available."""
    result = await _recovery_status(
        "process_source", {"source_id": "source:s1", "embed": False}
    )

    assert result is None
    repo_query.assert_not_called()


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_source_row_missing_is_undeterminable(repo_query):
    repo_query.return_value = []

    assert await _recovery_status("embed_source", {"source_id": "source:gone"}) is None


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embed_note_same_entity_completed_run(repo_query):
    repo_query.return_value = [
        {
            "id": "command:ok1",
            "args": {"note_id": "note:n1"},
            "result": {"execution_metadata": {"started_at": "2026-09-27T10:00:00Z"}},
        },
        # a completed run for a DIFFERENT note must not count
        {
            "id": "command:ok2",
            "args": {"note_id": "note:n2"},
            "result": None,
        },
    ]

    result = await _recovery_status("embed_note", {"note_id": "note:n1"})

    assert result is not None
    assert result["recovered"] is True
    assert "2026-09-27T10:00:00Z" in result["detail"]
    query = repo_query.await_args.args[0]
    assert "status = 'completed'" in query


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embed_note_without_completed_run(repo_query):
    repo_query.return_value = [
        {"id": "command:ok2", "args": {"note_id": "note:n2"}, "result": None}
    ]

    result = await _recovery_status("embed_note", {"note_id": "note:n1"})

    assert result == {
        "recovered": False,
        "detail": "no completed 'embed_note' run found for this entity",
    }


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_classify_sources_view_classified(repo_query):
    repo_query.return_value = [{"last_classified_at": "2026-09-26T08:00:00Z"}]

    result = await _recovery_status(
        "classify_sources", {"view_id": "source_view:v1", "method": "content"}
    )

    assert result is not None
    assert result["recovered"] is True
    assert "2026-09-26T08:00:00Z" in result["detail"]


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_classify_sources_view_never_classified(repo_query):
    repo_query.return_value = [{"last_classified_at": None}]

    result = await _recovery_status("classify_sources", {"view_id": "source_view:v1"})

    assert result is not None
    assert result["recovered"] is False


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_transfer_stage_done(repo_query):
    repo_query.return_value = [{"progress": {"stage": "done", "percent": 100}}]

    result = await _recovery_status("import_data", {})

    assert result is not None
    assert result["recovered"] is True

    repo_query.return_value = [{"progress": {"stage": "copying", "percent": 40}}]
    result = await _recovery_status("export_data", {})
    assert result is not None
    assert result["recovered"] is False


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_unknown_command_or_missing_entity_key(repo_query):
    assert await _recovery_status("mystery_command", {"x": 1}) is None
    assert await _recovery_status("embed_note", {}) is None
    assert await _recovery_status("embed_source", {}) is None
    # rebuild_embeddings takes mode/include_* args — no single entity to check
    assert await _recovery_status("rebuild_embeddings", {"mode": "all"}) is None
    repo_query.assert_not_called()


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_total_none_only_status_counts(repo_query):
    """NULL chunk columns must behave like total<=0: status alone decides."""
    repo_query.return_value = [
        {"embedding_status": "completed", "embedded_chunks": None, "total_chunks": None}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result == {
        "recovered": True,
        "detail": "source now completed, 0/0 chunks",
    }


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_embedding_missing_status_reports_unknown(repo_query):
    repo_query.return_value = [
        {"embedding_status": None, "embedded_chunks": 0, "total_chunks": 48}
    ]

    result = await _recovery_status("embed_source", {"source_id": "source:s1"})

    assert result is not None
    assert result["recovered"] is False
    assert "source now unknown" in result["detail"]


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_same_entity_every_registered_key_tuple(repo_query):
    """Happy path for each SAME_ENTITY_RECOVERY_KEYS entry: exact args match recovers."""
    failed_args_by_name = {
        "embed_note": {"note_id": "note:n1"},
        "embed_insight": {"insight_id": "insight:i1"},
        "generate_artifact": {"notebook_id": "notebook:nb1", "artifact_type": "essay"},
        "create_insight": {"source_id": "source:s1", "insight_type": "summary"},
        "run_transformation": {
            "source_id": "source:s1",
            "transformation_id": "transformation:t1",
        },
    }
    assert set(failed_args_by_name) == set(SAME_ENTITY_RECOVERY_KEYS)

    for name, args in failed_args_by_name.items():
        repo_query.reset_mock()
        repo_query.return_value = [
            {"id": f"command:ok-{name}", "args": dict(args), "result": None}
        ]

        result = await _recovery_status(name, args)

        assert result is not None, name
        assert result["recovered"] is True, name
        query = repo_query.await_args.args[0]
        assert "name = $name" in query and "status = 'completed'" in query, name


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_same_entity_multi_key_must_match_every_key(repo_query):
    """A completed run matching only one of two entity keys is not this entity."""
    repo_query.return_value = [
        {
            "id": "command:ok1",
            "args": {"notebook_id": "notebook:nb1", "artifact_type": "webpage"},
            "result": None,
        }
    ]

    result = await _recovery_status(
        "generate_artifact",
        {"notebook_id": "notebook:nb1", "artifact_type": "essay"},
    )

    assert result is not None
    assert result["recovered"] is False
    assert "no completed 'generate_artifact' run" in result["detail"]


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_same_entity_completed_row_missing_key_never_matches(repo_query):
    """A completed row without the entity key (or with corrupt args) is skipped."""
    repo_query.return_value = [
        {"id": "command:ok1", "args": {}, "result": None},
        {"id": "command:ok2", "args": None, "result": None},
        {"id": "command:ok3", "args": "corrupt", "result": None},
    ]

    result = await _recovery_status("embed_note", {"note_id": "note:n1"})

    assert result is not None
    assert result["recovered"] is False


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_same_entity_partial_present_keys_compare_on_those_only(
    repo_query,
):
    """Failed args missing part of the key tuple compare on the present keys only."""
    repo_query.return_value = [
        {
            "id": "command:ok1",
            "args": {
                "source_id": "source:s1",
                "transformation_id": "transformation:t1",
            },
            "result": None,
        }
    ]

    result = await _recovery_status("run_transformation", {"source_id": "source:s1"})

    assert result is not None
    assert result["recovered"] is True


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_same_entity_no_completed_rows_at_all(repo_query):
    repo_query.return_value = []

    result = await _recovery_status("embed_insight", {"insight_id": "insight:i1"})

    assert result == {
        "recovered": False,
        "detail": "no completed 'embed_insight' run found for this entity",
    }


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_classify_sources_accepts_source_view_alias(repo_query):
    """Stored arg key is view_id; the source_view spelling must also resolve."""
    repo_query.return_value = [{"last_classified_at": "2026-09-26T08:00:00Z"}]

    result = await _recovery_status(
        "classify_sources", {"source_view": "source_view:v9"}
    )

    assert result is not None
    assert result["recovered"] is True


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_classify_sources_without_view_key_is_undeterminable(repo_query):
    assert await _recovery_status("classify_sources", {"method": "content"}) is None
    repo_query.assert_not_called()


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_transfer_state_row_missing_is_undeterminable(repo_query):
    repo_query.return_value = []

    assert await _recovery_status("import_data", {}) is None


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_source_view_row_missing_is_undeterminable(repo_query):
    repo_query.return_value = []

    result = await _recovery_status("classify_sources", {"view_id": "source_view:gone"})

    assert result is None


@pytest.mark.asyncio
@patch("api.explain_service.repo_query", new_callable=AsyncMock)
async def test_recovery_survives_query_errors(repo_query):
    repo_query.side_effect = RuntimeError("db down")

    assert await _recovery_status("embed_source", {"source_id": "source:s1"}) is None


def test_filter_suggestions_drops_retry_when_recovered():
    suggestions = _filter_suggestions(
        [{"action": "retry"}, {"action": "copy_diagnostics"}],
        "embed_source",
        recovered=True,
    )
    assert [s["action"] for s in suggestions] == ["copy_diagnostics"]


# --- recovery through the explain flow --------------------------------------


async def _explain_with_recovery(model_mocks, source_rows, output=MODEL_OUTPUT):
    """Run explain_failed_command for an embed_source row with a given source state.

    repo_query is called: (1) command row, (2) recovery lookup,
    (3) entity-state material for the prompt.
    """
    repo_query, provision, _ = model_mocks
    row = {
        "id": "command:e1",
        "name": "embed_source",
        "args": {"source_id": "source:s1"},
        "status": "failed",
        "error_message": "Provider returned 429",
    }
    repo_query.side_effect = [[row], source_rows, source_rows]
    provision.return_value = _provisioned(output)
    return await explain_failed_command("command:e1", None, [], "en-US", refresh=False)


@pytest.mark.asyncio
async def test_explain_response_carries_recovery_and_drops_retry(model_mocks):
    output = MODEL_OUTPUT.replace('"open_credentials"', '"retry"')

    result = await _explain_with_recovery(
        model_mocks,
        [{"embedding_status": "completed", "embedded_chunks": 48, "total_chunks": 48}],
        output=output,
    )

    assert result["recovery"] == {
        "recovered": True,
        "detail": "source now completed, 48/48 chunks",
    }
    # the model's trailing JSON suggested retry; a recovered item must not
    assert result["suggestions"] == []
    prompt = model_mocks[1].await_args.args[0]
    assert "## Recovery status" in prompt
    assert "source now completed, 48/48 chunks" in prompt


@pytest.mark.asyncio
async def test_explain_degraded_response_carries_recovery(model_mocks):
    model_mocks[1].side_effect = RuntimeError("429 too many requests")

    result = await _explain_with_recovery(
        model_mocks,
        [{"embedding_status": "completed", "embedded_chunks": 48, "total_chunks": 48}],
    )

    assert result["degraded"] is True
    assert result["recovery"]["recovered"] is True
    # transient degraded actions include retry; recovery filters it out
    assert [s["action"] for s in result["suggestions"]] == ["copy_diagnostics"]


@pytest.mark.asyncio
async def test_explain_cache_key_includes_recovery_state(model_mocks):
    """A recovery flip within the TTL must invalidate the cached answer."""
    repo_query, provision, _ = model_mocks
    row = {
        "id": "command:e1",
        "name": "embed_source",
        "args": {"source_id": "source:s1"},
        "status": "failed",
        "error_message": "Provider returned 429",
    }
    broken = [{"embedding_status": "failed", "embedded_chunks": 12, "total_chunks": 48}]
    fixed = [
        {"embedding_status": "completed", "embedded_chunks": 48, "total_chunks": 48}
    ]
    repo_query.side_effect = [[row], broken, broken, [row], fixed, fixed]
    provision.return_value = _provisioned()

    first = await explain_failed_command("command:e1", None, [], "en-US", refresh=False)
    second = await explain_failed_command(
        "command:e1", None, [], "en-US", refresh=False
    )

    assert first["from_cache"] is False
    assert first["recovery"]["recovered"] is False
    assert second["from_cache"] is False
    assert second["recovery"]["recovered"] is True
    assert provision.await_count == 2
