import apiClient from './client'
import { getAuthToken } from '@/lib/auth-token'
import { getApiUrl } from '@/lib/config'
import {
  QuestionEssayGenerateRequest,
  QuestionGenerateRequest,
  QuestionGenerateResult,
} from '@/lib/types/api'

// 软考题目工作台生成 API client（无状态端点，题目数据来自请求体）。
// 红线（ADR-017）：请求只含考试元数据（标题/年份/技术域/三问）+ 用户备注，
// 没有 source_id——范文在构造上不可达。整篇生成额外携带 env_id（考生自己
// 的项目环境，服务端经 chat 同一条 verified-snapshot 通道解析）。

/** 生成流端点的失败原因（与端点 422/502/504 及网络层一一对应；
 * no_env 仅整篇生成端点会产生（env 解析失败/验证门未开） */
export type QuestionStreamErrorReason =
  | 'no_title'
  | 'no_env'
  | 'model_timeout'
  | 'model_error'
  | 'network'

export class QuestionStreamError extends Error {
  readonly reason: QuestionStreamErrorReason

  constructor(reason: QuestionStreamErrorReason, message?: string) {
    super(message ?? reason)
    this.name = 'QuestionStreamError'
    this.reason = reason
  }
}

type StreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'stage'; stage: string }
  | { type: 'complete'; result: QuestionGenerateResult }
  | { type: 'error'; reason: string; message?: string }

function reasonFromEvent(reason: string | undefined): QuestionStreamErrorReason {
  if (reason === 'no_title') return 'no_title'
  if (reason === 'model_timeout') return 'model_timeout'
  return 'model_error'
}

// 整篇生成的事件语法与工作台流一致，唯 complete 携带纯文本草稿本体
// （content，无 JSON result 包装）；error 多一个 no_env 分支。
type EssayStreamEvent =
  | { type: 'delta'; content: string }
  | { type: 'stage'; stage: string }
  | { type: 'complete'; content: string }
  | { type: 'error'; reason: string; message?: string }

function essayReasonFromEvent(
  reason: string | undefined,
): QuestionStreamErrorReason {
  if (reason === 'no_title') return 'no_title'
  if (reason === 'no_env') return 'no_env'
  if (reason === 'model_timeout') return 'model_timeout'
  return 'model_error'
}

export const ruankaoQuestionsApi = {
  generate: async (
    data: QuestionGenerateRequest,
  ): Promise<QuestionGenerateResult> => {
    const response = await apiClient.post<QuestionGenerateResult>(
      '/ruankao/questions/generate',
      data,
    )
    return response.data
  },

  // SSE 孪生端点（chat.ts streamRun 同款骨架）：直连 API base——next dev 会
  // 缓冲流式代理路由，token 增量会被并成一块，动画/速度就没了。
  // complete 事件的 result 与同步端点响应同形；error 事件→QuestionStreamError。
  // stage 事件（preparing/waiting/thinking/generating）→ onStage 回调；signal
  // 之后的尾部可选回调与 chat.ts streamRun（onEvent, signal?, onChunk?）同款。
  generateStream: async (
    data: QuestionGenerateRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
    onStage?: (stage: string) => void,
  ): Promise<QuestionGenerateResult> => {
    const token = getAuthToken()
    const apiUrl = await getApiUrl()
    let response: Response
    try {
      response = await fetch(
        `${apiUrl}/api/ruankao/questions/generate/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify(data),
          signal,
        },
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw new QuestionStreamError('network')
    }
    if (!response.ok) {
      let reason: QuestionStreamErrorReason = 'model_error'
      try {
        const body = (await response.json()) as {
          detail?: { reason?: string }
        }
        if (body?.detail?.reason === 'no_title') reason = 'no_title'
      } catch {
        // 非 JSON 错误体：保持 model_error
      }
      throw new QuestionStreamError(reason, `HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new QuestionStreamError('network', 'No response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: QuestionGenerateResult | undefined
    while (result === undefined) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        let event: StreamEvent
        try {
          event = JSON.parse(jsonStr) as StreamEvent
        } catch (e) {
          if (e instanceof SyntaxError) {
            console.error('Error parsing question stream SSE data:', e)
            continue
          }
          throw e
        }
        if (event.type === 'delta') {
          onDelta(event.content)
        } else if (event.type === 'stage') {
          onStage?.(event.stage)
        } else if (event.type === 'complete') {
          result = event.result
          break
        } else {
          throw new QuestionStreamError(
            reasonFromEvent(event.reason),
            event.message,
          )
        }
      }
    }
    if (result === undefined) {
      // 流断在 complete 之前（网络中断/代理掐断）
      throw new QuestionStreamError('network', 'Stream ended without complete')
    }
    return result
  },

  // 整篇生成 SSE（generateStream 同款骨架，直连 API base）：stage/delta 事件
  // → onStage/onDelta 回调；complete 携带纯文本草稿（content）作为返回值；
  // error 事件与流前 422（no_title/no_env）→ QuestionStreamError 类型化
  // reason。断连取消：signal 中止后端同步取消在途模型调用。
  essayGenerateStream: async (
    data: QuestionEssayGenerateRequest,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
    onStage?: (stage: string) => void,
  ): Promise<string> => {
    const token = getAuthToken()
    const apiUrl = await getApiUrl()
    let response: Response
    try {
      response = await fetch(
        `${apiUrl}/api/ruankao/questions/essay/generate/stream`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
          },
          body: JSON.stringify(data),
          signal,
        },
      )
    } catch (error) {
      if (signal?.aborted) throw error
      throw new QuestionStreamError('network')
    }
    if (!response.ok) {
      let reason: QuestionStreamErrorReason = 'model_error'
      try {
        const body = (await response.json()) as {
          detail?: { reason?: string }
        }
        if (body?.detail?.reason === 'no_title') reason = 'no_title'
        if (body?.detail?.reason === 'no_env') reason = 'no_env'
      } catch {
        // 非 JSON 错误体：保持 model_error
      }
      throw new QuestionStreamError(reason, `HTTP ${response.status}`)
    }
    if (!response.body) {
      throw new QuestionStreamError('network', 'No response body')
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let content: string | undefined
    while (content === undefined) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6).trim()
        if (!jsonStr) continue
        let event: EssayStreamEvent
        try {
          event = JSON.parse(jsonStr) as EssayStreamEvent
        } catch (e) {
          if (e instanceof SyntaxError) {
            console.error('Error parsing question essay stream SSE data:', e)
            continue
          }
          throw e
        }
        if (event.type === 'delta') {
          onDelta(event.content)
        } else if (event.type === 'stage') {
          onStage?.(event.stage)
        } else if (event.type === 'complete') {
          content = event.content
          break
        } else {
          throw new QuestionStreamError(
            essayReasonFromEvent(event.reason),
            event.message,
          )
        }
      }
    }
    if (content === undefined) {
      // 流断在 complete 之前（网络中断/代理掐断）
      throw new QuestionStreamError('network', 'Stream ended without complete')
    }
    return content
  },
}
