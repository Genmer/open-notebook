'use client'

import { useState } from 'react'
import { FoldersColumn } from './FoldersColumn'
import { SourcesColumn } from './SourcesColumn'
import { NotesColumn } from './NotesColumn'
import { ChatColumn } from './ChatColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { FileText, StickyNote, MessageSquare } from 'lucide-react'
import type { NotebookResponse, SourceListResponse, NoteResponse } from '@/lib/types/api'
import type { ContextSelections, ContextMode, NoteContextMode } from '@/lib/types/notebook-context'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import type { NoteContextDefault, BulkContextHandler } from '@/lib/utils/source-context'

export interface ClassicNotebookViewProps {
  notebookId: string
  notebook: NotebookResponse
  sources: SourceListResponse[] | undefined
  sourcesLoading: boolean
  refetchSources: () => void
  hasNextPage?: boolean
  isFetchingNextPage?: boolean
  fetchNextPage?: () => void
  notes: NoteResponse[] | undefined
  notesLoading: boolean
  sourceGrouping: NotebookSourceFilters
  setSourceGrouping: (filters: NotebookSourceFilters) => void
  contextSelections: ContextSelections
  handleSourceContextModeChange: (sourceId: string, mode: ContextMode) => void
  handleNoteContextModeChange: (noteId: string, mode: NoteContextMode) => void
  handleBulkSourceContext: BulkContextHandler
  handleBulkNoteContext: (action: NoteContextDefault) => void
  setArtifactDialogOpen: (open: boolean) => void
  setContextPickerOpen: (open: boolean) => void
}

export function ClassicNotebookView({
  notebookId,
  notebook,
  sources,
  sourcesLoading,
  refetchSources,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  notes,
  notesLoading,
  sourceGrouping,
  setSourceGrouping,
  contextSelections,
  handleSourceContextModeChange,
  handleNoteContextModeChange,
  handleBulkSourceContext,
  handleBulkNoteContext,
  setArtifactDialogOpen,
  setContextPickerOpen,
}: ClassicNotebookViewProps) {
  const { t } = useTranslation()
  const { foldersCollapsed, sourcesCollapsed, notesCollapsed } = useNotebookColumnsStore()
  const isDesktop = useIsDesktop()
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>('chat')

  return (
    <div className="flex-1 p-6 pt-6 overflow-x-auto flex flex-col">
      {/* Mobile: Tabbed interface */}
      {!isDesktop && (
        <>
          <div className="lg:hidden mb-4">
            <Tabs
              value={mobileActiveTab}
              onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sources" className="gap-2">
                  <FileText className="h-4 w-4" />
                  {t('navigation.sources')}
                </TabsTrigger>
                <TabsTrigger value="notes" className="gap-2">
                  <StickyNote className="h-4 w-4" />
                  {t('common.notes')}
                </TabsTrigger>
                <TabsTrigger value="chat" className="gap-2">
                  <MessageSquare className="h-4 w-4" />
                  {t('common.chat')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-hidden lg:hidden">
            {mobileActiveTab === 'sources' && (
              <SourcesColumn
                sources={sources}
                isLoading={sourcesLoading}
                notebookId={notebookId}
                notebookName={notebook?.name}
                onRefresh={refetchSources}
                contextSelections={contextSelections.sources}
                onContextModeChange={handleSourceContextModeChange}
                onBulkContextModeChange={handleBulkSourceContext}
                grouping={sourceGrouping}
                onGroupingChange={setSourceGrouping}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
              />
            )}
            {mobileActiveTab === 'notes' && (
              <NotesColumn
                notes={notes}
                isLoading={notesLoading}
                notebookId={notebookId}
                contextSelections={contextSelections.notes}
                onContextModeChange={handleNoteContextModeChange}
                onBulkContextModeChange={handleBulkNoteContext}
                onGenerateArtifact={() => setArtifactDialogOpen(true)}
              />
            )}
            {mobileActiveTab === 'chat' && (
              <ChatColumn
                notebookId={notebookId}
                contextSelections={contextSelections}
                onOpenContextPicker={() => setContextPickerOpen(true)}
                sources={sources ?? []}
                sourcesLoading={sourcesLoading}
                sourceGrouping={sourceGrouping}
              />
            )}
          </div>
        </>
      )}

      {/* Desktop: Collapsible columns layout */}
      <div
        className={cn(
          'hidden lg:flex h-full min-h-0 gap-4 transition-all duration-150',
          'flex-row'
        )}
      >
        {/* Folders Column */}
        <div
          className={cn(
            'transition-all duration-150',
            foldersCollapsed ? 'w-12 flex-shrink-0' : 'w-60 flex-shrink-0'
          )}
        >
          <FoldersColumn grouping={sourceGrouping} onGroupingChange={setSourceGrouping} />
        </div>

        {/* Sources Column */}
        <div
          className={cn(
            'transition-all duration-150',
            sourcesCollapsed ? 'w-12 flex-shrink-0' : 'flex-1 min-w-[320px] max-w-[420px]'
          )}
        >
          <SourcesColumn
            sources={sources}
            isLoading={sourcesLoading}
            notebookId={notebookId}
            notebookName={notebook?.name}
            onRefresh={refetchSources}
            contextSelections={contextSelections.sources}
            onContextModeChange={handleSourceContextModeChange}
            onBulkContextModeChange={handleBulkSourceContext}
            grouping={sourceGrouping}
            onGroupingChange={setSourceGrouping}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            fetchNextPage={fetchNextPage}
          />
        </div>

        {/* Notes Column */}
        <div
          className={cn(
            'transition-all duration-150',
            notesCollapsed ? 'w-12 flex-shrink-0' : 'flex-none basis-1/3'
          )}
        >
          <NotesColumn
            notes={notes}
            isLoading={notesLoading}
            notebookId={notebookId}
            contextSelections={contextSelections.notes}
            onContextModeChange={handleNoteContextModeChange}
            onBulkContextModeChange={handleBulkNoteContext}
            onGenerateArtifact={() => setArtifactDialogOpen(true)}
          />
        </div>

            {/* Chat Column */}
            <div className="transition-all duration-150 flex-1 min-w-0 lg:pr-6 lg:-mr-6">
              <ChatColumn
                notebookId={notebookId}
                contextSelections={contextSelections}
                onOpenContextPicker={() => setContextPickerOpen(true)}
                sources={sources ?? []}
                sourcesLoading={sourcesLoading}
                sourceGrouping={sourceGrouping}
              />
            </div>
      </div>
    </div>
  )
}
