'use client'

import { Fragment } from 'react'
import type { MouseEvent } from 'react'
import type { Quad } from '@/lib/pdf/annotation-anchor'

/**
 * SVG annotation overlay for a single PDF page (plan §4.3/§4.6, F4).
 *
 * The svg is absolutely positioned over the page wrapper at z-[2] (between
 * the canvas+textLayer and the floating TOC). Its viewBox IS PDF user space
 * (y grows upward), so persisted quads render verbatim after a single y-flip
 * group; zoom needs no path regeneration — the viewBox scales user units to
 * the CSS-pixel page and `vector-effect="non-scaling-stroke"` keeps the ink
 * at a constant 1.5 CSS px.
 *
 * Pure rendering: no selection listening, no page state — props in, SVG out.
 */

/** Semantic ink colors; tokens --anno-<color>-ink/-paper live in globals.css. */
export const ANNOTATION_COLORS = ['gold', 'fern', 'plum', 'slate', 'clay'] as const
export type AnnotationColor = (typeof ANNOTATION_COLORS)[number]

export const ANNOTATION_LINE_STYLES = ['wavy', 'straight'] as const
export type AnnotationLineStyle = (typeof ANNOTATION_LINE_STYLES)[number]

export interface OverlayAnnotation {
  id: string
  color: AnnotationColor
  lineStyle: AnnotationLineStyle
  /** One quad per selected text line, in PDF user space. */
  quads: Quad[]
}

export interface AnnotationSvgOverlayProps {
  annotations: OverlayAnnotation[]
  /** Page size in PDF user units (the viewBox space, y grows upward). */
  userWidth: number
  userHeight: number
  /** Page size in CSS pixels — the scaled on-screen page. */
  cssWidth: number
  cssHeight: number
  /** Id of the selected annotation: darker ink + boosted wash (§4.3). */
  activeId?: string | null
  onHover?: (id: string, event: MouseEvent<SVGGElement>) => void
  onLeave?: (id: string) => void
}

/** Constant 1.5 CSS px ink regardless of zoom (plan §4.3 hard rule). */
const INK_STROKE_WIDTH = 1.5
/**
 * Selected wash boost (§4.3 "洗底升 30%"): the --anno-*-paper token bakes a
 * 22% alpha in, and a single rect's opacity cannot exceed 1 — so the active
 * state stacks one extra paper pass at 40%:
 * 0.22 + (1-0.22)·0.22·0.40 ≈ 0.289 ≈ 22% × 1.3.
 */
const ACTIVE_WASH_BOOST_OPACITY = 0.4
/** Selected ink darkening (§4.3 "ink 加深") — brightness filter over the var(). */
const ACTIVE_INK_FILTER = 'brightness(0.8)'

/** Path/attr precision: 0.001 user units is far below any zoom threshold. */
const COORD_PRECISION = 3

function round3(n: number): number {
  return Math.round(n * 10 ** COORD_PRECISION) / 10 ** COORD_PRECISION
}

/** Fixed-point formatting keeps generated `d` strings snapshot-stable. */
function fmt(n: number): string {
  return String(round3(n) + 0) // `+ 0` normalizes -0
}

export interface WavyPathOptions {
  /** Baseline offset above each quad's bottom edge, user units (default 3.5). */
  baselineOffset?: number
  /** Half-wavelength in user units; λ = 2 × segmentWidth (default 4 → λ=8). */
  segmentWidth?: number
  /** Quadratic control height; rendered amplitude is half of it (default 3.5 → 1.75). */
  waveHeight?: number
}

/**
 * Wavy underline `d` for a set of quads, one wave train per line quad:
 * `M x0 y0 q 2 -3.5 4 0 t 4 0 t 4 0 …` (plan §4.3, @scale=1 user units).
 * The baseline sits `baselineOffset` above the quad's bottom edge (user
 * space: y grows upward). A trailing stretch shorter than half a segment is
 * dropped (invisible at any zoom); narrow quads scale the bump height
 * proportionally so they never render as tall needles.
 */
