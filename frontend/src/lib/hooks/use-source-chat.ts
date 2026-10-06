'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiErrorMessage } from '@/lib/utils/error-handler'
import { useTranslation } from '@/lib/hooks/use-translation'
import { sourceChatApi } from '@/lib/api/source-chat'
import { chatApi } from '@/lib/api/chat'
import {
  SourceChatSession,
  SourceChatMessage,
  SourceChatContextIndicator,
  CreateSourceChatSessionRequest,
  UpdateSourceChatSessionRequest
} from '@/lib/types/api'

export function useSourceChat(sourceId: string) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<SourceChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [contextIndicators, setContextIndicators] = useState<SourceChatContextIndicator | null>(null)
  // Pending project env binding (软考项目环境): the source-chat create
  // endpoint has no project_env field, so it is applied right after the
  // session auto-creates via the unified /chat/sessions PUT.
  const [pendingProjectEnv, setPendingProjectEnv] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Fetch sessions
  const { data: sessions = [], isLoading: loadingSessions, refetch: refetchSessions } = useQuery<SourceChatSession[]>({
    queryKey: ['sourceChatSessions', sourceId],
    queryFn: () => sourceChatApi.listSessions(sourceId),
    enabled: !!sourceId
  })

  // Fetch current session with messages
  const { data: currentSession, refetch: refetchCurrentSession } = useQuery({
    queryKey: ['sourceChatSession', sourceId, currentSessionId],
    queryFn: () => sourceChatApi.getSession(sourceId, currentSessionId!),
    enabled: !!sourceId && !!currentSessionId
  })

  // Update messages when session changes
  useEffect(() => {
    if (currentSession?.messages) {
      setMessages(currentSession.messages)
    }
    // Also clears the badge when the session goes away (deleted / switched).
    setContextIndicators(currentSession?.context_indicators ?? null)
  }, [currentSession])

  // Auto-select most recent session when sessions are loaded
  useEffect(() => {
    if (sessions.length > 0 && !currentSessionId) {
      // Find most recent session (sessions are sorted by created date desc from API)
      const mostRecentSession = sessions[0]
      setCurrentSessionId(mostRecentSession.id)
    }
  }, [sessions, currentSessionId])

  // Create session mutation
  const createSessionMutation = useMutation({
    mutationFn: (data: Omit<CreateSourceChatSessionRequest, 'source_id'>) => 
      sourceChatApi.createSession(sourceId, data),
    onSuccess: (newSession) => {
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
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
    mutationFn: ({ sessionId, data }: { sessionId: string, data: UpdateSourceChatSessionRequest }) =>
      sourceChatApi.updateSession(sourceId, sessionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
      queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, currentSessionId] })
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
      sourceChatApi.deleteSession(sourceId, sessionId),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
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

  // History editing (message-bubble delete / clear): same optimistic-then-
  // authoritative flow as the notebook chat hook — the checkpoint response is
  // the single source of truth, failures reconcile via a session refetch.
  const deleteMessagesMutation = useMutation({
    mutationFn: ({ sessionId, messageIds }: { sessionId: string; messageIds: string[] }) =>
      sourceChatApi.deleteMessages(sessionId, { message_ids: messageIds }),
    onMutate: ({ sessionId, messageIds }) => {
      if (sessionId !== currentSessionId) return
      const doomed = new Set(messageIds)
      setMessages(prev => prev.filter(message => !doomed.has(message.id)))
    },
    onSuccess: (data, { sessionId }) => {
      // Authoritative replace with what the checkpoint actually retains.
      if (sessionId === currentSessionId) setMessages(data.messages)
      queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
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
    mutationFn: (sessionId: string) => sourceChatApi.clearMessages(sessionId),
    onMutate: (sessionId) => {
      if (sessionId === currentSessionId) setMessages([])
    },
    onSuccess: (data, sessionId) => {
      if (sessionId === currentSessionId) setMessages(data.messages)
      queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, sessionId] })
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
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

  // Send message with streaming
  const sendMessage = useCallback(async (message: string, modelOverride?: string) => {
    let sessionId = currentSessionId

    // Auto-create session if none exists
    if (!sessionId) {
      try {
        const defaultTitle = message.length > 30 ? `${message.substring(0, 30)}...` : message
        const newSession = await sourceChatApi.createSession(sourceId, { title: defaultTitle })
        sessionId = newSession.id
        setCurrentSessionId(sessionId)
        if (pendingProjectEnv) {
          // Best-effort backfill through the unified chat endpoint; a
          // failure here must not block the message send.
          try {
            await chatApi.updateSession(sessionId, { project_env: pendingProjectEnv })
          } catch (bindError) {
            console.error('Failed to bind project env to new session:', bindError)
          }
          setPendingProjectEnv(null)
        }
        queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
      } catch (err: unknown) {
        const error = err as { response?: { data?: { detail?: string } }, message?: string };
        console.error('Failed to create chat session:', error)
        toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
        return
      }
    }

    // Add user message optimistically
    const userMessage: SourceChatMessage = {
      id: `temp-${Date.now()}`,
      type: 'human',
      content: message,
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, userMessage])
    setIsStreaming(true)

    try {
      const response = await sourceChatApi.sendMessage(sourceId, sessionId, {
        message,
        model_override: modelOverride
      })

      if (!response) {
        throw new Error('No response body')
      }

      const reader = response.getReader()
      const decoder = new TextDecoder()
      let aiMessage: SourceChatMessage | null = null
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const jsonStr = line.slice(6).trim()
              if (!jsonStr) continue

              const data = JSON.parse(jsonStr)
              
              if (data.type === 'ai_message') {
                // Create AI message on first content chunk to avoid empty bubble
                if (!aiMessage) {
                  aiMessage = {
                    id: `ai-${Date.now()}`,
                    type: 'ai',
                    content: data.content || '',
                    timestamp: new Date().toISOString()
                  }
                  setMessages(prev => [...prev, aiMessage!])
                } else {
                  aiMessage.content += data.content || ''
                  setMessages(prev =>
                    prev.map(msg => msg.id === aiMessage!.id
                      ? { ...msg, content: aiMessage!.content }
                      : msg
                    )
                  )
                }
              } else if (data.type === 'context_indicators') {
                setContextIndicators(data.data)
              } else if (data.type === 'error') {
                throw new Error(data.message || 'Stream error')
              }
            } catch (e) {
              if (e instanceof SyntaxError) {
                console.error('Error parsing SSE data:', e)
              } else {
                throw e
              }
            }
          }
        }
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }, message?: string };
      console.error('Error sending message:', error)
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToSendMessage'))
      // Remove optimistic messages on error
      setMessages(prev => prev.filter(msg => !msg.id.startsWith('temp-')))
    } finally {
      setIsStreaming(false)
      // Refetch session to get persisted messages
      refetchCurrentSession()
    }
  }, [sourceId, currentSessionId, pendingProjectEnv, refetchCurrentSession, queryClient, t])

  // Cancel streaming
  const cancelStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsStreaming(false)
    }
  }, [])

  // Switch session
  const switchSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId)
    setContextIndicators(null)
  }, [])

  // Create session
  const createSession = useCallback((data: Omit<CreateSourceChatSessionRequest, 'source_id'>) => {
    return createSessionMutation.mutate(data)
  }, [createSessionMutation])

  // Update session
  const updateSession = useCallback((sessionId: string, data: UpdateSourceChatSessionRequest) => {
    return updateSessionMutation.mutate({ sessionId, data })
  }, [updateSessionMutation])

  // Delete session
  const deleteSession = useCallback((sessionId: string) => {
    return deleteSessionMutation.mutate(sessionId)
  }, [deleteSessionMutation])

  // Set project env binding: existing sessions go through the unified
  // /chat/sessions PUT (the source-chat PUT has no project_env field).
  const setProjectEnv = useCallback((env: string | null) => {
    if (currentSessionId) {
      chatApi
        .updateSession(currentSessionId, { project_env: env })
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
          queryClient.invalidateQueries({ queryKey: ['sourceChatSession', sourceId, currentSessionId] })
        })
        .catch((err: unknown) => {
          const error = err as { response?: { data?: { detail?: string } }, message?: string }
          toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToUpdateSession'))
        })
    } else {
      setPendingProjectEnv(env)
    }
  }, [currentSessionId, queryClient, sourceId, t])

  // Create a fresh session already bound to a project env (switch-dialog
  // "new session" option).
  const createSessionWithProjectEnv = useCallback(async (envId: string) => {
    try {
      const newSession = await sourceChatApi.createSession(sourceId, {})
      await chatApi.updateSession(newSession.id, { project_env: envId })
      setCurrentSessionId(newSession.id)
      setPendingProjectEnv(null)
      queryClient.invalidateQueries({ queryKey: ['sourceChatSessions', sourceId] })
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } }, message?: string }
      toast.error(getApiErrorMessage(error.response?.data?.detail || error.message, (key) => t(key), 'apiErrors.failedToCreateSession'))
    }
  }, [sourceId, queryClient, t])

  // History editing: delete selected messages / clear the whole history of a
  // session (checkpoint hard-delete behind the scenes).
  const deleteMessages = useCallback((sessionId: string, messageIds: string[]) => {
    return deleteMessagesMutation.mutate({ sessionId, messageIds })
  }, [deleteMessagesMutation])

  const clearMessages = useCallback((sessionId: string) => {
    return clearMessagesMutation.mutate(sessionId)
  }, [clearMessagesMutation])

  return {
    // State
    sessions,
    currentSession: sessions.find(s => s.id === currentSessionId),
    currentSessionId,
    messages,
    isStreaming,
    contextIndicators,
    loadingSessions,
    pendingProjectEnv,
    isDeletingSession: deleteSessionMutation.isPending,
    isDeletingMessages: deleteMessagesMutation.isPending,
    isClearingMessages: clearMessagesMutation.isPending,

    // Actions
    createSession,
    updateSession,
    deleteSession,
    deleteMessages,
    clearMessages,
    switchSession,
    sendMessage,
    cancelStreaming,
    setProjectEnv,
    createSessionWithProjectEnv,
    refetchSessions
  }
}
