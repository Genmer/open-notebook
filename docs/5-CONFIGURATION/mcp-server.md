# Built-in MCP Server (Coding Agents)

Open Notebook ships a built-in **MCP server** (`open_notebook.mcp_server`) that
exposes this notebook library directly to coding agents — Claude Code, Cursor,
and any MCP-compatible client — over **stdio**. The agent talks to your
SurrealDB database through the same domain layer as the API: no HTTP endpoint
needs to be reachable.

> Looking for the community HTTP-based server (`open-notebook-mcp`)? See
> [MCP Integration](mcp-integration.md). The built-in server below needs no
> extra install and no running API.

## Tools

4 read-only tools plus 1 write tool:

| Tool | Purpose |
|---|---|
| `list_notebooks()` | Every notebook (id, name, description) |
| `list_sources(notebook_id)` | Sources of one notebook (metadata only) |
| `search(query, notebook_ids?, limit?)` | Full-text search with vector fallback, optionally scoped to notebooks |
| `chat(notebook_id, question)` | One-shot grounded answer with citations (`context_ids`) |
| `add_note(notebook_id, title, content)` | The only write: saves an AI note and queues it for embedding |

`chat` is intentionally stateless: retrieval + a single model call per
invocation. There is no conversation memory — pass the full question each
time. The model used is the default **tools** model from Manage → Models.

## Prerequisites

- Python environment of this repository (the server runs inside the
  `open_notebook` package, needs `fastmcp`, which is a direct dependency).
- SurrealDB running and reachable via `SURREAL_URL` etc. (the same `.env` the
  API uses — the server loads it from the working directory).
- For `chat` and vector `search` fallback: an embedding model configured; for
  `add_note` embedding to complete: the surreal-commands worker running
  (`make worker-start`).

## Run Manually

From the repository root:

```bash
python -m open_notebook.mcp_server
```

It speaks MCP over stdio and produces no other stdout output.

## Claude Code

```bash
claude mcp add open-notebook -- uv run --directory /path/to/open-notebook python -m open_notebook.mcp_server
```

Or in the project root run it from, create `.mcp.json`:

```json
{
  "mcpServers": {
    "open-notebook": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/path/to/open-notebook",
        "python",
        "-m",
        "open_notebook.mcp_server"
      ]
    }
  }
}
```

Environment variables (`SURREAL_URL`, `SURREAL_NAMESPACE`, `SURREAL_DATABASE`,
`SURREAL_PASSWORD`, model credentials) are read from the repository `.env`; you
can also pass an `env` object in the config above.

## Cursor

Add to `~/.cursor/mcp.json` (or the project's `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-notebook": {
      "command": "uv",
      "args": [
        "run",
        "--directory",
        "/path/to/open-notebook",
        "python",
        "-m",
        "open_notebook.mcp_server"
      ]
    }
  }
}
```

Windows note: replace `/path/to/open-notebook` with the absolute path of this
repository (e.g. `E:/Code/Agent/open-notebook` — forward slashes avoid JSON
escaping issues).

## Example Prompts

- _"List my Open Notebooks"_
- _"Search my notebooks for 'embedding chunking' and open the top hits"_
- _"Ask my 'LLM research' notebook how context preferences work"_
- _"Save that conclusion as a note in my 'LLM research' notebook"_

## Troubleshooting

- **Server exits immediately / client shows no tools**: run
  `python -m open_notebook.mcp_server` from the repo root manually — a missing
  database connection or a import error prints to stderr.
- **`chat` errors with a model configuration message**: configure a default
  **tools** model (and an embedding model) in Manage → Models.
- **Notes saved but not searchable**: the embed command is queued — check the
  surreal-commands worker is running.
