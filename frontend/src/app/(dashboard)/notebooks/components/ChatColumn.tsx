'use client'

import { useMemo, useState } from 'react'
import { useNotebookChat } from '@/lib/hooks/use-notebook-chat'
import { useNotes } from '@/lib/hooks/use-notes'
import { ChatPanel } from '@/components/sources/ChatPanel'
import { ContextBreakdownDialog } from './ContextBreakdownDialog'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'
import { ContextSelections } from '../[id]/page'
import { useTranslation } from '@/lib/hooks/use-translation'
import { SourceListResponse, NoteResponse } from '@/lib/types/api'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import type { ContextMode, NoteContextMode } from '@/lib/types/notebook-context'
import type { BulkContextHandler } from '@/lib/utils/source-context'

interface ChatColumnProps {
  notebookId: string
  contextSelections: ContextSelections
  onOpenContextPicker: () => void
  sources: SourceListResponse[]
  sourcesLoading: boolean
  /** 原引用直传 ChatPanel，供「保存」弹窗的存为来源模式预选默认文件夹。 */
  sourceGrouping?: NotebookSourceFilters
  /** 全屏侧栏复用真工作区列所需的数据/回调（GeminiSourcesColumn 等）。 */
  refetchSources?: () => void
  onSourceContextModeChange?: (sourceId: string, mode: ContextMode) => void
  onBulkSourceContext?: BulkContextHandler
  onGroupingChange?: (filters: NotebookSourceFilters) => void
  /** 明细弹层的笔记移除入口（'off'）复用页面既有的笔记模式回调。 */
  onNoteContextModeChange?: (noteId: string, mode: NoteContextMode) => void
  notes?: NoteResponse[]
  notesLoading?: boolean
}

