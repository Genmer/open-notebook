const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * Displayable text during streaming: strips closed `<think>…</think>` blocks;
 * everything after an unclosed `<think>` stays hidden; a partial `<think`
 * prefix at the very end is held back so a half-received tag never flashes.
 *
 * The backend only cleans thinking content on the final message, so deltas
 * arrive as raw text and the frontend must filter them itself.
 */
export function filterStreamingContent(buffer: string): string {
  let out = ''
  let rest = buffer
  while (true) {
    const i = rest.indexOf(OPEN)
    if (i === -1) break
    out += rest.slice(0, i)
    const after = rest.slice(i + OPEN.length)
    const j = after.indexOf(CLOSE)
    if (j === -1) return out // think block not closed yet: hide the rest
    rest = after.slice(j + CLOSE.length)
  }
  for (let k = Math.min(OPEN.length - 1, rest.length); k > 0; k--) {
    if (rest.endsWith(OPEN.slice(0, k))) return out + rest.slice(0, rest.length - k)
  }
  return out + rest
}
