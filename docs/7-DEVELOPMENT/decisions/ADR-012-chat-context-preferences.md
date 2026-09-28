# ADR-012: Chat context preferences are a schemaless table keyed (notebook, folder, source), with no DELETE

- **Status**: Accepted
- **Date**: 2026-09
- **Related**: ADR-006 (migration granularity), migration 31

## Context

The notebook chat context UI lets the user include/exclude each source per folder scope. Manual and bulk choices had to survive navigation between folders, but not necessarily forever: the scope view defines its own default (in-folder sources included, everything else out), so preferences only exist to override that default. Storing them on the `source` row would leak across scopes and notebooks; a fully managed relational join table would add migration weight for data that is safe to lose.

## Decision

**Persist per-source context modes in the schemaless `chat_context_pref` table (migration 31), keyed by the (notebook, folder, source) triple; there is no DELETE endpoint — writing a mode back to `full` restores the default.**

- The record id is a deterministic SHA-256 hash of `(notebook, folder, source)`, so re-saving the same triple is a true upsert and re-saving never duplicates rows.
- `folder` is the `source_group` record for folder scopes and `NONE` for the ungrouped bucket; reads filter `folder = $folder` / `folder IS NONE`.
- Cleanup happens only through cascade deletes of the owning records (notebook, source, or folder/view deletion sweeps `chat_context_pref` in the same call). Orphan rows are unreachable by construction: every read is scoped by a live parent id.
- The API surface is GET/PUT on `/notebooks/{id}/context-preferences` only; the frontend treats save failures as non-fatal (toast + refetch on next scope entry).

## Alternatives considered

- **Columns on `source`** — rejected: modes are per (notebook, folder), a source can live in several folders, and the unscoped "all" view would need yet another field.
- **A SCHEMFULL table with a DELETE endpoint** — rejected: more schema to migrate and more API for data whose absence already means "use the scope default"; stale rows are harmless, so garbage collection via cascades is enough.
- **Client-only state (localStorage)** — rejected: choices would not follow the user across browsers/devices, unlike every other notebook artifact.

## Consequences

- Un-bulk ("reset to default") is a write of `full`/`off` per source, not a delete; rows accumulate until the owning record is deleted.
- Any new writer must reuse the deterministic id helper (`_pref_ref` in `api/routers/notebook_context_prefs.py`) or upserts will fork into duplicate rows.
- The table is intentionally schemaless, so adding a per-pref field later needs no migration.
