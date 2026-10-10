# ADR-017: Model-essay red-line isolation filters at three shared read points

- **Status**: Accepted
- **Date**: 2026-10

## Context

The 软考 module keeps model essays (范文) in the normal source store, but their text must never enter any AI generation context (red line 1 of the module requirements): the exam-essay coach and question-bank generators may not retrieve them, or the user's own writing converges on the training essays. Five concrete leak paths existed — global text/vector search, `gather_evidence`, `ask.py` retrieval, the MCP server, `Notebook.get_context` and `build_notebook_context` (notebook chat injection).

## Decision

**One mark table, one filter function, three read-side landing points, two explicit exception channels.**

- `model_essay_mark` (migration 41) stores only `target_type` plus a `source` or `source_group` record reference — no content fields, no copies of essay text. Marks on a folder cover its whole subtree (defensively capped at `MAX_GROUP_DEPTH` levels below the marked root), and the effective set is recomputed on every read, so filing changes follow automatically.
- `get_marked_source_ids()` (`open_notebook/domain/model_essay_mark.py`) is the single resolution point for the effective set. It is **fail-closed**: a database failure propagates and fails the retrieval rather than returning unfiltered rows. There is deliberately no cache — a cache-expiry window is a leak window.
- The filter is applied inside the **public** entry points, not per call site: `text_search`/`vector_search` tails (covers all four source row shapes — title/full-text/chunk/insight — because `parent_id` is always `source.id`, and inherits to the split-term retry, the position-overflow fallback, `gather_evidence`, `ask.py` and the MCP server), `Notebook.get_context` after the full-text fetch, and `build_notebook_context` in both its config and default branches.
- The only sanctioned exception channels are single-source chat (`build_source_context`, the user explicitly opens that essay) and reading a source by id (`get_essay_full_text` / `GET /api/sources/{id}`) for the essay reading mode and the future similarity check.
- Dangling marks are handled with three safety layers: SurrealDB EVENT cascade on source/source_group delete (migration 41, same posture as migration 29), silent skip + reporting in the library endpoint, and `DELETE /api/ruankao/essay-marks?dangling=true` as the manual backstop.

## Alternatives considered

- **Optional exclude parameter on the `fn::text_search`/`fn::vector_search` SurrealDB functions** — rejected: the default (no parameter) would be the unsafe path; every future caller must remember to pass it.
- **Filtering inside `_raw_text_search`** — rejected: the split-term retry and the #648 overflow fallback assemble results through other paths; filtering at the public tail covers every cascade for free.
- **Filtering in each consumer (ask graph, MCP, pipeline)** — rejected: five call sites to keep in sync; a new consumer silently reintroduces the leak.
- **Marking by copying essays into a separate table** — rejected: duplicates content (drifts from the real source on update) and violates the module's no-copy rule.

## Consequences

- New retrieval code must call `text_search`/`vector_search` (never the `fn::` functions directly — the two existing direct callers are the entry points themselves, locked by comment and tests in `tests/test_model_essay_mark_isolation.py`).
- The user's search page also stops showing marked-essay snippets — accepted strictness (R9); the essays stay reachable by id (library page, reading mode).
- Every search/context read pays 1–3 small mark queries; accepted, no cache by design.
- A mark-table outage fails searches and context building (fail-closed) — the whole notebook's retrieval is the blast radius; visibility is a plain 500.
