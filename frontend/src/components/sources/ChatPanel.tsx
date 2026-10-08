'use client'

import { memo, useCallback, useMemo, useState, useRef, useEffect, useId } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { Bot, User, Send, Loader2, FileText, Lightbulb, StickyNote, Clock, Maximize2, Minimize2, Sparkles, Square, Trash2 } from 'lucide-react'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import {
  SourceChatMessage,
  SourceChatContextIndicator,
  BaseChatSession,
  NoteResponse,
  SourceListResponse
} from '@/lib/types/api'
import type { ContextMode, ContextSelections } from '@/lib/types/notebook-context'
import type { BulkContextHandler } from '@/lib/utils/source-context'
import type { ContextBreakdown } from '@/lib/types/api'
import { ModelSelector } from './ModelSelector'
import { ChatParticipantSelector } from '@/components/chat/ChatParticipantSelector'
import { ParallelRunsPicker } from '@/components/chat/ParallelRunsPicker'
import { ParallelLiveCard } from '@/components/chat/ParallelLiveCard'
import { groupParallelMessages } from '@/lib/utils/parallel-messages'
import { filterStreamingContent } from '@/lib/utils/stream-text'
import { ContextIndicator } from '@/components/common/ContextIndicator'
import { ContextBreakdownBar } from '@/components/common/ContextBreakdownBar'
import { ArtifactSidePanels } from '@/components/common/ArtifactSidePanels'
import { ArtifactViewDialog } from '@/app/(dashboard)/notebooks/components/ArtifactViewDialog'
import { GeminiSourcesColumn } from '@/app/(dashboard)/notebooks/components/GeminiSourcesColumn'
import { GeminiStudioColumn } from '@/app/(dashboard)/notebooks/components/GeminiStudioColumn'
import { EdgePanelHandle } from '@/components/common/EdgePanelHandle'
import { SessionManager } from '@/components/sources/SessionManager'
import { MessageActions } from '@/components/sources/MessageActions'
import { ChatProjectEnv } from '@/components/project-envs/ChatProjectEnv'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { excerpt } from '@/app/(dashboard)/notebooks/components/ContextBreakdownDialog'
import { convertReferencesToCompactMarkdown, createCompactReferenceLinkComponent, parseSourceReferences } from '@/lib/utils/source-references'
import { sourcesApi } from '@/lib/api/sources'
import { useModalManager } from '@/lib/hooks/use-modal-manager'
import { useSourceTitles } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { useChatPreferencesStore } from '@/lib/stores/chat-preferences-store'
import type { NotebookSourceFilters } from '@/lib/hooks/use-sources'
import { toast } from 'sonner'
import { useTranslation } from '@/lib/hooks/use-translation'

interface NotebookContextStats {
  sourcesInsights: number
  sourcesFull: number
  notesCount: number
  tokenCount?: number
  charCount?: number
}

