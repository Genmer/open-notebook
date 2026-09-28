"""Open Notebook MCP server.

Exposes this notebook library to coding agents (Claude Code, Cursor, ...) as
four read-only tools plus one write tool over stdio:

- list_notebooks()                    -> every notebook in the library
- list_sources(notebook_id)          -> sources of one notebook
- search(query, notebook_ids, limit) -> text search with vector fallback
- chat(notebook_id, question)        -> single-shot RAG answer
- add_note(notebook_id, title, content) -> the only write operation

Deliberately NOT reused: graphs/chat (needs a checkpointer-backed session) and
graphs/ask (a multi-step strategy/searches/synthesis orchestration). The chat
tool is a single Prompter render + one model call over vector_search results,
i.e. the ask/final_answer step without the surrounding langgraph session.

Run with: python -m open_notebook.mcp_server
"""

# Load environment variables before anything that touches the DB or the
# proxy settings, mirroring api/main.py (issue #1160). E402 is ignored
# project-wide, which is what makes this pattern lint-clean.
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from ai_prompter import Prompter
from fastmcp import FastMCP
from loguru import logger

from open_notebook.ai.provision import provision_langchain_model_with_info
from open_notebook.ai.usage import record_llm_usage
from open_notebook.domain.notebook import (
    Note,
    Notebook,
    resolve_notebook_scope,
    text_search,
    vector_search,
)
from open_notebook.exceptions import (
    DatabaseOperationError,
    InvalidInputError,
    OpenNotebookError,
)
from open_notebook.utils import clean_thinking_content
from open_notebook.utils.error_classifier import classify_error
from open_notebook.utils.text_utils import extract_text_content

# Output budget for the single chat call. Matches the 8192 cap shared by ask,
# chat and transformations - the previous 2000 cap truncated token-dense
# languages and left reasoning models with no visible answer (#1221).
MCP_MAX_TOKENS = 8192

# How many search hits feed the chat context, matching ask's provide_answer.
CHAT_CONTEXT_RESULTS = 10


async def list_notebooks() -> List[Dict[str, Any]]:
    """List every notebook in this Open Notebook library.

    Returns the notebook id (usable in other tools), name, description and
    archived flag, newest activity first.
    """
    notebooks = await Notebook.get_all(order_by="updated desc")
    return [
        {
            "id": notebook.id,
            "name": notebook.name,
            "description": notebook.description,
            "archived": notebook.archived,
            "updated": str(notebook.updated),
        }
        for notebook in notebooks
    ]


async def list_sources(notebook_id: str) -> List[Dict[str, Any]]:
    """List the sources of one notebook (metadata only, no full text).

    Args:
        notebook_id: A `notebook:<key>` id as returned by list_notebooks.
    """
    notebook = await Notebook.get(notebook_id)  # raises NotFoundError
    sources = await notebook.get_sources()
    return [
        {
            "id": source.id,
            "title": source.title,
            "topics": source.topics,
            "embedding_status": source.embedding_status,
            "updated": str(source.updated),
        }
        for source in sources
    ]


async def search(
    query: str,
    notebook_ids: Optional[List[str]] = None,
    limit: int = 10,
) -> List[Dict[str, Any]]:
    """Keyword search across the whole knowledge base or a notebook scope.

    Runs full-text search first and falls back to vector (semantic) search if
    the text index fails, so one tool covers both. Rows carry the matched
    content, its parent source id (parent_id) and a score.

    Args:
        query: Search keywords.
        notebook_ids: Optional list of `notebook:<key>` ids to restrict the
            search to; empty or omitted searches everything.
        limit: Maximum number of results (1-50, default 10).
    """
    if not query or not query.strip():
        raise InvalidInputError("Search keyword cannot be empty")
    limit = max(1, min(int(limit), 50))
    scope = await resolve_notebook_scope(notebook_ids or [])

    try:
        results = await text_search(
            query, limit, True, True, notebook_ids=scope or None
        )
    except DatabaseOperationError as e:
        logger.warning(f"MCP search: text search failed, trying vector search: {e}")
        results = await vector_search(
            query, limit, True, True, notebook_ids=scope or None
        )

    return [
        {
            "id": row.get("id"),
            "title": row.get("title"),
            "content": row.get("content"),
            "parent_id": row.get("parent_id"),
            "score": row.get("relevance")
            if row.get("relevance") is not None
            else row.get("similarity"),
        }
        for row in results or []
    ]


