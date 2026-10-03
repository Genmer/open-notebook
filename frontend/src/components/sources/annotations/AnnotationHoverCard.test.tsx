import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import AnnotationHoverCard from './AnnotationHoverCard'
import type { SourceAnnotation } from '@/lib/api/source-annotations'

// The API module is the component's only data door — mock it wholesale.
vi.mock('@/lib/api/source-annotations', () => ({
  ANNOTATION_COLORS: ['gold', 'fern', 'plum', 'slate', 'clay'],
  sourceAnnotationsApi: {
    list: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
  },
}))

// Neutral sonner toast callable + error channel, both assertable.
const mockToast = vi.fn()
vi.mock('sonner', () => {
  const toast = Object.assign((...args: unknown[]) => mockToast(...args), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn(),
  })
  return { toast }
})

// Override the global setup mock with a t() that surfaces interpolations so
// color-name precedence (settings cache vs i18n fallback) is assertable.
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}|${Object.values(opts).join(',')}` : key,
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

import { sourceAnnotationsApi } from '@/lib/api/source-annotations'
import { toast } from 'sonner'

const { update, remove, create, getSettings } = vi.mocked(sourceAnnotationsApi)
const mockToastError = vi.mocked(toast.error)

const baseAnnotation: SourceAnnotation = {
  id: 'source_annotation:abc',
  source: 'source:def',
  color: 'gold',
  line_style: 'wavy',
  body: 'must memorize',
  display_position: null,
  quote: 'the quoted text',
  text_anchor: null,
  pdf_anchor: { page: 3, quads: [{ x1: 1, y1: 2, x2: 30, y2: 4 }] },
  page: 3,
  start_offset: null,
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
}

function renderCard(props?: {
  annotation?: Partial<SourceAnnotation>
  defaultPinned?: boolean
  onUpdated?: (a: SourceAnnotation) => void
  onDeleted?: (a: SourceAnnotation) => void
  onRestored?: (a: SourceAnnotation) => void
}) {
  const onOpenChange = vi.fn()
  const utils = render(
    <AnnotationHoverCard
      annotation={{ ...baseAnnotation, ...props?.annotation }}
      anchorRect={{ left: 100, top: 100, width: 60, height: 12 }}
      open
      onOpenChange={onOpenChange}
      defaultPinned={props?.defaultPinned}
      onUpdated={props?.onUpdated}
      onDeleted={props?.onDeleted}
      onRestored={props?.onRestored}
    />
  )
  return { onOpenChange, ...utils }
}

function pin() {
  fireEvent.click(screen.getByTestId('annotation-hover-edit'))
}

describe('AnnotationHoverCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    getSettings.mockResolvedValue({ id: 'open_notebook:annotation_settings', color_names: {} })
    update.mockResolvedValue(baseAnnotation)
    remove.mockResolvedValue(undefined)
    create.mockResolvedValue({ ...baseAnnotation, id: 'source_annotation:new' })
  })

  it('renders quote, body and meta in preview mode', () => {
    renderCard()

    expect(screen.getByTestId('annotation-hover-quote')).toHaveTextContent('the quoted text')
    expect(screen.getByTestId('annotation-hover-body')).toHaveTextContent('must memorize')
    expect(screen.queryByTestId('annotation-hover-body-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('annotation-hover-meta')).toHaveTextContent(
      'sources.annotations.hover.pageMeta|3'
    )
  })

  it('shows only the enlarged color dot + quote hint for a pure highlight', () => {
    renderCard({ annotation: { body: null } })

    expect(screen.getByTestId('annotation-hover-color-dot')).toBeInTheDocument()
    expect(screen.queryByTestId('annotation-hover-body')).not.toBeInTheDocument()
    expect(screen.getByTestId('annotation-hover-quote')).toBeInTheDocument()
  })

  it('applies a color change immediately via update when pinned', async () => {
    const onUpdated = vi.fn()
    const updated: SourceAnnotation = { ...baseAnnotation, color: 'fern' }
    update.mockResolvedValue(updated)
    renderCard({ onUpdated })

    pin()
    fireEvent.click(screen.getByTestId('annotation-hover-color-fern'))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('source_annotation:abc', { color: 'fern' })
    )
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(updated))
  })

  it('toggles the line style via update when pinned', async () => {
    renderCard()

    pin()
    fireEvent.click(screen.getByTestId('annotation-hover-line-straight'))

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('source_annotation:abc', { line_style: 'straight' })
    )
  })

  it('deletes without confirmation, closes the card and offers an 8s undo toast', async () => {
    const onDeleted = vi.fn()
    const { onOpenChange } = renderCard({ onDeleted })

    fireEvent.click(screen.getByTestId('annotation-hover-delete'))

    await waitFor(() => expect(remove).toHaveBeenCalledWith('source_annotation:abc'))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(baseAnnotation))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))

    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1))
    const [message, options] = mockToast.mock.calls[0] as [
      string,
      { duration: number; action: { label: string; onClick: () => void } }
    ]
    expect(message).toBe('sources.annotations.hover.deleted')
    expect(options.duration).toBe(8000)
    expect(options.action.label).toBe('sources.annotations.hover.undo')
  })

  it('restores the original values via create when undo is clicked', async () => {
    const onRestored = vi.fn()
    renderCard({ onRestored })

    fireEvent.click(screen.getByTestId('annotation-hover-delete'))
    await waitFor(() => expect(mockToast).toHaveBeenCalledTimes(1))

    mockToast.mock.calls[0][1].action.onClick()
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        source_id: 'source:def',
        color: 'gold',
        line_style: 'wavy',
        body: 'must memorize',
        quote: 'the quoted text',
        text_anchor: null,
        pdf_anchor: baseAnnotation.pdf_anchor,
      })
    )
    await waitFor(() =>
      expect(onRestored).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'source_annotation:new' })
      )
    )
  })

  it('surfaces a delete failure as a toast and keeps the card open', async () => {
    const { onOpenChange } = renderCard()
    remove.mockRejectedValue(new Error('boom'))

    fireEvent.click(screen.getByTestId('annotation-hover-delete'))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('sources.annotations.toast.deleteFailed'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('collapses a clean pinned card back to preview on Esc without closing', () => {
    const { onOpenChange } = renderCard()

    pin()
    expect(screen.getByTestId('annotation-hover-body-input')).toBeInTheDocument()

    fireEvent.keyDown(screen.getByTestId('annotation-hover-card'), { key: 'Escape' })

    expect(screen.queryByTestId('annotation-hover-body-input')).not.toBeInTheDocument()
    expect(screen.getByTestId('annotation-hover-card')).toBeInTheDocument()
    expect(update).not.toHaveBeenCalled()
    expect(onOpenChange).not.toHaveBeenCalled()

    // Layered exit (plan §3.7): a second Esc in preview closes the card.
    fireEvent.keyDown(screen.getByTestId('annotation-hover-card'), { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves a dirty body before collapsing on Esc', async () => {
    renderCard()

    pin()
    fireEvent.change(screen.getByTestId('annotation-hover-body-input'), {
      target: { value: 'revised note' },
    })
    fireEvent.keyDown(screen.getByTestId('annotation-hover-card'), { key: 'Escape' })

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith('source_annotation:abc', { body: 'revised note' })
    )
    expect(screen.queryByTestId('annotation-hover-body-input')).not.toBeInTheDocument()
  })

  it('prefers annotation_settings names over i18n defaults and caches them', async () => {
    getSettings.mockResolvedValue({
      id: 'open_notebook:annotation_settings',
      color_names: { gold: '必背' },
    })
    renderCard()

    pin()
    await waitFor(() =>
      expect(screen.getByTestId('annotation-hover-color-gold')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('必背')
      )
    )
    expect(localStorage.getItem('annotation-color-names-storage')).toBe(
      JSON.stringify({ gold: '必背' })
    )
  })

  it('falls back to the cached names when the settings fetch fails', async () => {
    localStorage.setItem('annotation-color-names-storage', JSON.stringify({ fern: '已掌握' }))
    getSettings.mockRejectedValue(new Error('offline'))
    renderCard({ annotation: { color: 'fern' } })

    pin()
    await waitFor(() =>
      expect(screen.getByTestId('annotation-hover-color-fern')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('已掌握')
      )
    )
  })

  it('falls back to the i18n default color name when nothing overrides it', async () => {
    renderCard()

    pin()
    await waitFor(() =>
      expect(screen.getByTestId('annotation-hover-color-gold')).toHaveAttribute(
        'aria-label',
        expect.stringContaining('sources.annotations.colors.gold')
      )
    )
  })
})
