'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { chatApi, ParallelStreamEvent } from '@/lib/api/chat'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'

// Re-arm on every SSE chunk; only fires when the stream goes genuinely
// silent (0 disables the watchdog entirely).
const STREAM_IDLE_TIMEOUT_MS = 120_000

// run_delta frames coalesce on a trailing timer: setState at most ~20×/s no
// matter the token rate or how many runs interleave in one reader chunk.
const DELTA_FLUSH_MS = 50

export interface ParallelRunState {
  key: string
  kind: 'default' | 'agent' | 'model'
  name: string
  status: 'pending' | 'streaming' | 'done' | 'error'
  /** run_complete's authoritative full text. */
  content?: string
  /** Raw deltaText aggregation — streaming preview only, unfiltered <think>. */
  deltaText?: string
  error?: string
  model_name?: string | null
  agent_name?: string | null
}

export type ParallelPhase = 'idle' | 'running' | 'done'

export interface SynthesisState {
  content: string
  model_name: string | null
  agent_name: string | null
}

interface UseParallelChatResult {
  phase: ParallelPhase
  runs: ParallelRunState[]
  groupId: string | null
  synthesis: SynthesisState | null
  isSynthesizing: boolean
  /** Live view state; the authoritative copy lives in the session history. */
  start: (
    sessionId: string,
    message: string,
    runs: string[],
    context: Record<string, unknown>,
    onArchived?: () => void
  ) => Promise<void>
  cancel: () => void
  reset: () => void
  synthesize: (
    sessionId: string,
    participant: { agent?: string; model?: string },
    instruction?: string
  ) => Promise<void>
}

