# ADR-018: Ruankao user data starts local-first (localStorage) with defined table-upgrade triggers

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: ADR-016 (tab registry), ADR-017 (model-essay red line)

## Context

The ruankao module's remaining batches needed a persistence home for three kinds of user data — question-bank entries, essay drafts, timed-training runs — plus a way to hand a draft to the essay-coach chat. All three are single-user, single-browser and small (well under 100 KB). The README 2026-10-06 fork rule obliges every new project-data table to ship with a migration, `DATA_TABLES` export registration and export tests; three of the four batches were frontend-only sessions, so a table trio would not fit, and no cross-device or export demand had been observed to justify one.

## Decision

**localStorage with versioned keys now; migration to a SurrealDB table only when a trigger fires, under a fixed upgrade obligation.**

- Versioned keys: `ruankao.questions.v1` (question bank, no entry cap), `ruankao.essayDrafts.v1` (drafts, capped at 20, oldest dropped), `ruankao.trainingSessions.v1` (training runs, capped at 50). A parse failure falls back to an empty store; corrupt entries are dropped on read, never crash the panel. The coach handoff is a one-shot `sessionStorage` seed (`ruankao.coachHandoff.v1`), not stored data.
- Fixed-parts generation is a stateless synchronous endpoint (`POST /api/project-envs/{env_id}/fixed-parts/generate`) — nothing persists server-side, same posture as generic-paragraph; the essay slots live only inside the localStorage draft.
- Upgrade triggers: cross-device sync, multi-user sharing, or an export/import request for any of the three stores. When one fires, the migration **must** ship as one package: a SCHEMAFULL migration (posture of `41.surrealql`), `DATA_TABLES` registration in `commands/data_transfer_commands.py`, the export-test trio, and a one-shot localStorage → table import script.

## Alternatives considered

- **A SurrealDB table per store (`ruankao_question`, `ruankao_essay_draft`, `ruankao_training_session`)** — rejected: the migration + DATA_TABLES + export-test trio exceeded the single-session budgets of the frontend-only batches, and the demand (sync, sharing, export) was unproven.
- **Reusing `Note` for drafts and questions** — rejected: `Note.save()` automatically submits an `embed_note` command (`open_notebook/domain/notebook.py:845-876`), which pushes the content into the general retrieval context — exactly what ADR-017's red line keeps essay material out of — and Note has no section schema for the essay's five slots.

## Consequences

- Clearing browser data (or a private window) loses the bank, drafts and training history; the UI labels the storage 「本地存储」 so this is stated, not surprising.
- The three stores are absent from export/import packages; the upgrade triggers above are the exit path.
- ADR-016's tab registry is unaffected — panels read their store directly. The fixed-parts endpoint and the coach-handoff bridge deliberately get no record of their own (an increment on the existing stateless-endpoint pattern and a pure frontend mechanism).
