'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowUp,
  Eraser,
  MessageSquareText,
  MousePointerClick,
  Paperclip,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { agentsApi } from '@/lib/api/agents'
import {
  quickChatStream,
  QuickChatError,
  type QuickChatMessage,
} from '@/lib/api/quick-chat'
import { modelsApi } from '@/lib/api/models'
import { MODEL_QUERY_KEYS } from '@/lib/hooks/use-models'
import { useElementPicker } from '@/lib/hooks/use-element-picker'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  computeStreamMetrics,
  formatStreamElapsed,
  type StreamMetricsSample,
} from '@/lib/ruankao/stream-metrics'

// localStorage 键（仅本浏览器窗口的轻量持久化；服务端不落库）
const LS_TURNS = 'quickask:turns'
const LS_MODEL = 'quickask:modelId'
const LS_AGENT = 'quickask:agentId'
const MAX_TURNS = 60
const MAX_BLOCKS = 12
// Radix Select 禁止空字符串 value（保留给清空语义）→ 哨兵值做「默认/不使用」
const MODEL_DEFAULT = 'default'
const AGENT_NONE = 'none'
// 指标标签复用题库工作台的通用流式文案（当前/峰值/已用时/已输出）
const STREAM_KEY = 'ruankao.questionBank.workbench.stream'
// 全字面量映射：locale 未用键检测靠源码文本扫描，模板串会漏报（see index.test.ts）
const ERROR_KEY_BY_REASON: Record<string, string> = {
  no_message: 'quickAsk.error.no_message',
  no_model: 'quickAsk.error.no_model',
  model_timeout: 'quickAsk.error.model_timeout',
  model_error: 'quickAsk.error.model_error',
  network: 'quickAsk.error.network',
}

