"""Tests for the study-artifact generation feature: the POST
/api/notebooks/{id}/artifacts submit endpoint (api/routers/notebooks.py) and
the generate_artifact command (commands/artifact_commands.py). DB and LLM
access are stubbed, following the test_source_groups_api.py pattern."""

import json
from contextlib import ExitStack
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from commands.artifact_commands import (
    ARTIFACT_TYPES,
    ArtifactGenerationInput,
    _parse_flashcards,
    generate_artifact_command,
)
from open_notebook.domain.notebook import Note, Notebook
from open_notebook.exceptions import NotFoundError

NOTEBOOK_ID = "notebook:nb1"
JOB_ID = "job:abc123"


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
    return Notebook(id=NOTEBOOK_ID, name="My Notebook", description="desc")


def _context_data():
    return {
        "sources": [
            {
                "id": "source:s1",
                "title": "Doc 1",
                "insights": [{"content": "Key fact"}],
                "full_text": "Long source text about photosynthesis.",
            }
        ],
        "notes": [
            {"id": "note:n1", "title": "My note", "content": "Note content"}
        ],
    }


class TestSubmitEndpoint:
    @pytest.mark.asyncio
    @patch("api.routers.notebooks.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_submit_returns_job_id(self, mock_get, mock_submit, client):
        mock_get.return_value = _notebook()
        mock_submit.return_value = JOB_ID

        response = client.post(
            f"/api/notebooks/{NOTEBOOK_ID}/artifacts",
            json={"artifact_type": "study_guide", "instruction": "Focus on ch. 2"},
        )

        assert response.status_code == 200
        body = response.json()
        assert body["job_id"] == JOB_ID
        assert body["status"] == "submitted"
        assert body["artifact_type"] == "study_guide"
        mock_submit.assert_awaited_once_with(
            module_name="open_notebook",
            command_name="generate_artifact",
            command_args={
                "notebook_id": NOTEBOOK_ID,
                "artifact_type": "study_guide",
                "instruction": "Focus on ch. 2",
                "context_config": None,
            },
        )

    @pytest.mark.asyncio
    @patch("api.routers.notebooks.CommandService.submit_command_job", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_submit_passes_context_config(self, mock_get, mock_submit, client):
        mock_get.return_value = _notebook()
        mock_submit.return_value = JOB_ID
        context_config = {
            "sources": {"source:s1": "full content"},
            "notes": {"note:n1": "full content"},
        }

        response = client.post(
            f"/api/notebooks/{NOTEBOOK_ID}/artifacts",
            json={"artifact_type": "flashcards", "context_config": context_config},
        )

        assert response.status_code == 200
        assert (
            mock_submit.call_args.kwargs["command_args"]["context_config"]
            == context_config
        )

    @pytest.mark.asyncio
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_unknown_notebook_404(self, mock_get, client):
        mock_get.side_effect = NotFoundError("Notebook not found")

        response = client.post(
            f"/api/notebooks/{NOTEBOOK_ID}/artifacts",
            json={"artifact_type": "faq"},
        )

        assert response.status_code == 404

    def test_invalid_artifact_type_422(self, client):
        response = client.post(
            f"/api/notebooks/{NOTEBOOK_ID}/artifacts",
            json={"artifact_type": "quiz"},
        )

        assert response.status_code == 422


class TestParseFlashcards:
    def test_plain_json_array(self):
        cards = [{"front": "Q1", "back": "A1"}, {"front": "Q2", "back": "A2"}]
        result = json.loads(_parse_flashcards(json.dumps(cards)))
        assert result == cards

    def test_strips_code_fence_and_surrounding_prose(self):
        raw = 'Here you go:\n```json\n[{"front": "Q", "back": "A"}]\n```\nDone'
        result = json.loads(_parse_flashcards(raw))
        assert result == [{"front": "Q", "back": "A"}]

    def test_drops_incomplete_cards(self):
        raw = json.dumps(
            [
                {"front": "Q1", "back": "A1"},
                {"front": "", "back": "A2"},
                {"front": "Q3"},
            ]
        )
        result = json.loads(_parse_flashcards(raw))
        assert result == [{"front": "Q1", "back": "A1"}]

    def test_no_array_raises(self):
        with pytest.raises(ValueError):
            _parse_flashcards("Sorry, I cannot help with that.")

    def test_invalid_json_raises(self):
        with pytest.raises(ValueError):
            _parse_flashcards('[{"front": "Q", "back": }')

    def test_empty_array_raises(self):
        with pytest.raises(ValueError):
            _parse_flashcards("[]")


class TestGenerateArtifactCommand:
    def _command_stubs(self, llm_content, context_data=None):
        """Return (llm_patcher, prov) plus a context manager stacking all the
        other seams the command touches."""
        prov = MagicMock()
        prov.langchain_model.ainvoke = AsyncMock(
            return_value=MagicMock(content=llm_content)
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
                return_value=(context_data or _context_data(), "total"),
            )
        )
        stack.enter_context(
            patch(
                "commands.artifact_commands.record_llm_usage", new_callable=AsyncMock
            )
        )
        return llm_patcher, stack

    @pytest.mark.asyncio
    async def test_study_guide_creates_markdown_note(self):
        llm_patcher, stack = self._command_stubs("# Study Guide\n\n- Point one")
        saved = {}

        async def capture_note_save(self):
            await _capture_save(self)
            saved["note"] = self
            return "embed_job:1"

        with stack, llm_patcher, patch.object(
            Note, "save", capture_note_save
        ), patch.object(Note, "add_to_notebook", new_callable=AsyncMock):
            result = await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="study_guide",
                    instruction="Keep it short",
                    context_config={"sources": {"source:s1": "full content"}},
                )
            )

        assert result.success is True
        assert result.note_id == "note:new1"
        assert saved["note"].title.startswith("Study Guide:")
        assert "# Study Guide" in saved["note"].content

    @pytest.mark.asyncio
    async def test_faq_creates_markdown_note(self):
        llm_patcher, stack = self._command_stubs("## Q: Why?\nA: Because.")
        saved = {}

        async def capture_note_save(self):
            await _capture_save(self)
            saved["note"] = self
            return "embed_job:1"

        with stack, llm_patcher, patch.object(
            Note, "save", capture_note_save
        ), patch.object(Note, "add_to_notebook", new_callable=AsyncMock):
            result = await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="faq",
                )
            )

        assert result.success is True
        assert saved["note"].title.startswith("FAQ:")

    @pytest.mark.asyncio
    async def test_flashcards_content_stored_as_json(self):
        llm_output = '```json\n[{"front": "What is X?", "back": "X is Y"}]\n```'
        llm_patcher, stack = self._command_stubs(llm_output)
        saved = {}

        async def capture_note_save(self):
            await _capture_save(self)
            saved["note"] = self
            return "embed_job:1"

        with stack, llm_patcher, patch.object(
            Note, "save", capture_note_save
        ), patch.object(Note, "add_to_notebook", new_callable=AsyncMock):
            result = await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="flashcards",
                )
            )

        assert result.success is True
        note = saved["note"]
        assert note.note_type == "ai"
        cards = json.loads(note.content)
        assert cards == [{"front": "What is X?", "back": "X is Y"}]
        assert note.title.startswith("Flashcards:")

    @pytest.mark.asyncio
    async def test_invalid_flashcard_output_fails_permanently(self):
        llm_patcher, stack = self._command_stubs("No cards here, sorry!")
        with stack, llm_patcher, pytest.raises(ValueError):
            await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="flashcards",
                )
            )

    @pytest.mark.asyncio
    async def test_unknown_artifact_type_raises(self):
        with pytest.raises(ValueError):
            await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="quiz",
                )
            )

    @pytest.mark.asyncio
    async def test_empty_context_raises(self):
        llm_patcher, stack = self._command_stubs(
            "whatever", context_data={"sources": [], "notes": []}
        )
        with stack, llm_patcher, pytest.raises(ValueError):
            await generate_artifact_command(
                ArtifactGenerationInput(
                    notebook_id=NOTEBOOK_ID,
                    artifact_type="faq",
                )
            )


def test_artifact_types_in_sync_with_templates():
    from pathlib import Path

    for artifact_type in ARTIFACT_TYPES:
        assert Path(f"prompts/artifact/{artifact_type}.jinja").is_file()