interface ChatPanelProps {
  messages: SourceChatMessage[]
  isStreaming: boolean
  // Live token-stream text (notebook chat only). Absent on source chats —
  // the waiting bubble keeps its plain spinner there.
  streamingMessage?: { content: string } | null
  // Stops the in-flight notebook-chat stream (rendered as the stop button on
  // the streaming bar). Absent on source chats — that path has no abortable
  // SSE request.
  onStopStreaming?: () => void
  contextIndicators: SourceChatContextIndicator | null
  onSendMessage: (message: string, modelOverride?: string) => void
  modelOverride?: string
  onModelChange?: (model?: string) => void
  // Agent binding (PDR-04): when onAgentChange is provided the composer swaps
  // the plain model selector for the agent/model participant picker.
  agent?: string | null
  onAgentChange?: (agent: string | null) => void
  // Project environment binding (软考项目环境): rendered only when the change
  // handler is provided — keeps legacy test renders provider-free.
  projectEnv?: string | null
  onProjectEnvChange?: (env: string | null) => void
  onNewSessionWithEnv?: (env: string) => void
  // Parallel answers (PDR-004, notebook chat only): live fan-out state plus
  // send/synthesize/cancel handlers. Absent on source chats.
  parallelChat?: {
    phase: 'idle' | 'running' | 'done'
    runs: import('@/lib/hooks/use-parallel-chat').ParallelRunState[]
    /** Group the live/settled card currently stands in for (dedup key against
     * the archived history view). Null until runs_started arrives. */
    groupId: string | null
    synthesis: import('@/lib/hooks/use-parallel-chat').SynthesisState | null
    isSynthesizing: boolean
    send: (message: string, runs: string[]) => void
    synthesize: (participant: { agent?: string; model?: string }) => void
    cancel: () => void
  }
  // Session management props
  sessions?: BaseChatSession[]
  currentSessionId?: string | null
  onCreateSession?: (title: string) => void
  onSelectSession?: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => void
  onUpdateSession?: (sessionId: string, title: string) => void
  loadingSessions?: boolean
  /** Delete-session mutation in-flight flag (ConfirmDialog spinner). */
  isDeletingSession?: boolean
  // Per-message delete entry (history editing): when provided, human bubbles
  // grow a hover trash button and AI bubbles' action row grows a delete
  // button — both behind a ConfirmDialog owned by this panel. Hidden while
  // isStreaming/parallel-running and on temp-* optimistic bubbles.
  onDeleteMessage?: (messageId: string) => void
  /** Message-delete mutation in-flight flag (ConfirmDialog spinner). */
  isDeletingMessage?: boolean
  // Clear-conversation entry (history editing): header trash button behind a
  // ConfirmDialog owned by this panel. Same lock as the per-message entries —
  // without this prop the source detail page has no clear path at all (the
  // breakdown dialog only mounts on the notebook chat).
  onClearMessages?: () => void
  /** Clear-history mutation in-flight flag (ConfirmDialog spinner). */
  isClearingMessage?: boolean
  // Generic props for reusability
  title?: string
  contextType?: 'source' | 'notebook'
  /** When set, the notebook context row becomes a button opening the picker. */
  onOpenContextPicker?: () => void
  // Notebook context stats (for notebook chat)
  notebookContextStats?: NotebookContextStats
  // Composition breakdown (char shares per segment). When present (and some
  // content segment is non-zero) the stacked bar renders above the composer;
  // onOpenContextBreakdown opens the detail dialog mounted by the caller.
  contextBreakdown?: ContextBreakdown | null
  onOpenContextBreakdown?: () => void
  // Notebook ID for saving notes
  notebookId?: string
  // 当前来源分组浏览范围：原引用直传给保存弹窗预选默认文件夹
  sourceGrouping?: NotebookSourceFilters
  // ── Workspace pass-through (notebook chat) ─────────────────────────────
  // Feeds the fullscreen side panels with the notebook page's real data and
  // context handlers, so the panels mount the actual workspace columns
  // (GeminiSourcesColumn / GeminiStudioColumn) instead of a lite clone —
  // checkbox selections in the panel affect the real chat context.
  sources?: SourceListResponse[]
  sourcesLoading?: boolean
  refetchSources?: () => void
  contextSelections?: ContextSelections
  onSourceContextModeChange?: (sourceId: string, mode: ContextMode) => void
  onBulkSourceContext?: BulkContextHandler
  onGroupingChange?: (filters: NotebookSourceFilters) => void
  notes?: NoteResponse[]
  notesLoading?: boolean
}

