"""Tests for the MCP server tool layer (open_notebook/mcp_server.py).

The five tools are tested as plain functions with DB access stubbed at
repo_query / domain functions, following the test_source_groups_api.py
pattern. The registration tests inspect the FastMCP server in-process -
no real server process is started.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from open_notebook.domain.notebook import Note, Notebook, Source
from open_notebook.exceptions import (
    AuthenticationError,
    DatabaseOperationError,
    InvalidInputError,
    NotFoundError,
)

NB_ID = "notebook:nb1"


class TestListNotebooks:
    @pytest.mark.asyncio
    @patch("open_notebook.domain.base.repo_query", new_callable=AsyncMock)
    async def test_maps_rows_to_brief_dicts(self, repo_query):
        from open_notebook.mcp_server import list_notebooks

        repo_query.return_value = [
            {
                "id": "notebook:n2",
                "name": "Second",
                "description": "d2",
                "archived": False,
                "created": "2026-01-02T00:00:00",
                "updated": "2026-01-03T00:00:00",
            },
            {
                "id": "notebook:n1",
                "name": "First",
                "description": "d1",
                "archived": True,
                "created": "2026-01-01T00:00:00",
                "updated": "2026-01-02T00:00:00",
            },
        ]

        result = await list_notebooks()

        assert result == [
            {
                "id": "notebook:n2",
                "name": "Second",
                "description": "d2",
                "archived": False,
                "updated": "2026-01-03 00:00:00",
            },
            {
                "id": "notebook:n1",
                "name": "First",
                "description": "d1",
                "archived": True,
                "updated": "2026-01-02 00:00:00",
            },
        ]
        # order_by must survive the domain validation into the query
        assert "ORDER BY updated desc" in repo_query.await_args.args[0]

    @pytest.mark.asyncio
    @patch("open_notebook.domain.base.repo_query", new_callable=AsyncMock)
    async def test_db_failure_surfaces_as_database_error(self, repo_query):
        from open_notebook.mcp_server import list_notebooks

        repo_query.side_effect = RuntimeError("db down")

        with pytest.raises(DatabaseOperationError):
            await list_notebooks()


class TestListSources:
    @pytest.mark.asyncio
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_lists_metadata_without_full_text(self, mock_get):
        from open_notebook.mcp_server import list_sources

        source = Source(
            id="source:s1",
            title="Paper",
            topics=["ai"],
            embedding_status="completed",
            updated="2026-01-01T00:00:00",
        )
        notebook = MagicMock()
        notebook.get_sources = AsyncMock(return_value=[source])
        mock_get.return_value = notebook

        result = await list_sources(NB_ID)

        mock_get.assert_awaited_once_with(NB_ID)
        assert result == [
            {
                "id": "source:s1",
                "title": "Paper",
                "topics": ["ai"],
                "embedding_status": "completed",
                "updated": "2026-01-01 00:00:00",
            }
        ]

    @pytest.mark.asyncio
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_unknown_notebook_propagates_not_found(self, mock_get):
        from open_notebook.mcp_server import list_sources

        mock_get.side_effect = NotFoundError("notebook not found")

        with pytest.raises(NotFoundError):
            await list_sources("notebook:missing")


class TestSearch:
    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_text_search_normalized_rows(
        self, mock_scope, mock_text, mock_vector
    ):
        from open_notebook.mcp_server import search

        mock_scope.return_value = [NB_ID]
        mock_text.return_value = [
            {
                "id": "source:s1",
                "title": "Paper",
                "content": "matched `text`",
                "parent_id": "source:s1",
                "relevance": 3.2,
            }
        ]

        result = await search("text", notebook_ids=[NB_ID])

        mock_scope.assert_awaited_once_with([NB_ID])
        mock_text.assert_awaited_once_with("text", 10, True, True, notebook_ids=[NB_ID])
        mock_vector.assert_not_awaited()
        assert result == [
            {
                "id": "source:s1",
                "title": "Paper",
                "content": "matched `text`",
                "parent_id": "source:s1",
                "score": 3.2,
            }
        ]

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_empty_scope_searches_globally(
        self, mock_scope, mock_text, mock_vector
    ):
        from open_notebook.mcp_server import search

        mock_scope.return_value = []
        mock_text.return_value = []

        result = await search("anything")

        mock_text.assert_awaited_once_with(
            "anything", 10, True, True, notebook_ids=None
        )
        assert result == []

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_text_failure_falls_back_to_vector_search(
        self, mock_scope, mock_text, mock_vector
    ):
        from open_notebook.mcp_server import search

        mock_scope.return_value = []
        mock_text.side_effect = DatabaseOperationError("text index broke")
        mock_vector.return_value = [
            {
                "id": "insight:i1",
                "title": "Summary",
                "content": "semantic hit",
                "parent_id": "source:s1",
                "similarity": 0.87,
            }
        ]

        result = await search("meaning")

        mock_vector.assert_awaited_once_with(
            "meaning", 10, True, True, notebook_ids=None
        )
        # vector rows report their similarity as score
        assert result[0]["score"] == 0.87

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_both_paths_failing_surfaces_error(
        self, mock_scope, mock_text, mock_vector
    ):
        from open_notebook.mcp_server import search

        mock_scope.return_value = []
        mock_text.side_effect = DatabaseOperationError("text broke")
        mock_vector.side_effect = DatabaseOperationError("no embedding model")

        with pytest.raises(DatabaseOperationError):
            await search("anything")

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_limit_clamped_to_1_50(self, mock_scope, mock_text, mock_vector):
        from open_notebook.mcp_server import search

        mock_scope.return_value = []
        mock_text.return_value = []

        await search("q", limit=0)
        await search("q", limit=500)

        assert mock_text.await_args_list[0].args[1] == 1
        assert mock_text.await_args_list[1].args[1] == 50

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.text_search", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.resolve_notebook_scope", new_callable=AsyncMock)
    async def test_blank_query_rejected_before_any_lookup(
        self, mock_scope, mock_text, mock_vector
    ):
        from open_notebook.mcp_server import search

        with pytest.raises(InvalidInputError):
            await search("   ")

        mock_scope.assert_not_awaited()
        mock_text.assert_not_awaited()
        mock_vector.assert_not_awaited()


class TestChat:
    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.record_llm_usage", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.provision_langchain_model_with_info")
    @patch("open_notebook.mcp_server.Prompter")
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_single_prompter_call_with_vector_context(
        self, mock_get, mock_vector, mock_prompter, mock_provision, mock_usage
    ):
        from open_notebook import mcp_server

        mock_get.return_value = MagicMock(id=NB_ID)
        search_rows = [
            {"id": "source:s1", "content": "chunk text", "similarity": 0.9},
            {"id": "note:n1", "content": "note text", "similarity": 0.8},
        ]
        mock_vector.return_value = search_rows
        renderer = MagicMock()
        renderer.render.return_value = "SYSTEM PROMPT"
        mock_prompter.return_value = renderer
        fake_message = SimpleNamespace(content="Grounded answer [source:s1]")
        prov = MagicMock()
        prov.langchain_model.ainvoke = AsyncMock(return_value=fake_message)
        mock_provision.return_value = prov

        result = await mcp_server.chat(NB_ID, "What is X?")

        # retrieval scoped to the notebook only
        mock_vector.assert_awaited_once_with(
            "What is X?", 10, True, True, notebook_ids=[NB_ID]
        )
        # exactly one Prompter render + one model call (no langgraph session)
        mock_prompter.assert_called_once_with(prompt_template="ask/query_process")
        renderer.render.assert_called_once()
        data = renderer.render.call_args.kwargs["data"]
        assert data["question"] == "What is X?"
        assert data["ids"] == ["source:s1", "note:n1"]
        assert data["results"] == search_rows
        mock_provision.assert_awaited_once_with(
            "SYSTEM PROMPT", None, "tools", max_tokens=8192
        )
        prov.langchain_model.ainvoke.assert_awaited_once_with("SYSTEM PROMPT")
        assert result == {
            "notebook_id": NB_ID,
            "answer": "Grounded answer [source:s1]",
            "context_ids": ["source:s1", "note:n1"],
        }
        mock_usage.assert_awaited_once_with(
            model=prov, ai_message=fake_message, call_type="mcp_chat"
        )

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.record_llm_usage", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.provision_langchain_model_with_info")
    @patch("open_notebook.mcp_server.Prompter")
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_unknown_notebook_fails_before_llm_call(
        self, mock_get, mock_vector, mock_prompter, mock_provision, mock_usage
    ):
        from open_notebook import mcp_server

        mock_get.side_effect = NotFoundError("notebook not found")

        with pytest.raises(NotFoundError):
            await mcp_server.chat("notebook:missing", "q?")

        mock_vector.assert_not_awaited()
        mock_prompter.assert_not_called()
        mock_provision.assert_not_awaited()
        mock_usage.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.record_llm_usage", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.provision_langchain_model_with_info")
    @patch("open_notebook.mcp_server.Prompter")
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_blank_question_rejected(
        self, mock_get, mock_vector, mock_prompter, mock_provision, mock_usage
    ):
        from open_notebook import mcp_server

        with pytest.raises(InvalidInputError):
            await mcp_server.chat(NB_ID, "  ")

        mock_get.assert_not_awaited()

    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.record_llm_usage", new_callable=AsyncMock)
    @patch("open_notebook.mcp_server.provision_langchain_model_with_info")
    @patch("open_notebook.mcp_server.Prompter")
    @patch("open_notebook.mcp_server.vector_search", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_provider_failure_recorded_and_classified(
        self, mock_get, mock_vector, mock_prompter, mock_provision, mock_usage
    ):
        from open_notebook import mcp_server

        mock_get.return_value = MagicMock(id=NB_ID)
        mock_vector.return_value = []
        renderer = MagicMock()
        renderer.render.return_value = "SYSTEM PROMPT"
        mock_prompter.return_value = renderer
        prov = MagicMock()
        prov.langchain_model.ainvoke = AsyncMock(
            side_effect=ValueError("401 unauthorized")
        )
        mock_provision.return_value = prov

        with pytest.raises(AuthenticationError):
            await mcp_server.chat(NB_ID, "q?")

        mock_usage.assert_awaited_once()
        assert mock_usage.await_args.kwargs["success"] is False
        assert "401" in mock_usage.await_args.kwargs["error"]


class TestAddNote:
    @pytest.mark.asyncio
    @patch("open_notebook.mcp_server.Note")
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_saves_ai_note_and_links_to_notebook(self, mock_get, mock_note_class):
        from open_notebook import mcp_server

        fake_note = SimpleNamespace(
            id="note:new1",
            title="My note",
            note_type="ai",
            save=AsyncMock(return_value="command:abc123"),
            add_to_notebook=AsyncMock(),
        )
        mock_note_class.return_value = fake_note

        result = await mcp_server.add_note(NB_ID, "My note", "Some content")

        mock_get.assert_awaited_once_with(NB_ID)
        mock_note_class.assert_called_once_with(
            title="My note", content="Some content", note_type="ai"
        )
        fake_note.save.assert_awaited_once_with()
        fake_note.add_to_notebook.assert_awaited_once_with(NB_ID)
        assert result == {
            "id": "note:new1",
            "title": "My note",
            "note_type": "ai",
            "notebook_id": NB_ID,
            "embed_command_id": "command:abc123",
        }

    @pytest.mark.asyncio
    @patch.object(Note, "add_to_notebook", new_callable=AsyncMock)
    @patch.object(Note, "save", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_unknown_notebook_never_saves(self, mock_get, mock_save, mock_relate):
        from open_notebook import mcp_server

        mock_get.side_effect = NotFoundError("notebook not found")

        with pytest.raises(NotFoundError):
            await mcp_server.add_note("notebook:missing", "t", "c")

        mock_save.assert_not_awaited()
        mock_relate.assert_not_awaited()

    @pytest.mark.asyncio
    @patch.object(Note, "add_to_notebook", new_callable=AsyncMock)
    @patch.object(Note, "save", new_callable=AsyncMock)
    @patch.object(Notebook, "get", new_callable=AsyncMock)
    async def test_empty_content_rejected_by_note_validator(
        self, mock_get, mock_save, mock_relate
    ):
        from open_notebook import mcp_server

        with pytest.raises(InvalidInputError):
            await mcp_server.add_note(NB_ID, "t", "   ")

        mock_save.assert_not_awaited()


class TestServerWiring:
    @pytest.mark.asyncio
    async def test_five_tools_registered_under_expected_names(self):
        from fastmcp.client import Client

        from open_notebook.mcp_server import mcp

        async with Client(mcp) as client:
            tools = await client.list_tools()

        assert {t.name for t in tools} == {
            "list_notebooks",
            "list_sources",
            "search",
            "chat",
            "add_note",
        }

    @pytest.mark.asyncio
    async def test_registered_functions_and_signatures(self):
        from fastmcp.tools import FunctionTool

        from open_notebook.mcp_server import (
            add_note,
            chat,
            list_notebooks,
            list_sources,
            mcp,
            search,
        )

        assert mcp.name == "open-notebook"

        expected = {
            "list_notebooks": list_notebooks,
            "list_sources": list_sources,
            "search": search,
            "chat": chat,
            "add_note": add_note,
        }
        schemas = {}
        for name, fn in expected.items():
            tool = await mcp.get_tool(name)
            assert isinstance(tool, FunctionTool), (
                f"tool {name} not registered as a function tool"
            )
            assert tool.fn is fn, f"tool {name} wired to the wrong function"
            schemas[name] = tool.parameters

        # read-only tools take ids/query; only add_note writes content
        assert schemas["list_notebooks"]["properties"] == {}
        assert schemas["list_sources"]["required"] == ["notebook_id"]
        assert schemas["chat"]["required"] == ["notebook_id", "question"]
        assert "notebook_ids" in schemas["search"]["properties"]
        assert "limit" in schemas["search"]["properties"]
        assert schemas["add_note"]["required"] == ["notebook_id", "title", "content"]

    @pytest.mark.asyncio
    @patch("open_notebook.domain.base.repo_query", new_callable=AsyncMock)
    async def test_tool_call_round_trip_through_mcp_protocol(self, repo_query):
        """Calling a tool through a real fastmcp Client (in-process, no server
        process) must serialize our dict payloads into MCP JSON content."""
        import json

        from fastmcp.client import Client

        from open_notebook.mcp_server import mcp

        repo_query.return_value = [
            {
                "id": "notebook:n1",
                "name": "Research",
                "description": "d",
                "archived": False,
                "created": "2026-01-01T00:00:00",
                "updated": "2026-01-02T00:00:00",
            }
        ]

        async with Client(mcp) as client:
            result = await client.call_tool("list_notebooks", {})

        assert json.loads(result.content[0].text) == [
            {
                "id": "notebook:n1",
                "name": "Research",
                "description": "d",
                "archived": False,
                "updated": "2026-01-02 00:00:00",
            }
        ]
