import { describe, it, expect } from 'vitest'
import { createInstance } from 'i18next'
import { resources, enUS, zhCN } from './index'

// Pinned inventory of the i18n keys added by the 2026-09 changesets
// (source context menu / grouping folders, usage tracking, data management,
// embedding progress, processing steps). Extracted from the working-tree diff
// at authoring time so it stays meaningful after commit: it guards that these
// keys exist in both zh-CN and en-US, and that every other locale resolves
// them without crashing — via its own translation or the en-US fallback.
const NEW_KEYS = [
  'app.dataManagement.description',
  'app.dataManagement.title',
  'chat.enterToSend',
  'chat.enterToSendHint',
  'dataManagement.errors.concurrent',
  'dataManagement.errors.failed',
  'dataManagement.errors.uploadTooLarge',
  'dataManagement.export.confirmDescription',
  'dataManagement.export.confirmTitle',
  'dataManagement.export.deleteConfirmDesc',
  'dataManagement.export.deleteConfirmTitle',
  'dataManagement.export.deletePackage',
  'dataManagement.export.deletedToast',
  'dataManagement.export.description',
  'dataManagement.export.download',
  'dataManagement.export.downloading',
  'dataManagement.export.idle',
  'dataManagement.export.stages.collecting',
  'dataManagement.export.stages.copying_files',
  'dataManagement.export.stages.exporting_embeddings',
  'dataManagement.export.stages.exporting_tables',
  'dataManagement.export.stages.packaging',
  'dataManagement.export.start',
  'dataManagement.export.startedToast',
  'dataManagement.export.summary.counts',
  'dataManagement.export.summary.filesSkipped',
  'dataManagement.export.summary.packageSize',
  'dataManagement.export.summary.tableCount',
  'dataManagement.export.title',
  'dataManagement.import.chooseFile',
  'dataManagement.import.chooseFileButton',
  'dataManagement.import.confirmDescription',
  'dataManagement.import.confirmTitle',
  'dataManagement.import.description',
  'dataManagement.import.dropzoneHint',
  'dataManagement.import.importAnother',
  'dataManagement.import.limitHint',
  'dataManagement.import.rowFormat',
  'dataManagement.import.stages.embeddings',
  'dataManagement.import.stages.files',
  'dataManagement.import.stages.metadata',
  'dataManagement.import.stages.precheck',
  'dataManagement.import.stages.relations',
  'dataManagement.import.stages.validating',
  'dataManagement.import.startedToast',
  'dataManagement.import.summary.imported',
  'dataManagement.import.summary.skipped',
  'dataManagement.import.summary.warnings',
  'dataManagement.import.title',
  'dataManagement.import.upload',
  'dataManagement.import.uploading',
  'storage.title',
  'storage.description',
  'storage.refresh',
  'storage.loadFailed',
  'storage.recordCount',
  'storage.stats.database',
  'storage.stats.databaseHint',
  'storage.stats.disk',
  'storage.stats.diskHint',
  'storage.stats.export',
  'storage.stats.exportHintEstimate',
  'storage.stats.exportHintLast',
  'storage.stats.records',
  'storage.stats.recordsHint',
  'storage.breakdown.title',
  'storage.breakdown.description',
  'storage.breakdown.estimateNote',
  'storage.disk.title',
  'storage.disk.description',
  'storage.disk.diskEmpty',
  'storage.disk.diskShareAria',
  'storage.disk.diskTotal',
  'storage.disk.diskRootPath',
  'storage.sections.uploads',
  'storage.sections.podcasts',
  'storage.sections.exports',
  'storage.sections.tiktoken_cache',
  'storage.sections.sqlite',
  'storage.sections.other',
  'storage.categories.sources',
  'storage.categories.insights',
  'storage.categories.notes',
  'storage.categories.embeddings',
  'dataManagement.warnings.droppedField',
  'dataManagement.warnings.unparseableDatetime',
  'dataManagement.warnings.embeddingModelMismatch',
  'dataManagement.warnings.noDefaultEmbeddingModel',
  'dataManagement.warnings.embeddingDimensionMismatch',
  'dataManagement.warnings.transformationModelMissing',
  'dataManagement.warnings.transformationPromptConflict',
  'dataManagement.warnings.manifestFileMissing',
  'dataManagement.warnings.fileChecksumMismatch',
  'dataManagement.warnings.edgeEndpointNotImported',
  'dataManagement.warnings.edgeEndpointUnknown',
  'navigation.backToSources',
  'navigation.storage',
  'tasks.title',
  'tasks.description',
  'tasks.refresh',
  'tasks.loadFailed',
  'tasks.empty',
  'tasks.filter.all',
  'tasks.filter.active',
  'tasks.filter.completed',
  'tasks.filter.failed',
  'tasks.status.new',
  'tasks.status.queued',
  'tasks.status.running',
  'tasks.status.completed',
  'tasks.status.failed',
  'tasks.status.canceled',
  'tasks.statusRunning',
  'tasks.command.create_insight',
  'tasks.command.run_transformation',
  'tasks.command.embed_source',
  'tasks.command.embed_note',
  'tasks.command.embed_insight',
  'tasks.command.rebuild_embeddings',
  'tasks.command.process_source',
  'tasks.command.import_data',
  'tasks.command.export_data',
  'tasks.command.generate_podcast',
  'tasks.command.generate_artifact',
  'tasks.progressChunks',
  // /tasks pagination footer (2026-09-28 changeset)
  'tasks.shownOfTotal',
  'tasks.loadMore',
  // /tasks task cancellation (2026-09-28 changeset)
  'tasks.cancel',
  'tasks.cancelSuccess',
  'tasks.cancelFailed',
  // /tasks failure-explanation AI card + task retry (2026-09-28 changeset)
  'tasks.explain.whyFailed',
  'tasks.explain.classRetryable',
  'tasks.explain.classNeedsConfig',
  'tasks.explain.classKnownIssue',
  'tasks.explain.classLikelyBug',
  'tasks.explain.classUnknown',
  'tasks.explain.sectionWhat',
  'tasks.explain.sectionCause',
  'tasks.explain.sectionFix',
  'tasks.explain.sectionNext',
  'tasks.explain.factsTitle',
  'tasks.explain.actionRetry',
  'tasks.explain.actionOpenModelsSettings',
  'tasks.explain.actionOpenCredentials',
  'tasks.explain.actionCopyDiagnostics',
  'tasks.explain.actionReportIssue',
  'tasks.explain.factCommand',
  'tasks.explain.factType',
  'tasks.explain.factStatus',
  'tasks.explain.factError',
  'tasks.explain.degradedNotice',
  'tasks.explain.refresh',
  'tasks.explain.copyDone',
  'tasks.explain.loadFailed',
  // /tasks explain card AI styling + recovery-aware retry (2026-09-28 changeset)
  'tasks.explain.aiLabel',
  'tasks.explain.thinking',
  'tasks.explain.aiRetry',
  'tasks.explain.manualRetry',
  'tasks.explain.recoveredNotice',
  'tasks.explain.retrySkippedRecovered',
  'tasks.retrySuccess',
  'tasks.retryFailed',
  'models.qaModelLabel',
  'models.qaModelDesc',
  'usage.typeQaExplain',
  'storage.title',
  'storage.description',
  'storage.refresh',
  'storage.loadFailed',
  'storage.recordCount',
  'storage.stats.database',
  'storage.stats.databaseHint',
  'storage.stats.disk',
  'storage.stats.diskHint',
  'storage.stats.export',
  'storage.stats.exportHintEstimate',
  'storage.stats.exportHintLast',
  'storage.stats.records',
  'storage.stats.recordsHint',
  'storage.breakdown.title',
  'storage.breakdown.description',
  'storage.breakdown.estimateNote',
  'storage.disk.title',
  'storage.disk.description',
  'storage.disk.diskEmpty',
  'storage.disk.diskShareAria',
  'storage.disk.diskTotal',
  'storage.disk.diskRootPath',
  'storage.sections.uploads',
  'storage.sections.podcasts',
  'storage.sections.exports',
  'storage.sections.tiktoken_cache',
  'storage.sections.sqlite',
  'storage.sections.other',
  'storage.categories.sources',
  'storage.categories.insights',
  'storage.categories.notes',
  'storage.categories.embeddings',
  'navigation.dataManagement',
  'navigation.usage',
  'settings.appearance',
  'settings.appearanceDesc',
  'settings.chunkOverlap',
  'settings.chunkOverlapHelp',
  'settings.chunkParamsChangedToast',
  'settings.chunkSize',
  'settings.chunkSizeHelp',
  'settings.embeddingBatchSize',
  'settings.embeddingBatchSizeHelp',
  'settings.minChunkSize',
  'settings.minChunkSizeHelp',
  'settings.skin',
  'settings.skinClassic',
  'settings.skinClassicDesc',
  'settings.skinQuietGreen',
  'settings.skinQuietGreenDesc',
  'sources.chooseFileButton',
  'sources.dropzoneHint',
  'sources.embedMissing.badge.completed',
  'sources.embedMissing.badge.failed',
  'sources.embedMissing.badge.notEmbedded',
  'sources.embedMissing.badge.queued',
  'sources.embedMissing.badge.running',
  'sources.embedMissing.button',
  'sources.embedMissing.confirmCta',
  'sources.embedMissing.confirmDescription',
  'sources.embedMissing.confirmTitle',
  'sources.embedMissing.errorHint',
  'sources.embedMissing.progressTitle',
  'sources.embedMissing.startedToast',
  'sources.embeddingCompletedChunks',
  'sources.embeddingFailedTitle',
  'sources.embeddingInProgress',
  'sources.embeddingIncomplete',
  'sources.embeddingIncompleteHint',
  'sources.embeddingPartialTitle',
  'sources.embeddingProgressChunks',
  'sources.embeddingRetry',
  'sources.embeddingStatusCompleted',
  'sources.embeddingStatusQueued',
  'sources.embeddingStatusRunning',
  'sources.embeddingWaitingWorker',
  'sources.grouping.addView',
  'sources.grouping.addViewTitle',
  'sources.grouping.aiContentViewName',
  'sources.grouping.aiOverwriteHint',
  'sources.grouping.aiTitleViewName',
  'sources.grouping.all',
  'sources.grouping.allViews',
  'sources.grouping.applyRename',
  'sources.grouping.batchDelete',
  'sources.grouping.batchDeleteConfirmDesc',
  'sources.grouping.batchDeleteConfirmTitle',
  'sources.grouping.batchDeleteSuccess',
  'sources.grouping.batchRename',
  'sources.grouping.batchRenameDesc',
  'sources.grouping.batchRenameTitle',
  'sources.grouping.breadcrumbAria',
  'sources.grouping.bulkPartial',
  'sources.grouping.cascadeConfirmDesc',
  'sources.grouping.cascadeConfirmTitle',
  'sources.grouping.classify.button',
  'sources.grouping.classify.confirmCta',
  'sources.grouping.classify.confirmDescription',
  'sources.grouping.classify.confirmTitle',
  'sources.grouping.classify.doneSummary',
  'sources.grouping.classify.failed',
  'sources.grouping.classify.progressRunning',
  'sources.grouping.classify.stageAssigning',
  'sources.grouping.classify.stageClustering',
  'sources.grouping.classify.stageLlm',
  'sources.grouping.classify.startedToast',
  'sources.grouping.copyCreatedToast',
  'sources.grouping.copyHere',
  'sources.grouping.copySuccess',
  'sources.grouping.copyTo',
  'sources.grouping.copyToGroup',
  'sources.grouping.copyToGroupTitle',
  'sources.grouping.deleteGroupDesc',
  'sources.grouping.deleteGroupTitle',
  'sources.grouping.deleteGroupWithSources',
  'sources.grouping.deleteGroupWithSourcesWarn',
  'sources.grouping.deleteViewDesc',
  'sources.grouping.deleteViewTitle',
  'sources.grouping.dragInvalidTarget',
  'sources.grouping.emptyGroup',
  'sources.grouping.fileTypeTab',
  'sources.grouping.findLabel',
  'sources.grouping.folderAssignFailed',
  'sources.grouping.groupCreatedToast',
  'sources.grouping.groupNamePlaceholder',
  'sources.grouping.groupOptions',
  'sources.grouping.groupSelectLabel',
  'sources.grouping.inlineCreateLabel',
  'sources.grouping.moveGroupTitle',
  'sources.grouping.moveHere',
  'sources.grouping.moveSuccess',
  'sources.grouping.moveSuccessWithTarget',
  'sources.grouping.moveTargetViewHint',
  'sources.grouping.moveTo',
  'sources.grouping.moveToFolder',
  'sources.grouping.moveToGroup',
  'sources.grouping.moveToGroupTitle',
  'sources.grouping.newFolder',
  'sources.grouping.newGroup',
  'sources.grouping.newGroupTitle',
  'sources.grouping.newSubgroup',
  'sources.grouping.noChanges',
  'sources.grouping.noFolderOption',
  'sources.grouping.noGroups',
  'sources.grouping.noGroupsCreateHint',
  'sources.grouping.openSource',
  'sources.grouping.operationFailed',
  'sources.grouping.prefixLabel',
  'sources.grouping.previewLabel',
  'sources.grouping.previewUnchanged',
  'sources.grouping.renameGroupTitle',
  'sources.grouping.renameSlowHint',
  'sources.grouping.renameSource',
  'sources.grouping.renameSourceTitle',
  'sources.grouping.renameSuccess',
  'sources.grouping.renameViewTitle',
  'sources.grouping.replaceLabel',
  'sources.grouping.rootOption',
  'sources.grouping.rowActions',
  'sources.grouping.saveToFolder',
  'sources.grouping.selectAllLoaded',
  'sources.grouping.selectRow',
  'sources.grouping.selectedCount',
  'sources.grouping.selectedPageHint',
  'sources.grouping.suffixLabel',
  'sources.grouping.ungroupAction',
  'sources.grouping.ungroupSuccess',
  'sources.grouping.ungrouped',
  'sources.grouping.viewNameDesc',
  'sources.grouping.viewNamePlaceholder',
  'sources.grouping.viewOptions',
  'sources.grouping.viewSelectLabel',
  'sources.insightGenerationFailed',
  'sources.insightInProgress',
  'sources.processingStatusDone',
  'sources.processingStatusFailed',
  'sources.processingStatusInProgress',
  'sources.processingStatusPending',
  'sources.processingStatusSkipped',
  'sources.processingStatusUnknown',
  'sources.processingStepCompletion',
  'sources.processingStepEmbedding',
  'sources.processingStepExtraction',
  'sources.processingStepTransformation',
  'sources.processingTitle',
  'sources.transformationTitleDenseSummary',
  'sources.transformationTitleKeyInsights',
  'sources.transformationTitlePaperAnalysis',
  'sources.transformationTitleReflectionQuestions',
  'sources.transformationTitleSimpleSummary',
  'sources.transformationTitleTableOfContents',
  'sources.type.other',
  'chat.contextChars',
  'chat.contextEmpty',
  'chat.contextEmptyReadOnly',
  'chat.contextFullTooltip',
  'chat.contextInsightsTooltip',
  'chat.contextLabel',
  'chat.contextNotesSection',
  'chat.contextNotesTooltip',
  'chat.contextNoItems',
  'chat.contextPickerCounts',
  'chat.contextPickerDesc',
  'chat.contextPickerOpen',
  'chat.contextPickerTitle',
  'chat.contextSearchPlaceholder',
  'chat.contextTokens',
  'models.priceDesc',
  'models.priceFetch',
  'models.priceFetchNotFound',
  'models.priceFetchSuccess',
  'models.priceInput',
  'models.priceOutput',
  'models.priceSaveSuccess',
  'models.priceSource',
  'models.priceSourceManual',
  'models.priceTitle',
  'usage.byModel',
  'usage.callType',
  'usage.calls',
  'usage.clear',
  'usage.clearConfirmDesc',
  'usage.clearConfirmTitle',
  'usage.clearFailed',
  'usage.clearedDesc',
  'usage.costEstimate',
  'usage.created',
  'usage.dailyTotal',
  'usage.estimatedHintCost',
  'usage.description',
  'usage.empty',
  'usage.emptyDesc',
  'usage.emptyTitle',
  'usage.errorDesc',
  'usage.errorTitle',
  'usage.estimatedHint',
  'usage.estimatedNote',
  'usage.exportButton',
  'usage.exportCsv',
  'usage.exportJson',
  'usage.failure',
  'usage.filterByType',
  'usage.filteredEmptyDesc',
  'usage.filteredEmptyTitle',
  'usage.heatmapCellHint',
  'usage.heatmapDesc',
  'usage.heatmapNoData',
  'usage.heatmapTitle',
  'usage.inputTokens',
  'usage.lastNDays',
  'usage.less',
  'usage.loadMore',
  'usage.model',
  'usage.modelShare',
  'usage.modelShareAria',
  'usage.more',
  'usage.noPrevPeriod',
  'usage.noPriceHint',
  'usage.other',
  'usage.outputTokens',
  'usage.privacyDesc',
  'usage.privacyTitle',
  'usage.provider',
  'usage.records',
  'usage.recordsDesc',
  'usage.recordsShown',
  'usage.resetFilters',
  'usage.retry',
  'usage.status',
  'usage.success',
  'usage.timeRange',
  'usage.title',
  'usage.today',
  'usage.totalCalls',
  'usage.totalTokens',
  'usage.trackingEnabled',
  'usage.trend',
  'usage.trendAria',
  'usage.unpricedNote',
  'usage.typeAll',
  'usage.typeAsk',
  'usage.typeChat',
  'usage.typeEmbedding',
  'usage.typePrompt',
  'usage.typeSourceChat',
  'usage.typeTransformation',
  'usage.vsPrevPeriod',
]

