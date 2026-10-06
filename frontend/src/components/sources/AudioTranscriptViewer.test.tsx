import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi, beforeEach } from 'vitest'

const fetchBufferMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/sources', () => ({
  sourcesApi: { fetchSourceFileBuffer: fetchBufferMock },
}))

// SaveNoteDialog drags query hooks; stub it and capture its content prop.
const saveNoteMock = vi.hoisted(() =>
  vi.fn((props: Record<string, unknown>) => {
    void props
    return <div data-testid="save-note-stub" />
  })
)
vi.mock('@/components/sources/SaveNoteDialog', () => ({
  SaveNoteDialog: saveNoteMock,
}))

import { AudioTranscriptViewer, isAudioFilePath } from './AudioTranscriptViewer'

// jsdom has no scrollIntoView; the follow-scroll effect calls it directly.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

const FULL_TEXT = '第一句结束。第二句结束！\n\nNew paragraph. Second sentence here.'

function renderViewer(overrides: Partial<Parameters<typeof AudioTranscriptViewer>[0]> = {}) {
  return render(
    <AudioTranscriptViewer
      sourceId="source:s1"
      fullText={FULL_TEXT}
      notebookId="notebook:n1"
      sourceTitle="会议录音"
      {...overrides}
    />
  )
}

describe('isAudioFilePath', () => {
  it('matches audio containers and rejects others', () => {
    expect(isAudioFilePath('/data/uploads/meeting.mp3')).toBe(true)
    expect(isAudioFilePath('/data/uploads/voice.M4A')).toBe(true)
    expect(isAudioFilePath('/data/uploads/paper.pdf')).toBe(false)
    expect(isAudioFilePath('/data/uploads/notes.txt')).toBe(false)
    expect(isAudioFilePath(null)).toBe(false)
  })
})

describe('AudioTranscriptViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders sentences grouped into paragraphs with excerpt buttons', async () => {
    fetchBufferMock.mockRejectedValue(new Error('no file'))
    renderViewer()

    await waitFor(() =>
      expect(screen.getByTestId('audio-transcript-viewer')).toBeInTheDocument()
    )
    // 4 sentences across 2 paragraphs.
    expect(screen.getByTestId('transcript-sentence-0')).toHaveTextContent('第一句结束。')
    expect(screen.getByTestId('transcript-sentence-2')).toHaveTextContent('New paragraph.')
    expect(screen.queryAllByTestId(/^transcript-excerpt-/)).toHaveLength(4)
    // Audio unavailable → fallback hint, no player.
    expect(screen.getByText('sources.audioTranscript.playerUnavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('audio-transcript-player')).not.toBeInTheDocument()
  })

  it('mounts a player when the audio buffer loads', async () => {
    fetchBufferMock.mockResolvedValue(new ArrayBuffer(8))
    renderViewer()

    await waitFor(() =>
      expect(screen.getByTestId('audio-transcript-player')).toBeInTheDocument()
    )
  })

  it('follows the playhead by character share', async () => {
    fetchBufferMock.mockResolvedValue(new ArrayBuffer(8))
    renderViewer()

    const player = await screen.findByTestId('audio-transcript-player')
    Object.defineProperty(player, 'duration', { value: 100, configurable: true })
    fireEvent(player, new Event('loadedmetadata'))
    Object.defineProperty(player, 'currentTime', { value: 40, configurable: true })
    fireEvent(player, new Event('timeupdate'))

    // 40% of 100s → past sentence 0 (25% share), before sentence 2 (50%).
    await waitFor(() =>
      expect(screen.getByTestId('transcript-sentence-1').getAttribute('data-active')).toBeDefined()
    )
  })

  it('opens the excerpt dialog with the templated sentence', async () => {
    fetchBufferMock.mockRejectedValue(new Error('no file'))
    renderViewer()

    await screen.findByTestId('transcript-sentence-0')
    fireEvent.click(screen.getByTestId('transcript-excerpt-0'))

    expect(saveNoteMock).toHaveBeenCalled()
    const props = saveNoteMock.mock.calls[saveNoteMock.mock.calls.length - 1][0]
    // t() resolves to the bare key in tests, so pin the pipeline (key +
    // notebook + note mode) rather than the interpolated text.
    expect(props.content).toBe('sources.audioTranscript.excerptTemplate')
    expect(props.notebookId).toBe('notebook:n1')
    expect(props.initialMode).toBe('note')
  })
})
