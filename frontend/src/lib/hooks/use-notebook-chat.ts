'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { buildChatContextConfig } from '@/lib/utils/source-context'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { chatApi, ChatStreamEvent } from '@/lib/api/chat'
import { useParallelChat } from '@/lib/hooks/use-parallel-chat'
import { QUERY_KEYS } from '@/lib/api/query-client'
import {
  NotebookChatMessage,
  CreateNotebookChatSessionRequest,
  UpdateNotebookChatSessionRequest,
  SourceListResponse,
  NoteResponse,
  ContextBreakdown
} from '@/lib/types/api'
import { ContextSelections } from '@/app/(dashboard)/notebooks/[id]/page'

// Re-arm on every SSE event/byte chunk; only fires when the stream goes
// genuinely silent (same technique as use-parallel-chat).
const STREAM_IDLE_TIMEOUT_MS = 120_000

interface UseNotebookChatParams {
  notebookId: string
  sources: SourceListResponse[]
  notes: NoteResponse[]
  contextSelections: ContextSelections
}

export function useNotebookChat({ notebookId, sources, notes, contextSelections }: UseNotebookChatParams) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<NotebookChatMessage[]>([])
  const [isSending, setIsSending] = useState(false)
  const [tokenCount, setTokenCount] = useState<number>(0)
  const [charCount, setCharCount] = useState<number>(0)
  // Composition breakdown of the assembled context (char shares per segment,
  // with per-message history items). null when the backend predates the field.
  const [contextBreakdown, setContextBreakdown] = useState<ContextBreakdown | null>(null)
  // Pending model override for when user changes model before a session exists
  const [pendingModelOverride, setPendingModelOverride] = useState<string | null>(null)
  // Pending agent binding (PDR-004); mutually exclusive with the model override
  const [pendingAgentOverride, setPendingAgentOverride] = useState<string | null>(null)
  // Pending project env binding (软考项目环境); independent of both
  const [pendingProjectEnv, setPendingProjectEnv] = useState<string | null>(null)
  // Parallel answers (PDR-004): live fan-out state shared with the composer
  const parallel = useParallelChat()
  // Single-run token streaming: the accumulating text lives in its own state
  // (never a per-token setMessages — that would re-run groupParallelMessages
  // and re-map the whole list on every chunk). null = not streaming.
  const [streamingContent, setStreamingContent] = useState<string | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamMountedRef = useRef(false)

  // Unmount safety (use-parallel-chat technique): clear the watchdog and
  // abort any in-flight stream so nothing leaks past the component lifetime.
  useEffect(() => {
    streamMountedRef.current = true
    return () => {
      streamMountedRef.current = false
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current)
      streamAbortRef.current?.abort()
    }
  }, [])

  // Fetch sessions for this notebook
  const {
    data: sessions = [],
    isLoading: loadingSessions,
    refetch: refetchSessions
  } = useQuery({
    queryKey: QUERY_KEYS.notebookChatSessions(notebookId),
    queryFn: () => chatApi.listSessions(notebookId),
    enabled: !!notebookId
  })

  // Fetch current session with messages
  const {
    data: currentSession,
    refetch: refetchCurrentSession
  } = useQuery({
    queryKey: QUERY_KEYS.notebookChatSession(currentSessionId!),
    queryFn: () => chatApi.getSession(currentSessionId!),
    enabled: !!notebookId && !!currentSessionId
  })

  // Update messages when current session changes
  useEffect(() => {
    if (currentSession?.messages) {
      setMessages(currentSession.messages)
    }
  }, [currentSession])

  // Auto-select most recent session when sessions are loaded
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId) {
      // Sessions are sorted by created date desc from API
      const mostRecentSession = sessions[0]
      setCurrentSessionId(mostRecentSession.id)
    }
  }, [sessions, currentSessionId])

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (data: CreateNotebookChatSessionRequest) =>
      chatApi.createSession(data),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      setCurrentSessionId(newSession.id)
      toast.success(t('chat.sessionCreated'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
    }
  })

  // Update session mutation
  const updateSessionMutation = useMutation({
    mutationFn: ({ sessionId, data }: {
      sessionId: string
      data: UpdateNotebookChatSessionRequest
    }) => chatApi.updateSession(sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSession(currentSessionId!)
      })
      toast.success(t('chat.sessionUpdated'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToUpdateSession'))
    }
  })

  // Delete session mutation
  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) =>
      chatApi.deleteSession(sessionId),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      if (currentSessionId === deletedId) {
        setCurrentSessionId(null)
        setMessages([])
      }
      toast.success(t('sessions.sessionDeleted'))
    },
    onError: (err: unknown) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToDeleteSession'))
    }
  })

  // Build context from the selection maps (the context picker may include
  // sources that paginated listings have not loaded yet). An explicit session
  // id (or the current one) asks the backend to include the session history in
  // the breakdown; servers without the field simply ignore it.
  const buildContext = useCallback(async (sessionId?: string) => {
    const context_config = buildChatContextConfig(
      contextSelections,
      sources.map(source => source.id),
      notes.map(note => note.id),
    )

    // Call API to build context with actual content
    const response = await chatApi.buildContext({
      notebook_id: notebookId,
      context_config,
      session_id: sessionId ?? currentSessionId ?? undefined,
    })

    // Store token and char counts
    setTokenCount(response.token_count)
    setCharCount(response.char_count)
    setContextBreakdown(response.breakdown ?? null)

    return response.context
  }, [notebookId, sources, notes, contextSelections, currentSessionId])

  // Refresh only the composition breakdown (same call as buildContext); the
  // auto-refresh effect below already fires on selection/session changes, this
  // covers the post-mutation and post-send refreshes.
  const refreshContextBreakdown = useCallback(async (sessionId?: string) => {
    try {
      await buildContext(sessionId)
    } catch (error) {
      console.error('Error refreshing context breakdown:', error)
    }
  }, [buildContext])

  // History editing mutations (context breakdown dialog entries). Optimistic
  // update first; on failure reconcile against the session checkpoint (the
  // authoritative source) instead of hand-rolling a rollback snapshot.
  const deleteMessagesMutation = useMutation({
    mutationFn: ({ sessionId, messageIds }: { sessionId: string; messageIds: string[] }) =>
      chatApi.deleteChatMessages(sessionId, { message_ids: messageIds }),
    onMutate: ({ sessionId, messageIds }) => {
      if (sessionId !== currentSessionId) return
      const doomed = new Set(messageIds)
      setMessages(prev => prev.filter(message => !doomed.has(message.id)))
    },
    onSuccess: (data, { sessionId }) => {
      // Authoritative replace with what the checkpoint actually retains.
      if (sessionId === currentSessionId) setMessages(data.messages)
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSession(sessionId)
      })
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      refreshContextBreakdown(sessionId)
      toast.success(t('sessions.messageDeleted', { count: data.deleted_count }))
    },
    onError: (err: unknown, { sessionId }) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(t('sessions.messageDeleteFailed'), {
        description: getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.genericError')
      })
      if (sessionId === currentSessionId) void refetchCurrentSession()
    }
  })

  const clearMessagesMutation = useMutation({
    mutationFn: (sessionId: string) => chatApi.clearChatMessages(sessionId),
    onMutate: (sessionId) => {
      if (sessionId === currentSessionId) setMessages([])
    },
    onSuccess: (data, sessionId) => {
      if (sessionId === currentSessionId) setMessages(data.messages)
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSession(sessionId)
      })
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      refreshContextBreakdown(sessionId)
      toast.success(t('sessions.messagesCleared'))
    },
    onError: (err: unknown, sessionId) => {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(t('sessions.clearFailed'), {
        description: getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.genericError')
      })
      if (sessionId === currentSessionId) void refetchCurrentSession()
    }
  })

  // Auto-create a session if none exists (shared by the single-run and
  // parallel send paths); returns null on failure after toasting.
  const ensureSessionId = useCallback(async (message: string): Promise<string | null> => {
    if (currentSessionId) return currentSessionId
    try {
      const defaultTitle = message.length > 30
        ? `${message.substring(0, 30)}...`
        : message
      const newSession = await chatApi.createSession({
        notebook_id: notebookId,
        title: defaultTitle,
        // Include pending model override when creating session
        model_override: pendingModelOverride ?? undefined,
        agent: pendingAgentOverride ?? undefined,
        project_env: pendingProjectEnv ?? undefined
      })
      setCurrentSessionId(newSession.id)
      // Clear pending bindings now that they are applied to the session
      setPendingModelOverride(null)
      setPendingAgentOverride(null)
      setPendingProjectEnv(null)
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.notebookChatSessions(notebookId)
      })
      return newSession.id
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
      return null
    }
  }, [currentSessionId, notebookId, pendingModelOverride, pendingAgentOverride, pendingProjectEnv, queryClient, t])

  // Send message (token-streamed over SSE; /chat/execute stays as the
  // compatibility/rollback path on the backend). Signature unchanged.
  const sendMessage = useCallback(async (message: string, modelOverride?: string) => {
    const sessionId = await ensureSessionId(message)
    if (!sessionId) return

    // Add user message optimistically
    const userMessage: NotebookChatMessage = {
      id: `temp-${Date.now()}`,
      type: 'human',
      content: message,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, userMessage])
    setIsSending(true)
    setStreamingContent('')

    const abortController = new AbortController()
    streamAbortRef.current = abortController

    const clearStreamTimeout = () => {
      if (streamTimeoutRef.current) {
        clearTimeout(streamTimeoutRef.current)
        streamTimeoutRef.current = null
      }
    }
    // 120s idle watchdog; re-armed on every SSE event AND every received
    // byte chunk (so the backend's 15s `: ping` keep-alive counts).
    const armStreamTimeout = () => {
      clearStreamTimeout()
      streamTimeoutRef.current = setTimeout(() => {
        abortController.abort()
      }, STREAM_IDLE_TIMEOUT_MS)
    }

    try {
      // Build context and send message (session id included so the breakdown
      // reflects this session's history)
      const context = await buildContext(sessionId)

      // Flow state as local variables (useState would stale-close inside
      // the SSE event callback).
      let sawComplete = false
      let streamError: string | null = null
      const onEvent = (ev: ChatStreamEvent) => {
        armStreamTimeout()
        if (ev.type === 'delta') {
          if (streamMountedRef.current) {
            setStreamingContent(prev => (prev ?? '') + ev.content)
          }
        } else if (ev.type === 'complete') {
          sawComplete = true
          if (streamMountedRef.current) {
            setStreamingContent(null)
            // Authoritative replace, same semantics as the old sync path.
            setMessages(ev.messages)
          }
        } else if (ev.type === 'error') {
          streamError = ev.message
        }
      }

      armStreamTimeout()
      await chatApi.streamRun(
        sessionId,
        {
          message,
          context,
          model_override: modelOverride ?? (currentSession?.model_override ?? undefined),
          agent_override: currentSession?.agent ?? undefined
        },
        onEvent,
        abortController.signal,
        armStreamTimeout
      )

      if (sawComplete) {
        // Refetch only after the stream ended (same ordering as before);
        // complete already replaced the message list authoritatively.
        await refetchCurrentSession()
      } else {
        // error event or the stream was cut before complete
        throw new Error(streamError || 'Chat stream ended without completing')
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // User stop or idle watchdog: reconcile so the optimistic temp- user
        // message is replaced by the backend's authoritative copy.
        await refetchCurrentSession()
        return
      }
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Error sending message:', error)
      const detail = error.response?.data?.detail || error.message || ''
      if (detail.includes('already in progress')) {
        // 409 in-flight guard: a generation is already running for this session
        toast.error(t('chat.streamBusy'))
      } else {
        toast.error(t('chat.streamFailed'), {
          description: getApiErrorMessage(detail, (key) => t(key))
        })
      }
      // Always reconcile with the checkpoint: the backend has almost
      // certainly already stored the user message (input application writes
      // it before generation), so deleting only the temp- message would
      // desync the UI from the session state.
      await refetchCurrentSession()
    } finally {
      setIsSending(false)
      setStreamingContent(null)
      clearStreamTimeout()
      streamAbortRef.current = null
      // History changed with this send: refresh the composition breakdown
      // with the local session id (the closure-safe one, not the state that
      // may still be null for a first-message auto-created session).
      void refreshContextBreakdown(sessionId)
    }
  }, [
    currentSession,
    ensureSessionId,
    buildContext,
    refreshContextBreakdown,
    refetchCurrentSession,
    t
  ])

  // User-visible stop for the in-flight stream (streaming bar's stop button);
  // aborts the SSE fetch; the send path's AbortError branch reconciles state.
  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort()
  }, [])

  // Parallel answers (PDR-004): fan one question out to 2-5 participants.
  // The live cards come from the parallel hook; the archived group lands in
  // the session history and a refetch renders the authoritative copy.
  const sendParallelMessage = useCallback(async (message: string, runs: string[]) => {
    const sessionId = await ensureSessionId(message)
    if (!sessionId) return
    const context = await buildContext(sessionId)
    await parallel.start(sessionId, message, runs, context, refetchCurrentSession)
  }, [ensureSessionId, buildContext, parallel, refetchCurrentSession])

  const synthesizeParallel = useCallback(
    (participant: { agent?: string; model?: string }, instruction?: string) => {
      if (!currentSessionId) return Promise.resolve()
      return parallel.synthesize(currentSessionId, participant, instruction)
    },
    [currentSessionId, parallel]
  )

  // Switch session
  const switchSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
  }, [])

  // Create session (optionally bound to a project env right away)
  const createSession = useCallback((title?: string, projectEnv?: string) => {
    return createSessionMutation.mutate({
      notebook_id: notebookId,
      title,
      project_env: projectEnv
    })
  }, [createSessionMutation, notebookId])

  // Update session
  const updateSession = useCallback((sessionId: string, data: UpdateNotebookChatSessionRequest) => {
    return updateSessionMutation.mutate({
      sessionId,
      data
    })
  }, [updateSessionMutation])

  // Delete session
  const deleteSession = useCallback((sessionId: string) => {
    return deleteSessionMutation.mutate(sessionId)
  }, [deleteSessionMutation])

  // History editing (context breakdown dialog): delete selected messages /
  // clear the whole history of a session.
  const deleteMessages = useCallback((sessionId: string, messageIds: string[]) => {
    return deleteMessagesMutation.mutate({ sessionId, messageIds })
  }, [deleteMessagesMutation])

  const clearMessages = useCallback((sessionId: string) => {
    return clearMessagesMutation.mutate(sessionId)
  }, [clearMessagesMutation])

  // Set model override - handles both existing sessions and pending state.
  // The backend clears the session's agent binding when a model is set
  // (mutual exclusion); the pending branch mirrors that locally.
  const setModelOverride = useCallback((model: string | null) => {
    if (currentSessionId) {
      // Session exists - update it directly
      updateSessionMutation.mutate({
        sessionId: currentSessionId,
        data: { model_override: model }
      })
    } else {
      // No session yet - store as pending
      setPendingModelOverride(model)
      setPendingAgentOverride(null)
    }
  }, [currentSessionId, updateSessionMutation])

  // Set agent binding (PDR-004) - mirrors setModelOverride; the backend
  // clears model_override when an agent is set.
  const setAgentOverride = useCallback((agent: string | null) => {
    if (currentSessionId) {
      updateSessionMutation.mutate({
        sessionId: currentSessionId,
        data: { agent }
      })
    } else {
      setPendingAgentOverride(agent)
      setPendingModelOverride(null)
    }
  }, [currentSessionId, updateSessionMutation])

  // Set project env binding (软考项目环境) - independent of agent/model.
  const setProjectEnv = useCallback((env: string | null) => {
    if (currentSessionId) {
      updateSessionMutation.mutate({
        sessionId: currentSessionId,
        data: { project_env: env }
      })
    } else {
      setPendingProjectEnv(env)
    }
  }, [currentSessionId, updateSessionMutation])

  // Update token/char counts when context selections change
  useEffect(() => {
    const updateContextCounts = async () => {
      try {
        await buildContext()
      } catch (error) {
        console.error('Error updating context counts:', error)
      }
    }
    updateContextCounts()
  }, [buildContext])

  return {
    // State
    sessions,
    currentSession: currentSession || sessions.find(s => s.id === currentSessionId),
    currentSessionId,
    messages,
    isSending,
    // Live streaming text (null when idle); the waiting/streaming bubble in
    // ChatPanel renders it as plain text + cursor while isSending is true.
    streamingMessage: streamingContent === null ? null : { content: streamingContent },
    loadingSessions,
    isDeletingSession: deleteSessionMutation.isPending,
    tokenCount,
    charCount,
    // Composition breakdown (null when the backend has no breakdown yet)
    contextBreakdown,
    isDeletingMessages: deleteMessagesMutation.isPending,
    isClearingMessages: clearMessagesMutation.isPending,
    pendingModelOverride,
    pendingAgentOverride,
    pendingProjectEnv,

    // Actions
    createSession,
    updateSession,
    deleteSession,
    switchSession,
    sendMessage,
    stopStreaming,
    setModelOverride,
    setAgentOverride,
    setProjectEnv,
    deleteMessages,
    clearMessages,
    refreshContextBreakdown,
    parallel,
    sendParallelMessage,
    synthesizeParallel,
    refetchSessions
  }
}
