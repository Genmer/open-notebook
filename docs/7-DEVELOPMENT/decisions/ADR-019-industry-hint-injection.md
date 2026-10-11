# ADR-019: Industry hints are one dual-mirror corpus, derived from the stored industry at render time

- **Status**: Accepted
- **Date**: 2026-10

## Context

The industry pool (ADR-016) grew per-entry business-trait hints — one ≤40-character Chinese line per industry, finalized in `docs/7-DEVELOPMENT/plans/industry-pool-upgrade-design.md` §2.2. They do two jobs: tooltip the pool UI, and steer mock generation so an AI-mocked project's background matches the chosen industry's real business surface. That raised three structural questions at once: where the hint corpus lives (the frontend pool already holds the names, but generation runs in the Python worker), how it reaches the prompts (a request field? a DB column? a lookup?), and which of the project-env templates consume it. The hints are Chinese corpus feeding a Chinese essay pipeline (R2, ADR-016), and an industry `name` is already the stored `env.industry` value and must never change — it is the lookup key.

## Decision

**One corpus, two language mirrors; hints are never transmitted or stored — the backend derives them from the stored industry at render time, and only the five mock main-chain templates consume them.**

- The pool exists twice by design: `frontend/src/lib/ruankao/industry-pool.ts` (`{name, hint}` entries for the UI) and `open_notebook/ai/industry_pool.py` (`INDUSTRY_HINTS` for generation), byte-equal by contract and enforced by `tests/test_industry_pool_parity.py`. A `name` is immutable; changing one strands stored `env.industry` values and the lookup at the same time.
- Scheme B: no request field, no schema change, no migration. Each of the five mock-chain render functions (`render_mock`, `generate_materials`, `generate_routes`, `render_materials_draft`, `render_route_draft`) resolves `industry_hint = industry_hint_for(resolved_industry)` while assembling its template data. Out-of-pool or blank industries yield `""`, and the `{%- if industry_hint %}` line in COMPANY CONTEXT renders nothing — byte-identical to the pre-injection output, locked by a test that renders the stripped template in the same Prompter environment.
- The injection surface is exactly those five templates (mock, materials, routes, both draft assemblies), one conditional line after the industry line. `render_generic_paragraph` and `render_fixed_parts` deliberately take no hint: their only factual source is the verified material, and both also serve real projects, where a mock-oriented hint could pull the text away from the user's actual material. Because the hint is re-derived from the stored (unchangeable) industry on every render, the four re-run paths (reverify, regenerate, materials redo, selection submit) agree with first generation for free.

## Alternatives considered

- **Scheme A — `industry_hint` as a request field plus a persisted column** (mirroring `industry` / migration 40): rejected for this batch — it touches ~10 files, needs a migration and a `ProjectEnvUpdate.industry` fix (the update model has no industry field), and re-run paths would need the hint threaded through. It remains the recorded upgrade path if hints ever become user-editable.
- **Carrying the hint through `wizardSeed`** (pool click → wizard state → request): rejected — it creates hint-staging state with no consumer and edits the wizard's click-through flow; scheme B needs zero wizard changes.
- **Injecting into the bypass templates too**: rejected for the material-purity and real-project reasons above; a `source_type == "mock"` gate is the prepared future extension, not needed now.
- **A SurrealDB table for the pool**: already rejected in ADR-016 for the names (read-only vocabulary, no owner, no sync story); the same reasoning covers the hints.

## Consequences

- Editing the pool means editing both mirrors in the same change; the parity test fails on any drift — that is the point.
- The default industry (物流行业) and every custom industry get no hint line — expected behavior, not a regression, and rendering stays byte-identical.
- Byte-identical no-hint rendering is a hard gate: template edits must keep the `{%- if %}…{%- endif %}` whitespace-control form; a bare `{% if %}` on its own line would leave a blank-line diff.
- If "industry editable after creation" is ever built, hint-lookup consistency must be re-evaluated in a new record (a rename would strand stored rows outside the pool).
