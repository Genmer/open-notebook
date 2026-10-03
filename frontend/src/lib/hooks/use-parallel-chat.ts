'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { chatApi, ParallelStreamEvent } from '@/lib/api/chat'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'

// Re-arm on every SSE chunk; only fires when the stream goes genuinely
// silent (0 disables the watchdog entirely).
const STREAM_IDLE_TIMEOUT_MS = 120_000

export interface ParallelRunState {
  key: string
  kind: 'default' | 'agent' | 'model'
  name: string
  status: 'pending' | 'done' | 'error'
  content?: string
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
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      abortRef.current?.abort()
    }
  }, [])

  const clearTimeout_ = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

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
    abortRef.current?.abort()
    abortRef.current = null
    if (mountedRef.current) setPhase('done')
  }, [clearTimeout_])

  const reset = useCallback(() => {
    clearTimeout_()
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setRuns([])
    setGroupId(null)
    setSynthesis(null)
  }, [clearTimeout_])

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
      setRuns([])
      setGroupId(null)
      setSynthesis(null)
      armTimeout()

      const handleEvent = (event: ParallelStreamEvent) => {
        armTimeout()
        if (event.type === 'runs_started') {
          setGroupId(event.group_id ?? null)
          setRuns(
            (event.runs ?? []).map((r) => ({
              key: r.key,
              kind: r.kind,
              name: r.name,
              status: 'pending',
            }))
          )
        } else if (event.type === 'run_complete') {
          setRuns((prev) =>
            prev.map((r) =>
              r.key === event.key
                ? {
                    ...r,
                    status: 'done',
                    content: event.content,
                    model_name: event.model_name,
                    agent_name: event.agent_name,
                  }
                : r
            )
          )
        } else if (event.type === 'run_error') {
          setRuns((prev) =>
            prev.map((r) =>
              r.key === event.key
                ? { ...r, status: 'error', error: event.message }
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
    [armTimeout, clearTimeout_, t]
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
