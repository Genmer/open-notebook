import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Quad } from '@/lib/pdf/annotation-anchor'
import AnnotationSvgOverlay, {
  buildStraightPath,
  buildWavyPath,
  quadToWashRect,
} from './AnnotationSvgOverlay'
import type { OverlayAnnotation } from './AnnotationSvgOverlay'

/** "t 4 0" × count — the repeating half-wave of the §4.3 pattern. */
const bumps = (count: number): string => Array<string>(count).fill('t 4 0').join(' ')

// Quads in PDF user space (y grows upward). y1 is the LOWER edge.
const wide: Quad = { x1: 100, y1: 600, x2: 300, y2: 616 } // width 200 → 50 half-waves, no tail
const medium: Quad = { x1: 90, y1: 560, x2: 100, y2: 576 } // width 10 → 2 half-waves + 2u tail
const narrow: Quad = { x1: 50, y1: 500, x2: 53, y2: 516 } // width 3 < one segment
const tinyTail: Quad = { x1: 10, y1: 400, x2: 14.4, y2: 416 } // tail 0.4u < 0.5u drop threshold
const oddTail: Quad = { x1: 200, y1: 300, x2: 214, y2: 316 } // 3 half-waves + 2u tail (crest side)
const degenerate: Quad = { x1: 100, y1: 600, x2: 100, y2: 616 } // zero width

describe('buildWavyPath', () => {
  it('lays the §4.3 pattern along each quad: q 2 -3.5 4 0 then reflecting t 4 0', () => {
    // Baseline sits 3.5 user units above the quad's bottom edge (600 + 3.5).
    expect(buildWavyPath([wide])).toBe(`M 100 603.5 q 2 -3.5 4 0 ${bumps(49)}`)
  })

  it('emits one wave train per quad, space-joined', () => {
    expect(buildWavyPath([wide, medium])).toBe(
      `M 100 603.5 q 2 -3.5 4 0 ${bumps(49)} M 90 563.5 q 2 -3.5 4 0 t 4 0 q 1 -1.75 2 0`
    )
  })

  it('closes a >=0.5u tail with a proportional bump, alternating crest/trough', () => {
    // 3 full half-waves (q + 2×t) → next control is on the +side.
    expect(buildWavyPath([oddTail])).toBe(
      'M 200 303.5 q 2 -3.5 4 0 t 4 0 t 4 0 q 1 1.75 2 0'
    )
    // 2 full half-waves → next control is on the −side (medium case above).
  })

  it('drops a sub-threshold tail instead of spiking', () => {
    expect(buildWavyPath([tinyTail])).toBe('M 10 403.5 q 2 -3.5 4 0')
  })

  it('scales bump height proportionally on quads narrower than one segment', () => {
    // width 3 < 4 → single bump of height 3/4 × 3.5 = 2.625, no needle.
    expect(buildWavyPath([narrow])).toBe('M 50 503.5 q 1.5 -2.625 3 0')
  })

  it('honours baselineOffset / segmentWidth / waveHeight options', () => {
    expect(buildWavyPath([wide], { baselineOffset: 4 })).toBe(`M 100 604 q 2 -3.5 4 0 ${bumps(49)}`)
    expect(buildWavyPath([{ x1: 0, y1: 0, x2: 16, y2: 10 }], { segmentWidth: 8, waveHeight: 7 })).toBe(
      'M 0 3.5 q 4 -7 8 0 t 8 0'
    )
  })

  it('skips zero/negative-width quads and returns "" for empty input', () => {
    expect(buildWavyPath([])).toBe('')
    expect(buildWavyPath([degenerate])).toBe('')
  })
})

describe('buildStraightPath', () => {
  it('draws M x0 y L x1 y per quad on the same baseline rule', () => {
    expect(buildStraightPath([wide, medium])).toBe(
      'M 100 603.5 L 300 603.5 M 90 563.5 L 100 563.5'
    )
  })

  it('honours baselineOffset and skips degenerate/empty input', () => {
    expect(buildStraightPath([wide], { baselineOffset: 4 })).toBe('M 100 604 L 300 604')
    expect(buildStraightPath([degenerate])).toBe('')
    expect(buildStraightPath([])).toBe('')
  })
})

