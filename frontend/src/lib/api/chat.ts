import apiClient from './client'
import { getAuthToken } from '@/lib/auth-token'
import {
  NotebookChatSession,
  NotebookChatSessionWithMessages,
  CreateNotebookChatSessionRequest,
  UpdateNotebookChatSessionRequest,
  SendNotebookChatMessageRequest,
  NotebookChatMessage,
  BuildContextRequest,
  BuildContextResponse,
} from '@/lib/types/api'

export interface ParallelRunStarted {
  key: string
  kind: 'default' | 'agent' | 'model'
  name: string
}

export interface ParallelStreamEvent {
  type:
    | 'runs_started'
    | 'run_complete'
    | 'run_error'
    | 'archived'
    | 'complete'
    | 'error'
  group_id?: string
  runs?: ParallelRunStarted[]
  key?: string
  name?: string
  message?: string
  content?: string
  model_name?: string | null
  agent_name?: string | null
  messages?: NotebookChatMessage[]
}

export interface SynthesizeRequest {
  group_id: string
  instruction?: string
  agent?: string
  model?: string
}

export interface SynthesizeResponse {
  group_id: string
  content: string
  model_name: string | null
  agent_name: string | null
}

export const chatApi = {
  // Session management
  listSessions: async (notebookId: string) => {
    const response = await apiClient.get<NotebookChatSession[]>(
      `/chat/sessions`,
      { params: { notebook_id: notebookId } }
    )
    return response.data
  },

  createSession: async (data: CreateNotebookChatSessionRequest) => {
    const response = await apiClient.post<NotebookChatSession>(
      `/chat/sessions`,
      data
    )
    return response.data
  },

  getSession: async (sessionId: string) => {
    const response = await apiClient.get<NotebookChatSessionWithMessages>(
      `/chat/sessions/${sessionId}`
    )
    return response.data
  },

  updateSession: async (sessionId: string, data: UpdateNotebookChatSessionRequest) => {
    const response = await apiClient.put<NotebookChatSession>(
      `/chat/sessions/${sessionId}`,
      data
    )
    return response.data
  },

  deleteSession: async (sessionId: string) => {
    await apiClient.delete(`/chat/sessions/${sessionId}`)
  },

  // Messaging (synchronous, no streaming)
  sendMessage: async (data: SendNotebookChatMessageRequest) => {
    const response = await apiClient.post<{
      session_id: string
      messages: NotebookChatMessage[]
    }>(
      `/chat/execute`,
      data
    )
    return response.data
  },

  buildContext: async (data: BuildContextRequest) => {
    const response = await apiClient.post<BuildContextResponse>(
      `/chat/context`,
      data
    )
    return response.data
  },

  // Parallel answers (PDR-004): one SSE stream fanning out to N participants.
  // Relative URL + fetch like searchApi.askKnowledgeBase (dev proxy & Docker).
  parallelRun: async (
    sessionId: string,
    data: { message: string; context: Record<string, unknown>; runs: string[] },
    onEvent: (event: ParallelStreamEvent) => void,
    signal?: AbortSignal
  ) => {
    const token = getAuthToken()
    const response = await fetch(`/api/chat/sessions/${sessionId}/parallel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(data),
      signal,
    })
    if (!response.ok) {
      let errorMessage = `HTTP error! status: ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.detail || errorData.message || errorMessage
      } catch {
        errorMessage = response.statusText || errorMessage
      }
      throw new Error(errorMessage)
    }
    if (!response.body) {
      throw new Error('No response body received from server')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim()
          if (!jsonStr) continue
          try {
            onEvent(JSON.parse(jsonStr) as ParallelStreamEvent)
          } catch (e) {
            if (e instanceof SyntaxError) {
              console.error('Error parsing parallel SSE data:', e)
            } else {
              throw e
            }
          }
        }
      }
    }
  },

  synthesize: async (sessionId: string, data: SynthesizeRequest) => {
    const response = await apiClient.post<SynthesizeResponse>(
      `/chat/sessions/${sessionId}/synthesize`,
      data
    )
    return response.data
  },
}

export default chatApi