const getLeafStrings = (
  obj: Record<string, unknown>,
  prefix = '',
  acc: Record<string, string> = {},
): Record<string, string> => {
  for (const el of Object.keys(obj)) {
    const val = obj[el]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      getLeafStrings(val as Record<string, unknown>, prefix + el + '.', acc)
    } else if (typeof val === 'string') {
      acc[prefix + el] = val
    }
  }
  return acc
}

const deletePath = (obj: Record<string, unknown>, dotted: string): void => {
  const parts = dotted.split('.')
  let node: Record<string, unknown> = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const next = node[parts[i]]
    if (next === null || typeof next !== 'object') return
    node = next as Record<string, unknown>
  }
  delete node[parts[parts.length - 1]]
}

// Mirrors src/lib/i18n.ts: fallbackLng en-US, interpolation escape off.
const makeI18n = async (
  lng: string,
  res: Record<string, { translation: Record<string, unknown> }>,
) => {
  const inst = createInstance()
  await inst.init({
    resources: res,
    lng,
    fallbackLng: 'en-US',
    interpolation: { escapeValue: false },
  })
  return inst
}

const allResources = resources as unknown as Record<
  string,
  { translation: Record<string, unknown> }
>

const fallbackLocales = Object.keys(resources).filter(
  code => code !== 'en-US' && code !== 'zh-CN',
)

