# ADR-016: Ruankao module is one registry-driven page with hidden null-slot tabs

- **Status**: Accepted
- **Date**: 2026-10

## Context

The 软考 (ruankao) exam-essay workspace grows from one page (project environments) into a five-surface module (project environments, question bank, model-essay library marks, essay reading/writing, topic heat board) delivered by four independently scheduled batches. A route per surface would couple the batches to the router and to each other's launch dates, and the industry pool (77 name-level Chinese strings for the mock wizard) needed a home without a database table.

## Decision

**The module lives at a single `/ruankao` page whose tabs come from one registry (`frontend/src/lib/ruankao/tabs.ts`): each entry carries `key`/`labelKey`/`testid`/`renderContent`, and a tab whose content slot is `null` is not rendered at all.** Segments fill their slot and the tab appears — no router or page edits. Tab state is local `useState` (never written to the URL); `?tab=<key>` is read once as a deep-link initial value and invalid or not-yet-delivered keys fall back to the first rendered tab. External deep links always use `/ruankao?tab=<key>`; opening the wizard with values from outside goes through a one-shot seed prop (`preset`), not URL state.

The legacy `/project-environments` route issues a temporary (307) redirect to `/ruankao?tab=environments` — temporary so the shell batch can be rolled back independently of a 308's aggressive browser caching; in-app `window.open` callers point at the new address directly. The industry pool ships as a frontend constant (`lib/ruankao/industry-pool.ts`), embedded as a section inside the project-environments tab (no separate tab, no DB table, entries stay Chinese and out of the 14 locales).

## Alternatives considered

- **One route per surface (`/ruankao/qbank`, …)** — rejected: couples batch merge order to the router and splits the module's shared shell.
- **Render all five tabs with "coming soon" placeholders** — rejected: question bank / model library / essay have their own i18n namespaces and empty-state copy; a hidden tab is cheaper and cannot imply shipped features.
- **Persist the active tab in the URL or localStorage** — rejected: breaks the tasks-page precedent of local-only tab state and makes deep links ambiguous about whether they should navigate or seed.
- **Industry pool as a SurrealDB table or a separate tab** — rejected: entries are read-only vocabulary extracted offline from the essay corpus (no owner, no sync story); R2 pinned the pool inside the project-environments tab.

## Consequences

- Each batch's diff surface is one line in `tabs.ts` plus its own panel component; the registry is the single place tab keys/labels/testids are defined (`ruankao.tabs.<key>` i18n keys follow it).
- Deep links to an undelivered tab silently land on the first tab until that segment fills its slot — intentional, so external links never open an empty page.
- The 307 must be revisited once the module is stable (upgrade to `permanentRedirect`) so browsers cache the move.