export function ChatPanel({
  messages,
  isStreaming,
  streamingMessage,
  onStopStreaming,
  contextIndicators,
  onSendMessage,
  modelOverride,
  onModelChange,
  agent,
  onAgentChange,
  projectEnv,
  onProjectEnvChange,
  onNewSessionWithEnv,
  parallelChat,
  sessions = [],
  currentSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onUpdateSession,
  loadingSessions = false,
  isDeletingSession = false,
  onDeleteMessage,
  isDeletingMessage = false,
  onClearMessages,
  isClearingMessage = false,
  title,
  contextType = 'source',
  notebookContextStats,
  contextBreakdown,
  onOpenContextBreakdown,
  onOpenContextPicker,
  notebookId,
  sourceGrouping,
  sources,
  sourcesLoading,
  refetchSources,
  contextSelections,
  onSourceContextModeChange,
  onBulkSourceContext,
  onGroupingChange,
  notes,
  notesLoading
}: ChatPanelProps) {
  const { t } = useTranslation()
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // Pending per-message delete (bubble entry): backs the ConfirmDialog; the
  // message object (not just the id) is kept so the confirm copy carries the
  // excerpt, same as the context-breakdown dialog's entries.
  const [pendingDelete, setPendingDelete] = useState<SourceChatMessage | null>(null)
  // Clear-conversation confirm (header trash entry): one flag backs the
  // button and its dialog, same as the breakdown dialog's clear entry.
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  // Fullscreen slide-out panels (sources left / notes right) — notebook chat
  // only; the open/close flags live here so the layered Esc handler below can
  // see them, while the react-query data fetching stays inside the
  // conditional child (ChatFullscreenPanels) to keep this component
  // provider-free in tests.
  const [panelLeftOpen, setPanelLeftOpen] = useState(false)
  const [panelRightOpen, setPanelRightOpen] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { openModal } = useModalManager()

  // Session delete lock (A12): notebook/source streaming or a running parallel
  // fan-out. The parallel path has no backend 409 (chat_parallel.py is
  // change-frozen), so this guard is what keeps the session undeletable while
  // its archived answers are still being written. Same combination as the
  // message delete entries.
  const sessionDeleteLocked =
    isStreaming || parallelChat?.phase === 'running'

  // Per-message delete lock: same combination as above (deleting mid-write
  // would race the checkpoint writer; the backend also 409s the delete while a
  // single-run stream is in flight).
  const messageDeleteLocked =
    isStreaming || parallelChat?.phase === 'running'

  // Stable handler for the memoized message rows: resolves the id back to the
  // message object for the confirm excerpt, then opens the ConfirmDialog.
  const requestMessageDelete = useCallback((messageId: string) => {
    setPendingDelete(messages.find(message => message.id === messageId) ?? null)
  }, [messages])

  // ESC 还原：全屏态 Card 已 fixed 脱离 flex 流，监听 window keydown 即可，
  // 无需目标元素持有焦点；非全屏态不挂监听。分层退出：侧栏开着先收侧栏，
  // 其次才退全屏（与 ArtifactViewDialog/PDF 全屏同款手势）。
  useEffect(() => {
    if (!isFullscreen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (panelLeftOpen || panelRightOpen) {
        setPanelLeftOpen(false)
        setPanelRightOpen(false)
      } else {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isFullscreen, panelLeftOpen, panelRightOpen])

  // Stable reference-click handler so memoized messages don't re-render on
  // composer keystrokes (which no longer re-render this component at all, since
  // the input state lives in the ChatComposer child).
  const handleReferenceClick = useCallback(
    async (type: string, id: string, passage?: string) => {
      const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'

      // Source citations with answer context: try to locate the exact passage
      // and open the reader positioned on it. Any failure falls back to a
      // plain unpositioned open.
      if (modalType === 'source' && passage) {
        const located = await sourcesApi.locatePassage(id, passage)
        if (located?.quote) {
          openModal(modalType, id, { citeQuote: located.quote })
          return
        }
      }

      try {
        openModal(modalType, id)
        // Note: The modal system uses URL parameters and doesn't throw errors for missing items.
        // The modal component itself will handle displaying "not found" states.
        // This try-catch is here for future enhancements or unexpected errors.
      } catch {
        toast.error(t('common.noResults'))
      }
    },
    [openModal, t]
  )

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Streaming follow: jump to the latest token (omitted behavior = 'auto',
  // instant follow) so the typing bubble stays in view; the smooth [messages]
  // effect above stays untouched.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView()
  }, [streamingMessage?.content])

  return (
    <>
    <Card
      className={cn(
        'flex flex-col overflow-hidden',
        // 全屏时 fixed 脱离 flex 流，尺寸锚定改为受控 class（h-screen/w-screen），
        // 不再依赖 h-full/flex-1 从父容器继承。
        isFullscreen
          ? 'fixed inset-0 z-50 h-screen w-screen rounded-none transition-[padding] duration-300'
          : 'h-full flex-1',
        // 面板开启时推挤而非覆盖：padding 让出面板宽度（w-96=24rem），
        // 中间对话与左右面板三栏并存；窄屏（<lg）保持覆盖模式。
        isFullscreen && panelLeftOpen && 'lg:pl-96',
        isFullscreen && panelRightOpen && 'lg:pr-96'
      )}
    >
      <CardHeader className="pb-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.13em] text-muted-foreground">
            <span aria-hidden className="h-3.5 w-[3px] rounded-full bg-teal" />
            {title || (contextType === 'source' ? t('chat.chatWith', { name: t('navigation.sources') }) : t('chat.chatWith', { name: t('common.notebook') }))}
          </CardTitle>
          <div className="flex items-center gap-1">
          {onSelectSession && onCreateSession && onDeleteSession && (
            <Dialog open={sessionManagerOpen} onOpenChange={setSessionManagerOpen}>
              <Button
                variant="ghost"
                size="sm"
                className="gap-2 text-muted-foreground"
                onClick={() => setSessionManagerOpen(true)}
                disabled={loadingSessions}
              >
                <Clock className="h-4 w-4" />
                <span className="text-xs">{t('chat.sessions')}</span>
              </Button>
              <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden">
                <DialogTitle className="sr-only">{t('sessions.managerTitle')}</DialogTitle>
                <SessionManager
                  sessions={sessions}
                  currentSessionId={currentSessionId ?? null}
                  onCreateSession={(title) => onCreateSession?.(title)}
                  onSelectSession={(sessionId) => {
                    onSelectSession(sessionId)
                    setSessionManagerOpen(false)
                  }}
                  onUpdateSession={(sessionId, title) => onUpdateSession?.(sessionId, title)}
                  onDeleteSession={(sessionId) => onDeleteSession?.(sessionId)}
                  loadingSessions={loadingSessions}
                  isDeletingSession={isDeletingSession}
                  deleteDisabled={sessionDeleteLocked}
                />
              </DialogContent>
            </Dialog>
          )}
          {onClearMessages && messages.some((message) => !message.id.startsWith('temp-')) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setClearConfirmOpen(true)}
              disabled={messageDeleteLocked || isDeletingMessage || isClearingMessage}
              aria-label={t('context.clearHistory')}
              title={t('context.clearHistory')}
              data-testid="chat-clear-history"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => setIsFullscreen((value) => !value)}
            aria-label={isFullscreen ? t('chat.exitFullscreen') : t('chat.enterFullscreen')}
            title={isFullscreen ? t('chat.exitFullscreen') : t('chat.enterFullscreen')}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col min-h-0 p-0">
        <ScrollArea className="flex-1 min-h-0 px-4" ref={scrollAreaRef}>
          <div className="space-y-4 py-4">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">
                  {t('chat.startConversation', { type: contextType === 'source' ? t('navigation.sources') : t('common.notebook') })}
                </p>
                <p className="text-xs mt-2">{t('chat.askQuestions')}</p>
              </div>
            ) : (
              groupParallelMessages(messages).map((item) =>
                item.kind === 'single' && item.message ? (
                  <ChatMessage
                    key={item.message.id}
                    message={item.message}
                    notebookId={notebookId}
                    onReferenceClick={handleReferenceClick}
                    sourceGrouping={sourceGrouping}
                    onDeleteMessage={
                      onDeleteMessage &&
                      !messageDeleteLocked &&
                      !item.message.id.startsWith('temp-')
                        ? requestMessageDelete
                        : undefined
                    }
                  />
                ) : parallelChat &&
                  parallelChat.phase !== 'idle' &&
                  item.groupId === parallelChat.groupId ? null : (
                  <ParallelGroupView
                    key={item.groupId}
                    item={item}
                    notebookId={notebookId}
                    onReferenceClick={handleReferenceClick}
                    sourceGrouping={sourceGrouping}
                  />
                )
              )
            )}
            {/* Kept mounted through 'done' (not just 'running'): error/watchdog
                paths must not evaporate, and the synthesis bar stays reachable
                after the runs settle. The archived copy of the SAME group is
                hidden above by groupId while this card is up; the next send
                resets the hook and the history view takes over. */}
            {parallelChat && parallelChat.phase !== 'idle' && (
              <ParallelLiveCard
                runs={parallelChat.runs}
                isSynthesizing={parallelChat.isSynthesizing}
                synthesis={parallelChat.synthesis}
                onSynthesize={parallelChat.synthesize}
              />
            )}
            {isStreaming && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0">
                  <div className="h-8 w-8 rounded-full bg-teal-tint flex items-center justify-center">
                    <Bot className="h-4 w-4 text-teal" />
                  </div>
                </div>
                {/* 单行流式条：等宽灰字只展示尾部内容（最新 token 永远可见，
                    旧内容从左侧滚出），Stop 按钮可中断本次生成 */}
                <div
                  data-testid="chat-stream-window"
                  className="flex h-8 min-w-0 max-w-[80%] flex-1 items-center gap-2 rounded-md border bg-card px-3"
                >
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-teal" />
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {(streamingMessage?.content ?? '') === ''
                      ? t('chat.streamBuilding')
                      : t('chat.streamGenerating')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
                    {(streamingMessage?.content ?? '') === ''
                      ? contextIndicators &&
                        (contextIndicators.sources?.length || contextIndicators.notes?.length)
                        ? t('chat.streamWaitingHint', {
                            sources: contextIndicators.sources?.length ?? 0,
                            notes: contextIndicators.notes?.length ?? 0,
                          })
                        : t('chat.streamWaitingGeneric')
                      : (() => {
                          // Plain text while streaming: token-level re-parsing via
                          // MarkdownRenderer would be too costly; the authoritative
                          // message renders markdown once complete arrives.
                          const text = filterStreamingContent(streamingMessage!.content)
                          return text.length > 120 ? '…' + text.slice(-120) : text
                        })()}
                  </span>
                  <span className="inline-block h-[1em] w-[2px] shrink-0 translate-y-[2px] bg-teal animate-pulse" />
                  {onStopStreaming && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={onStopStreaming}
                      aria-label={t('chat.streamStop')}
                      title={t('chat.streamStop')}
                    >
                      <Square className="h-2.5 w-2.5" />
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Context Indicators */}
        {contextIndicators && (
          <div className="border-t px-4 py-2">
            <div className="flex flex-wrap gap-2 text-xs">
              {contextIndicators.sources?.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <FileText className="h-3 w-3" />
                  {contextIndicators.sources.length} {t('navigation.sources')}
                </Badge>
              )}
              {contextIndicators.insights?.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <Lightbulb className="h-3 w-3" />
                  {contextIndicators.insights.length} {contextIndicators.insights.length === 1 ? t('common.insight') : t('common.insights')}
                </Badge>
              )}
              {contextIndicators.notes?.length > 0 && (
                <Badge variant="outline" className="gap-1">
                  <StickyNote className="h-3 w-3" />
                  {contextIndicators.notes.length} {contextIndicators.notes.length === 1 ? t('common.note') : t('common.notes')}
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Notebook Context Indicator */}
        {notebookContextStats && (
          <ContextIndicator
            sourcesInsights={notebookContextStats.sourcesInsights}
            sourcesFull={notebookContextStats.sourcesFull}
            notesCount={notebookContextStats.notesCount}
            tokenCount={notebookContextStats.tokenCount}
            charCount={notebookContextStats.charCount}
            onOpenPicker={onOpenContextPicker}
          />
        )}

        {/* Project environment binding (软考项目环境) */}
        {onProjectEnvChange && (
          <ChatProjectEnv
            envId={projectEnv ?? null}
            onBind={onProjectEnvChange}
            onNewSessionWithEnv={onNewSessionWithEnv}
            disabled={isStreaming}
          />
        )}

        {/* Composition bar (notebook chat only): renders itself only when a
            breakdown exists and some content segment is non-zero; the whole
            bar opens the detail dialog. */}
        {contextBreakdown && onOpenContextBreakdown && (
          <ContextBreakdownBar
            breakdown={contextBreakdown}
            onOpen={onOpenContextBreakdown}
          />
        )}

        {/* Input Area */}
        <ChatComposer
          onSendMessage={onSendMessage}
          agent={agent}
          onAgentChange={onAgentChange}
          parallelChat={parallelChat}
          isStreaming={isStreaming}
          onStopStreaming={onStopStreaming}
          modelOverride={modelOverride}
          onModelChange={onModelChange}
        />
      </CardContent>

      {/* Fullscreen slide-out panels + edge handles (notebook chat only): the
          fullscreen Card is `fixed`, so absolute children anchor to it and the
          reading area behind the panels stays interactive. */}
      {isFullscreen && !!notebookId && (
        <ChatFullscreenPanels
          notebookId={notebookId}
          leftOpen={panelLeftOpen}
          rightOpen={panelRightOpen}
          onLeftOpenChange={setPanelLeftOpen}
          onRightOpenChange={setPanelRightOpen}
          onExitFullscreen={() => {
            setPanelLeftOpen(false)
            setPanelRightOpen(false)
            setIsFullscreen(false)
          }}
          onOpenSource={(sourceId) => openModal('source', sourceId)}
          sources={sources}
          sourcesLoading={sourcesLoading}
          refetchSources={refetchSources}
          contextSelections={contextSelections}
          onSourceContextModeChange={onSourceContextModeChange}
          onBulkSourceContext={onBulkSourceContext}
          grouping={sourceGrouping}
          onGroupingChange={onGroupingChange}
          notes={notes}
          notesLoading={notesLoading}
        />
      )}
    </Card>

    {/* Delete one message from its bubble (destructive; excerpt in the copy,
        sessions.* keys per the 2026-10 session-manager changeset) */}
    <ConfirmDialog
      open={!!pendingDelete}
      onOpenChange={(next) => { if (!next) setPendingDelete(null) }}
      title={t('sessions.deleteMessage')}
      description={t('sessions.deleteMessageDesc', {
        excerpt: pendingDelete ? excerpt(pendingDelete.content, 30) : '',
      })}
      confirmVariant="destructive"
      isLoading={isDeletingMessage}
      onConfirm={() => {
        if (pendingDelete) onDeleteMessage?.(pendingDelete.id)
        setPendingDelete(null)
      }}
    />

    {/* Clear the whole conversation (destructive; same keys as the
        context-breakdown dialog's clear entry). temp-* optimistic bubbles have
        no checkpoint presence, so the count only covers persisted messages. */}
    <ConfirmDialog
      open={clearConfirmOpen}
      onOpenChange={setClearConfirmOpen}
      title={t('context.clearHistory')}
      description={t('context.clearHistoryDesc', {
        count: messages.filter((message) => !message.id.startsWith('temp-')).length,
      })}
      confirmVariant="destructive"
      isLoading={isClearingMessage}
      onConfirm={() => {
        onClearMessages?.()
        setClearConfirmOpen(false)
      }}
    />
    </>
  )
}

/**
 * Slide-out panels + edge handles + note-reading dialog for the fullscreen
 * chat Card. Split out of ChatPanel so the react-query notes fetch (and its
 * Provider requirement) only exists once the panels actually mount — the
 * chat itself stays renderable without a QueryClient.
 *
 * When the workspace pass-through props are present (notebook page chat),
 * the panels mount the REAL workspace columns — GeminiSourcesColumn on the
 * left, GeminiStudioColumn on the right — so the fullscreen experience is
 * pixel-identical to the notebook page, and context checkboxes inside the
 * panel drive the actual chat context. Without them (no data passed), the
 * lite ArtifactSidePanels lists are used as a fallback.
 */
function ChatFullscreenPanels({
  notebookId,
  leftOpen,
  rightOpen,
  onLeftOpenChange,
  onRightOpenChange,
  onExitFullscreen,
  onOpenSource,
  sources,
  sourcesLoading,
  refetchSources,
  contextSelections,
  onSourceContextModeChange,
  onBulkSourceContext,
  grouping,
  onGroupingChange,
  notes,
  notesLoading,
}: {
  notebookId: string
  leftOpen: boolean
  rightOpen: boolean
  onLeftOpenChange: (open: boolean) => void
  onRightOpenChange: (open: boolean) => void
  onExitFullscreen: () => void
  onOpenSource: (sourceId: string) => void
  sources?: SourceListResponse[]
  sourcesLoading?: boolean
  refetchSources?: () => void
  contextSelections?: ContextSelections
  onSourceContextModeChange?: (sourceId: string, mode: ContextMode) => void
  onBulkSourceContext?: BulkContextHandler
  grouping?: NotebookSourceFilters
  onGroupingChange?: (filters: NotebookSourceFilters) => void
  notes?: NoteResponse[]
  notesLoading?: boolean
}) {
  const { t } = useTranslation()
  const [readingNote, setReadingNote] = useState<NoteResponse | null>(null)
  const { data: panelNotes = [] } = useNotes(notebookId)
  const resolvedNotes = notes ?? panelNotes
  // Real workspace columns mount only when the page passed its data through.
  const useWorkspaceColumns = Array.isArray(sources)

  const leftSlot = useWorkspaceColumns ? (
    <GeminiSourcesColumn
      notebookId={notebookId}
      sources={sources}
      isLoading={!!sourcesLoading}
      onRefresh={refetchSources ?? (() => {})}
      contextSelections={contextSelections?.sources ?? {}}
      onContextModeChange={onSourceContextModeChange ?? (() => {})}
      onBulkContextModeChange={onBulkSourceContext ?? (() => {})}
      grouping={grouping}
      onGroupingChange={onGroupingChange}
    />
  ) : undefined
  const rightSlot = useWorkspaceColumns ? (
    <GeminiStudioColumn
      notebookId={notebookId}
      notes={resolvedNotes}
      isLoading={!!notesLoading}
      sources={sources}
      contextSelections={contextSelections}
      sourceGrouping={grouping}
      embedded
    />
  ) : undefined

  return (
    <>
      {!leftOpen && (
        <EdgePanelHandle
          side="left"
          ariaLabel={t('artifacts.openSourcesPanel')}
          label={t('artifacts.sourcesPanelTitle')}
          onClick={() => onLeftOpenChange(true)}
          testid="chat-handle-left"
        />
      )}
      {!rightOpen && (
        <EdgePanelHandle
          side="right"
          ariaLabel={t('artifacts.openNotesPanel')}
          label={t('artifacts.notesPanelTitle')}
          onClick={() => onRightOpenChange(true)}
          testid="chat-handle-right"
        />
      )}
      <ArtifactSidePanels
        notebookId={notebookId}
        notes={resolvedNotes}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onLeftOpenChange={onLeftOpenChange}
        onRightOpenChange={onRightOpenChange}
        onExitFullscreen={onExitFullscreen}
        onOpenSource={onOpenSource}
        onNoteSelect={(note) => setReadingNote(note)}
        leftPanel={leftSlot}
        rightPanel={rightSlot}
      />
      {/* Note reading dialog opened from the right panel (same experience as
          the PDF fullscreen panels). */}
      <ArtifactViewDialog
        open={!!readingNote}
        onOpenChange={(next) => { if (!next) setReadingNote(null) }}
        note={readingNote ? { title: readingNote.title, content: readingNote.content } : undefined}
        notebookId={notebookId}
        notes={resolvedNotes}
        activeNoteId={readingNote?.id ?? null}
        onNoteSelect={(note) => setReadingNote(note)}
        onOpenSource={onOpenSource}
      />
    </>
  )
}

// Composer owns the input state so keystrokes (including IME composition) only
// re-render this small component instead of the whole message history.
interface ChatComposerProps {
  onSendMessage: (message: string, modelOverride?: string) => void
  isStreaming: boolean
  // While streaming, the send button becomes a clickable stop button that
  // aborts the in-flight stream. Absent when the chat has no abortable request.
  onStopStreaming?: () => void
  modelOverride?: string
  onModelChange?: (model?: string) => void
  agent?: string | null
  onAgentChange?: (agent: string | null) => void
  parallelChat?: {
    phase: 'idle' | 'running' | 'done'
    send: (message: string, runs: string[]) => void
    cancel: () => void
  }
}

function ChatComposer({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  modelOverride,
  onModelChange,
  agent,
  onAgentChange,
  parallelChat
}: ChatComposerProps) {
  const { t } = useTranslation()
  const chatInputId = useId()
  const enterToSendId = useId()
  const [input, setInput] = useState('')
  const enterToSendRaw = useChatPreferencesStore((state) => state.enterToSend)
  const setEnterToSend = useChatPreferencesStore((state) => state.setEnterToSend)
  const hasHydrated = useChatPreferencesStore((state) => state.hasHydrated)
  // persist rehydrate 前按默认值渲染，避免 SSR/客户端首帧属性不一致
  const enterToSend = hasHydrated ? enterToSendRaw : false
  // Safari 的 compositionend 先于选词确认的 keydown 派发，isComposing 已复位，需用 ref 兜底
  const composingRef = useRef(false)
  // A running parallel fan-out owns the composer: single sends would race the
  // five answers into one checkpoint, and the send button doubles as the
  // parallel stop (the live card has no stop of its own).
  const parallelRunning = parallelChat?.phase === 'running'

  const handleSend = () => {
    if (input.trim() && !isStreaming && !parallelRunning) {
      onSendMessage(input.trim(), modelOverride)
      setInput('')
    }
  }

  const handleParallelSend = (runs: string[]) => {
    // The picker now opens on an empty input, so an empty-input confirm lands
    // here: hint instead of silently doing nothing, and refocus the composer.
    if (!input.trim()) {
      toast.error(t('chat.parallelEmptyHint'))
      document.getElementById(chatInputId)?.focus()
      return
    }
    if (!isStreaming && parallelChat) {
      parallelChat.send(input.trim(), runs)
      setInput('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 组合期的回车是选词确认，不是发送意图，直接放行给输入法
    if (e.key !== 'Enter' || e.nativeEvent.isComposing || composingRef.current) return

    const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toUpperCase().indexOf('MAC') >= 0

    if (enterToSend) {
      // Shift+Enter 保留换行
      if (!e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    } else if (isMac ? e.metaKey : e.ctrlKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Detect platform for placeholder text
  const isMac = typeof navigator !== 'undefined' && navigator.userAgent.toUpperCase().indexOf('MAC') >= 0
  const keyHint = isMac ? '⌘+Enter' : 'Ctrl+Enter'
  const sendHint = enterToSend
    ? t('chat.enterToSendHint')
    : t('chat.pressToSend', { key: keyHint })

  return (
    <div className="flex-shrink-0 p-4 space-y-3 border-t">
      {/* Model selector + enter-to-send preference */}
      <div className="flex items-center justify-between gap-2">
        {onAgentChange ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground">{t('chat.model')}</span>
            <ChatParticipantSelector
              value={{ agent: agent ?? null, modelOverride: modelOverride ?? null }}
              onChange={(participant) => {
                onAgentChange(participant.agent ?? null)
                onModelChange?.(participant.modelOverride ?? undefined)
              }}
              disabled={isStreaming}
            />
          </div>
        ) : onModelChange && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground">{t('chat.model')}</span>
            <ModelSelector
              currentModel={modelOverride}
              onModelChange={onModelChange}
              disabled={isStreaming}
            />
          </div>
        )}
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto">
          <Checkbox
            id={enterToSendId}
            checked={enterToSend}
            onCheckedChange={(checked) => setEnterToSend(checked === true)}
          />
          <Label
            htmlFor={enterToSendId}
            className="text-xs text-muted-foreground cursor-pointer"
          >
            {t('chat.enterToSend')}
          </Label>
        </div>
      </div>

      <div className="flex gap-2 items-end min-w-0">
        <Textarea
          id={chatInputId}
          name="chat-message"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            composingRef.current = true
          }}
          onCompositionEnd={() => {
            // 推迟一个宏任务清除，跨过 Safari「compositionend → keydown」的派发顺序
            setTimeout(() => {
              composingRef.current = false
            }, 0)
          }}
          placeholder={`${t('chat.sendPlaceholder')} (${sendHint})`}
          disabled={isStreaming || parallelRunning}
          className="flex-1 min-h-[40px] max-h-[100px] resize-none py-2 px-3 min-w-0"
          rows={1}
        />
        {parallelChat && (
          <ParallelRunsPicker
            disabled={isStreaming || parallelChat.phase === 'running'}
            onSend={handleParallelSend}
          />
        )}
        <Button
          onClick={
            isStreaming ? onStopStreaming : parallelRunning ? parallelChat?.cancel : handleSend
          }
          disabled={isStreaming ? !onStopStreaming : parallelRunning ? false : !input.trim()}
          size="icon"
          className="h-[40px] w-[40px] flex-shrink-0"
          aria-label={
            (isStreaming && onStopStreaming) || parallelRunning ? t('chat.streamStop') : undefined
          }
          title={
            (isStreaming && onStopStreaming) || parallelRunning ? t('chat.streamStop') : undefined
          }
        >
          {isStreaming || parallelRunning ? (
            isStreaming ? (
              onStopStreaming ? (
                <Square className="h-4 w-4" />
              ) : (
                <Loader2 className="h-4 w-4 animate-spin" />
              )
            ) : (
              <Square className="h-4 w-4" />
            )
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

// Archived parallel group (PDR-004): the human question renders through the
// normal ChatMessage row; the answers sit in a responsive grid, with the
// synthesis conclusion highlighted below.
function ParallelGroupView({
  item,
  notebookId,
  onReferenceClick,
  sourceGrouping,
}: {
  item: import('@/lib/utils/parallel-messages').MessageListItem<SourceChatMessage>
  notebookId?: string
  onReferenceClick: (type: string, id: string, passage?: string) => void
  sourceGrouping?: NotebookSourceFilters
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2" data-testid={`parallel-group-${item.groupId}`}>
      {item.question && (
        <ChatMessage
          message={item.question}
          notebookId={notebookId}
          onReferenceClick={onReferenceClick}
          sourceGrouping={sourceGrouping}
          // A12: the group question is the anchor of the archived group —
          // deleting it alone would strand the answer cards, so the bubble's
          // delete entry is suppressed here (the breakdown dialog's per-id
          // entries remain the surgical path).
          suppressDelete
        />
      )}
      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {(item.answers ?? []).map((answer) => (
          <div
            key={answer.id}
            className="rounded-lg border bg-card p-3 space-y-1.5 min-w-0"
            data-testid={`parallel-answer-${answer.id}`}
          >
            <p className="text-xs font-medium text-muted-foreground truncate">
              {t('chat.answeredBy', {
                name: answer.agent_name || answer.model_name || t('chat.groupDefault'),
              })}
            </p>
            <div className="max-h-72 overflow-y-auto text-sm">
              <AIMessageContent
                content={answer.content}
                onReferenceClick={onReferenceClick}
              />
            </div>
          </div>
        ))}
      </div>
      {item.synthesis && (
        <div
          className="rounded-lg border border-gold/40 bg-card p-3 space-y-1.5"
          data-testid={`parallel-synthesis-${item.groupId}`}
        >
          <p className="text-xs font-medium text-gold flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            {t('chat.synthesisResultTitle')}
            <span className="text-muted-foreground font-normal">
              {t('chat.answeredBy', {
                name:
                  item.synthesis.agent_name ||
                  item.synthesis.model_name ||
                  t('chat.groupDefault'),
              })}
            </span>
          </p>
          <div className="text-sm">
            <AIMessageContent
              content={item.synthesis.content}
              onReferenceClick={onReferenceClick}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Single chat message row. Memoized so historical messages don't re-render when
// unrelated state (e.g. the composer input) changes.
interface ChatMessageProps {
  message: SourceChatMessage
  notebookId?: string
  onReferenceClick: (type: string, id: string, passage?: string) => void
  sourceGrouping?: NotebookSourceFilters
  /** Per-message delete entry (history editing). Present only when the panel
   *  unlocked it: not streaming, no parallel fan-out, not a temp-* bubble. */
  onDeleteMessage?: (messageId: string) => void
  /** Hide the delete entries even when onDeleteMessage is wired — parallel
   *  group questions set this so a group can't lose its anchor message. */
  suppressDelete?: boolean
}

const ChatMessage = memo(function ChatMessage({
  message,
  notebookId,
  onReferenceClick,
  sourceGrouping,
  onDeleteMessage,
  suppressDelete = false,
}: ChatMessageProps) {
  const { t } = useTranslation()
  const deletable = !!onDeleteMessage && !suppressDelete
  return (
    <div
      className={`flex gap-3 group/msg ${
        message.type === 'human' ? 'justify-end' : 'justify-start'
      }`}
    >
      {message.type === 'ai' && (
        <div className="flex-shrink-0">
          <div className="h-8 w-8 rounded-full bg-teal-tint flex items-center justify-center">
            <Bot className="h-4 w-4 text-teal" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2 max-w-[80%]">
        <div
          className={`rounded-lg px-4 py-2 border ${
            message.type === 'human'
              ? 'bg-muted'
              : 'bg-card'
          }`}
        >
          {message.type === 'ai' ? (
            <AIMessageContent
              content={message.content}
              onReferenceClick={onReferenceClick}
            />
          ) : (
            <p className="text-sm break-all">{message.content}</p>
          )}
        </div>
        {message.type === 'ai' && (
          <MessageActions
            content={message.content}
            notebookId={notebookId}
            sourceGrouping={sourceGrouping}
            onDelete={
              deletable ? () => onDeleteMessage?.(message.id) : undefined
            }
          />
        )}
      </div>
      {message.type === 'human' && (
        <div className="flex items-center gap-1 flex-shrink-0">
          {deletable && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive opacity-0 group-hover/msg:opacity-100 focus-visible:opacity-100 transition-opacity"
              onClick={() => onDeleteMessage?.(message.id)}
              aria-label={t('sessions.deleteMessage')}
              title={t('sessions.deleteMessage')}
              data-testid={`message-delete-${message.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <div className="h-8 w-8 rounded-full bg-muted border flex items-center justify-center">
            <User className="h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}
    </div>
  )
})

// Helper component to render AI messages with clickable references
function AIMessageContent({
  content,
  onReferenceClick
}: {
  content: string
  onReferenceClick: (type: string, id: string, passage?: string) => void
}) {
  const { t } = useTranslation()
  // The hook lives here (not in memoized ChatMessage) so arriving title data
  // re-renders only this message body, and messages without source references
  // never issue a request (enabled: ids.length > 0).
  const sourceIds = useMemo(() => {
    const ids = parseSourceReferences(content)
      .filter((reference) => reference.type === 'source')
      .map((reference) => reference.id)
    return [...new Set(ids)]
  }, [content])
  const { data: titles } = useSourceTitles(sourceIds)

  // Reference ids are bare (no table prefix); the API returns full record ids.
  const titleLookup = useMemo(() => {
    if (!titles?.length) return undefined
    const map = new Map<string, string>()
    for (const item of titles) {
      if (item.title) map.set(item.id.replace(/^source:/, ''), item.title)
    }
    return map.size > 0 ? map : undefined
  }, [titles])

  // Convert references to compact markdown with numbered citations
  const markdownWithCompactRefs = convertReferencesToCompactMarkdown(content, t('common.references'), titleLookup)

  // Create custom link component for compact references
  const LinkComponent = createCompactReferenceLinkComponent(onReferenceClick, content)

  return (
    <MarkdownRenderer components={{
      a: LinkComponent
    }}>
      {markdownWithCompactRefs}
    </MarkdownRenderer>
  )
}
