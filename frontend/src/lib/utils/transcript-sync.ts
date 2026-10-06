/**
 * Timestamp-free playback ↔ text synchronization.
 *
 * Uploaded-audio sources only keep a plain-text transcript (no per-word or
 * per-segment timestamps), so playback progress is mapped onto the text by
 * cumulative character share: a sentence starting at 42% of the total
 * characters highlights while the playhead sits at 42% of the duration. It is
 * an approximation (speech pace varies), but it gives sentence-level follow
 * highlighting with zero backend changes and works for every existing audio
 * source.
 */

export interface TranscriptSpan {
  /** Offsets into the ORIGINAL full text. */
  start: number
  end: number
}

// CJK terminators end a sentence unconditionally; latin ones only when
// followed by whitespace/end-of-line (avoids decimals and abbreviations).
const SENTENCE_END = /[。！？]|[.!?…](?=\s|$)/
// Trailing-dot abbreviations that must not split: "Mr. Smith paid…".
const ABBREV_TAIL = /(Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|Fig|No|Inc|Ltd|Co|approx|dept|est|min|max)\.$/

/**
 * Split a transcript into sentence spans inside its existing paragraphs
 * (blank-line separated). Whitespace-only stretches belong to no sentence.
 */
export function splitTranscriptSentences(text: string): TranscriptSpan[] {
  const spans: TranscriptSpan[] = []
  let paragraphStart = 0
  const flushParagraph = (end: number) => {
    const paragraph = text.slice(paragraphStart, end)
    let cursor = 0
    for (const rawLine of paragraph.split('\n')) {
      let lineCursor = 0
      const line = rawLine
      let searchFrom = 0
      for (;;) {
        const rest = line.slice(searchFrom)
        const match = rest.match(SENTENCE_END)
        if (!match || match.index === undefined) break
        const sentenceEnd = searchFrom + match.index + 1
        if (
          match[0] !== '。' &&
          match[0] !== '！' &&
          match[0] !== '？' &&
          ABBREV_TAIL.test(line.slice(0, sentenceEnd))
        ) {
          // "Mr." / "etc." — keep scanning past the abbreviation dot.
          searchFrom = sentenceEnd
          continue
        }
        const sentence = line.slice(lineCursor, sentenceEnd)
        if (sentence.trim()) {
          // Trim the leading whitespace so spans start on real text.
          const lead = sentence.length - sentence.trimStart().length
          spans.push({
            start: paragraphStart + cursor + lineCursor + lead,
            end: paragraphStart + cursor + sentenceEnd,
          })
          lineCursor = sentenceEnd
        }
        searchFrom = sentenceEnd
      }
      const leftover = line.slice(lineCursor)
      if (leftover.trim()) {
        // No terminator: the leftover is a sentence of its own.
        const lead = leftover.length - leftover.trimStart().length
        spans.push({
          start: paragraphStart + cursor + lineCursor + lead,
          end: paragraphStart + cursor + line.length,
        })
      }
      cursor += line.length + 1
    }
  }

  let idx = text.indexOf('\n\n')
  while (idx !== -1) {
    flushParagraph(idx)
    paragraphStart = idx + 2
    idx = text.indexOf('\n\n', paragraphStart)
  }
  flushParagraph(text.length)
  return spans
}

/** Character weight of a span, whitespace excluded. */
function weight(text: string, span: TranscriptSpan): number {
  let count = 0
  for (let i = span.start; i < span.end; i += 1) {
    if (!/\s/.test(text[i])) count += 1
  }
  return count
}

/**
 * Index of the sentence the playhead is on, given playback progress in [0, 1].
 * Returns -1 for empty input; clamps progress into [0, 1].
 */
export function activeSentenceIndex(
  text: string,
  spans: TranscriptSpan[],
  progress: number
): number {
  if (spans.length === 0) return -1
  const clamped = Math.min(1, Math.max(0, progress))
  const total = spans.reduce((sum, span) => sum + weight(text, span), 0)
  if (total === 0) return -1
  let acc = 0
  for (let i = 0; i < spans.length; i += 1) {
    acc += weight(text, spans[i])
    // Strictly-less keeps a playhead exactly at a sentence boundary on the
    // NEW sentence — consistent with spanStartProgress-based seeking.
    if (clamped * total < acc) return i
  }
  return spans.length - 1
}

/**
 * Share of the total character weight that lies before a span — the playback
 * fraction at which a segment becomes active. Used for click-to-seek: jumping
 * the playhead so the clicked sentence lights up.
 */
export function spanStartProgress(text: string, spans: TranscriptSpan[], index: number): number {
  const total = spans.reduce((sum, span) => sum + weight(text, span), 0)
  if (total === 0 || index < 0 || index >= spans.length) return 0
  let acc = 0
  for (let i = 0; i < index; i += 1) acc += weight(text, spans[i])
  return acc / total
}
