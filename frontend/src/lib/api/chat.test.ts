import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => {
  const mock = { get: vi.fn(), post: vi.fn(), delete: vi.fn() }
  return { default: mock, apiClient: mock }
})

vi.mock('@/lib/config', () => ({
  getApiUrl: vi.fn(async () => 'http://127.0.0.1:5055'),
}))

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn(() => 'tok-1'),
}))

import { chatApi, ParallelStreamEvent } from './chat'

function sseResponse(chunks: string[], ok = true, status = 200): Response {
  const encoder = new TextEncoder()
  const queue: Array<{ done: boolean; value?: Uint8Array }> = chunks.map((c) => ({
    done: false,
    value: encoder.encode(c),
  }))
  queue.push({ done: true })
  return {
    ok,
    status,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => queue.shift() as { done: boolean; value?: Uint8Array },
      }),
    },
  } as unknown as Response
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('chatApi.parallelRun', () => {
  it('fetches the API directly (bypassing the buffering next dev proxy)', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"type":"complete"}\n\n']))
    vi.stubGlobal('fetch', fetchMock)

    await chatApi.parallelRun('s1', { message: 'hi', context: {}, runs: ['default'] }, vi.fn())

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:5055/api/chat/sessions/s1/parallel')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('reassembles SSE events split across chunk boundaries', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"type":"runs_started","group_id":"par_1","runs":[{"key":"defau',
        'lt","kind":"default","name":"default"}]}\n\ndata: {"type":"run_delta","key":"default","del',
        'ta":"Hi"}\n\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const received: ParallelStreamEvent[] = []
    await chatApi.parallelRun('s1', { message: 'hi', context: {}, runs: ['default'] }, (e) =>
      received.push(e)
    )

    expect(received).toEqual([
      {
        type: 'runs_started',
        group_id: 'par_1',
        runs: [{ key: 'default', kind: 'default', name: 'default' }],
      },
      { type: 'run_delta', key: 'default', delta: 'Hi' },
    ])
  })

  it('delivers every high-frequency run_delta as its own callback, in order', async () => {
    const lines = Array.from({ length: 50 }, (_, i) =>
      `data: {"type":"run_delta","key":"default","delta":"${i}"}\n\n`
    )
    // Interleave both runs in one giant chunk, as one buffered read would.
    const chunks = lines.concat(
      Array.from({ length: 10 }, (_, i) => `data: {"type":"run_delta","key":"agent:a1","delta":"x${i}"}\n\n`)
    )
    const fetchMock = vi.fn(async () => sseResponse([chunks.join('')]))
    vi.stubGlobal('fetch', fetchMock)

    const received: ParallelStreamEvent[] = []
    await chatApi.parallelRun('s1', { message: 'hi', context: {}, runs: ['default'] }, (e) =>
      received.push(e)
    )

    const defaultDeltas = received.filter((e) => e.type === 'run_delta' && e.key === 'default')
    const agentDeltas = received.filter((e) => e.type === 'run_delta' && e.key === 'agent:a1')
    expect(received).toHaveLength(60)
    expect(defaultDeltas.map((e) => e.delta)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i))
    )
    expect(agentDeltas.map((e) => e.delta)).toEqual(
      Array.from({ length: 10 }, (_, i) => `x${i}`)
    )
  })

  it('skips malformed SSE lines without killing the stream', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {not json}\n\n',
        'data: {"type":"ping"}\n\n',
        'data: {"type":"run_delta","key":"default","delta":"still alive"}\n\n',
      ])
    )
    vi.stubGlobal('fetch', fetchMock)

    const received: ParallelStreamEvent[] = []
    await chatApi.parallelRun('s1', { message: 'hi', context: {}, runs: ['default'] }, (e) =>
      received.push(e)
    )

    expect(received).toEqual([
      { type: 'ping' },
      { type: 'run_delta', key: 'default', delta: 'still alive' },
    ])
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('surfaces non-2xx responses as an error with the API detail message', async () => {
    vi.stubGlobal('fetch', async () =>
      ({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ detail: 'Parallel run already in flight' }),
        headers: new Headers(),
      }) as unknown as Response
    )

    await expect(
      chatApi.parallelRun('s1', { message: 'hi', context: {}, runs: ['default'] }, vi.fn())
    ).rejects.toThrow('Parallel run already in flight')
  })
})
