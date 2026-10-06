'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AudioLines, Quote } from 'lucide-react'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { SaveNoteDialog } from '@/components/sources/SaveNoteDialog'
import { sourcesApi } from '@/lib/api/sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import {
  activeSentenceIndex,
  spanStartProgress,
  splitTranscriptSentences,
  type TranscriptSpan,
} from '@/lib/utils/transcript-sync'

interface AudioTranscriptViewerProps {
  sourceId: string
  /** Parsed transcript text of the audio source (full_text). */
  fullText: string
  /** Notebook the excerpt note goes to; falls back to the source's first. */
  notebookId?: string | null
  fallbackNotebookId?: string | null
  sourceTitle?: string | null
}

const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|webm|mp4)$/i

/**
 * Structured transcript view for uploaded-audio sources: an inline player on
 * top, the transcript split into paragraphs/sentences below. While playing,
 * the sentence under the playhead (mapped by cumulative character share, see
 * transcript-sync.ts) is highlighted and scrolled into view; clicking a
 * sentence seeks the playhead onto it; every sentence offers a one-click
 * excerpt into a note via SaveNoteDialog.
 */
export function AudioTranscriptViewer({
  sourceId,
  fullText,
  notebookId,
  fallbackNotebookId,
  sourceTitle,
}: AudioTranscriptViewerProps) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const activeRef = useRef<HTMLSpanElement | null>(null)
  const userScanningRef = useRef(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [audioFailed, setAudioFailed] = useState(false)
  const [duration, setDuration] = useState<number | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [excerpt, setExcerpt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const buffer = await sourcesApi.fetchSourceFileBuffer(sourceId)
        if (cancelled) return
        objectUrl = URL.createObjectURL(new Blob([buffer]))
        setAudioUrl(objectUrl)
      } catch {
        if (!cancelled) setAudioFailed(true)
      }
    })()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sourceId])

  const sentences = useMemo(() => splitTranscriptSentences(fullText), [fullText])
  const paragraphs = useMemo(() => {
    // Group sentences back into paragraphs on the original blank lines: a new
    // paragraph starts whenever the gap from the previous sentence contains
    // the original whitespace run.
    const groups: Array<Array<{ span: TranscriptSpan; idx: number }>> = []
    let prevEnd = -1
    sentences.forEach((span, idx) => {
      const gap = fullText.slice(prevEnd < 0 ? 0 : prevEnd, span.start)
      if (prevEnd < 0 || /\n\s*\n/.test(gap)) {
        groups.push([{ span, idx }])
      } else {
        groups[groups.length - 1].push({ span, idx })
      }
      prevEnd = span.end
    })
    return groups
  }, [fullText, sentences])

  // Playhead → active sentence (character-share mapping). The comparison
  // guards against re-render loops from float noise.
  useEffect(() => {
    if (!duration || audioFailed || sentences.length === 0) return
    const next = activeSentenceIndex(fullText, sentences, currentTime / duration)
    setActiveIdx(prev => (prev === next ? prev : next))
  }, [currentTime, duration, fullText, sentences, audioFailed])

  // Follow-scroll: only while the sentence actually changes and the user is
  // not scanning the text with a selection/drag.
  useEffect(() => {
    if (activeIdx < 0 || userScanningRef.current) return
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const seekToSentence = (idx: number) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    audio.currentTime = spanStartProgress(fullText, sentences, idx) * duration
    setCurrentTime(audio.currentTime)
  }

  const handleTimeUpdate = () => {
    const audio = audioRef.current
    if (!audio) return
    setCurrentTime(audio.currentTime)
  }

  const targetNotebookId = notebookId ?? fallbackNotebookId

  return (
    <div data-testid="audio-transcript-viewer">
      {audioFailed ? (
        <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <AudioLines className="h-4 w-4 shrink-0" />
          {t('sources.audioTranscript.playerUnavailable')}
        </p>
      ) : !audioUrl ? (
        <div className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
          <LoadingSpinner size="sm" />
          {t('sources.audioTranscript.loadingPlayer')}
        </div>
      ) : (
        <audio
          ref={audioRef}
          controls
          preload="metadata"
          src={audioUrl}
          className="mb-4 w-full"
          data-testid="audio-transcript-player"
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={(event) => setDuration(event.currentTarget.duration || null)}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || null)}
          onError={() => setAudioFailed(true)}
        />
      )}

      <div
        className="space-y-4 text-sm leading-7"
        onMouseDown={() => {
          userScanningRef.current = true
        }}
        onMouseUp={() => {
          userScanningRef.current = false
        }}
        data-testid="audio-transcript-text"
      >
        {paragraphs.map((group, gi) => (
          <p key={gi} className="whitespace-pre-wrap">
            {group.map(({ span, idx }) => (
              <span
                key={idx}
                ref={idx === activeIdx ? activeRef : undefined}
                data-testid={`transcript-sentence-${idx}`}
                data-active={idx === activeIdx || undefined}
                onClick={() => seekToSentence(idx)}
                className={cn(
                  'group/sentence cursor-pointer rounded-sm px-0.5 transition-colors',
                  idx === activeIdx && 'bg-amber-500/25'
                )}
              >
                {fullText.slice(span.start, span.end)}
                <button
                  type="button"
                  aria-label={t('sources.audioTranscript.excerptSentence')}
                  title={t('sources.audioTranscript.excerptSentence')}
                  data-testid={`transcript-excerpt-${idx}`}
                  className="ml-1 inline-flex translate-y-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/sentence:opacity-100"
                  onClick={(event) => {
                    event.stopPropagation()
                    setExcerpt(
                      t('sources.audioTranscript.excerptTemplate', {
                        quote: fullText.slice(span.start, span.end).trim(),
                        source: sourceTitle ?? '',
                      })
                    )
                  }}
                >
                  <Quote className="h-3.5 w-3.5" />
                </button>{' '}
              </span>
            ))}
          </p>
        ))}
      </div>

      {excerpt && targetNotebookId && (
        <SaveNoteDialog
          open
          onOpenChange={(open) => {
            if (!open) setExcerpt(null)
          }}
          content={excerpt}
          notebookId={targetNotebookId}
          initialMode="note"
        />
      )}
    </div>
  )
}

/** True when a source's uploaded file is an audio container we can play. */
export function isAudioFilePath(filePath: string | null | undefined): boolean {
  if (!filePath) return false
  return AUDIO_EXT.test(filePath)
}
