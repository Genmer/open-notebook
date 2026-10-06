import { beforeEach, describe, expect, it, vi } from 'vitest'
import apiClient from './client'
import { sourceAnnotationsApi } from './source-annotations'

vi.mock('./client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = vi.mocked(apiClient.get)
const mockPost = vi.mocked(apiClient.post)
const mockPut = vi.mocked(apiClient.put)
const mockDelete = vi.mocked(apiClient.delete)

const annotation = {
  id: 'source_annotation:abc',
  source: 'source:def',
  color: 'gold',
  line_style: 'wavy',
  body: 'must memorize',
  display_position: null,
  quote: 'the quoted text',
  text_anchor: null,
  pdf_anchor: { page: 3, quads: [{ x1: 1, y1: 2, x2: 3, y2: 4 }] },
  page: 3,
  start_offset: null,
  created: '2026-10-01T10:00:00Z',
  updated: '2026-10-01T10:00:00Z',
}

describe('sourceAnnotationsApi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists annotations for a source without a page filter', async () => {
    mockGet.mockResolvedValue({ data: [annotation] })

    await expect(sourceAnnotationsApi.list('source:def')).resolves.toEqual([annotation])
    expect(mockGet).toHaveBeenCalledWith('/source-annotations', {
      params: { source_id: 'source:def' },
    })
  })

  it('lists annotations narrowed to one page (lazy loading)', async () => {
    mockGet.mockResolvedValue({ data: [] })

    await expect(sourceAnnotationsApi.list('source:def', 3)).resolves.toEqual([])
    expect(mockGet).toHaveBeenCalledWith('/source-annotations', {
      params: { source_id: 'source:def', page: 3 },
    })
  })

  it('counts via the list endpoint (no dedicated count endpoint)', async () => {
    mockGet.mockResolvedValue({ data: [annotation, annotation] })

    await expect(sourceAnnotationsApi.count('source:def')).resolves.toBe(2)
  })

  it('passes an abort signal from count through to the GET (F9 dialog-close cancellation)', async () => {
    mockGet.mockResolvedValue({ data: [annotation] })
    const controller = new AbortController()

    await expect(
      sourceAnnotationsApi.count('source:def', { signal: controller.signal })
    ).resolves.toBe(1)
    expect(mockGet).toHaveBeenCalledWith('/source-annotations', {
      params: { source_id: 'source:def' },
      signal: controller.signal,
    })
  })

  it('creates an annotation and returns the stored row', async () => {
    mockPost.mockResolvedValue({ data: annotation })

    await expect(
      sourceAnnotationsApi.create({
        source_id: 'source:def',
        color: 'gold',
        line_style: 'wavy',
        body: 'must memorize',
        quote: 'the quoted text',
        pdf_anchor: { page: 3, quads: [{ x1: 1, y1: 2, x2: 3, y2: 4 }] },
      })
    ).resolves.toEqual(annotation)
    expect(mockPost).toHaveBeenCalledWith('/source-annotations', {
      source_id: 'source:def',
      color: 'gold',
      line_style: 'wavy',
      body: 'must memorize',
      quote: 'the quoted text',
      pdf_anchor: { page: 3, quads: [{ x1: 1, y1: 2, x2: 3, y2: 4 }] },
    })
  })

  it('sends partial updates with the id encoded in the path', async () => {
    mockPut.mockResolvedValue({ data: { ...annotation, color: 'fern' } })

    await expect(
      sourceAnnotationsApi.update('source_annotation:abc', { color: 'fern' })
    ).resolves.toMatchObject({ color: 'fern' })
    expect(mockPut).toHaveBeenCalledWith(
      '/source-annotations/source_annotation%3Aabc',
      { color: 'fern' }
    )
  })

  it('deletes an annotation with the id encoded in the path', async () => {
    mockDelete.mockResolvedValue({ data: { success: true } })

    await expect(sourceAnnotationsApi.remove('source_annotation:abc')).resolves.toBeUndefined()
    expect(mockDelete).toHaveBeenCalledWith('/source-annotations/source_annotation%3Aabc')
  })

  it('reads the color-semantics settings singleton', async () => {
    mockGet.mockResolvedValue({ data: { id: 'open_notebook:annotation_settings', color_names: { gold: '必背' } } })

    await expect(sourceAnnotationsApi.getSettings()).resolves.toEqual({
      id: 'open_notebook:annotation_settings',
      color_names: { gold: '必背' },
    })
    expect(mockGet).toHaveBeenCalledWith('/annotation-settings')
  })

  it('saves color-semantics names under color_names', async () => {
    mockPut.mockResolvedValue({ data: { id: 'open_notebook:annotation_settings', color_names: { plum: '存疑' } } })

    await expect(sourceAnnotationsApi.saveSettings({ plum: '存疑' })).resolves.toMatchObject({
      color_names: { plum: '存疑' },
    })
    expect(mockPut).toHaveBeenCalledWith('/annotation-settings', {
      color_names: { plum: '存疑' },
    })
  })

  it('propagates request errors to the caller (client.ts owns 401 handling)', async () => {
    mockGet.mockRejectedValue(new Error('boom'))

    await expect(sourceAnnotationsApi.list('source:def')).rejects.toThrow('boom')
  })
})