export function ChatColumn({
  notebookId,
  contextSelections,
  onOpenContextPicker,
  sources,
  sourcesLoading,
  sourceGrouping,
  refetchSources,
  onSourceContextModeChange,
  onBulkSourceContext,
  onGroupingChange,
  onNoteContextModeChange,
  notes: notesProp,
  notesLoading: notesLoadingProp,
}: ChatColumnProps) {
  const { t } = useTranslation()
  // Detail dialog behind the composition bar.
  const [breakdownOpen, setBreakdownOpen] = useState(false)

  // Fetch notes for this notebook
  const { data: ownNotes = [], isLoading: ownNotesLoading } = useNotes(notebookId)
  const notes = notesProp ?? ownNotes
  const notesLoading = notesLoadingProp ?? ownNotesLoading

  // Initialize notebook chat hook
  const chat = useNotebookChat({
    notebookId,
    sources,
    notes,
    contextSelections
  })

  // Context stats for the indicator, counted from the selection maps so
  // sources picked via the context picker (beyond the loaded pages) count too.
  const contextStats = useMemo(() => {
    let sourcesInsights = 0
    let sourcesFull = 0
    for (const mode of Object.values(contextSelections.sources)) {
      if (mode === 'insights') sourcesInsights++
      else if (mode === 'full') sourcesFull++
    }
    let notesCount = 0
    for (const mode of Object.values(contextSelections.notes)) {
      if (mode === 'full') notesCount++
    }
    return {
      sourcesInsights,
      sourcesFull,
      notesCount,
      tokenCount: chat.tokenCount,
      charCount: chat.charCount
    }
  }, [contextSelections, chat.tokenCount, chat.charCount])

  // History/context editing locks up while a generation runs: the single-run
  // stream, a parallel fan-out, or a compression job about to rewrite the
  // checkpoint (deleting mid-generation would race the checkpoint writer).
  // Same guard combination as the composer's entries.
  const editLocked = chat.isSending || chat.parallel.phase === 'running' || chat.isCompressing

  // Show loading state while sources/notes are being fetched
  if (sourcesLoading || notesLoading) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <LoadingSpinner size="lg" />
        </CardContent>
      </Card>
    )
  }

  // Show error state if data fetch failed (unlikely but good to handle)
  if (!sources && !notes) {
    return (
      <Card className="h-full flex flex-col">
        <CardContent className="flex-1 flex items-center justify-center">
          <div className="text-center text-muted-foreground">
            <AlertCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-sm">{t('chat.unableToLoadChat')}</p>
            <p className="text-xs mt-2">{t('common.refreshPage') || 'Please try refreshing the page'}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
    <ChatPanel
      title={t('chat.chatWithNotebook')}
      contextType="notebook"
      messages={chat.messages}
      isStreaming={chat.isSending}
      streamingMessage={chat.streamingMessage}
      onStopStreaming={chat.stopStreaming}
      contextIndicators={null}
      onSendMessage={(message, modelOverride) => chat.sendMessage(message, modelOverride)}
      modelOverride={chat.currentSession?.model_override ?? chat.pendingModelOverride ?? undefined}
      onModelChange={(model) => chat.setModelOverride(model ?? null)}
      agent={chat.currentSession?.agent ?? chat.pendingAgentOverride ?? null}
      onAgentChange={(agentId) => chat.setAgentOverride(agentId ?? null)}
      projectEnv={chat.currentSession?.project_env ?? chat.pendingProjectEnv ?? null}
      onProjectEnvChange={(envId) => chat.setProjectEnv(envId)}
      onNewSessionWithEnv={(envId) => chat.createSession(undefined, envId)}
      parallelChat={{
        phase: chat.parallel.phase,
        runs: chat.parallel.runs,
        synthesis: chat.parallel.synthesis,
        isSynthesizing: chat.parallel.isSynthesizing,
        send: (message, runs) => chat.sendParallelMessage(message, runs),
        synthesize: (participant) => chat.synthesizeParallel(participant),
      }}
      sessions={chat.sessions}
      currentSessionId={chat.currentSessionId}
      onCreateSession={(title) => chat.createSession(title)}
      onSelectSession={chat.switchSession}
      onUpdateSession={(sessionId, title) => chat.updateSession(sessionId, { title })}
      onDeleteSession={chat.deleteSession}
      loadingSessions={chat.loadingSessions}
      isDeletingSession={chat.isDeletingSession}
      onDeleteMessage={(messageId) => {
        if (chat.currentSessionId) chat.deleteMessages(chat.currentSessionId, [messageId])
      }}
      isDeletingMessage={chat.isDeletingMessages}
      onClearMessages={() => {
        if (chat.currentSessionId) chat.clearMessages(chat.currentSessionId)
      }}
      isClearingMessage={chat.isClearingMessages}
      notebookContextStats={contextStats}
      contextBreakdown={chat.contextBreakdown}
      onOpenContextBreakdown={() => setBreakdownOpen(true)}
      notebookId={notebookId}
      onOpenContextPicker={onOpenContextPicker}
      sourceGrouping={sourceGrouping}
      sources={sources}
      sourcesLoading={sourcesLoading}
      refetchSources={refetchSources}
      contextSelections={contextSelections}
      onSourceContextModeChange={onSourceContextModeChange}
      onBulkSourceContext={onBulkSourceContext}
      onGroupingChange={onGroupingChange}
      notes={notes}
      notesLoading={notesLoading}
    />
    <ContextBreakdownDialog
      open={breakdownOpen}
      onOpenChange={setBreakdownOpen}
      breakdown={chat.contextBreakdown}
      messages={chat.messages}
      editLocked={editLocked}
      isMutating={chat.isDeletingMessages || chat.isClearingMessages}
      onRemoveMessages={(messageIds) => {
        if (chat.currentSessionId) chat.deleteMessages(chat.currentSessionId, messageIds)
      }}
      onCompressMessages={(messageIds) => {
        if (chat.currentSessionId) chat.compressMessages(chat.currentSessionId, messageIds)
      }}
      onClassifyTopics={async () => {
        if (!chat.currentSessionId) return null
        try {
          // Rejections are already toasted in the hook; null keeps the
          // dialog's previous classification state.
          return await chat.classifyTopics(chat.currentSessionId)
        } catch {
          return null
        }
      }}
      isCompressing={chat.isCompressing}
      isClassifying={chat.isClassifying}
      onClearMessages={() => {
        if (chat.currentSessionId) chat.clearMessages(chat.currentSessionId)
      }}
      onSourceModeChange={(sourceId, mode) => onSourceContextModeChange?.(sourceId, mode)}
      onNoteModeChange={(noteId, mode) => onNoteContextModeChange?.(noteId, mode)}
      onOpenContextPicker={onOpenContextPicker}
    />
    </>
  )
}