interface PickedBlock {
  id: string
  label: string
  text: string
}

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function QuickAskHost() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [blocks, setBlocks] = useState<PickedBlock[]>([])
  const [turns, setTurns] = useState<QuickChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [metrics, setMetrics] = useState<StreamMetricsSample | null>(null)
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [modelId, setModelId] = useState('')
  const [agentId, setAgentId] = useState('')

  const hostRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamPartsRef = useRef<string[]>([])
  const deltaTimesRef = useRef<number[]>([])
  const charsRef = useRef(0)
  const startedAtRef = useRef(0)

  // ── 持久化：动作点显式保存，不做 effect 派生写入 ──────────────────
  // effect 依赖 turns/modelId 写 LS 的写法在 StrictMode 下必炸：save
  // effect 首跑拿到 setState 应用前的旧值（[] / ''）就把已存数据覆盖删
  // 掉。只读的恢复 effect 留在挂载时；所有写入都发生在用户的动作回调里，
  // 时序天然确定。
  useEffect(() => {
    setTurns(loadJSON<QuickChatMessage[]>(LS_TURNS, []))
    const savedModel = window.localStorage.getItem(LS_MODEL)
    const savedAgent = window.localStorage.getItem(LS_AGENT)
    if (savedModel !== null) setModelId(savedModel)
    if (savedAgent !== null) setAgentId(savedAgent)
  }, [])
  const persistTurns = useCallback((next: QuickChatMessage[]) => {
    if (next.length) window.localStorage.setItem(LS_TURNS, JSON.stringify(next))
    else window.localStorage.removeItem(LS_TURNS)
  }, [])

  // ── 模型/智能体列表（面板打开才拉取）───────────────────────────────
  const { data: models } = useQuery({
    queryKey: MODEL_QUERY_KEYS.models,
    queryFn: () => modelsApi.list(),
    enabled: open,
  })
  const { data: agents } = useQuery({
    queryKey: ['agents', 'quick-ask'],
    queryFn: () => agentsApi.list(true),
    enabled: open,
  })
  const languageModels = (models ?? []).filter((m) => m.type === 'language')

  // ── 元素拾取 ────────────────────────────────────────────────────────
  const handlePick = useCallback((block: PickedBlock) => {
    setBlocks((prev) => [...prev, block])
  }, [])
  const handlePickEmpty = useCallback(() => {
    toast.warning(t('quickAsk.pickEmpty'))
  }, [t])
  const stopPicking = useCallback(() => setPicking(false), [])
  useElementPicker({
    active: picking,
    hostRef,
    onPick: handlePick,
    onPickEmpty: handlePickEmpty,
    onFinish: stopPicking,
  })
  // 关面板即结束拾取，避免监听器悬挂
  useEffect(() => {
    if (!open) setPicking(false)
  }, [open])

  // ── 发送 / 流式 ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!streaming) return
    const id = window.setInterval(() => {
      setStreamText(streamPartsRef.current.join(''))
      setMetrics(
        computeStreamMetrics(
          deltaTimesRef.current,
          charsRef.current,
          '',
          startedAtRef.current,
          performance.now(),
          metrics?.peakTps ?? 0,
        ),
      )
    }, 500)
    return () => window.clearInterval(id)
    // metrics.peakTps 单调递增，旧值只作峰值下界，无需触发重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return
    const picked = blocks
    const userTurn: QuickChatMessage = {
      role: 'user',
      content: text,
      contextLabels: picked.map((b) => b.label),
    }
    const history = [...turns, userTurn].slice(-MAX_TURNS)
    setTurns(history)
    persistTurns(history)
    setInput('')
    setBlocks([])
    setErrorKey(null)
    setStreaming(true)
    setStreamText('')
    streamPartsRef.current = []
    deltaTimesRef.current = []
    charsRef.current = 0
    startedAtRef.current = performance.now()
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const full = await quickChatStream({
        messages: history,
        modelId: modelId || null,
        agentId: agentId || null,
        contextBlocks: picked.map(({ label, text: blockText }) => ({
          label,
          text: blockText,
        })),
        onDelta: (delta) => {
          deltaTimesRef.current.push(performance.now())
          charsRef.current += delta.length
          streamPartsRef.current.push(delta)
        },
        signal: controller.signal,
      })
      const answered = [...history, { role: 'assistant' as const, content: full }]
      setTurns(answered)
      persistTurns(answered)
    } catch (err) {
      if (controller.signal.aborted) {
        const partial = streamPartsRef.current.join('').trim()
        if (partial) {
          const interrupted = [...history, { role: 'assistant' as const, content: partial }]
          setTurns(interrupted)
          persistTurns(interrupted)
        }
      } else if (err instanceof QuickChatError) {
        setErrorKey(err.reason)
      } else {
        setErrorKey('network')
      }
    } finally {
      setStreaming(false)
      setStreamText('')
      setMetrics(null)
      abortRef.current = null
    }
  }, [input, streaming, blocks, turns, modelId, agentId, persistTurns])

  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  // 流式输出时贴底滚动
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, streamText, open, errorKey])

  const removeBlock = useCallback((id: string) => {
    setBlocks((prev) => prev.filter((b) => b.id !== id))
  }, [])
  const togglePicking = useCallback(() => {
    if (!picking && blocks.length >= MAX_BLOCKS) {
      toast.warning(t('quickAsk.pickLimit', { count: MAX_BLOCKS }))
      return
    }
    setPicking((prev) => !prev)
  }, [picking, blocks.length, t])

  const visibleTurns: QuickChatMessage[] = streaming && streamText
    ? [...turns, { role: 'assistant', content: streamText }]
    : turns

  if (!open) {
    return (
      <div ref={hostRef}>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 z-40 h-11 w-11 rounded-full shadow-lg"
          onClick={() => setOpen(true)}
          aria-label={t('quickAsk.launcherAria')}
          title={t('quickAsk.launcherAria')}
          data-testid="quick-ask-launcher"
        >
          <MessageSquareText className="h-5 w-5" />
        </Button>
      </div>
    )
  }

  return (
    <div ref={hostRef}>
      <div
        className="quickask-panel fixed inset-y-0 right-0 z-[60] flex w-[420px] max-w-[92vw] flex-col border-l bg-background shadow-2xl"
        role="complementary"
        aria-label={t('quickAsk.title')}
        data-testid="quick-ask-panel"
      >
        {/* 头部 */}
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <MessageSquareText className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-medium">{t('quickAsk.title')}</span>
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setClearOpen(true)}
              disabled={turns.length === 0 || streaming}
              aria-label={t('quickAsk.clear')}
              title={t('quickAsk.clear')}
              data-testid="quick-ask-clear"
            >
              <Eraser className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setOpen(false)}
              aria-label={t('common.close')}
              data-testid="quick-ask-close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* 模型 / 智能体 */}
        <div className="grid grid-cols-2 gap-2 border-b px-3 py-2">
          <Select
            value={modelId || MODEL_DEFAULT}
            onValueChange={(v) => {
              const next = v === MODEL_DEFAULT ? '' : v
              setModelId(next)
              window.localStorage.setItem(LS_MODEL, next)
            }}
            disabled={streaming}
          >
            <SelectTrigger
              className="h-8 text-xs"
              aria-label={t('quickAsk.modelLabel')}
              data-testid="quick-ask-model"
            >
              <SelectValue placeholder={t('quickAsk.modelLabel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={MODEL_DEFAULT}>{t('quickAsk.modelDefault')}</SelectItem>
              {languageModels.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={agentId || AGENT_NONE}
            onValueChange={(v) => {
              const next = v === AGENT_NONE ? '' : v
              setAgentId(next)
              window.localStorage.setItem(LS_AGENT, next)
            }}
            disabled={streaming}
          >
            <SelectTrigger
              className="h-8 text-xs"
              aria-label={t('quickAsk.agentLabel')}
              data-testid="quick-ask-agent"
            >
              <SelectValue placeholder={t('quickAsk.agentLabel')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AGENT_NONE}>{t('quickAsk.agentNone')}</SelectItem>
              {(agents ?? []).map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 消息区 */}
        <ScrollArea className="min-h-0 flex-1">
          <div ref={scrollRef} className="flex flex-col gap-3 px-3 py-3">
            {visibleTurns.length === 0 && !streaming && (
              <div
                className="mt-10 flex flex-col items-center gap-2 text-center text-sm text-muted-foreground"
                data-testid="quick-ask-empty"
              >
                <MessageSquareText className="h-8 w-8 opacity-40" />
                {t('quickAsk.emptyState')}
              </div>
            )}
            {visibleTurns.map((turn, i) => (
              <div
                key={i}
                className={
                  turn.role === 'user'
                    ? 'self-end max-w-[85%] rounded-lg bg-primary/10 px-3 py-2 text-sm'
                    : 'self-start max-w-[95%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm'
                }
                data-testid={`quick-ask-turn-${turn.role}`}
              >
                {turn.contextLabels && turn.contextLabels.length > 0 && (
                  <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Paperclip className="h-3 w-3" />
                    {t('quickAsk.attachBadge', {
                      count: turn.contextLabels.length,
                    })}
                  </div>
                )}
                <div className="whitespace-pre-wrap break-words">{turn.content}</div>
              </div>
            ))}
            {streaming && !streamText && (
              <div
                className="self-start rounded-lg border px-3 py-2 text-sm text-muted-foreground"
                data-testid="quick-ask-waiting"
              >
                {t('quickAsk.generating')}
              </div>
            )}
            {errorKey && (
              <div
                className="self-start rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                data-testid="quick-ask-error"
              >
                {t(ERROR_KEY_BY_REASON[errorKey] ?? 'quickAsk.error.network')}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* 流式指标行（速度/峰值/已用时/已输出，文案复用题库工作台通用键） */}
        {streaming && metrics && (
          <div
            className="flex items-center gap-3 border-t px-3 py-1.5 text-[11px] tabular-nums text-muted-foreground"
            data-testid="quick-ask-metrics"
          >
            <span className="qstream-bar h-0.5 w-16 rounded-full bg-primary/70" />
            <span>{t(`${STREAM_KEY}.speed`, { value: metrics.speedTps.toFixed(1) })}</span>
            <span>{t(`${STREAM_KEY}.elapsed`, { value: formatStreamElapsed(metrics.elapsedMs) })}</span>
            <span>{t(`${STREAM_KEY}.tokens`, { value: metrics.tokens })}</span>
          </div>
        )}

        {/* 页面上下文芯片 */}
        {blocks.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 border-t px-3 py-2"
            data-testid="quick-ask-context"
          >
            {blocks.map((b) => (
              <Badge
                key={b.id}
                variant="outline"
                className="max-w-full gap-1 py-0.5 text-[11px] font-normal"
              >
                <span className="truncate">{b.label}</span>
                <span className="text-muted-foreground">
                  {t('quickAsk.contextChars', { count: b.text.length })}
                </span>
                <button
                  type="button"
                  className="ml-0.5 rounded-full hover:bg-muted"
                  onClick={() => removeBlock(b.id)}
                  aria-label={t('quickAsk.removeContext')}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}

        {/* 输入区 */}
        <div className="border-t p-2">
          <div className="mb-1.5 flex items-center gap-2">
            <Button
              variant={picking ? 'default' : 'outline'}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={togglePicking}
              data-testid="quick-ask-pick"
            >
              <MousePointerClick className="h-3.5 w-3.5" />
              {t('quickAsk.pickElement')}
            </Button>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  void send()
                }
              }}
              placeholder={t('quickAsk.inputPlaceholder')}
              className="max-h-32 min-h-[36px] resize-none text-sm"
              rows={1}
              disabled={streaming}
              data-testid="quick-ask-input"
            />
            {streaming ? (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={stop}
                aria-label={t('quickAsk.stop')}
                title={t('quickAsk.stop')}
                data-testid="quick-ask-stop"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 shrink-0"
                onClick={() => void send()}
                disabled={!input.trim()}
                aria-label={t('quickAsk.send')}
                title={t('quickAsk.send')}
                data-testid="quick-ask-send"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 拾取模式提示条 */}
      {picking && (
        <div
          className="fixed left-1/2 top-4 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm shadow-lg"
          data-testid="quick-ask-pick-hint"
        >
          <MousePointerClick className="h-4 w-4 text-primary" />
          {t('quickAsk.pickHint')}
          <kbd className="rounded border bg-muted px-1.5 py-0.5 text-[11px]">Esc</kbd>
          <Button variant="outline" size="sm" className="h-7" onClick={stopPicking}>
            {t('quickAsk.pickDone')}
          </Button>
        </div>
      )}

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quickAsk.clearTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('quickAsk.clearDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setTurns([])
                persistTurns([])
              }}
              data-testid="quick-ask-clear-confirm"
            >
              {t('quickAsk.clear')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
