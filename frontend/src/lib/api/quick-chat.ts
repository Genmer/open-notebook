import { getAuthToken } from '@/lib/auth-token'
import { getApiUrl } from '@/lib/config'

// 快捷问答（全局侧边卡）API client — 无状态端点：完整历史随请求体往返，
// 服务端不落库（前端 localStorage 持久化）。

export interface QuickChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 仅前端展示用：该条 user 消息附带的页面上下文标签 */
  contextLabels?: string[]
}

export interface QuickContextBlock {
  label: string
  text: string
}

/** quickChatStream 的失败原因（与端点 422 及 SSE error 事件一一对应） */
export type QuickChatErrorReason =
  | 'no_message'
  | 'no_model'
  | 'model_timeout'
  | 'model_error'
  | 'network'

export class QuickChatError extends Error {
  readonly reason: QuickChatErrorReason

  constructor(reason: QuickChatErrorReason, message?: string) {
    super(message ?? reason)
    this.name = 'QuickChatError'
    this.reason = reason
  }
}

type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'complete'; content: string }
  | { type: 'error'; reason: string; message?: string }

function reasonFromEvent(reason: string | undefined): QuickChatErrorReason {
  if (reason === 'no_model') return 'no_model'
  if (reason === 'model_timeout') return 'model_timeout'
  return 'model_error'
}

export interface QuickChatStreamOptions {
  messages: QuickChatMessage[]
  modelId?: string | null
  agentId?: string | null
  contextBlocks?: QuickContextBlock[]
  onDelta: (delta: string) => void
  signal?: AbortSignal
}

/** SSE 直连 API base（next dev 会缓冲流式代理路由，token 增量会被并块）。 */
export async function quickChatStream({
  messages,
  modelId,
  agentId,
  contextBlocks,
  onDelta,
  signal,
}: QuickChatStreamOptions): Promise<string> {
  const token = getAuthToken()
  const apiUrl = await getApiUrl()
  let response: Response
  try {
    response = await fetch(`${apiUrl}/api/chat_quick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        messages: messages.map(({ role, content }) => ({ role, content })),
        model_id: modelId || null,
        agent_id: agentId || null,
        context_blocks: contextBlocks ?? [],
      }),
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new QuickChatError('network')
  }
  if (!response.ok) {
    if (response.status === 422) throw new QuickChatError('no_message')
    throw new QuickChatError('model_error')
  }

  const reader = response.body?.getReader()
  if (!reader) throw new QuickChatError('network')
  const decoder = new TextDecoder()
  let buffer = ''
  let result: string | null = null

  const handleEvent = (raw: string) => {
    const payload = raw.slice('data: '.length)
    let event: StreamEvent
    try {
      event = JSON.parse(payload) as StreamEvent
    } catch {
      return
    }
    if (event.type === 'delta') {
      onDelta(event.content)
    } else if (event.type === 'complete') {
      result = event.content
    } else if (event.type === 'error') {
      throw new QuickChatError(reasonFromEvent(event.reason), event.message)
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data: ')) handleEvent(line)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (result === null) throw new QuickChatError('network')
  return result
}
