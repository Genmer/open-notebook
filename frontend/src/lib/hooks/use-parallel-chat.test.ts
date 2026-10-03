import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useParallelChat } from './use-parallel-chat'
import { ParallelStreamEvent } from '@/lib/api/chat'

// useTranslation is mocked globally in setup.ts (t returns the key string)

const events: ParallelStreamEvent[] = []

vi.mock('@/lib/api/chat', () => ({
  chatApi: {
    parallelRun: vi.fn(
      async (
        _sessionId: string,
        _data: unknown,
        onEvent: (event: ParallelStreamEvent) => void
      ) => {
        for (const event of events) onEvent(event)
      }
    ),
    synthesize: vi.fn(async () => ({
      group_id: 'par_1',
      content: 'merged',
      model_name: 'gpt',
      agent_name: null,
    })),
  },
}))

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useParallelChat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
  })

  it('walks the SSE event sequence into run states and phase', async () => {
    events.push(
      {
        type: 'runs_started',
        group_id: 'par_1',
        runs: [
          { key: 'default', kind: 'default', name: 'default' },
          { key: 'agent:agent:1', kind: 'agent', name: 'Researcher' },
        ],
      },
      {
        type: 'run_complete',
        key: 'default',
        group_id: 'par_1',
        content: 'plain answer',
        model_name: 'gpt',
        agent_name: null,
      },
      { type: 'run_error', key: 'agent:agent:1', message: 'boom' },
      { type: 'archived', group_id: 'par_1', messages: [] },
      { type: 'complete', group_id: 'par_1' }
    )

    const onArchived = vi.fn()
    const { result } = renderHook(() => useParallelChat())

    await act(async () => {
      await result.current.start('chat_session:s1', 'hi', ['default', 'agent:agent:1'], {}, onArchived)
    })

    expect(result.current.phase).toBe('done')
    expect(result.current.groupId).toBe('par_1')
    expect(result.current.runs).toMatchObject([
      { key: 'default', status: 'done', content: 'plain answer' },
      { key: 'agent:agent:1', status: 'error', error: 'boom' },
    ])
    expect(onArchived).toHaveBeenCalledTimes(1)
  })

  it('stays pending while the stream is in flight', async () => {
    let release: (() => void) | undefined
    const { chatApi } = await import('@/lib/api/chat')
    ;(chatApi.parallelRun as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        release = resolve
      })
    )

    const { result } = renderHook(() => useParallelChat())
    let pending: Promise<void> | undefined
    act(() => {
      pending = result.current.start('chat_session:s1', 'hi', ['default'], {})
    })
    await flush()

    expect(result.current.phase).toBe('running')
    expect(result.current.runs).toEqual([])

    await act(async () => {
      release?.()
      await pending
    })
    expect(result.current.phase).toBe('done')
  })

  it('synthesize stores the merged result', async () => {
    events.push({
      type: 'runs_started',
      group_id: 'par_1',
      runs: [{ key: 'default', kind: 'default', name: 'default' }],
    })
    const { result } = renderHook(() => useParallelChat())

    await act(async () => {
      await result.current.start('chat_session:s1', 'hi', ['default'], {})
    })
    await act(async () => {
      await result.current.synthesize('chat_session:s1', { model: 'model:gpt' })
    })

    expect(result.current.synthesis).toEqual({
      content: 'merged',
      model_name: 'gpt',
      agent_name: null,
    })
    const { chatApi } = await import('@/lib/api/chat')
    expect(chatApi.synthesize).toHaveBeenCalledWith('chat_session:s1', {
      group_id: 'par_1',
      instruction: undefined,
      model: 'model:gpt',
    })
  })
})