describe('quadToWashRect', () => {
  it('maps a quad to its user-space wash rect, rounded to 0.001', () => {
    expect(quadToWashRect({ x1: 90.123456, y1: 560.1, x2: 100.7, y2: 576.9 })).toEqual({
      x: 90.123,
      y: 560.1,
      width: 10.577,
      height: 16.8,
    })
  })

  it('returns null for degenerate quads', () => {
    expect(quadToWashRect({ x1: 10, y1: 5, x2: 20, y2: 5 })).toBeNull()
    expect(quadToWashRect({ x1: 10, y1: 5, x2: 10, y2: 15 })).toBeNull()
  })
})

// Page 612×792 user units at scale 1.5 → 918×1188 CSS px.
const annotations: OverlayAnnotation[] = [
  {
    id: 'anno-1',
    color: 'gold',
    lineStyle: 'wavy',
    quads: [{ x1: 72, y1: 700, x2: 244, y2: 712 }], // width 172 → 43 half-waves
  },
  {
    id: 'anno-2',
    color: 'fern',
    lineStyle: 'straight',
    quads: [{ x1: 72, y1: 650.25, x2: 300.5, y2: 662 }],
  },
  {
    id: 'anno-3',
    color: 'clay',
    lineStyle: 'wavy',
    quads: [
      { x1: 72, y1: 600, x2: 200, y2: 612 },
      { x1: 72, y1: 580, x2: 180, y2: 592 },
    ],
  },
]

function renderOverlay(props: Partial<Parameters<typeof AnnotationSvgOverlay>[0]> = {}) {
  return render(
    <AnnotationSvgOverlay
      annotations={annotations}
      userWidth={612}
      userHeight={792}
      cssWidth={918}
      cssHeight={1188}
      {...props}
    />
  )
}

