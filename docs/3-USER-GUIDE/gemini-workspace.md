# Gemini Workspace - The NotebookLM-Style View

The Gemini workspace rearranges a notebook into the familiar three-column NotebookLM layout: a sources folder tree on the left, chat in the center, and a Studio panel on the right. Under the hood it is the same engine as the classic view — same sources, same notes, same chat — only the arrangement changes.

---

## What Is the Gemini Workspace

Open Notebook ships with two ways to look at a notebook. The classic view spreads sources, notes, and chat across separate columns. The Gemini view condenses everything into one screen that mirrors Google's NotebookLM:

```
┌──────────────────────────────────────────────────────────────┐
│  Notebook header                                              │
├──────────────┬──────────────────────────┬────────────────────┤
│              │                          │                    │
│  SOURCES     │       CHAT               │  STUDIO            │
│              │                          │                    │
│  Folder tree │  Talk to AI about        │  Toolbox: Audio    │
│  + web       │  everything you ticked   │  Overview, Study   │
│  research    │  in the left column      │  Guide, FAQ,       │
│              │                          │  Flashcards...     │
│  ☑ Folder A  │                          │                    │
│    ☑ Paper   │  [Message...]            │  Note cards        │
│    ☐ URL     │                          │  (artifacts land   │
│  ☑ Folder B  │                          │   here as notes)   │
│              │                          │                    │
└──────────────┴──────────────────────────┴────────────────────┘
```

Every part of a notebook stays in view at once: pick context on the left, converse in the middle, and collect artifacts and notes on the right.

---

## Switching Between Classic and Gemini Views

The layout is a per-user appearance setting, and it applies immediately — no save button, no reload.

```
1. Click "Settings" in the sidebar
2. Find the "Appearance" card
3. Under "Notebook Detail Style", pick one:
   - "Open NoteBook (Default)" - classic multi-column layout with
     hierarchical folders, sources, notes, and chat
   - "Gemini Notebook" - Google NotebookLM three-column layout with
     Web Research, centered chat, and Studio workspace
4. Open any notebook - it now uses the style you picked
```

Two things worth knowing:

- The choice is remembered **per browser** (it is stored locally, not on the server), so you can run Gemini view on your laptop and classic view on another machine.
- The "Gemini Notebook" option carries a **NotebookLM** badge in settings, so it is easy to spot.

---

## Tour of the Three Columns

### Sources Column: Folder Tree and Context Menu

The left column is your notebook's filing cabinet. Its header shows the column title plus a badge counting how many sources currently feed the chat context.

At the top of the column:

- **"New folder"** (folder+ icon) - create a folder in the current view
- **"从已有添加" (Add existing)** - link sources that already exist elsewhere in your library into this notebook
- **"Add Source"** - add brand-new content (same upload flow as the classic view; see [Adding Sources](adding-sources.md))
- A **view selector** (labeled "Organize") appears when your library has more than one view, grouped into "My folders" and "✨ AI grouping"

Below that, two tabs split the column:

