# Data Migration - Export and Import Your Library

Your Open Notebook library is portable. Export everything to a single zip package, then import it on another instance — for backups, moving to a new machine, or sharing a research library with a teammate.

> **Open "Data Management"** in the sidebar's "Manage" group — it has an Export card and an Import card.

---

## When to Export or Import

| Situation | What to do |
|-----------|------------|
| Regular backup of your research | Full export, download the zip, store it safely |
| Move to a new server or laptop | Full export here → import there |
| Copy your model setup (providers and keys) to a second instance | "Model configuration only" export → import there |
| Share a library with a collaborator | Full export → they import the package |

Both export and import run as background jobs. Only one can run at a time — starting a second one while a job is queued or running is rejected.

---

## Quick Start: Export Your Library

```
1. Go to "Data Management" in the sidebar
2. In the Export card, click "Export data"
3. Confirm the dialog "Start data export?"
4. Watch the stage list while it runs (or check the Task Center)
5. When it completes, click "Download package"
6. Store the .zip somewhere safe
```

Large libraries can take a while — the summary shows the package size and per-table record counts when it finishes.

### What Is Included (notebooks, sources, notes, embeddings; optional model configs & API keys)

A **"Full export"** bundles your whole library:

- Notebooks, sources, notes and transformations
- Source views, folders and folder memberships
- Insights attached to sources
- Relations between records (source-to-notebook links, note links, group memberships)
- Embedding vectors for all sources
- Attachments — the original uploaded files
- System settings: content processing settings and custom prompts

Tick **"Include model configuration"** to also add your provider setup: credentials (including API keys), models and default model assignments.

The **"Model configuration only"** scope packages just that model setup — useful for cloning your provider configuration without the research content.

> **⚠️ API keys travel in plain text.** The dialog warns you before including model configuration: "This package will contain API keys in plain text. Anyone who obtains the zip file can read them — store and share it securely." Treat the export zip like a password file.

### Exports Run in the Background

The export job appears in the [Task Center](task-center.md) as "Export data" and progresses through five stages: Collecting metadata → Exporting tables → Copying files → Exporting embeddings → Packaging. This requires the background worker to be running (see the [installation guide](../1-INSTALLATION/index.md)).

If some uploaded files are missing on disk, the export still completes — the summary lists them under a yellow "skipped" section so you know what did not make it into the package.

**"Delete package"** removes the generated zip from the server (your library data is not affected); "Export data" starts a fresh export at any time.

---

## Importing an Export Package

### Selecting the Package

```
1. Go to "Data Management" on the target instance
2. In the Import card, click "Choose file" — or drag the .zip onto the dropzone
3. Click "Import package"
4. Wait for the package scan (usually a few seconds)
5. Review conflicts if asked, then click "Start Import"
6. Follow the progress stages until the summary appears
```

Packages are limited to 1 GB per upload. The scan reads the package before anything is written, so a corrupt or non-Open-Notebook zip is rejected up front.

### Confirming Conflicts

Regular data (notebooks, sources, notes, embeddings) is **never overwritten** — records that already exist here with the same id are skipped. Only **model configuration** can conflict, because credentials and models are the records you might legitimately want to replace.

If the package's credentials or models differ from the ones already on this instance, a "Review conflicts before importing" dialog lists each one side by side — "Current" versus "In package", with the differing fields highlighted — and asks you to choose per item:

- **"Skip"** (the default) — keep the local version, ignore the package's
- **"Overwrite"** — replace the local version with the package's

Use "Skip all" / "Overwrite all" for bulk choices, then click **"Start Import"**. Note that the package's **default model assignments are applied after import** regardless of individual skip decisions — the dialog tells you so.

The import then runs as a background job ("Import data" in the [Task Center](task-center.md)) through seven stages: Validating package → Precheck → Writing metadata → Importing model configuration → Saving files → Writing embeddings → Linking relations.

> **Encryption key required for packages with keys**: if the package contains API keys, the target instance must have `OPEN_NOTEBOOK_ENCRYPTION_KEY` set — the import is rejected otherwise. Credentials are always stored encrypted at rest.

---

## Reading Import Warnings

When the import finishes, the summary shows three counters: **Imported**, **Skipped (already present)** and **Warnings**. Warnings never abort the import — they tell you what was adapted or left out.

