# Folders - Organizing Sources with Folders

Folders group your sources inside a notebook — nested as deeply as you need, filed by hand or automatically by AI. They also scope what chat sees: select a folder, and your context choices are remembered for that folder.

---

## What Are Folders

Folders live in the **folder rail** — the "Folders" column with the "Organize" selector at the top of a notebook view (available in both the classic and the Gemini-style workspace). The same folders, with a file-manager-style grid, bulk operations and more, are on the **Sources page** ("Sources" in the sidebar's "Collect" group).

Three things to know up front:

- **Folder sets.** The "Organize" selector switches between independent folder trees, called folder sets. A set is "An independent folder tree, shared across notebooks" — the same folders appear in every notebook; each source is filed per set.
- **Three families of sets.** "My folders" — ones you create and maintain yourself; "✨ AI grouping" — built-in sets the AI fills for you ("By content" and "By filename"); "By file type" — read-only buckets by file format.
- **Filing is per set.** A source can sit in one folder per set: moving it to a new folder in the same set removes it from the old one.

---

## Quick Start: Create Your First Folder

```
1. Open a notebook
2. In the "Folders" column, click "New folder" at the bottom
3. Name it ("Interviews", "Papers 2026", ...) and confirm
4. Select the folder — it shows "No sources here yet."
5. Open a source's "⋯" menu and pick "Move to folder…"
6. Click the folder to see only its sources
```

Folders can nest: hover a folder, open its "⋯" menu and pick "New subfolder" — up to five levels deep. On the Sources page you can also drag sources straight onto a folder (see [Filing Sources](#filing-sources)).

---

## Managing Folders

### Creating, Renaming and Nesting

Every folder's "⋯" menu (or right-click) offers:

- **"New subfolder"** — creates a child (folders can nest up to 5 levels)
- **"Edit"** — rename
- **"Move to..."** — reparent the folder; you can also just drag a folder onto another folder (or onto the blank area to move it to the root)
- **"Delete"** — see below

Names must be unique among sibling folders — a duplicate is rejected with "A folder with this name already exists here". Folders show a count badge with the number of sources filed directly inside them.

### Deleting a Folder

Deleting asks for confirmation: "Delete folder "X"?" — "Sources inside will be removed from the folder."

- **Default (checkbox unchecked):** the folder and its subfolders are removed; the sources **stay in your notebook** — they just become unfiled ("Not in a folder").
- **Checkbox "Also delete all sources in this folder":** deletes every source in the folder and its subfolders, along with their files and insights. This needs a second confirmation — "Delete sources permanently?" — because it cannot be undone.

Either way, the folder's saved chat-context preferences (see [Folder-Level Chat Context](#folder-level-chat-context)) are cleared together with the folder.

Deleting a whole **folder set** ("Folder set options" → delete) removes all its folders but never touches sources: "All folders in this set will be removed. The sources themselves are not affected." The two built-in AI sets ("By content", "By filename") cannot be deleted.

---

## Filing Sources

### Manual Move and Drag Targets

- **Drag and drop (Sources page):** drag one or more selected sources from the list onto a folder in the tree — or onto "Not in a folder" to unfile them.
- **Row menu:** open a source's "⋯" menu → "Move to folder…" and pick the target folder and set (available in the notebook view too).
- **Multi-select (Sources page):** select sources with the checkboxes, then "Move to folder", "Copy to folder" or "Remove from folder".

**"Copy to folder"** duplicates the selected sources into the target folder — a real copy with its own file (named "… (copy)") and, for fully embedded sources, its embeddings. Extracted insights are not duplicated. Useful for filing the same material under two projects without re-uploading it.

When adding a new source, the dialog's **"Save to folder (optional)"** section files it as it is created — default "Don't put in a folder". If you pick a folder but no notebook, you are warned: "A folder is selected — pick at least one notebook, otherwise the source will not appear in any notebook's folder view."

### AI Content and Filename Classification

The two built-in AI sets file sources for you:

- **"By content"** — clusters sources by what they are about
- **"By filename"** — groups them by their file/title names

Click the sparkle ("Re-classify") button on an AI set and confirm: "AI will rebuild every folder in "X". Existing folders and any manual refiling in this folder set will be replaced." Classification runs in the background — it shows live progress (Clustering sources → AI analyzing → Writing folders) and a done summary with the number of folders created and sources classified. Requirements: at least 3 sources in your library and a default chat model configured. Because it is a background job, it also appears in the [Task Center](task-center.md).

> **Re-classifying overwrites manual filing** in that set — the hint shown on every AI set. Keep curation work in "My folders" sets, which the AI never touches.

### Bulk Operations

On the Sources page, select multiple sources (there is a "Select all loaded sources" checkbox in the header) and:

- **"Move to folder" / "Copy to folder"** — file the whole selection at once
- **"Remove from folder"** — unfile them within the current set
- **"Rename"** — batch rename by prefix, suffix or find-and-replace, with a live preview of how many titles will change
- **"Delete"** — removes the selected sources with their files, insights and folder assignments (double-confirmed)

---

## Folder-Level Chat Context

Folders do more than organize — they scope what the AI sees:

```
1. In a notebook, select a folder in the "Folders" column
2. Open the chat context picker ("Context:" row)
3. Sources inside the folder are included by default;
   sources outside it are excluded
4. Adjust per source as usual
5. Switch to another folder — your choices for each folder
   are remembered; switch back and they are restored
```

Your per-source toggles are saved per notebook **and** folder, so a folder works like a saved context preset: "only my Interviews" or "everything except the archive folder". Selecting "All" in the "Organize" selector returns to the notebook-wide default behavior described in [Chat Effectively](chat-effectively.md).

Deleting a folder also clears the preferences saved for it — recreating a folder with the same name starts fresh.

---

## File-Type Views

The "By file type" tab is a read-only alternative to folders: fixed buckets that group sources by format — "Link", "Text", one bucket per detected file type (PDF, DOCX, …) and "Other" for the rest. There is nothing to create or maintain; click a bucket to filter the list. Use it for a quick "show me all PDFs", and folder sets for everything curated.

---

## Common Issues

| Issue | What Happens | How to Fix |
|---------|--------------|------------|
| Deleted a folder and its sources vanished | "Also delete all sources in this folder" was checked | This cannot be undone — restore from a backup ([Data Migration](data-migration.md)); leave the box unchecked next time |
| Re-classify wiped my manual arrangement | Expected — AI sets are rebuilt on every classification | Do manual curation in a "My folders" set |
| "Cannot move into itself or its subfolders" | Dragging a folder into its own descendant | Move to an unrelated folder (or the root) first |
| Cannot create a deeper subfolder | Folder trees max out at 5 levels | Flatten the branch or start a new top-level folder |
| "Re-classify" does nothing | Fewer than 3 sources, or no default chat model configured | Add sources / set a default chat model in model settings |
| Classification stuck in "Queued" | The background worker is not running | Start the worker, then check the [Task Center](task-center.md) |
| New source did not land in the chosen folder | No notebook was selected alongside the folder | Add the source again with a notebook picked — the dialog warns about this |

---

## Summary Checklist

- [ ] I know folder sets are shared across notebooks and filing is per set
- [ ] I use "My folders" for hand-curated trees and AI sets for automatic grouping
- [ ] I delete folders with the checkbox **off** unless I truly want the sources gone
- [ ] I file sources by drag-and-drop, row menu, or the add-source dialog
- [ ] I use folder selection to scope chat context instead of re-picking sources
- [ ] I reach for "By file type" for quick format filtering, not for curation

Folders turn a flat pile of sources into a library you can navigate — and a context you can aim.
