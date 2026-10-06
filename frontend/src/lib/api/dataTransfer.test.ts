import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('./client', () => {
  const mock = {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  }
  return { default: mock, apiClient: mock }
})

vi.mock('@/lib/config', () => ({
  getApiUrl: vi.fn(async () => 'http://127.0.0.1:5055'),
}))

vi.mock('@/lib/auth-token', () => ({
  getAuthToken: vi.fn(() => 'tok-1'),
}))

import { dataTransferApi } from './dataTransfer'
import { apiClient } from './client'
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

describe('dataTransferApi.uploadImportChunked', () => {
  const CHUNK = 8 * 1024 * 1024

  // A stand-in File sized in bytes only; slice() yields throwaway blobs since
  // the digest is stubbed and the server is a mock. jsdom's Blob lacks
  // arrayBuffer(), hence the hand-rolled stand-in.
  function fakeFile(size: number): File {
    return {
      name: 'big.zip',
      size,
      lastModified: 123,
      slice: (start: number, end: number) =>
        ({ arrayBuffer: async () => new ArrayBuffer(Math.max(0, end - start)) }) as Blob,
    } as unknown as File
  }

  const okPut = () => ({ ok: true, status: 200 }) as unknown as Response

  it('resumes from server-known parts, uploads the rest, completes once', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } })
    const size = CHUNK * 2 + 1024 // three parts
    vi.mocked(apiClient.post)
      .mockResolvedValueOnce({ data: { upload_id: 'u1', uploaded_chunks: [0] } })
      .mockResolvedValueOnce({ data: { scan_id: 'scan-1', decisions_required: 0 } })
    const fetchMock = vi.fn<typeof fetch>(async () => okPut())
    vi.stubGlobal('fetch', fetchMock)

    const events: { loaded: number; total: number }[] = []
    const result = await dataTransferApi.uploadImportChunked(fakeFile(size), (p) =>
      events.push(p)
    )

    expect(result).toMatchObject({ scan_id: 'scan-1' })
    // Session created with the resume key derived from the file identity.
    const postMock = apiClient.post as unknown as Mock
    const createCall = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(createCall[0]).toBe('/data-transfer/import/chunk-session')
    expect(createCall[1]).toMatchObject({
      filename: 'big.zip',
      total_size: size,
      chunk_size: CHUNK,
      total_chunks: 3,
      client_key: `big.zip:${size}:123`,
    })
    expect(postMock.mock.calls[1]?.[0]).toBe(
      '/data-transfer/import/chunk-session/u1/complete'
    )
    // Part 0 was already on the server → only parts 1 and 2 go over the wire.
    const putUrls = fetchMock.mock.calls.map((c) => String(c[0])).sort()
    expect(putUrls).toEqual([
      'http://127.0.0.1:5055/api/data-transfer/import/chunk-session/u1/chunks/1',
      'http://127.0.0.1:5055/api/data-transfer/import/chunk-session/u1/chunks/2',
    ])
    // Every PUT carries the per-part digest header.
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(call[1].headers).toMatchObject({
        'X-Chunk-Sha256': expect.any(String),
      })
    }
    // Progress starts from the resumed part and ends at the full size.
    expect(events[0]).toEqual({ loaded: CHUNK, total: size })
    expect(events[events.length - 1]).toEqual({ loaded: size, total: size })
    expect(events).toHaveLength(3)
  })

  it('fails fast on a 4xx rejection without resending the part', async () => {
    vi.stubGlobal('crypto', { subtle: { digest: async () => new ArrayBuffer(32) } })
    vi.mocked(apiClient.post).mockResolvedValueOnce({
      data: { upload_id: 'u2', uploaded_chunks: [] },
    })
    const fetchMock = vi.fn<typeof fetch>(async () => ({ ok: false, status: 400 }) as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      dataTransferApi.uploadImportChunked(fakeFile(1024))
    ).rejects.toThrow('rejected: HTTP 400')
    // A client error will not heal on retry: exactly one attempt.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
