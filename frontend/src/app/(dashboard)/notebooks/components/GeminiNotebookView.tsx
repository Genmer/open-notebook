'use client'

import { useState } from 'react'
import { GeminiSourcesColumn } from './GeminiSourcesColumn'
import { GeminiStudioColumn } from './GeminiStudioColumn'
import { ChatColumn } from './ChatColumn'
import { CollapsibleColumn } from '@/components/notebooks/CollapsibleColumn'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { BookOpen, Sparkles, MessageSquare } from 'lucide-react'
import type { NotebookResponse, SourceListResponse, NoteResponse } from '@/lib/types/api'
import type { ContextSelections, ContextMode } from '@/lib/types/notebook-context'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'

export interface GeminiNotebookViewProps {
  notebookId: string
  notebook: NotebookResponse
  sources: SourceListResponse[] | undefined
  sourcesLoading: boolean
  refetchSources: () => void
  notes: NoteResponse[] | undefined
  notesLoading: boolean
  sourceGrouping?: NotebookSourceFilters
  setSourceGrouping?: (filters: NotebookSourceFilters) => void
  contextSelections: ContextSelections
  handleSourceContextModeChange: (sourceId: string, mode: ContextMode) => void
  handleBulkSourceContext: (action: SourceBulkAction) => void
  setContextPickerOpen: (open: boolean) => void
}

export function GeminiNotebookView({
  notebookId,
  notebook,
  sources,
  sourcesLoading,
  refetchSources,
  notes,
  notesLoading,
  sourceGrouping,
  setSourceGrouping,
  contextSelections,
  handleSourceContextModeChange,
  handleBulkSourceContext,
  setContextPickerOpen,
}: GeminiNotebookViewProps) {
  const isDesktop = useIsDesktop()
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'chat' | 'studio'>('chat')
  // Studio 收起状态：与经典视图的笔记栏共用持久化 store
  const { notesCollapsed, toggleNotes } = useNotebookColumnsStore()

  return (
    <div className="flex-1 p-6 pt-5 overflow-hidden flex flex-col min-h-0 bg-muted/20">
      {/* 移动端视图：Tabs 切换 */}
      {!isDesktop && (
        <>
          <div className="lg:hidden mb-4 shrink-0">
            <Tabs
              value={mobileActiveTab}
              onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'chat' | 'studio')}
            >
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="sources" className="gap-1.5 text-xs">
                  <BookOpen className="h-4 w-4" />
                  来源与导源
                </TabsTrigger>
                <TabsTrigger value="chat" className="gap-1.5 text-xs">
                  <MessageSquare className="h-4 w-4" />
                  研读问答
                </TabsTrigger>
                <TabsTrigger value="studio" className="gap-1.5 text-xs">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Studio 工作室
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex-1 overflow-hidden lg:hidden min-h-0">
            {mobileActiveTab === 'sources' && (
              <GeminiSourcesColumn
                notebookId={notebookId}
                notebookName={notebook?.name}
                sources={sources}
                isLoading={sourcesLoading}
                onRefresh={refetchSources}
                contextSelections={contextSelections.sources}
                onContextModeChange={handleSourceContextModeChange}
                onBulkContextModeChange={handleBulkSourceContext}
                grouping={sourceGrouping}
                onGroupingChange={setSourceGrouping}
              />
            )}
            {mobileActiveTab === 'chat' && (
              <ChatColumn
                notebookId={notebookId}
                contextSelections={contextSelections}
                onOpenContextPicker={() => setContextPickerOpen(true)}
                sources={sources ?? []}
                sourcesLoading={sourcesLoading}
              />
            )}
            {mobileActiveTab === 'studio' && (
              <GeminiStudioColumn
                notebookId={notebookId}
                notes={notes}
                isLoading={notesLoading}
                sources={sources}
                contextSelections={contextSelections}
              />
            )}
          </div>
        </>
      )}

      {/* 桌面端：NotebookLM 经典现代三栏布局（左栏加宽；右栏可收起） */}
      <div
        className={cn(
          'hidden lg:grid h-full min-h-0 gap-5 transition-all duration-150',
          notesCollapsed
            ? 'grid-cols-[380px_minmax(0,1fr)_48px] xl:grid-cols-[420px_minmax(0,1fr)_48px]'
            : 'grid-cols-[380px_minmax(0,1fr)_340px] xl:grid-cols-[420px_minmax(0,1fr)_360px]'
        )}
      >
        {/* 左栏：来源与网络导源 (Sources & Web Research) */}
        <div className="h-full min-h-0 overflow-hidden">
          <GeminiSourcesColumn
            notebookId={notebookId}
            notebookName={notebook?.name}
            sources={sources}
            isLoading={sourcesLoading}
            onRefresh={refetchSources}
            contextSelections={contextSelections.sources}
            onContextModeChange={handleSourceContextModeChange}
            onBulkContextModeChange={handleBulkSourceContext}
            grouping={sourceGrouping}
            onGroupingChange={setSourceGrouping}
          />
        </div>

        {/* 中栏：Chat 研读对话主视区 */}
        <div className="h-full min-h-0 overflow-hidden">
          <ChatColumn
            notebookId={notebookId}
            contextSelections={contextSelections}
            onOpenContextPicker={() => setContextPickerOpen(true)}
            sources={sources ?? []}
            sourcesLoading={sourcesLoading}
          />
        </div>

        {/* 右栏：Studio 工作室与笔记瀑布流（支持收起为窄条） */}
        <div className="h-full min-h-0 overflow-hidden">
          <CollapsibleColumn
            isCollapsed={notesCollapsed}
            onToggle={toggleNotes}
            collapsedIcon={Sparkles}
            collapsedLabel="Studio"
          >
            <GeminiStudioColumn
              notebookId={notebookId}
              notes={notes}
              isLoading={notesLoading}
              sources={sources}
              contextSelections={contextSelections}
            />
          </CollapsibleColumn>
        </div>
      </div>
    </div>
  )
}