export function buildWavyPath(quads: Quad[], opts: WavyPathOptions = {}): string {
  const { baselineOffset = 3.5, segmentWidth = 4, waveHeight = 3.5 } = opts
  const parts: string[] = []
  for (const quad of quads) {
    const width = quad.x2 - quad.x1
    if (width <= 0) continue
    const y = quad.y1 + baselineOffset
    const fullSegments = Math.floor(width / segmentWidth)
    const remainder = width - fullSegments * segmentWidth
    // First bump is an explicit quadratic (`q`); the rest are reflecting
    // smooth quadratics (`t`) so crest/trough alternate without re-stating
    // the control point. A quad narrower than one segment gets a single
    // width-proportional bump instead.
    const firstWidth = fullSegments > 0 ? segmentWidth : remainder
    const firstHeight = (firstWidth / segmentWidth) * waveHeight
    parts.push(
      `M ${fmt(quad.x1)} ${fmt(y)} q ${fmt(firstWidth / 2)} ${fmt(-firstHeight)} ${fmt(firstWidth)} 0`
    )
    for (let i = 1; i < fullSegments; i++) {
      parts.push(`t ${fmt(segmentWidth)} 0`)
    }
    if (fullSegments > 0 && remainder >= 0.5) {
      // Explicit closing bump keeps the reflected control height proportional
      // (a bare `t r 0` would reuse the full 3.5 control and spike). Side
      // alternates with the bumps emitted so far.
      const side = fullSegments % 2 === 0 ? -1 : 1
      const height = Math.min(waveHeight, (remainder / segmentWidth) * waveHeight)
      parts.push(`q ${fmt(remainder / 2)} ${fmt(side * height)} ${fmt(remainder)} 0`)
    }
  }
  return parts.join(' ')
}

/**
 * Straight underline `d`: `M x0 y L x1 y` per quad, same baseline rule as
 * the wavy path.
 */
export function buildStraightPath(
  quads: Quad[],
  opts: Pick<WavyPathOptions, 'baselineOffset'> = {}
): string {
  const { baselineOffset = 3.5 } = opts
  const parts: string[] = []
  for (const quad of quads) {
    if (quad.x2 <= quad.x1) continue
    const y = quad.y1 + baselineOffset
    parts.push(`M ${fmt(quad.x1)} ${fmt(y)} L ${fmt(quad.x2)} ${fmt(y)}`)
  }
  return parts.join(' ')
}

export interface WashRect {
  x: number
  y: number
  width: number
  height: number
}

/** Highlight-wash rect for one quad, in user space (rendered inside the y-flip). */
export function quadToWashRect(quad: Quad): WashRect | null {
  const width = round3(quad.x2 - quad.x1)
  const height = round3(quad.y2 - quad.y1)
  if (width <= 0 || height <= 0) return null
  return { x: round3(quad.x1), y: round3(quad.y1), width, height }
}

export default function AnnotationSvgOverlay({
  annotations,
  userWidth,
  userHeight,
  cssWidth,
  cssHeight,
  activeId = null,
  onHover,
  onLeave,
}: AnnotationSvgOverlayProps) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[2]"
      width={round3(cssWidth)}
      height={round3(cssHeight)}
      viewBox={`0 0 ${fmt(userWidth)} ${fmt(userHeight)}`}
      data-testid="annotation-svg-overlay"
    >
      {/* User space (y up) → svg space (y down): p → (x, userHeight − y). */}
      <g transform={`scale(1,-1) translate(0,${fmt(-userHeight)})`}>
        {annotations.map((annotation) => {
          const isActive = annotation.id === activeId
          const d =
            annotation.lineStyle === 'wavy'
              ? buildWavyPath(annotation.quads)
              : buildStraightPath(annotation.quads)
          const washStyle = { fill: `var(--anno-${annotation.color}-paper)` }
          return (
            <g
              key={annotation.id}
              className="pointer-events-auto"
              data-annotation-id={annotation.id}
              data-testid={`anno-overlay-${annotation.id}`}
              data-active={isActive ? 'true' : undefined}
              onMouseEnter={(event) => onHover?.(annotation.id, event)}
              onMouseLeave={() => onLeave?.(annotation.id)}
            >
              {/* Wash rects stay pointer-transparent so the textLayer keeps
                  native selection; only the inked line is hittable. */}
              {annotation.quads.map((quad, index) => {
                const rect = quadToWashRect(quad)
                if (!rect) return null
                return (
                  <Fragment key={index}>
                    <rect
                      x={rect.x}
                      y={rect.y}
                      width={rect.width}
                      height={rect.height}
                      style={washStyle}
                      pointerEvents="none"
                    />
                    {isActive && (
                      <rect
                        x={rect.x}
                        y={rect.y}
                        width={rect.width}
                        height={rect.height}
                        style={washStyle}
                        opacity={ACTIVE_WASH_BOOST_OPACITY}
                        pointerEvents="none"
                        data-wash-boost="true"
                      />
                    )}
                  </Fragment>
                )
              })}
              <path
                d={d}
                fill="none"
                strokeWidth={INK_STROKE_WIDTH}
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  stroke: `var(--anno-${annotation.color}-ink)`,
                  ...(isActive ? { filter: ACTIVE_INK_FILTER } : null),
                }}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