### Warnings Follow the Interface Language (incl. Chinese)

Warning texts are localized: they display in your interface language, including a complete Simplified Chinese translation. Internally the import emits structured warning codes, and the UI renders them from its translation catalog. Packages produced by older versions carry plain English warning text instead; recognized ones are still translated, and anything unrecognized is shown as-is.

### Common Warnings (embedding model/dimension mismatch, dropped fields, checksum mismatch, missing default-model target, skipped relations)

| Warning | What it means | What to do |
|---------|--------------|------------|
| Embedding model mismatch — package vectors came from model X, current default is model Y | Old and new vectors live in different "similarity spaces" | Rebuild embeddings after import, or set the default embedding model to match the package |
| No default embedding model configured here | Imported vectors may not match newly generated ones | Set a default embedding model in model settings |
| Embedding dimension mismatch (package N vs environment M) | The two environments use incompatible embedding models | Same as above — align the embedding model before relying on search |
| Dropped unsupported field | A field outside the known schema was ignored | Usually harmless; the record imported without it |
| Unparseable date, used the database default | A timestamp in the package could not be read | Cosmetic — dates fall back to defaults |
| Transformation model(s) missing in this environment | A transformation references a model you have not configured here | Add the model in [API Configuration](api-configuration.md) or reassign the transformation |
| Transformation already exists with a different prompt; the local version was kept | Import never overwrites your local transformations | Delete the local one first if you truly want the package's version |
| File declared in the manifest but missing from the package | The source imported, but without its attachment | The source keeps its original file link |
| File failed the checksum check and was skipped | The attachment was corrupted in transit; it was not imported | Re-export or copy the file manually |
| Skipped a link: one endpoint was not imported in this run | A relation pointing at a record that was skipped (already present) or failed | Harmless — the existing record already has its links |
| Default model from the package was not imported; the assignment was cleared | A default assignment pointed at a model you chose to skip | Reassign the default model in model settings |

---

## What Gets Imported and What Does Not

**Imported:**

- Every notebook, source, note, insight, transformation, folder and embedding whose id does not already exist here
- Attachments, verified against checksums
- Model configuration according to your Skip/Overwrite decisions
- Default model assignments from the package

**Not imported:**

- Anything whose id already exists here (skipped — never overwritten) — import **adds** a library, it does not merge two libraries into one
- Files that fail their checksum or were missing from the package
- Relations whose endpoints were not imported
- The chat history and token usage of the source instance (not part of a package)

To "update" records from a package, delete your local copies first — then the import will bring in the package's versions.

---

## Common Issues

**"A data export/import job is already queued or running. Wait for it to finish first."**
- Only one transfer job can run at a time. Watch it in the [Task Center](task-center.md) and start yours when it finishes.

**"The package exceeds the 1 GB upload limit."**
- Very large libraries can produce huge zips (attachments and embeddings add up). The 1 GB cap is the default upload limit (`OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB`); raise it on the target instance, or use the "Model configuration only" scope to move your provider setup separately from the heavy content.

**Import rejected: plain-text API keys but no `OPEN_NOTEBOOK_ENCRYPTION_KEY`**
- Set `OPEN_NOTEBOOK_ENCRYPTION_KEY` on the target instance and restart, then import again. This is the same key that encrypts credentials at rest.

**"No scanned import package found; upload the package again"**
- The scan and the import start are bound together: if you uploaded a different package in between (or the scan expired), just upload the zip and scan it again.

**Import finished but search results look wrong**
- See the embedding mismatch warnings above — the package was embedded with a different model. Rebuild embeddings on the target instance.

**Nothing progresses after "Start Import"**
- Imports run in the background worker. If the job sits queued in the Task Center, the worker is not running.

---

## Summary Checklist

Before you rely on an export:

- [ ] Export completed and I downloaded the zip (exports are not kept forever — "Delete package" or a newer export replaces it)
- [ ] I stored the zip securely — it may contain API keys in plain text
- [ ] The target instance has `OPEN_NOTEBOOK_ENCRYPTION_KEY` set (packages with keys)
- [ ] I understand import skips existing ids rather than overwriting
- [ ] I read the warnings — especially embedding model/dimension mismatches
- [ ] I checked the Task Center if the job seemed stuck

One zip, one import — your whole research library travels with you.
