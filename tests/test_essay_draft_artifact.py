"""Tests for the essay_draft artifact type (软考真题论文初稿): the POST
/api/notebooks/{id}/artifacts endpoint accepting it and the generate_artifact
command rendering the exam-question instruction into the essay prompt. DB and
LLM access are stubbed, following the test_artifacts_api.py /
test_source_groups_api.py pattern."""

from contextlib import ExitStack
from datetime import datetime
from pathlib import Path
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from commands.artifact_commands import (
    ARTIFACT_TYPES,
    ArtifactGenerationInput,
    generate_artifact_command,
)
from open_notebook.domain.notebook import Note, Notebook

NOTEBOOK_ID = "notebook:nb1"
JOB_ID = "job:essay1"
QUESTION = "论微服务架构及其应用"


@pytest.fixture
def client():
    from api.main import app

    return TestClient(app)


async def _capture_save(self):
    if self.id is None:
        self.id = f"{self.__class__.table_name}:new1"
    if self.created is None:
        self.created = datetime(2026, 1, 1)
    if self.updated is None:
        self.updated = datetime(2026, 1, 1)
    return "embed_job:1"


def _notebook():
    return Notebook(id=NOTEBOOK_ID, name="软件架构设计师", description="exam prep")


def _context_data():
    return {
        "sources": [
            {
                "id": "source:s1",
                "title": "范文 1",
                "insights": [{"content": "Key fact"}],
                "full_text": "范文正文。",
            }
        ],
        "notes": [],
    }


# Recorded by _CapturePrompter across a command run.
captured: Dict[str, Any] = {}


class _CapturePrompter:
    """Stands in for Prompter and records the template name and render data."""

    def __init__(self, prompt_template: str):
        captured["template"] = prompt_template

    def render(self, data: Dict[str, Any]) -> str:
        captured["data"] = data
        return "PROMPT"


def test_essay_draft_registered_with_template():
    assert "essay_draft" in ARTIFACT_TYPES
    assert Path("prompts/artifact/essay_draft.jinja").is_file()


class TestSubmitEndpoint:
    @pytest.mark.asyncio
    @patch(
        "api.routers.notebooks.CommandService.submit_command_job",
        new_callable=AsyncMock,
    )
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_submit_essay_draft_returns_job_id(
        self, mock_get, mock_submit, client
    ):
        mock_get.return_value = _notebook()
        mock_submit.return_value = JOB_ID

        response = client.post(
            f"/api/notebooks/{NOTEBOOK_ID}/artifacts",
            json={"artifact_type": "essay_draft", "instruction": QUESTION},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] == JOB_ID
        assert body["artifact_type"] == "essay_draft"
        assert mock_submit.call_args.kwargs["command_args"]["artifact_type"] == (
            "essay_draft"
        )
        assert mock_submit.call_args.kwargs["command_args"]["instruction"] == QUESTION


class TestEssayDraftCommand:
    @pytest.mark.asyncio
    async def test_renders_question_into_prompt_and_saves_markdown_note(self):
        prov = MagicMock()
        prov.langchain_model.ainvoke = AsyncMock(
            return_value=MagicMock(content="# 摘要\n\n初稿正文")
        )
        llm_patcher = patch(
            "commands.artifact_commands.provision_langchain_model_with_info",
            new_callable=AsyncMock,
            return_value=prov,
        )
        stack = ExitStack()
        stack.enter_context(
            patch.object(
                Notebook, "get", new_callable=AsyncMock, return_value=_notebook()
            )
        )
        stack.enter_context(
            patch(
                "commands.artifact_commands.build_notebook_context",
                new_callable=AsyncMock,
                return_value=(_context_data(), "total"),
            )
        )
        stack.enter_context(
            patch("commands.artifact_commands.record_llm_usage", new_callable=AsyncMock)
        )
        saved: Dict[str, Note] = {}

        async def capture_note_save(self):
            await _capture_save(self)
            saved["note"] = self
            return "embed_job:1"

        with (
            stack,
            llm_patcher,
            patch("commands.artifact_commands.Prompter", _CapturePrompter),
            patch.object(Note, "save", capture_note_save),
            patch.object(Note, "add_to_notebook", new_callable=AsyncMock),
        ):
            result = await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="essay_draft",
                    instruction=QUESTION,
                )
            )

        assert result.success is True
        assert result.note_id == "note:new1"
        # The exam question is passed as a render variable into the
        # essay_draft template, never as template source.
        assert captured["template"] == "artifact/essay_draft"
        assert captured["data"]["instruction"] == QUESTION
        assert "Key fact" in captured["data"]["context"]
        assert saved["note"].note_type == "ai"
        assert saved["note"].title is not None
        assert saved["note"].title.startswith("Essay Draft:")
        assert saved["note"].content is not None
        assert "# 摘要" in saved["note"].content
