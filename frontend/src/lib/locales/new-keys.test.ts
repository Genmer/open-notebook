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
  'dataManagement.import.confirmDescription',
  'dataManagement.import.confirmTitle',
  'dataManagement.import.description',
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
  'usage.byModel',
  'usage.callType',
  'usage.calls',
  'usage.clear',
  'usage.clearConfirmDesc',
  'usage.clearConfirmTitle',
  'usage.clearFailed',
  'usage.clearedDesc',
  'usage.created',
  'usage.dailyTotal',
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
