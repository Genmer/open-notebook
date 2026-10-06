# Storage Usage - Understanding What Takes Up Space

The Storage dashboard shows how much room your library occupies — text and vectors in the database, plus files on disk. Use it to see what actually consumes space and what deleting something will reclaim.

---

## Where to Find It

```
1. Click "Storage" in the sidebar (Manage section)
2. The dashboard opens at /settings/storage
3. Click "Refresh" to recalculate on demand
```

Numbers are reused from cache for about a minute; "Refresh" forces a recount whenever you want fresh figures.

---

## Reading the Dashboard

The page has four stat cards across the top and two detail cards below.

### The Four Stat Cards

| Card | Meaning |
|------|---------|
| "Database (estimated)" | Text and vectors stored in SurrealDB, estimated from counts |
| "On-disk usage" | Real bytes in the data folder, measured on disk |
| "Export package estimate" | How big a full-library export would be (see below) |
| "Records" | Total record count: vector chunks (with their dimensions) plus sources, insights and notes |

### The Disk Usage Donut

The "Disk usage" card shows a donut chart of your data folder — these are **real measured bytes**, not estimates:

- **Center**: total on-disk size
- **Segments**: "Uploaded files", "Podcast audio", "Export packages", "Tiktoken cache", "Chat checkpoints", and "Other" (anything else in the data folder)
- **Legend**: each segment's size and share of the total
- **Tooltip**: hover a segment for its exact size and percentage
- **Below the chart**: the data folder's path on your machine ("Folder: …"), so you know where the bytes physically live

If nothing is on disk yet, the card says so ("No files on disk yet.").

### The Database Breakdown (Per Type)

The "Database breakdown" card estimates size per record type, library-wide:

- **"Sources (full text)"** - extracted text of every source
- **"Insights"** - transformation and insight outputs
- **"Notes"** - your saved notes
- **"Embedding vectors"** - one vector per text chunk

Each row shows the record count, the estimated size, its share of the database, and a bar to compare at a glance. As the card's own description puts it: "Embeddings dominate large libraries."

One scope note: the breakdown is **library-wide** — there is no per-notebook split. To find a single notebook's share, look at its source count and sizes, or delete it (see [Freeing Up Space](#freeing-up-space)) and watch the total drop.

### Export-Size Estimation

The "Export package estimate" card predicts how large a full backup archive would be. It uses two possible bases, and the card tells you which one applies:

- **"Based on the size of your last export"** - if you have exported before, the estimate is the real size of that package
- **"Estimated from sampled compression ratios"** - with no export yet, it extrapolates: vectors compress to roughly 40% of their raw size, prose text to roughly 32%, and uploaded files count at about their full size

---

## What Takes Up Space

| Content | Where It Lives | How It's Counted |
|---------|---------------|------------------|
| Source full text | Database | Estimated (2 bytes per character) |
| Insights | Database | Estimated (2 bytes per character) |
| Notes | Database | Estimated (2 bytes per character) |
| Embedding vectors | Database | Estimated (8 bytes per vector value) |
| Uploaded files | Disk (`uploads/`) | Real measured bytes |
| Podcast audio | Disk (`podcasts/`) | Real measured bytes |
| Export packages | Disk (`exports/`) | Real measured bytes |
| Tiktoken cache | Disk | Real measured bytes (tokenizer vocabulary files) |
| Chat checkpoints | Disk | Real measured bytes (chat session state) |
| Everything else in the data folder | Disk | Real measured bytes ("Other") |

The estimation rule is spelled out on the page itself: "Text bytes are estimated at 2 bytes per character; each vector float counts as 8 bytes." The database column in SurrealDB cannot report per-table byte sizes, so text size is approximated from character counts — close enough for spotting trends, not an exact invoice.

**Which one grows fastest?** For text-heavy libraries, embeddings usually dominate: every source is split into chunks (~500 words each, see [Adding Sources](adding-sources.md)), and every chunk carries a vector. Uploading big PDFs grows both the text and the vector side; generating podcasts grows the disk side.

---

## Freeing Up Space

Each lever removes a specific slice:

### Delete Sources You No Longer Need

```
1. Open the source's menu (right-click in the Gemini view,
   "⋮" on the card in the classic view)
2. Choose delete and confirm
3. This removes the source's uploaded file, its embeddings,
   and its insights — all three slices shrink at once
```

This is the most effective lever, because it reclaims database estimates **and** disk bytes together.

### Delete Podcast Episodes

```
1. Go to Podcasts
2. Delete an episode you've downloaded or no longer need
3. Its audio file is removed from the podcasts folder
```

### Delete Old Export Packages

```
1. Click "Data Management" in the sidebar
2. In the export card, click "Delete package" and confirm
3. The package file is removed from the exports folder
   (and the export estimate falls back to the compression-ratio basis)
```

### Delete a Notebook (With Its Exclusive Sources)

```
1. Delete the notebook and choose to also delete sources that
   belong only to it
2. Those exclusive sources are fully deleted - files, embeddings,
   insights - while shared sources are merely unlinked and stay
```

### Two Things That Don't Need Cleaning

- **Tiktoken cache** - tokenizer vocabulary files the app manages itself; leave them alone
- **The data folder in general** - it also contains the database itself. Never clean it by hand from the file system; use the app's delete actions instead

---

## Related Dashboards

- **"Token Usage"** (`/settings/usage`) - what your AI calls *spend*: daily token trends and per-model cost estimates. Storage is what you keep; usage is what you consume.
- **"Data Management"** (`/settings/data`) - the export/import workflow behind the "Export packages" disk slice and the "Export package estimate" card.

---

## Common Questions

### Are These Numbers Exact?

The disk numbers are exact measurements of the data folder. The database numbers are estimates by construction — SurrealDB cannot report per-table byte sizes, so the page labels them "estimated" and shows the rule it uses (2 bytes per character, 8 bytes per vector value).

### Why Doesn't the Database Estimate Match My Data Folder Size?

The database total only sums four measured categories (sources, insights, notes, embeddings). The folder also holds the database engine's own overhead, indexes, chat checkpoints and other files — those surface under "Other" in the donut, not in the database estimate.

### Why Did the Export Estimate Change After My First Export?

Before any export, the card extrapolates from sampled compression ratios. Once a real package exists, the estimate switches to its actual size — so a jump after your first export is the estimate becoming real.

### Where Is My Data Actually Stored?

The path is printed under the disk donut ("Folder: …"). Everything the donut shows — uploads, podcast audio, exports, caches, checkpoints — lives inside that folder.

### Does Deleting a Source Really Free Space Immediately?

Yes — deleting a source removes its uploaded file from disk and its embeddings and insights from the database right away. The "Refresh" button re-counts so you can see the effect.