describe('New i18n keys (2026-09 changesets)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = NEW_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = NEW_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of NEW_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of NEW_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of NEW_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 source-annotation
// MVP (selection toolbar, annotation hover card, scan-page notice, delete
// confirm count, failure toasts). Same guarding contract as NEW_KEYS above:
// exists in both zh-CN and en-US, and every other locale resolves it without
// crashing — via its own translation or the en-US fallback.
const ANNOTATION_KEYS = [
  'sources.annotations.scanNotice',
  'sources.annotations.orphanedHint',
  'sources.annotations.colors.gold',
  'sources.annotations.colors.fern',
  'sources.annotations.colors.plum',
  'sources.annotations.colors.slate',
  'sources.annotations.colors.clay',
  'sources.annotations.toolbar.colorAria',
  'sources.annotations.toolbar.line',
  'sources.annotations.toolbar.wavy',
  'sources.annotations.toolbar.straight',
  'sources.annotations.toolbar.comment',
  'sources.annotations.toolbar.copy',
  'sources.annotations.toolbar.copied',
  'sources.annotations.hover.edit',
  'sources.annotations.hover.delete',
  'sources.annotations.hover.deleted',
  'sources.annotations.hover.undo',
  'sources.annotations.hover.colorLabel',
  'sources.annotations.hover.pageMeta',
  'sources.annotations.toast.createFailed',
  'sources.annotations.toast.updateFailed',
  'sources.annotations.toast.deleteFailed',
  'sources.annotations.toast.restoreFailed',
  'sources.annotations.toast.crossPage',
  'sources.annotations.toast.tooLong',
  'sources.annotations.deleteConfirm.count',
]

describe('New i18n keys (2026-10 source annotations)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = ANNOTATION_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = ANNOTATION_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of ANNOTATION_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of ANNOTATION_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of ANNOTATION_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 notebook chat
// token-streaming changeset (single-run SSE send path failure toasts). Same
// guarding contract as NEW_KEYS above: exists in both zh-CN and en-US, and
// every other locale resolves it without crashing — via its own translation
// or the en-US fallback.
const STREAM_KEYS = [
  'chat.streamFailed',
  'chat.streamBusy',
]

describe('New i18n keys (2026-10 chat streaming)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = STREAM_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = STREAM_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of STREAM_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of STREAM_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of STREAM_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 agents redesign
// changeset (template picker dialog + temperature help tooltip). The removed
// `agents.templateBlank` key is intentionally absent from this list. Same
// guarding contract as NEW_KEYS above: exists in both zh-CN and en-US, and
// every other locale resolves it without crashing — via its own translation
// or the en-US fallback.
const AGENT_PANEL_KEYS = [
  'agents.temperatureHelp',
  'agents.templatePickerDesc',
  'agents.templateBlankName',
  'agents.templateBlankDesc',
  'agents.templateUse',
]

describe('New i18n keys (2026-10 agents template panel)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = AGENT_PANEL_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = AGENT_PANEL_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of AGENT_PANEL_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of AGENT_PANEL_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of AGENT_PANEL_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 session manager
// upgrade (searchable chat-session panel, destructive delete confirm, key
// migration off the replaced `chat.*` session strings). Same guarding
// contract as NEW_KEYS above: exists in both zh-CN and en-US, and every
// other locale resolves it without crashing — via its own translation or
// the en-US fallback.
const SESSIONS_KEYS = [
  'sessions.managerTitle',
  'sessions.searchPlaceholder',
  'sessions.newSessionPlaceholder',
  'sessions.empty',
  'sessions.emptyHint',
  'sessions.noResults',
  'sessions.untitled',
  'sessions.rename',
  'sessions.deleteSession',
  'sessions.deleteSessionDesc',
  'sessions.sessionDeleted',
  'sessions.messagesCount',
  // History-editing feedback (message delete/clear toasts + confirm copy)
  'sessions.deleteMessage',
  'sessions.deleteMessageDesc',
  'sessions.messageDeleted',
  'sessions.messagesCleared',
  'sessions.messageDeleteFailed',
  'sessions.clearFailed',
]

describe('New i18n keys (2026-10 session manager)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = SESSIONS_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = SESSIONS_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of SESSIONS_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of SESSIONS_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of SESSIONS_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 context-breakdown
// changeset (composition bar + detail dialog in the notebook chat). Same
// guarding contract as the blocks above: exists in both zh-CN and en-US, and
// every other locale resolves it without crashing — via its own translation
// or the en-US fallback.
const CONTEXT_KEYS = [
  'context.breakdownAria',
  'context.breakdownTitle',
  'context.segmentSystem',
  'context.segmentHistory',
  'context.segmentSources',
  'context.segmentNotes',
  'context.segmentSystemHint',
  'context.totalLine',
  'context.estimateHint',
  'context.emptyBreakdown',
  'context.sourcesEmpty',
  'context.notesEmpty',
  'context.removeItem',
  'context.manageSources',
  'context.clearHistory',
  'context.clearHistoryDesc',
  'context.historyEmpty',
  'context.roleUser',
  'context.roleAssistant',
  'context.deleteMessage',
  'context.deleteMessageDesc',
  'context.itemChars',
  'context.itemPercent',
]

describe('New i18n keys (2026-10 context breakdown)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = CONTEXT_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = CONTEXT_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of CONTEXT_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 context time-view /
// batch-delete changeset (history view switch, calendar grouping, group
// selection, delete-selected confirm in the breakdown dialog). Same guarding
// contract as the blocks above.
const CONTEXT_TIME_KEYS = [
  'context.historyViewFlat',
  'context.historyViewTime',
  'context.timeToday',
  'context.timeYesterday',
  'context.timeThisWeek',
  'context.timeEarlier',
  'context.timeUnknown',
  'context.checkMessage',
  'context.selectGroup',
  'context.selectedCount',
  'context.deleteSelected',
  'context.deleteSelectedDesc',
]

describe('New i18n keys (2026-10 context time view / batch delete)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = CONTEXT_TIME_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = CONTEXT_TIME_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_TIME_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of CONTEXT_TIME_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_TIME_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 context
// compress/topic-view changeset (AI topic grouping, async compression flow,
// summary badge, batch-select action bar in the breakdown dialog). Same
// guarding contract as the blocks above.
const CONTEXT_TOPIC_KEYS = [
  'context.historyViewTopic',
  'context.ungrouped',
  'context.classifyTopics',
  'context.classifyFailed',
  'context.classifyTruncated',
  'context.topicClassifyHint',
  'context.compressSelected',
  'context.compressTitle',
  'context.compressDesc',
  'context.compressSubmitted',
  'context.compressFailed',
  'context.compressSuccess',
  'context.summaryBadge',
]

describe('New i18n keys (2026-10 context topic view / compress)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = CONTEXT_TOPIC_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = CONTEXT_TOPIC_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_TOPIC_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of CONTEXT_TOPIC_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of CONTEXT_TOPIC_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10-07 project-env
// materials-selection changeset (candidate step, material/route picker tabs,
// generation progress, list badges). The replaced `projectEnvs.generateAndVerify`
// key is intentionally absent. Same guarding contract as the blocks above.
const MATERIAL_KEYS = [
  'projectEnvs.stepMaterials',
  'projectEnvs.generateMaterials',
  'projectEnvs.skipMaterials',
  'projectEnvs.materialStepTitle',
  'projectEnvs.materialStepDesc',
  'projectEnvs.tabMaterials',
  'projectEnvs.tabRoutes',
  'projectEnvs.tabMaterialsHint',
  'projectEnvs.tabRoutesHint',
  'projectEnvs.stageMaterialing',
  'projectEnvs.stageRouting',
  'projectEnvs.materialSelectedCount',
  'projectEnvs.materialSelectAll',
  'projectEnvs.materialDeselectAll',
  'projectEnvs.materialGroupEmpty',
  'projectEnvs.materialSubmit',
  'projectEnvs.materialMinHint',
  'projectEnvs.routeSubmit',
  'projectEnvs.routeMinHint',
  'projectEnvs.routeDiffTech',
  'projectEnvs.routeDiffScale',
  'projectEnvs.routeDiffRole',
  'projectEnvs.routePreview',
  'projectEnvs.materialGenerateFailed',
  'projectEnvs.materialEmptyAll',
  'projectEnvs.materialRetry',
  'projectEnvs.materialStaleHint',
  'projectEnvs.materialSubmitFailed',
  'projectEnvs.materialBackToList',
  'projectEnvs.statusMaterialPending',
  'projectEnvs.statusMaterialReady',
  'projectEnvs.materialRegenerateBatch',
  'projectEnvs.materialRegenerateTitle',
  'projectEnvs.materialRegenerateDesc',
  'projectEnvs.skipReadyTitle',
  'projectEnvs.skipReadyDesc',
  'projectEnvs.crossTabRoutesTitle',
  'projectEnvs.crossTabRoutesDesc',
  'projectEnvs.crossTabMaterialsTitle',
  'projectEnvs.crossTabMaterialsDesc',
  'projectEnvs.phaseVerifyMock',
]

describe('New i18n keys (2026-10 project-env materials selection)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = MATERIAL_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = MATERIAL_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of MATERIAL_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of MATERIAL_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of MATERIAL_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10-07 paragraph-level
// verification changeset (AI rewrite suggestion panel on the verification
// points). Same guarding contract as the blocks above.
const SUGGEST_KEYS = [
  'projectEnvs.suggestAction',
  'projectEnvs.suggestTitle',
  'projectEnvs.suggestOriginal',
  'projectEnvs.suggestSuggestion',
  'projectEnvs.suggestExplanation',
  'projectEnvs.suggestAdopt',
  'projectEnvs.suggestDiscard',
  'projectEnvs.suggestFailed',
]

// Pinned inventory of the 2026-10-07 generic-paragraph changeset (view/edit
// section in the env detail dialog + AI generation). Same contract.
const GENERIC_PARAGRAPH_KEYS = [
  'projectEnvs.genericParagraph',
  'projectEnvs.genericParagraphHint',
  'projectEnvs.genericParagraphEdit',
  'projectEnvs.genericParagraphSave',
  'projectEnvs.genericParagraphCancel',
  'projectEnvs.genericParagraphGenerate',
  'projectEnvs.genericParagraphGenerateFailed',
  'projectEnvs.genericParagraphSaved',
  'projectEnvs.genericParagraphSaveFailed',
  'projectEnvs.genericParagraphCount',
]

// Pinned inventory of the 2026-10-07 data-transfer v3 changeset: the two
// project-env tables now travel in export/import packages. Same contract.
const TRANSFER_V3_KEYS = [
  'dataManagement.tables.project_env',
  'dataManagement.tables.project_env_verification',
]

// Pinned inventory of the 2026-10 project-env card/detail redesign changeset. Same guarding contract as the blocks above.
const VERIFICATION_DETAILS_KEYS = ['projectEnvs.verificationDetails']

// Pinned inventory of the 2026-10 project-env detail visual redesign changeset
// (timeline / metric tiles / tech cards / tuning flow / problem pairs). Same contract.
const DETAIL_VISUAL_KEYS = [
  'projectEnvs.detailMetrics',
  'projectEnvs.detailMetricTrendAria',
  'projectEnvs.detailTechStack',
  'projectEnvs.detailOutcome',
  'projectEnvs.detailProblem',
  'projectEnvs.detailSolution',
  'projectEnvs.detailOriginalText',
]

// Pinned inventory of the i18n keys added by the 2026-10-07 project-env
// industry changeset (mock wizard company-industry input). Same contract.
const INDUSTRY_KEYS = [
  'projectEnvs.mockIndustryLabel',
  'projectEnvs.mockIndustryHelper',
]

// Pinned inventory of the 2026-10 project-env ruankao UX pass: the exam-essay
// note under the page title and the nav entry, the whole-card detail aria
// label, and the static tech-stack glossary (40 entries) shown on hover.
// Same guarding contract as the blocks above.
const RUANKAO_UX_KEYS = [
  'projectEnvs.ruankaoNote',
  // `navigation.projectEnvironmentsHint` was removed with the sidebar entry
  // (superseded by `navigation.ruankaoHint`, pinned in RUANKAO_SHELL_KEYS).
  'projectEnvs.openDetailAria',
  'projectEnvs.glossary.redis',
  'projectEnvs.glossary.memcached',
  'projectEnvs.glossary.postgresql',
  'projectEnvs.glossary.mysql',
  'projectEnvs.glossary.mongodb',
  'projectEnvs.glossary.clickhouse',
  'projectEnvs.glossary.elasticsearch',
  'projectEnvs.glossary.milvus',
  'projectEnvs.glossary.kafka',
  'projectEnvs.glossary.rabbitmq',
  'projectEnvs.glossary.rocketmq',
  'projectEnvs.glossary.spring-boot',
  'projectEnvs.glossary.spring-cloud',
  'projectEnvs.glossary.fastapi',
  'projectEnvs.glossary.django',
  'projectEnvs.glossary.flask',
  'projectEnvs.glossary.vue',
  'projectEnvs.glossary.react',
  'projectEnvs.glossary.qwen',
  'projectEnvs.glossary.llama',
  'projectEnvs.glossary.deepseek',
  'projectEnvs.glossary.glm',
  'projectEnvs.glossary.bert',
  'projectEnvs.glossary.bge',
  'projectEnvs.glossary.vllm',
  'projectEnvs.glossary.or-tools',
  'projectEnvs.glossary.gurobi',
  'projectEnvs.glossary.cplex',
  'projectEnvs.glossary.osrm',
  'projectEnvs.glossary.postgis',
  'projectEnvs.glossary.arcgis',
  'projectEnvs.glossary.kubernetes',
  'projectEnvs.glossary.k8s',
  'projectEnvs.glossary.docker',
  'projectEnvs.glossary.nginx',
  'projectEnvs.glossary.java',
  'projectEnvs.glossary.python',
  'projectEnvs.glossary.go',
  'projectEnvs.glossary.node',
  'projectEnvs.glossary.jmeter',
]

// Pinned inventory of the i18n keys added by the 2026-10 Gemini sources column
// pass (folder expand/collapse-all header buttons, source context-menu copy
// actions for file name / in-app relative path / absolute path, clipboard
// success toast). Same guarding contract as the blocks above.
const GEMINI_COLUMN_KEYS = [
  'geminiSources.expandAll',
  'geminiSources.collapseAll',
  'sources.copyFileName',
  'sources.copyRelativePath',
  'sources.copyAbsolutePath',
  'sources.copiedToClipboard',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao module shell
// changeset (sidebar module group + module page tabs + hot-topics placeholder +
// industry pool section + industry combobox empty hint). The removed
// `navigation.projectEnvironments`/`projectEnvironmentsHint` keys are
// intentionally absent from this list. Same guarding contract as the blocks
// above.
const RUANKAO_SHELL_KEYS = [
  'navigation.ruankao',
  'navigation.ruankaoHint',
  'ruankao.title',
  'ruankao.description',
  'ruankao.tabs.environments',
  'ruankao.tabs.questionBank',
  'ruankao.tabs.modelLibrary',
  'ruankao.tabs.essay',
  'ruankao.tabs.hotTopics',
  'ruankao.hotTopics.plannedTitle',
  'ruankao.hotTopics.plannedDesc',
  'ruankao.industry.sectionTitle',
  'ruankao.industry.sectionDesc',
  'ruankao.industry.searchPlaceholder',
  'ruankao.industry.emptyHint',
  'ruankao.industry.noMatch',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao essay marks
// library pass (modelLibrary panel stats/view/folder-tree/source-list/
// dangling-cleanup + the edit guard on public model essays). Also clears the
// hook debt: toggleFailed / danglingCleaned / danglingCleanupFailed were
// already consumed by use-essay-marks.ts before this changeset. Same guarding
// contract as the blocks above; the three interpolated keys must keep their
// {{count}} placeholder in every locale (Placeholder Parity).
const ESSAY_MARK_KEYS = [
  'ruankao.essayMark.toggleFailed',
  'ruankao.essayMark.danglingCleaned',
  'ruankao.essayMark.danglingCleanupFailed',
  'ruankao.essayMark.viewLabel',
  'ruankao.essayMark.statsSources',
  'ruankao.essayMark.statsGroups',
  'ruankao.essayMark.statsEffective',
  'ruankao.essayMark.groupsTitle',
  'ruankao.essayMark.groupEffectiveCount',
  'ruankao.essayMark.sourcesTitle',
  'ruankao.essayMark.sourcesSearchPlaceholder',
  'ruankao.essayMark.sourcesEmpty',
  'ruankao.essayMark.viaGroupBadge',
  'ruankao.essayMark.markSourceAction',
  'ruankao.essayMark.unmarkSourceAction',
  'ruankao.essayMark.markGroupAction',
  'ruankao.essayMark.unmarkGroupAction',
  'ruankao.essayMark.danglingTitle',
  'ruankao.essayMark.danglingAction',
  'ruankao.essayMark.loadFailed',
  'ruankao.essayMark.retryAction',
  'ruankao.essayMark.editGuardTitle',
  'ruankao.essayMark.editGuardDesc',
  'ruankao.essayMark.editGuardConfirm',
  'ruankao.essayMark.editGuardStatusFailed',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao question-bank
// pass (questionBank tab: question CRUD form + domain/practiced filters +
// copy-for-coach handoff with clipboard fallback). The preset structure-demo
// entry was retired by the v2 seed pass — `sampleBadge` is intentionally
// absent from this list. Same guarding contract as the blocks above.
const QUESTION_BANK_KEYS = [
  'ruankao.questionBank.title',
  'ruankao.questionBank.desc',
  'ruankao.questionBank.createButton',
  'ruankao.questionBank.filterAllDomains',
  'ruankao.questionBank.filterAll',
  'ruankao.questionBank.filterUnpracticed',
  'ruankao.questionBank.filterPracticed',
  'ruankao.questionBank.searchPlaceholder',
  'ruankao.questionBank.emptyTitle',
  'ruankao.questionBank.emptyDesc',
  'ruankao.questionBank.yearLabel',
  'ruankao.questionBank.titleLabel',
  'ruankao.questionBank.domainLabel',
  'ruankao.questionBank.q1Label',
  'ruankao.questionBank.q2Label',
  'ruankao.questionBank.q3Label',
  'ruankao.questionBank.formTitleNew',
  'ruankao.questionBank.formTitleEdit',
  'ruankao.questionBank.submit',
  'ruankao.questionBank.deleteAction',
  'ruankao.questionBank.deleteTitle',
  'ruankao.questionBank.deleteDesc',
  'ruankao.questionBank.copyForCoach',
  'ruankao.questionBank.copyForCoachDone',
  'ruankao.questionBank.copyFallbackTitle',
  'ruankao.questionBank.validationRequired',
]

// Pinned inventory of the i18n keys added by the 2026-10 question-bank v2 seed
// pass (real/mock origin badges + origin filter + detail dialog with the three
// coach generation actions and the read/wizard full-essay channels; the tab
// and title rename to the plain question bank touched only the VALUES of
// ruankao.tabs.questionBank / questionBank.title / .desc — keys unchanged, so
// they stay pinned in QUESTION_BANK_KEYS above). The handoff guide lines and
// originNote verdicts are Chinese coach/corpus constants per ADR-016 R2 and
// stay out of the locales. Same guarding contract as above.
const QUESTION_BANK_V2_KEYS = [
  'ruankao.questionBank.originReal',
  'ruankao.questionBank.originMock',
  'ruankao.questionBank.originRealDesc',
  'ruankao.questionBank.originMockDesc',
  'ruankao.questionBank.filterAllOrigins',
  'ruankao.questionBank.filterReal',
  'ruankao.questionBank.filterMock',
  'ruankao.questionBank.detailAction',
  'ruankao.questionBank.detailTitle',
  'ruankao.questionBank.detailSourceLabel',
  'ruankao.questionBank.detailNoPromptText',
  'ruankao.questionBank.actionDecode',
  'ruankao.questionBank.actionQ2',
  'ruankao.questionBank.actionArguments',
  'ruankao.questionBank.actionFullEssayRead',
  'ruankao.questionBank.actionFullEssayGenerate',
  'ruankao.questionBank.handoffReady',
  'ruankao.questionBank.handoffNoNotebook',
  'ruankao.questionBank.wizardSeedReady',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao essay
// reading-mode pass (essay tab step 1: home cards with the marked-essay list +
// read view with the three-state red-line badge, loaded via the sanctioned
// GET /api/sources/{id} exception channel). The write-desk keys land as a
// separate ESSAY_WRITE_KEYS list with batch-4 step 2. `home.writeCardSoon`
// was retired by step 2 (the home write card became a real entry) and
// `home.trainCardSoon` was retired by the batch-5 trainer pass (the home train
// card became a real entry) — both are intentionally absent from this list.
// Same guarding contract as above.
const ESSAY_READ_KEYS = [
  'ruankao.essay.home.title',
  'ruankao.essay.home.readCard',
  'ruankao.essay.home.readCardDesc',
  'ruankao.essay.home.openLibrary',
  'ruankao.essay.read.redlineActive',
  'ruankao.essay.read.redlineInactive',
  'ruankao.essay.read.redlineError',
  'ruankao.essay.read.back',
  'ruankao.essay.read.notFound',
  'ruankao.essay.read.loading',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao writing-desk
// pass (essay tab step 2: five-section draft editor with char guardrails +
// fixed-parts generation from the project environment + coach handoff toasts
// consumed by the ChatPanel seed effect). The interpolated keys (countLabel /
// bodyTotal) must keep their {{count}} placeholder in every locale
// (Placeholder Parity). Same guarding contract as above.
const ESSAY_WRITE_KEYS = [
  'ruankao.essay.write.title',
  'ruankao.essay.write.desc',
  'ruankao.essay.write.draftLabel',
  'ruankao.essay.write.newDraft',
  'ruankao.essay.write.renameDraft',
  'ruankao.essay.write.deleteDraft',
  'ruankao.essay.write.confirmDeleteDraft',
  'ruankao.essay.write.untitled',
  'ruankao.essay.write.envLabel',
  'ruankao.essay.write.envNone',
  'ruankao.essay.write.generateFixed',
  'ruankao.essay.write.generateRunning',
  'ruankao.essay.write.generateOverwrite',
  'ruankao.essay.write.generateNoMaterial',
  'ruankao.essay.write.generateFailed',
  'ruankao.essay.write.generateTimeout',
  'ruankao.essay.write.sectionAbstract',
  'ruankao.essay.write.sectionBackground',
  'ruankao.essay.write.sectionQ2',
  'ruankao.essay.write.sectionArguments',
  'ruankao.essay.write.sectionClosing',
  'ruankao.essay.write.countLabel',
  'ruankao.essay.write.bodyTotal',
  'ruankao.essay.write.overLimit',
  'ruankao.essay.write.underFloor',
  'ruankao.essay.write.sendToCoach',
  'ruankao.essay.write.sendToCoachIncludeQ2',
  'ruankao.essay.write.handoffReady',
  'ruankao.essay.write.handoffNoNotebook',
  'ruankao.essay.write.handoffNoAgent',
  'ruankao.essay.write.savedLocal',
]

// Pinned inventory of the i18n keys added by the 2026-10 ruankao blind-writing
// trainer pass (batch 5: essay tab train subview with the setup/run/done state
// machine, per-section/full-paper timers, live char targets, localStorage
// history capped at 50, and the coach/draft handoffs unlocked on submit). The
// interpolated keys must keep their placeholders in every locale (Placeholder
// Parity): runTimer {{mm}}/{{ss}}, runTarget/runCurrent {{count}},
// historyItem {{date}}/{{topic}}/{{minutes}}/{{count}}. Same guarding
// contract as above.
const TRAINING_KEYS = [
  'ruankao.training.title',
  'ruankao.training.desc',
  'ruankao.training.setupTitle',
  'ruankao.training.topicLabel',
  'ruankao.training.topicPlaceholder',
  'ruankao.training.pickFromBank',
  'ruankao.training.outlineLabel',
  'ruankao.training.outlinePlaceholder',
  'ruankao.training.modePerSection',
  'ruankao.training.modeFullSimulation',
  'ruankao.training.minutesArgSection',
  'ruankao.training.minutesQ2',
  'ruankao.training.minutesTotal',
  'ruankao.training.start',
  'ruankao.training.runTimer',
  'ruankao.training.runTarget',
  'ruankao.training.runCurrent',
  'ruankao.training.nextSection',
  'ruankao.training.submit',
  'ruankao.training.leaveConfirm',
  'ruankao.training.stuckHint',
  'ruankao.training.doneTitle',
  'ruankao.training.doneMet',
  'ruankao.training.doneUnmet',
  'ruankao.training.copyToCoach',
  'ruankao.training.saveToDraft',
  'ruankao.training.saveToDraftDone',
  'ruankao.training.retrain',
  'ruankao.training.historyTitle',
  'ruankao.training.historyEmpty',
  'ruankao.training.historyItem',
  'ruankao.training.historyClear',
  'ruankao.training.historyConfirmClear',
]

// Pinned inventory of the i18n keys added by the 2026-10 industry-pool hint
// pass (hover business-trait line on the industry pool chips and the mock
// wizard industry combobox items). The hint bodies themselves are Chinese
// corpus constants per ADR-016 R2 and stay out of the locales. Same guarding
// contract as the blocks above.
const INDUSTRY_HINT_KEYS = ['ruankao.industry.hintLine']

// Pinned inventory of the i18n keys added by the 2026-10 folder header
// copy pass (Gemini sources column folder context menu: copy name /
// relative path, with the absolute-path item permanently greyed out -
// folders are in-app grouping records with no on-disk directory to
// fabricate a path from). Reuses sources.copyFileName/copyRelativePath/
// copyAbsolutePath/copiedToClipboard; only the greyed item's title/aria
// hint is new. Same guarding contract as the blocks above.
const FOLDER_COPY_KEYS = ['sources.grouping.folderNoDiskPath']

// Pinned inventory of the i18n keys added by the 2026-10 industry-profile
// hover pass (three profile lines — forms / tech / flows — on industry-pool
// chips and the mock-wizard industry combobox items for industries with
// corpus coverage). The profile bodies themselves are Chinese corpus
// constants per ADR-016 R2 and stay out of the locales. Same guarding
// contract as the blocks above.
const INDUSTRY_PROFILE_KEYS = [
  'ruankao.industry.profileFormsLine',
  'ruankao.industry.profileTechLine',
  'ruankao.industry.profileFlowsLine',
]

describe.each([
  ['2026-10 project-env suggest panel', SUGGEST_KEYS],
  ['2026-10 project-env generic paragraph', GENERIC_PARAGRAPH_KEYS],
  ['2026-10 data transfer v3 project-env tables', TRANSFER_V3_KEYS],
  ['2026-10 project-env card/detail redesign', VERIFICATION_DETAILS_KEYS],
  ['2026-10 project-env detail visual redesign', DETAIL_VISUAL_KEYS],
  ['2026-10 project-env industry input', INDUSTRY_KEYS],
  ['2026-10 project-env ruankao UX pass', RUANKAO_UX_KEYS],
  ['2026-10 Gemini sources column expand/collapse + copy paths', GEMINI_COLUMN_KEYS],
  ['2026-10 ruankao module shell', RUANKAO_SHELL_KEYS],
  ['2026-10 ruankao essay marks library', ESSAY_MARK_KEYS],
  ['2026-10 ruankao question bank', QUESTION_BANK_KEYS],
  ['2026-10 ruankao essay reading mode', ESSAY_READ_KEYS],
  ['2026-10 ruankao essay writing desk', ESSAY_WRITE_KEYS],
  ['2026-10 ruankao blind-writing trainer', TRAINING_KEYS],
  ['2026-10 industry pool hint line', INDUSTRY_HINT_KEYS],
  ['2026-10 folder header copy trio', FOLDER_COPY_KEYS],
  ['2026-10 industry pool profile lines', INDUSTRY_PROFILE_KEYS],
  ['2026-10 ruankao question bank v2 seeds', QUESTION_BANK_V2_KEYS],
])('New i18n keys (%s)', (_label, KEYS) => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 parallel live-card
// rewrite (progress header states, streaming label, failure title, stopwatch
// aria strings). Same guarding contract as NEW_KEYS above: exists in both
// zh-CN and en-US, and every other locale resolves it without crashing — via
// its own translation or the en-US fallback.
const PARALLEL_LIVE_KEYS = [
  'chat.parallelConnecting',
  'chat.parallelGenerating',
  'chat.parallelAllDone',
  'chat.parallelStreaming',
  'chat.parallelRunFailed',
  'chat.parallelTimerAria',
  'chat.parallelElapsedHint',
]

describe('New i18n keys (2026-10 parallel live card)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = PARALLEL_LIVE_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = PARALLEL_LIVE_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of PARALLEL_LIVE_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of PARALLEL_LIVE_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of PARALLEL_LIVE_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 parallel focus
// windows (enlarge toggle, per-window close, overlay dialog label, in-overlay
// dock for opening collapsed answers). Same guarding contract as
// PARALLEL_LIVE_KEYS above.
const PARALLEL_FOCUS_KEYS = [
  'chat.parallelExpand',
  'chat.parallelWindowClose',
  'chat.parallelFocusLabel',
  'chat.parallelDockLabel',
  'chat.parallelDockOpen',
]

describe('New i18n keys (2026-10 parallel focus windows)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = PARALLEL_FOCUS_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = PARALLEL_FOCUS_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of PARALLEL_FOCUS_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of PARALLEL_FOCUS_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of PARALLEL_FOCUS_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 model-library folder
// tree pass (per-folder expand/collapse chevron aria labels + empty-folder
// hint; library sources now carry source_group_ids so files mount under their
// folders). Same guarding contract as the blocks above.
const LIBRARY_TREE_KEYS = [
  'ruankao.essayMark.expandFolderAction',
  'ruankao.essayMark.collapseFolderAction',
  'ruankao.essayMark.folderEmptyHint',
]

describe('New i18n keys (2026-10 model-library folder tree)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = LIBRARY_TREE_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = LIBRARY_TREE_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of LIBRARY_TREE_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of LIBRARY_TREE_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of LIBRARY_TREE_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 essay capacity bar
// (writing-desk dashboard: five-lane proportion track, legend chips with
// four-state icon+text, body-total block, structured section headers and the
// submit-completeness summary). The old section* label keys stay untouched
// (the trainer reuses two of them); these are the new pure-name + dashboard
// keys. Interpolated keys must keep their placeholders in every locale
// (Placeholder Parity): targetRange {{min}}/{{max}}, legendCount
// {{name}}/{{count}}/{{target}}, legendOver {{count}}, completeness
// {{met}}/{{total}}, percentOfTotal {{percent}}. Same guarding contract as
// the blocks above.
const ESSAY_CAPACITY_KEYS = [
  'ruankao.essay.write.sectionAbstractName',
  'ruankao.essay.write.sectionBackgroundName',
  'ruankao.essay.write.sectionQ2Name',
  'ruankao.essay.write.sectionArgumentsName',
  'ruankao.essay.write.sectionClosingName',
  'ruankao.essay.write.targetRange',
  'ruankao.essay.write.legendCount',
  'ruankao.essay.write.legendUnder',
  'ruankao.essay.write.legendNear',
  'ruankao.essay.write.legendOver',
  'ruankao.essay.write.bodyThin',
  'ruankao.essay.write.bodyNear',
  'ruankao.essay.write.bodyAtCap',
  'ruankao.essay.write.completeness',
  'ruankao.essay.write.percentOfTotal',
  'ruankao.essay.write.capacityTitle',
  'ruankao.essay.write.capacityAria',
]

describe('New i18n keys (2026-10 essay capacity bar)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = ESSAY_CAPACITY_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = ESSAY_CAPACITY_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of ESSAY_CAPACITY_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of ESSAY_CAPACITY_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of ESSAY_CAPACITY_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})

// Pinned inventory of the i18n keys added by the 2026-10 question workbench
// (G line: three product blocks with an idle/generating/ready/error state
// machine, note-driven regenerate with overwrite confirm, copy / send-to-coach
// secondary channels, and the reason-mapped error copies). Block titles reuse
// the existing actionDecode/actionQ2/actionArguments keys; the coach guide
// lines stay Chinese corpus constants per ADR-016 R2. The interpolated key
// `workbench.generatedAt` must keep its {{time}} placeholder in every locale
// (Placeholder Parity, asserted below). Same guarding contract as the blocks
// above.
const QUESTION_WORKBENCH_KEYS = [
  'ruankao.questionBank.workbench.generate',
  'ruankao.questionBank.workbench.regenerate',
  'ruankao.questionBank.workbench.retry',
  'ruankao.questionBank.workbench.copy',
  'ruankao.questionBank.workbench.copyDone',
  'ruankao.questionBank.workbench.sendToCoach',
  'ruankao.questionBank.workbench.statusIdle',
  'ruankao.questionBank.workbench.statusGenerating',
  'ruankao.questionBank.workbench.statusReady',
  'ruankao.questionBank.workbench.statusError',
  'ruankao.questionBank.workbench.generatedAt',
  'ruankao.questionBank.workbench.noteBadge',
  'ruankao.questionBank.workbench.interruptHint',
  'ruankao.questionBank.workbench.noteLabel',
  'ruankao.questionBank.workbench.notePlaceholder',
  'ruankao.questionBank.workbench.noteApply',
  'ruankao.questionBank.workbench.overwriteConfirm',
  'ruankao.questionBank.workbench.errorNoTitle',
  'ruankao.questionBank.workbench.errorTimeout',
  'ruankao.questionBank.workbench.errorModel',
  'ruankao.questionBank.workbench.errorNetwork',
  'ruankao.questionBank.workbench.breakdown.comboAdviceTitle',
  'ruankao.questionBank.workbench.breakdown.materialMatchHeader',
  'ruankao.questionBank.workbench.breakdown.difficultyHeader',
  'ruankao.questionBank.workbench.breakdown.riskHeader',
  'ruankao.questionBank.workbench.breakdown.difficultyEasy',
  'ruankao.questionBank.workbench.breakdown.difficultyMedium',
  'ruankao.questionBank.workbench.breakdown.difficultyHard',
  'ruankao.questionBank.workbench.breakdown.riskLow',
  'ruankao.questionBank.workbench.breakdown.riskMedium',
  'ruankao.questionBank.workbench.breakdown.riskHigh',
  'ruankao.questionBank.workbench.q2.frameworkTitle',
  'ruankao.questionBank.workbench.q2.outlineHintTitle',
  'ruankao.questionBank.workbench.outline.roleQ2',
  'ruankao.questionBank.workbench.outline.roleQ3',
  'ruankao.questionBank.workbench.outline.dataAnchorsTitle',
]

describe('New i18n keys (2026-10 question workbench)', () => {
  it('every new key exists as a non-empty string in en-US', () => {
    const enLeaves = getLeafStrings(enUS)
    const missing = QUESTION_WORKBENCH_KEYS.filter(key => !enLeaves[key]?.trim())
    expect(missing, `Missing/empty in en-US: ${missing.join(', ')}`).toEqual([])
  })

  it('every new key exists as a non-empty string in zh-CN', () => {
    const zhLeaves = getLeafStrings(zhCN)
    const missing = QUESTION_WORKBENCH_KEYS.filter(key => !zhLeaves[key]?.trim())
    expect(missing, `Missing/empty in zh-CN: ${missing.join(', ')}`).toEqual([])
  })

  it('keeps the {{time}} placeholder of workbench.generatedAt in every locale (Placeholder Parity)', () => {
    for (const code of Object.keys(allResources)) {
      const leaves = getLeafStrings(allResources[code].translation)
      expect(
        leaves['ruankao.questionBank.workbench.generatedAt'],
        `${code} lost the {{time}} placeholder`,
      ).toContain('{{time}}')
    }
  })

  it.each(fallbackLocales)(
    '%s resolves every new key via i18next (own translation or en-US fallback, never the raw key)',
    async code => {
      const i18n = await makeI18n(code, allResources)
      const localeLeaves = getLeafStrings(allResources[code].translation)
      const enLeaves = getLeafStrings(enUS)

      for (const key of QUESTION_WORKBENCH_KEYS) {
        const expected = localeLeaves[key] ?? enLeaves[key]
        const value = i18n.t(key)
        expect(
          value,
          `${code} ${key}: expected "${expected}", got "${value}"`,
        ).toBe(expected)
        expect(value).not.toBe(key)
      }
    },
  )

  it.each(fallbackLocales)(
    '%s falls back to en-US when a new key is missing from that locale',
    async code => {
      const stripped = JSON.parse(
        JSON.stringify(allResources[code].translation),
      ) as Record<string, unknown>
      for (const key of QUESTION_WORKBENCH_KEYS) deletePath(stripped, key)

      const i18n = await makeI18n(code, {
        'en-US': allResources['en-US'],
        [code]: { translation: stripped },
      })
      const enLeaves = getLeafStrings(enUS)

      for (const key of QUESTION_WORKBENCH_KEYS) {
        expect(i18n.t(key)).toBe(enLeaves[key])
      }
    },
  )
})
