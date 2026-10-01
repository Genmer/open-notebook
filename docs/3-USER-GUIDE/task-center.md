# Task Center - Tracking Background Operations

Every async operation in Open Notebook — insights, embeddings, podcast generation, exports — runs in the background. The Task Center puts all of them on one page so you can see what is running, watch it live, and fix what failed.

---

## What Is the Task Center

Whenever Open Notebook does slow work, it does not block you — it queues a background task and lets you keep working. The Task Center (**"Task Center"** in the sidebar's "Manage" group) shows every one of those tasks:

- **Podcasts** being generated (see [Creating Podcasts](creating-podcasts.md))
- **Insights** extracted from sources (see [Transformations](transformations.md))
- **Embeddings** computed so sources become searchable (see [Adding Sources](adding-sources.md))
- **Sources** being processed after upload
- **Study artifacts** generated from your notes
- **Exports and imports** of your library (see [Data Migration](data-migration.md))

The list updates itself: while anything is running it refreshes every few seconds; when idle, it slows down to a gentle poll.

---

## Quick Start: Check Your First Task

```
1. Add a source to a notebook (or start a podcast)
2. Click "Task Center" in the sidebar
3. Find the task in the list — it is usually "Running" or "Queued"
4. Click the terminal button on the row ("View live progress") to watch it live
5. Go back to work — you do not need to keep this page open
```

Most source processing finishes in 30-60 seconds; podcasts and large embedding jobs take longer. You will also see progress inline where you started the job (for example, in the notebook view) — the Task Center is the place to check when you want the full picture.

---

## Understanding the Task List

Each row shows:

- **What** — the operation, e.g. "Generate insight", "Generate embeddings", "Generate podcast", "Export data", plus the item it works on (the source, notebook or note name)
- **Status** — a colored badge
- **When** — how long ago the task was created or updated
- **Progress** — running tasks show a progress bar and, for embedding jobs, a chunk counter like `12/40 chunks`

### Statuses and Multi-Stage Progress

| Status | Meaning |
|--------|---------|
| "Pending" | Received, not yet picked up |
| "Queued" | Waiting for a worker slot |
| "Running" | Actively executing |
| "Completed" | Done — result is in your library |
| "Failed" | Something went wrong (see [AI Diagnostics](#ai-diagnostics-for-failed-tasks) below) |
| "Canceled" | Canceled by you |

Running tasks move through a multi-stage pipeline. Each task type has its own four stages — for example, a podcast runs through material parsing, script generation, speech synthesis and final mixing; an embedding job reads text, splits it into chunks, computes vectors and writes the index. The current stage appears as a small badge next to the status, and the [Live Inspector](#live-inspector) shows all four stages as a stepper.

### Filtering by Type and Status

Tabs at the top filter the list, each with a live count badge:

```
1. "All" — every task
2. "In progress" — pending, queued and running
3. "Completed" — finished successfully
4. "Failed" — needs your attention
```

The list loads 100 tasks at a time; click "Load more" to see older ones. The "Refresh" button forces an immediate reload.

---

## Live Inspector

Every row has a terminal button — labeled "View live progress" while running, "Details" otherwise. Click it to open the Live Inspector, a panel that slides in from the right.

### What the Terminal Shows

The inspector's terminal window streams the task's live-progress feed with a typewriter effect, stage by stage, so you can tell the job is genuinely moving rather than guessing from a spinner. What it contains depends on the task type:

- **Podcasts** come closest to live model output: once scripting has started, the terminal shows the latest dialogue line written so far (or an "outline ready" line), refreshed as the script grows
- **Study artifacts** show an excerpt of the notebook's most recent note — not the text currently being generated (that note is only written when the job finishes), so early in the run you will see a stage message such as "analyzing context…" instead
- **All other tasks** — insights, transformations, embeddings, data transfers — show status text only: the current stage, progress counters (e.g. chunks indexed) and elapsed time. No model output is streamed for these

### Token Rate and Live Progress

The inspector shows:

- A **stopwatch** with elapsed time (MM:SS)
- A **progress bar** with a percentage when the backend can compute one
- A **stage stepper** — four cards showing all stages, with the current one highlighted
- **Token telemetry** for model tasks: prompt tokens, output tokens and a live rate in tok/s with the model name. For embedding tasks it shows processed chunks out of total instead

The list refreshes about every 1.5 seconds while the task runs, so counters and the terminal move continuously. Token numbers are approximate — until the model reports its usage, the panel shows an estimate.

From the inspector you can also **"取消任务"** (cancel the task) while it is still running.

> **Note**: This fork shows the inspector's stage names and a few button labels in Chinese regardless of interface language.

---

## AI Diagnostics for Failed Tasks

When a task fails, its row shows the raw error message plus three actions:

- **"Why did it fail?"** — expands the AI explanation card
- **"Manual retry"** — resubmits the job as-is
- **"AI Retry"** — checks whether the problem still exists before resubmitting

### The Four-Part Explanation (What / Why / How to Fix / Next Actions)

Click "Why did it fail?" and the card asks the AI to analyze the failure. After a few seconds of thinking, you get an "AI Analysis" card with a classification badge and four sections:

```
**What happened**
   A plain-language description of what failed.

**Likely root cause**
   The most probable reason — bad API key, rate limit, missing model, etc.

**How to fix**
   Concrete steps for your situation.

**Next actions**
   Buttons that do the fix for you.
```

The classification badge tells you who has to act:

| Badge | Meaning |
|-------|---------|
| "Retryable" | Transient problem — retrying will likely succeed |
| "Needs configuration" | Fix it on your side — usually a missing key or model |
| "Known issue" | Documented problem, not your fault |
| "Likely a bug" | Worth reporting |
| "Undetermined" | The AI could not classify it |

"Next actions" may include "Retry task", "Open model settings", "Open credentials", "Copy diagnostics" (a redacted summary safe to paste into a bug report) and "Report an issue". Expand "Details used" to see exactly which command, type, status and error text the analysis was based on.

If the AI service itself is unavailable, the card says so ("AI unavailable — showing rule-based classification") and falls back to a rule-based classification from the error type — you still get a badge and suggested actions.

### Recovery Detection and Retry

**"AI Retry"** first checks whether the failed item has already recovered — for example, another run completed the embedding while you were reading the explanation. If so, you get "Already recovered — retry skipped" and nothing is replayed; the card shows "The item looks healthy now — nothing to do". Only when the problem persists does AI Retry resubmit the job.

Not every task can be retried: podcast generation and imports cannot (an import deletes its uploaded package when it fails permanently), while insights, embeddings, source processing, artifacts and exports can.

---

## Troubleshooting

### Tasks Stuck in Queued (worker not running)

**Symptom**: Tasks sit in "Queued" forever and never start running.

**Cause**: The background worker is not running. Podcasts, embeddings and source processing are async jobs handled by a separate worker process — without it they silently queue forever.

**Fix**:
- If you run from source, start the worker (`make worker-start`) alongside the API
- In Docker, the worker runs inside the same container as the API — if tasks queue forever, check the container logs and restart it
- Then click "Refresh" — queued tasks should move to "Running" within seconds

### Retry Fails

**Symptom**: "Manual retry" produces the same failure.

**Fix**:
- Read the classification badge on the explanation card — "Needs configuration" means retrying cannot help until the key or model is fixed (see [API Configuration](api-configuration.md))
- For "Transient" problems (rate limits, network), wait a minute and retry
- If the badge says "Likely a bug", use "Copy diagnostics" and "Report an issue" instead of retrying

---

## Common Mistakes

| Mistake | What Happens | How to Fix |
|---------|--------------|------------|
| Leaving the Task Center open to "watch" a job | Wasted time — jobs run in the worker, not on this page | Start the job, glance at the Live Inspector once, go back to work |
| Retrying a "Needs configuration" failure | Same failure every time | Fix the key or model first, then retry |
| Ignoring "Queued" tasks for hours | Nothing progresses without the worker | Check that the worker process is running |
| Using "Manual retry" on everything | You may replay a job that already succeeded elsewhere | Prefer "AI Retry" — it skips recovered items |
| Canceling a running export to "speed it up" | The export stops and must restart from the beginning | Let data transfers run to completion |

---

## Summary Checklist

- [ ] I know the Task Center lives in the sidebar under "Manage"
- [ ] I use the "In progress" tab to see what is running right now
- [ ] I open the Live Inspector (terminal button) to watch long jobs
- [ ] Failed tasks get read via "Why did it fail?" before I retry
- [ ] Tasks stuck in "Queued" make me check the worker first
- [ ] I use "Copy diagnostics" (not screenshots) when reporting issues

Tasks are the engine room of Open Notebook. Check them when something feels slow — usually the answer is already on the page.
