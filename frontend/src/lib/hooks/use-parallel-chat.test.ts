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
// The hook coalesces deltas on a 50ms trailing timer; real timers (no fakes)
// plus a 60ms wait let one flush land, per the project's SSE test convention.
const waitForDeltaFlush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60))
  })

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

  it('materializes pending cards from run keys before runs_started arrives', async () => {
    // Stream never emits; the optimistic cards must exist for the whole flight.
    const { chatApi } = await import('@/lib/api/chat')
    ;(chatApi.parallelRun as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>(() => {})
    )

    const { result } = renderHook(() => useParallelChat())
    act(() => {
      // Never resolves — the optimistic cards must exist for the whole flight.
      void result.current.start('chat_session:s1', 'hi', ['default', 'agent:agent:1', 'model:gpt-4'], {})
    })
    await flush()

    expect(result.current.phase).toBe('running')
    expect(result.current.runs).toEqual([
      { key: 'default', kind: 'default', name: 'default', status: 'pending' },
      { key: 'agent:agent:1', kind: 'agent', name: 'agent:agent:1', status: 'pending' },
      { key: 'model:gpt-4', kind: 'model', name: 'model:gpt-4', status: 'pending' },
    ])
  })

  it('aggregates run_delta into streaming state on the flush timer', async () => {
    let emit: ((event: ParallelStreamEvent) => void) | undefined
    const { chatApi } = await import('@/lib/api/chat')
    ;(chatApi.parallelRun as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_sid: string, _data: unknown, onEvent: (event: ParallelStreamEvent) => void) => {
        emit = onEvent
        return new Promise<void>(() => {})
      }
    )

    const { result } = renderHook(() => useParallelChat())
    // Never await start() here: the mocked stream never resolves, and an
    // await inside act would jam React's act queue for the whole file.
    act(() => {
      void result.current.start('chat_session:s1', 'hi', ['default'], {})
    })

    // Suspended window: delta buffered in a ref, state still pending.
    act(() => {
      emit?.({ type: 'run_delta', key: 'default', delta: 'Hel' })
    })
    expect(result.current.runs[0].status).toBe('pending')
    expect(result.current.runs[0].deltaText).toBeUndefined()

    await waitForDeltaFlush()
    expect(result.current.runs[0]).toMatchObject({ status: 'streaming', deltaText: 'Hel' })

    // Interleaved deltas across keys land in their own run.
    act(() => {
      emit?.({ type: 'runs_started', group_id: 'par_1', runs: [
        { key: 'default', kind: 'default', name: 'default' },
        { key: 'agent:agent:1', kind: 'agent', name: 'Researcher' },
      ] })
    })
    act(() => {
      emit?.({ type: 'run_delta', key: 'default', delta: 'lo ' })
      emit?.({ type: 'run_delta', key: 'agent:agent:1', delta: 'deep ' })
      emit?.({ type: 'run_delta', key: 'default', delta: 'world' })
    })
    await waitForDeltaFlush()
    expect(result.current.runs).toMatchObject([
      { key: 'default', status: 'streaming', deltaText: 'Hello world' },
      { key: 'agent:agent:1', status: 'streaming', deltaText: 'deep ' },
    ])
  })

  it('run_complete replaces the delta aggregate with the authoritative full text', async () => {
    let emit: ((event: ParallelStreamEvent) => void) | undefined
    const { chatApi } = await import('@/lib/api/chat')
    ;(chatApi.parallelRun as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_sid: string, _data: unknown, onEvent: (event: ParallelStreamEvent) => void) => {
        emit = onEvent
        return new Promise<void>(() => {})
      }
    )

    const { result } = renderHook(() => useParallelChat())
    act(() => {
      void result.current.start('chat_session:s1', 'hi', ['default'], {})
    })

    act(() => {
      emit?.({ type: 'runs_started', group_id: 'par_1', runs: [{ key: 'default', kind: 'default', name: 'default' }] })
      // Residue intentionally left unflushed when complete arrives.
      emit?.({ type: 'run_delta', key: 'default', delta: 'partial wor' })
    })
    act(() => {
      emit?.({
        type: 'run_complete',
        key: 'default',
        group_id: 'par_1',
        content: 'full authoritative answer',
        model_name: 'gpt',
        agent_name: null,
      })
    })
    expect(result.current.runs[0]).toMatchObject({
      status: 'done',
      content: 'full authoritative answer',
      deltaText: undefined,
    })

    // The dropped residue must not reappear via a late flush.
    await waitForDeltaFlush()
    expect(result.current.runs[0]).toMatchObject({
      status: 'done',
      content: 'full authoritative answer',
      deltaText: undefined,
    })
  })

  it('run_error drops the buffered preview (partial stream is untrustworthy)', async () => {
    let emit: ((event: ParallelStreamEvent) => void) | undefined
    const { chatApi } = await import('@/lib/api/chat')
    ;(chatApi.parallelRun as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (_sid: string, _data: unknown, onEvent: (event: ParallelStreamEvent) => void) => {
        emit = onEvent
        return new Promise<void>(() => {})
      }
    )

    const { result } = renderHook(() => useParallelChat())
    act(() => {
      void result.current.start('chat_session:s1', 'hi', ['default'], {})
    })

    act(() => {
      emit?.({ type: 'runs_started', group_id: 'par_1', runs: [{ key: 'default', kind: 'default', name: 'default' }] })
      emit?.({ type: 'run_delta', key: 'default', delta: 'half-baked' })
      emit?.({ type: 'run_error', key: 'default', message: 'provider exploded' })
    })
    expect(result.current.runs[0]).toMatchObject({
      status: 'error',
      error: 'provider exploded',
      deltaText: undefined,
    })

    await waitForDeltaFlush()
    expect(result.current.runs[0]).toMatchObject({ status: 'error', deltaText: undefined })
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