export function useParallelChat(): UseParallelChatResult {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<ParallelPhase>('idle')
  const [runs, setRuns] = useState<ParallelRunState[]>([])
  const [groupId, setGroupId] = useState<string | null>(null)
  const [synthesis, setSynthesis] = useState<SynthesisState | null>(null)
  const [isSynthesizing, setIsSynthesizing] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deltaBufRef = useRef<Map<string, string>>(new Map())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current)
      deltaBufRef.current.clear()
      abortRef.current?.abort()
    }
  }, [])

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const clearDeltaFlush = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    deltaBufRef.current.clear()
  }, [])

  const flushDeltas = useCallback(() => {
    flushTimerRef.current = null
    const buf = deltaBufRef.current
    if (buf.size === 0) return
    deltaBufRef.current = new Map()
    setRuns((prev) =>
      prev.map((r) => {
        const chunk = buf.get(r.key)
        // Unchanged runs keep their reference so memoized cards skip render.
        if (chunk === undefined) return r
        return {
          ...r,
          status: r.status === 'pending' ? 'streaming' : r.status,
          deltaText: (r.deltaText ?? '') + chunk,
        }
      })
    )
  }, [])

  const scheduleDeltaFlush = useCallback(() => {
    if (flushTimerRef.current !== null) return
    flushTimerRef.current = setTimeout(flushDeltas, DELTA_FLUSH_MS)
  }, [flushDeltas])

  const armTimeout = useCallback(() => {
    clearTimeout_()
    if (STREAM_IDLE_TIMEOUT_MS <= 0) return
    timeoutRef.current = setTimeout(() => {
      abortRef.current?.abort()
      if (mountedRef.current) {
        setPhase((prev) => (prev === 'running' ? 'done' : prev))
      }
    }, STREAM_IDLE_TIMEOUT_MS)
  }, [clearTimeout_])

  const cancel = useCallback(() => {
    clearTimeout_()
    clearDeltaFlush()
    abortRef.current?.abort()
    abortRef.current = null
    if (mountedRef.current) setPhase('done')
  }, [clearDeltaFlush, clearTimeout_])

  const reset = useCallback(() => {
    clearTimeout_()
    clearDeltaFlush()
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setRuns([])
    setGroupId(null)
    setSynthesis(null)
  }, [clearDeltaFlush, clearTimeout_])

  const start = useCallback(
    async (
      sessionId: string,
      message: string,
      runKeys: string[],
      context: Record<string, unknown>,
      onArchived?: () => void
    ) => {
      abortRef.current?.abort()
      abortRef.current = new AbortController()
      setPhase('running')
      // Optimistically materialize pending cards from the run keys so the
      // grid never renders 0/0 while runs_started is still in flight; kind
      // parsing mirrors the backend's `_parse_run_key`.
      setRuns(
        runKeys.map((key) => ({
          key,
          kind: key === 'default' ? ('default' as const) : key.startsWith('agent:') ? ('agent' as const) : ('model' as const),
          // Temporary stand-in name; runs_started swaps in display names.
          name: key,
          status: 'pending' as const,
        }))
      )
      setGroupId(null)
      setSynthesis(null)
      armTimeout()

      const handleEvent = (event: ParallelStreamEvent) => {
        // Watchdog first: every event (deltas included) re-arms the idle timer.
        armTimeout()
        if (event.type === 'runs_started') {
          setGroupId(event.group_id ?? null)
          // Authoritative roster: new array from event.runs; early-arrived
          // streaming state per key is kept so a fast first delta survives.
          setRuns((prev) =>
            (event.runs ?? []).map((r) => {
              const existing = prev.find((p) => p.key === r.key)
              return existing
                ? { ...existing, kind: r.kind, name: r.name }
                : { key: r.key, kind: r.kind, name: r.name, status: 'pending' as const }
            })
          )
        } else if (event.type === 'run_delta') {
          if (!event.key) return
          deltaBufRef.current.set(
            event.key,
            (deltaBufRef.current.get(event.key) ?? '') + (event.delta ?? '')
          )
          scheduleDeltaFlush()
        } else if (event.type === 'run_complete') {
          // Full text is authoritative: drop any unflushed delta residue so a
          // late timer can't append dirty text after done.
          if (event.key) deltaBufRef.current.delete(event.key)
          setRuns((prev) =>
            prev.map((r) =>
              r.key === event.key
                ? {
                    ...r,
                    status: 'done',
                    content: event.content,
                    model_name: event.model_name,
                    agent_name: event.agent_name,
                    deltaText: undefined,
                  }
                : r
            )
          )
        } else if (event.type === 'run_error') {
          if (event.key) deltaBufRef.current.delete(event.key)
          setRuns((prev) =>
            prev.map((r) =>
              r.key === event.key
                ? { ...r, status: 'error', error: event.message, deltaText: undefined }
                : r
            )
          )
        } else if (event.type === 'archived') {
          onArchived?.()
        }
      }

      try {
        await chatApi.parallelRun(
          sessionId,
          { message, runs: runKeys, context },
          handleEvent,
          abortRef.current.signal
        )
        if (mountedRef.current) setPhase('done')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        const err = error as { response?: { data?: { detail?: string } }; message?: string }
        console.error('Parallel chat failed:', error)
        toast.error(t('chat.parallelFailed'), {
          description: getApiErrorMessage(
            err.response?.data?.detail || err.message || '',
            (key) => t(key)
          ),
        })
        if (mountedRef.current) setPhase('done')
      } finally {
        clearTimeout_()
      }
    },
    [armTimeout, clearTimeout_, scheduleDeltaFlush, t]
  )

  const synthesize = useCallback(
    async (
      sessionId: string,
      participant: { agent?: string; model?: string },
      instruction?: string
    ) => {
      if (!groupId) return
      setIsSynthesizing(true)
      try {
        const result = await chatApi.synthesize(sessionId, {
          group_id: groupId,
          instruction,
          ...participant,
        })
        if (mountedRef.current) {
          setSynthesis({
            content: result.content,
            model_name: result.model_name,
            agent_name: result.agent_name,
          })
        }
      } catch (error) {
        const err = error as { response?: { data?: { detail?: string } }; message?: string }
        toast.error(t('chat.synthesisFailed'), {
          description: getApiErrorMessage(
            err.response?.data?.detail || err.message || '',
            (key) => t(key)
          ),
        })
      } finally {
        if (mountedRef.current) setIsSynthesizing(false)
      }
    },
    [groupId, t]
  )

  return {
    phase,
    runs,
    groupId,
    synthesis,
    isSynthesizing,
    start,
    cancel,
    reset,
    synthesize,
  }
}