async def chat(notebook_id: str, question: str) -> Dict[str, Any]:
    """Ask a question about one notebook and get a cited, grounded answer.

    One retrieval + one model call: the notebook's sources and notes are
    searched semantically, the top matches are assembled into a prompt and a
    single LLM invocation produces the answer (document ids in brackets refer
    to the returned context_ids). There is no conversation memory - pass the
    full question every time.

    Args:
        notebook_id: A `notebook:<key>` id as returned by list_notebooks.
        question: The question to answer.
    """
    if not question or not question.strip():
        raise InvalidInputError("Question cannot be empty")
    notebook = await Notebook.get(notebook_id)  # raises NotFoundError

    results = await vector_search(
        question, CHAT_CONTEXT_RESULTS, True, True, notebook_ids=[notebook_id]
    )
    ids = [row["id"] for row in results]
    payload = {
        "question": question,
        # Single-shot variant of the ask pipeline: the "strategy" is the
        # question itself, so ask/query_process renders the retrieval context.
        "term": question,
        "instructions": (
            "Answer the user's question using only the retrieved results below. "
            "If the results do not contain the answer, say so."
        ),
        "results": results,
        "ids": ids,
    }
    system_prompt = Prompter(prompt_template="ask/query_process").render(data=payload)

    prov = None
    try:
        prov = await provision_langchain_model_with_info(
            system_prompt,
            None,
            "tools",
            max_tokens=MCP_MAX_TOKENS,
        )
        ai_message = await prov.langchain_model.ainvoke(system_prompt)
        answer = clean_thinking_content(extract_text_content(ai_message.content))

        await record_llm_usage(model=prov, ai_message=ai_message, call_type="mcp_chat")

        return {
            "notebook_id": notebook.id,
            "answer": answer,
            "context_ids": ids,
        }
    except OpenNotebookError as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="mcp_chat",
            success=False,
            error=str(e),
        )
        raise
    except Exception as e:
        await record_llm_usage(
            model=prov,
            ai_message=None,
            call_type="mcp_chat",
            success=False,
            error=str(e),
        )
        error_class, user_message = classify_error(e)
        raise error_class(user_message) from e


async def add_note(notebook_id: str, title: str, content: str) -> Dict[str, Any]:
    """Add a note to a notebook (the only write operation exposed here).

    The note is saved as an AI note and queued for embedding, so it becomes
    searchable and answerable once a worker processes the queue.

    Args:
        notebook_id: A `notebook:<key>` id as returned by list_notebooks.
        title: Note title.
        content: Note body (markdown or plain text, non-empty).
    """
    await Notebook.get(notebook_id)  # raises NotFoundError if invalid/missing
    note = Note(title=title, content=content, note_type="ai")
    command_id = await note.save()
    await note.add_to_notebook(notebook_id)
    return {
        "id": note.id,
        "title": note.title,
        "note_type": note.note_type,
        "notebook_id": notebook_id,
        "embed_command_id": command_id,
    }


mcp = FastMCP(
    "open-notebook",
    instructions=(
        "Access to an Open Notebook knowledge base. Start with list_notebooks, "
        "then search across notebooks or chat with a single notebook for a "
        "grounded, cited answer. add_note is the only write operation."
    ),
)

# Registered by reference: mcp.tool(fn, name=...) returns fn unchanged in
# fastmcp 3.x, so the plain functions above stay directly callable (tests).
mcp.tool(list_notebooks, name="list_notebooks")
mcp.tool(list_sources, name="list_sources")
mcp.tool(search, name="search")
mcp.tool(chat, name="chat")
mcp.tool(add_note, name="add_note")


def main() -> None:
    """Run the server over stdio (no banner - stdout/stderr carry the pipe)."""
    logger.info("Starting Open Notebook MCP server (stdio)")
    mcp.run(transport="stdio", show_banner=False)


if __name__ == "__main__":
    main()