describe('AnnotationSvgOverlay', () => {
  it('renders an svg in user-space viewBox at the CSS size, with one y-flip group', () => {
    renderOverlay()

    const svg = screen.getByTestId('annotation-svg-overlay')
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg).toHaveAttribute('viewBox', '0 0 612 792')
    expect(svg).toHaveAttribute('width', '918')
    expect(svg).toHaveAttribute('height', '1188')
    // SVGElement.className is an SVGAnimatedString — read the raw attribute.
    expect(svg.getAttribute('class')).toContain('pointer-events-none')
    expect(svg.getAttribute('class')).toContain('z-[2]')
    expect(svg.getAttribute('class')).toContain('absolute')
    expect(svg.getAttribute('class')).toContain('inset-0')

    const flip = svg.querySelector('g')
    expect(flip).toHaveAttribute('transform', 'scale(1,-1) translate(0,-792)')
  })

  it('renders one pointer-events-auto group per annotation with testids', () => {
    renderOverlay()

    for (const id of ['anno-1', 'anno-2', 'anno-3']) {
      const group = screen.getByTestId(`anno-overlay-${id}`)
      expect(group).toHaveAttribute('data-annotation-id', id)
      expect(group.getAttribute('class')).toContain('pointer-events-auto')
      expect(group.getAttribute('data-active')).toBeNull()
    }
    expect(screen.getByTestId('annotation-svg-overlay').querySelectorAll('path')).toHaveLength(3)
  })

  it('draws paths from the pure builders and inks them with the color tokens', () => {
    renderOverlay()

    const path1 = screen.getByTestId('anno-overlay-anno-1').querySelector('path')
    expect(path1).toHaveAttribute('d', `M 72 703.5 q 2 -3.5 4 0 ${bumps(42)}`)
    expect(path1?.getAttribute('style')).toContain('var(--anno-gold-ink)')

    const path2 = screen.getByTestId('anno-overlay-anno-2').querySelector('path')
    expect(path2).toHaveAttribute('d', 'M 72 653.75 L 300.5 653.75')
    expect(path2?.getAttribute('style')).toContain('var(--anno-fern-ink)')

    for (const path of document.querySelectorAll('path')) {
      expect(path).toHaveAttribute('fill', 'none')
      expect(path).toHaveAttribute('stroke-width', '1.5')
      expect(path).toHaveAttribute('vector-effect', 'non-scaling-stroke')
      expect(path).toHaveAttribute('stroke-linecap', 'round')
      expect(path).toHaveAttribute('stroke-linejoin', 'round')
    }
  })

  it('washes one user-space rect per quad with the paper token', () => {
    renderOverlay()

    const rects = screen.getByTestId('anno-overlay-anno-3').querySelectorAll('rect')
    expect(rects).toHaveLength(2)
    expect(rects[0]).toHaveAttribute('x', '72')
    expect(rects[0]).toHaveAttribute('y', '600')
    expect(rects[0]).toHaveAttribute('width', '128')
    expect(rects[0]).toHaveAttribute('height', '12')
    expect(rects[0].getAttribute('style')).toContain('var(--anno-clay-paper)')
    expect(rects[0]).toHaveAttribute('pointer-events', 'none')
    expect(rects[1]).toHaveAttribute('x', '72')
    expect(rects[1]).toHaveAttribute('y', '580')
    expect(rects[1]).toHaveAttribute('width', '108')
    expect(rects[1]).toHaveAttribute('height', '12')

    // Single-quad annotation → exactly one rect.
    expect(screen.getByTestId('anno-overlay-anno-1').querySelectorAll('rect')).toHaveLength(1)
  })

  it('fires onHover/onLeave from the annotation group', () => {
    const onHover = vi.fn()
    const onLeave = vi.fn()
    renderOverlay({ onHover, onLeave })

    fireEvent.mouseEnter(screen.getByTestId('anno-overlay-anno-1'))
    expect(onHover).toHaveBeenCalledTimes(1)
    expect(onHover).toHaveBeenCalledWith('anno-1', expect.anything())

    fireEvent.mouseLeave(screen.getByTestId('anno-overlay-anno-1'))
    expect(onLeave).toHaveBeenCalledTimes(1)
    expect(onLeave).toHaveBeenCalledWith('anno-1')

    // Other groups are wired independently.
    fireEvent.mouseEnter(screen.getByTestId('anno-overlay-anno-3'))
    expect(onHover).toHaveBeenLastCalledWith('anno-3', expect.anything())
  })

  it('darkens ink and boosts the wash only for activeId', () => {
    const { rerender } = renderOverlay()

    rerender(
      <AnnotationSvgOverlay
        annotations={annotations}
        userWidth={612}
        userHeight={792}
        cssWidth={918}
        cssHeight={1188}
        activeId="anno-1"
      />
    )

    const activeGroup = screen.getByTestId('anno-overlay-anno-1')
    expect(activeGroup).toHaveAttribute('data-active', 'true')
    const activePath = activeGroup.querySelector('path')
    expect(activePath?.getAttribute('style')).toContain('brightness(0.8)')
    // Base wash + one stacked boost rect.
    const activeRects = activeGroup.querySelectorAll('rect')
    expect(activeRects).toHaveLength(2)
    expect(activeRects[1]).toHaveAttribute('data-wash-boost', 'true')
    expect(activeRects[1]).toHaveAttribute('opacity', '0.4')

    const idleGroup = screen.getByTestId('anno-overlay-anno-2')
    expect(idleGroup.getAttribute('data-active')).toBeNull()
    expect(idleGroup.querySelector('path')?.getAttribute('style')).not.toContain('brightness')
    expect(idleGroup.querySelectorAll('rect')).toHaveLength(1)
    expect(idleGroup.querySelector('[data-wash-boost]')).toBeNull()
  })
})
