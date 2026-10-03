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
import { Bot, User, Send, Loader2, FileText, Lightbulb, StickyNote, Clock, Maximize2, Minimize2 } from 'lucide-react'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'
import {
  SourceChatMessage,
  SourceChatContextIndicator,
  BaseChatSession,
  NoteResponse,
  SourceListResponse
} from '@/lib/types/api'
import type { ContextMode, ContextSelections } from '@/lib/types/notebook-context'
import type { SourceBulkAction } from '@/lib/utils/source-context'
import { ModelSelector } from './ModelSelector'
import { ContextIndicator } from '@/components/common/ContextIndicator'
import { ArtifactSidePanels } from '@/components/common/ArtifactSidePanels'
import { ArtifactViewDialog } from '@/app/(dashboard)/notebooks/components/ArtifactViewDialog'
import { GeminiSourcesColumn } from '@/app/(dashboard)/notebooks/components/GeminiSourcesColumn'
import { GeminiStudioColumn } from '@/app/(dashboard)/notebooks/components/GeminiStudioColumn'
import { EdgePanelHandle } from '@/components/common/EdgePanelHandle'
import { SessionManager } from '@/components/sources/SessionManager'
import { MessageActions } from '@/components/sources/MessageActions'
import { convertReferencesToCompactMarkdown, createCompactReferenceLinkComponent, parseSourceReferences } from '@/lib/utils/source-references'
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
  contextIndicators: SourceChatContextIndicator | null
  onSendMessage: (message: string, modelOverride?: string) => void
  modelOverride?: string
  onModelChange?: (model?: string) => void
  // Session management props
  sessions?: BaseChatSession[]
  currentSessionId?: string | null
  onCreateSession?: (title: string) => void
  onSelectSession?: (sessionId: string) => void
  onDeleteSession?: (sessionId: string) => void
  onUpdateSession?: (sessionId: string, title: string) => void
  loadingSessions?: boolean
  // Generic props for reusability
  title?: string
  contextType?: 'source' | 'notebook'
  /** When set, the notebook context row becomes a button opening the picker. */
  onOpenContextPicker?: () => void
  // Notebook context stats (for notebook chat)
  notebookContextStats?: NotebookContextStats
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
  onBulkSourceContext?: (action: SourceBulkAction) => void
  onGroupingChange?: (filters: NotebookSourceFilters) => void
  notes?: NoteResponse[]
  notesLoading?: boolean
}

export function ChatPanel({
  messages,
  isStreaming,
  contextIndicators,
  onSendMessage,
  modelOverride,
  onModelChange,
  sessions = [],
  currentSessionId,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onUpdateSession,
  loadingSessions = false,
  title,
  contextType = 'source',
  notebookContextStats,
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
  const handleReferenceClick = useCallback((type: string, id: string) => {
    const modalType = type === 'source_insight' ? 'insight' : type as 'source' | 'note' | 'insight'

    try {
      openModal(modalType, id)
      // Note: The modal system uses URL parameters and doesn't throw errors for missing items.
      // The modal component itself will handle displaying "not found" states.
      // This try-catch is here for future enhancements or unexpected errors.
    } catch {
      toast.error(t('common.noResults'))
    }
  }, [openModal, t])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <>
    <Card
      className={cn(
        'flex flex-col overflow-hidden',
        // 全屏时 fixed 脱离 flex 流，尺寸锚定改为受控 class（h-screen/w-screen），
        // 不再依赖 h-full/flex-1 从父容器继承。
        isFullscreen ? 'fixed inset-0 z-50 h-screen w-screen rounded-none' : 'h-full flex-1'
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
                <DialogTitle className="sr-only">{t('chat.sessionsTitle')}</DialogTitle>
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
                />
              </DialogContent>
            </Dialog>
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
              messages.map((message) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  notebookId={notebookId}
                  onReferenceClick={handleReferenceClick}
                  sourceGrouping={sourceGrouping}
                />
              ))
            )}
            {isStreaming && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0">
                  <div className="h-8 w-8 rounded-full bg-teal-tint flex items-center justify-center">
                    <Bot className="h-4 w-4 text-teal" />
                  </div>
                </div>
                <div className="rounded-lg px-4 py-2 bg-card border">
                  <Loader2 className="h-4 w-4 animate-spin" />
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

        {/* Input Area */}
        <ChatComposer
          onSendMessage={onSendMessage}
          isStreaming={isStreaming}
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
  onBulkSourceContext?: (action: SourceBulkAction) => void
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
  modelOverride?: string
  onModelChange?: (model?: string) => void
}

function ChatComposer({
  onSendMessage,
  isStreaming,
  modelOverride,
  onModelChange
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

  const handleSend = () => {
    if (input.trim() && !isStreaming) {
      onSendMessage(input.trim(), modelOverride)
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
        {onModelChange && (
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
          disabled={isStreaming}
          className="flex-1 min-h-[40px] max-h-[100px] resize-none py-2 px-3 min-w-0"
          rows={1}
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || isStreaming}
          size="icon"
          className="h-[40px] w-[40px] flex-shrink-0"
        >
          {isStreaming ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  )
}

// Single chat message row. Memoized so historical messages don't re-render when
// unrelated state (e.g. the composer input) changes.
interface ChatMessageProps {
  message: SourceChatMessage
  notebookId?: string
  onReferenceClick: (type: string, id: string) => void
  sourceGrouping?: NotebookSourceFilters
}

const ChatMessage = memo(function ChatMessage({
  message,
  notebookId,
  onReferenceClick,
  sourceGrouping
}: ChatMessageProps) {
  return (
    <div
      className={`flex gap-3 ${
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
          />
        )}
      </div>
      {message.type === 'human' && (
        <div className="flex-shrink-0">
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
  onReferenceClick: (type: string, id: string) => void
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
  const LinkComponent = createCompactReferenceLinkComponent(onReferenceClick)

  return (
    <MarkdownRenderer components={{
      a: LinkComponent
    }}>
      {markdownWithCompactRefs}
    </MarkdownRenderer>
  )
}