- **"层级资源 (N)" (Hierarchical resources)** - your sources laid out as a folder tree
- **"网络导源 (Web)"** - the web research panel (see [Web Research Tab](#web-research-tab))

Inside the tree:

- Folders nest and collapse. Folders that contain sources start expanded; empty folders start collapsed.
- Each folder row has a **checkbox** - it toggles the chat context for every source in that folder, including subfolders.
- Each folder shows a count badge. When a folder holds more sources than this notebook uses, you see two numbers like `3 / 12`: the first is what is in this notebook, the second is how many sources that folder holds across your whole library.
- Sources not assigned to any folder land under **"未归档资源 (Ungrouped)"**.
- The **search box** filters the tree by title as you type.

**Right-click any source** for the full action menu:

| Menu Item | What It Does |
|-----------|--------------|
| "Open" | Opens the source detail view |
| "Rename" | Changes the source's title |
| "Move to folder…" | Files the source into another folder |
| "Remove from Notebook" | Unlinks it from this notebook (the source stays in your library) |
| "Delete Source" | Deletes it permanently, along with its file, embeddings, and insights |

At the bottom, a small **library overview panel** shows how your notebook relates to the rest of your library: "本笔记本已关联" (linked to this notebook) counts this notebook's sources, and "待引入文献" (not yet added) counts library sources this notebook does not use yet. If there are any, a "一键引入全库文献 (N)" (bring in N library sources) button opens the add-existing dialog with them one click away.

> Note: the folder tree here is the same folder system the classic view uses — folders are a library-wide feature, not something only this view has. Changes you make in one view show up in the other. For the full folder toolkit — nested folders, AI classification, folder-scoped chat context — see [Folders](folders.md).

### Chat Column: Save Reply as Note

The center column is the full chat experience — sessions, model override, and context control — titled "Chat with Notebook". It works exactly like the classic chat (see [Chat Effectively](chat-effectively.md)); the sources it sees are the ones you ticked in the left column.

The habit this layout encourages: **save good replies as notes**.

```
1. Ask a question in the center column
2. Under the AI reply, click "保存为笔记" (Save to note)
3. The reply becomes an AI note in the notebook
4. It appears immediately as a card in the right Studio column
```

There is also a "复制" (Copy) button next to it for pasting replies elsewhere.

### Studio Column

The right column is part toolbox, part notebook. It has two zones:

- **"Studio 工具箱 (Notebook Actions)"** - a grid of one-click generator cards (next section)
- **"笔记本卡片流" (note card stream)** - every note in the notebook as a card, AI notes marked with a bot icon. Click a card to read it in place, hover it to edit or delete. New AI replies you save, and artifacts you generate, both land here.

A "新建笔记" (New note) button in the header lets you write a note by hand, and a "进度管理" (Progress management) link jumps to the Task Center.

On narrow screens the whole workspace switches to tabs — "来源与导源" (Sources), "研读问答" (Chat), and "Studio 工作室" — so the three columns become three swipeable views. On desktop you can collapse the Studio column to a thin strip to give chat more room.

---

## Studio Artifacts

The Studio toolbox generates study materials from your notebook and files them back as notes:

| Tool | What You Get |
|------|--------------|
| "Audio Overview" | Opens the podcast generator for a two-host deep-dive episode (see [Creating Podcasts](creating-podcasts.md)) |
| "Study Guide" | Core concepts, key points, and self-test questions |
| "Briefing Doc" | An executive briefing: background, supporting facts, risks, next steps |
| "FAQ 问答集" (FAQ) | The questions readers would most likely ask, with answers |
| "Flashcards" | Question-and-answer cards for memorization practice |

Generating one:

```
1. Click a tool card in the Studio column (not "Audio Overview" - that one
   opens the podcast dialog directly)
2. The dialog pre-fills a custom instruction describing what to extract;
   edit it to steer the output
3. The dialog shows how many sources and notes will be used - it follows the
   context you ticked in the Sources column (with everything included as a
   fallback when nothing is selected)
4. Click "立即生成并存为笔记" (Generate and save as note)
```

Generation runs **asynchronously in the background**. The dialog switches to a live progress view showing status and elapsed time, with two options: "后台运行，关闭" (run in background, close) keeps the job going while you do something else, and "打开进度管理" (open progress management) jumps to the Task Center for the full inspector. When the artifact is ready it is added to the notebook automatically as an AI note — no manual copying.

> **Prerequisite**: artifact generation is a background job, and background jobs need the worker running (`make worker-start`). The Task Center is the place to watch every job (see [Task Center](task-center.md)); if jobs sit in "Queued" forever, see [Common Issues](#common-issues).

**Practicing with flashcards**: the generated flashcard note holds front/back pairs. Open the notebook's Notes panel in the classic view and click the flashcard note — it renders as click-to-flip cards (click a card, or focus it and press Enter/Space, to flip from question to answer). For what else you can do with artifact notes — editing, tagging, chat context — see [Working with Notes](working-with-notes.md).

---

## Web Research Tab

The second tab in the Sources column, "网络导源 (Web)", is a built-in starting point for gathering material about a topic:

```
1. In the Sources column, click the "网络导源 (Web)" tab
2. Pick a mode: "Fast 快速" (quick keyword sweep) or "Deep 深度"
   (slower, multi-step research)
3. Type a topic or keywords and press Enter (or the search button)
4. Review the candidate results - each has a checkbox, a title link,
   and a snippet
5. Tick the ones you want and click "批量加入笔记本" (add to notebook)
6. Each selected result is saved into the notebook as a link source
   and processed like any other web source
```

**Honest caveat**: in this fork, the research sweep itself is a preview — the result list is simulated placeholder data, not live web search. The saved sources are real: whatever you tick is added as a genuine link source and processed normally. Treat the tab as a workflow preview; for actual web content today, add URLs with "Add Source" → "Web Link" (see [Adding Sources](adding-sources.md)).

---

## Classic vs Gemini: Which to Use When

| Situation | Use |
|-----------|-----|
| Working through one notebook end to end (gather → ask → collect) | Gemini view - everything on one screen |
| You think in folders and want the tree always visible | Either - both views share the same folder tree |
| Heavy note editing and bulk note operations | Classic view - the dedicated Notes column has more room |
| Generating artifacts while chatting | Gemini view - progress shows in the Studio column without leaving chat |
| Small screens / quick checks on mobile | Gemini view - the three tabs switch cleanly |
| Following guides written for the classic layout | Classic view - panel names match the docs one-to-one |

You can flip between them any time in "Settings" → "Appearance"; nothing is lost because both views show the same notebook.

---

## Common Issues

### Stuck in "Queued" When Generating an Artifact

**Problem**: The progress view never advances past queued.
**Solution**: Background jobs run in the worker process. Start it (`make worker-start`, or `make status` to check), then retry or just wait — the job is still in the queue and will run once the worker is up.

### Saved Reply Doesn't Show Up in Studio

**Problem**: You clicked "保存为笔记" but see no new card.
**Solution**: The card list refreshes automatically; if you were mid-scroll, click into another notebook and back, or refresh the page. Also check the note isn't there under an auto-generated title.

### A Source Is Dimmed and AI Ignores It

**Problem**: A source card looks faded.
**Solution**: Its context checkbox is unticked, so chat cannot see it. Tick the checkbox — or tick the whole folder's checkbox — to bring it back into context.

### Folder Count Looks Wrong

**Problem**: A folder badge shows `3 / 12` but you only have 3 sources.
**Solution**: That's the dual count — 3 in this notebook, 12 across your whole library. The rest belong to other notebooks; use "从已有添加" (Add existing) if you want some of them here.

### Deleting a Folder Took My Sources With It

**Problem**: After deleting a folder, its sources are gone entirely.
**Solution**: When deleting, the dialog asks whether to "Also delete all sources in this folder" — ticked, sources (and their files) are permanently deleted after a second confirmation; unticked (the default), sources survive and move to "Ungrouped". Read the dialog before confirming; deleted sources cannot be recovered.

### Web Research Results Look Like Placeholders

**Problem**: Every search returns similar example results.
**Solution**: That's expected for now — the research sweep is a simulated preview in this fork (see [Web Research Tab](#web-research-tab)). Add real URLs via "Add Source" instead.

---

## Summary Checklist

- [ ] Switch layouts in "Settings" → "Appearance" → "Notebook Detail Style"
- [ ] Tick sources (or whole folders) in the left column to control chat context
- [ ] Right-click a source for open / rename / move / remove / delete
- [ ] Save useful chat replies with "保存为笔记" — they appear in Studio
- [ ] Generate study guides, FAQs, flashcards, and briefings from the Studio toolbox
- [ ] Remember the worker must be running for artifact jobs to progress
