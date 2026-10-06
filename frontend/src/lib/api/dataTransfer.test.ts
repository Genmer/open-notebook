import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('@/lib/config', () => ({
  getApiUrl: vi.fn(async () => 'http://127.0.0.1:5055'),
}))

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn(() => 'tok-1'),
}))

import { dataTransferApi } from './dataTransfer'
import { getAuthToken } from '@/lib/auth-token'

// jsdom has Blob but no object URLs; the download path only needs the calls.
const createObjectURL = vi.fn(() => 'blob:mock')
const revokeObjectURL = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function streamResponse(
  chunks: number[][],
  headers: Record<string, string> = { 'content-length': '10' },
  ok = true,
  status = 200,
): Response {
  const queue: Array<{ done: boolean; value?: Uint8Array }> = chunks.map(
    (bytes) => ({ done: false, value: new Uint8Array(bytes) })
  )
  queue.push({ done: true })
  return {
    ok,
    status,
    headers: new Headers(headers),
    body: {
      getReader: () => ({
        read: async () => queue.shift() as { done: boolean; value?: Uint8Array },
      }),
    },
  } as unknown as Response
}

describe('dataTransferApi.downloadExport', () => {
  it('reports chunked progress and totals from content-length', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([[1, 2, 3, 4, 5], [6, 7, 8, 9, 10]], {
        'content-length': '10',
        'content-disposition': 'attachment; filename="pkg.zip"',
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const events: { loaded: number; total: number }[] = []
    await dataTransferApi.downloadExport((p) => events.push(p))

    expect(events).toEqual([
      { loaded: 5, total: 10 },
      { loaded: 10, total: 10 },
    ])
    // Direct API fetch, auth header carried manually (no proxy buffering).
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:5055/api/data-transfer/export/download',
      { headers: { Authorization: 'Bearer tok-1' }, signal: undefined }
    )
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('reports total=0 when content-length is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([[1, 2]], {}))
    )

    const events: { loaded: number; total: number }[] = []
    await dataTransferApi.downloadExport((p) => events.push(p))

    expect(events).toEqual([{ loaded: 2, total: 0 }])
  })

  it('omits the Authorization header without a token', async () => {
    vi.mocked(getAuthToken).mockReturnValue('')
    const fetchMock = vi.fn<typeof fetch>(async () => streamResponse([[1]]))
    vi.stubGlobal('fetch', fetchMock)

    await dataTransferApi.downloadExport()

    expect(fetchMock.mock.calls[0][1]?.headers).toBeUndefined()
  })

  it('throws on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamResponse([], {}, false, 404))
    )

    await expect(dataTransferApi.downloadExport()).rejects.toThrow(
      'Download failed: HTTP 404'
    )
    expect(createObjectURL).not.toHaveBeenCalled()
  })
})
