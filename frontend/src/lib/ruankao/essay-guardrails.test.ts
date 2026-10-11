import { describe, expect, it } from 'vitest'
import {
  BODY_HARD_CAP,
  BODY_NEAR_MIN,
  BODY_OK_MIN,
  SECTION_BASELINES,
  SECTION_TARGET_TOTAL,
  bodyState,
  capacityPercent,
  countChars,
  essayCompleteness,
  guardAbstract,
  guardArguments,
  guardBody,
  guardClosing,
  guardQ2,
  sectionState,
  type EssaySectionKey,
} from './essay-guardrails'

describe('countChars', () => {
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(countChars('')).toBe(0)
    expect(countChars('摘要三百字')).toBe(5)
    // 代理对（emoji）算一个字；中文含标点口径下裸 emoji 不多计
    expect(countChars('🙂')).toBe(1)
    expect(countChars('🙂🙂')).toBe(2)
    expect(countChars('a🙂b')).toBe(3)
  })
})

describe('guardAbstract（摘要 ≤300，含标点，>300 即超）', () => {
  it('returns ok at and below 300, over above it', () => {
    expect(guardAbstract(0)).toBe('ok')
    expect(guardAbstract(300)).toBe('ok')
    expect(guardAbstract(301)).toBe('over')
  })
})

describe('guardBody（正文 2000-2500 健康，≥2500 红锁，<2000 偏薄）', () => {
  it('covers the three bands and both boundaries', () => {
    expect(guardBody(0)).toBe('warn')
    expect(guardBody(1999)).toBe('warn')
    expect(guardBody(2000)).toBe('ok')
    // 红锁边界收紧（裁决 #9）：恰好 2500 即 over——「已达硬上限」是预警不是安全
    expect(guardBody(2499)).toBe('ok')
    expect(guardBody(2500)).toBe('over')
    expect(guardBody(2501)).toBe('over')
  })
})

describe('guardQ2（~500，下限 400）', () => {
  it('warns below 400, ok at and above', () => {
    expect(guardQ2(0)).toBe('warn')
    expect(guardQ2(399)).toBe('warn')
    expect(guardQ2(400)).toBe('ok')
    expect(guardQ2(500)).toBe('ok')
    // 旧三态守卫回归钉：近超线的 600 仍返回 ok（near 不折叠进 warn，
    // 训练器可见行为逐字节不变——设计稿 ②2.3 修正裁决）
    expect(guardQ2(600)).toBe('ok')
  })
})

describe('guardArguments（两段 ~1000，下限 900）', () => {
  it('warns below 900, ok at and above', () => {
    expect(guardArguments(0)).toBe('warn')
    expect(guardArguments(899)).toBe('warn')
    expect(guardArguments(900)).toBe('ok')
    expect(guardArguments(1000)).toBe('ok')
  })
})

describe('guardClosing（~400，下限 300）', () => {
  it('warns below 300, ok at and above', () => {
    expect(guardClosing(0)).toBe('warn')
    expect(guardClosing(299)).toBe('warn')
    expect(guardClosing(300)).toBe('ok')
    expect(guardClosing(400)).toBe('ok')
  })
})

describe('SECTION_BASELINES（论文容量基准表，单一数字源）', () => {
  it('has the five exam sections in answer-sheet order', () => {
    expect(SECTION_BASELINES.map((b) => b.key)).toEqual([
      'abstract',
      'background',
      'question2',
      'arguments',
      'closing',
    ])
  })

  it('carries the F/T/C/H values from the baseline table', () => {
    expect(
      Object.fromEntries(
        SECTION_BASELINES.map((b) => [b.key, [b.floor, b.target, b.ceiling, b.hard]])
      )
    ).toEqual({
      abstract: [200, 300, 300, 300], // 300 即硬口径，near 带为空
      background: [400, 500, 600, 700],
      question2: [400, 500, 600, 700],
      arguments: [900, 1000, 1100, 1200],
      closing: [300, 400, 500, 600],
    })
  })

  it('sums five targets to the 2700 track capacity', () => {
    expect(SECTION_TARGET_TOTAL).toBe(2700)
    expect(
      SECTION_BASELINES.reduce((sum, b) => sum + b.target, 0)
    ).toBe(SECTION_TARGET_TOTAL)
  })

  it('uses ADR-011 section color tokens (never raw palette classes)', () => {
    expect(SECTION_BASELINES.map((b) => b.colorClass)).toEqual([
      'bg-teal',
      'bg-slate-hue',
      'bg-plum',
      'bg-fern',
      'bg-sage',
    ])
  })

  it('keeps the four body thresholds in the same module', () => {
    expect(BODY_OK_MIN).toBe(2000)
    expect(BODY_NEAR_MIN).toBe(2400)
    expect(BODY_HARD_CAP).toBe(2500)
  })
})

describe('sectionState（段四态：under/ok/near/over）', () => {
  it('bands each section on F/C/H boundaries', () => {
    // 摘要：C=H=300，无 near 带——>300 直接 over（考场硬口径）
    expect(sectionState('abstract', 199)).toBe('under')
    expect(sectionState('abstract', 200)).toBe('ok')
    expect(sectionState('abstract', 300)).toBe('ok')
    expect(sectionState('abstract', 301)).toBe('over')

    // 四段统一 H=C+100 失衡带：background/question2 600|700、arguments 1100|1200、
    // closing 500|600
    expect(sectionState('background', 399)).toBe('under')
    expect(sectionState('background', 400)).toBe('ok')
    expect(sectionState('background', 600)).toBe('ok')
    expect(sectionState('background', 601)).toBe('near')
    expect(sectionState('background', 700)).toBe('near')
    expect(sectionState('background', 701)).toBe('over')

    expect(sectionState('question2', 399)).toBe('under')
    expect(sectionState('question2', 400)).toBe('ok')
    expect(sectionState('question2', 600)).toBe('ok')
    expect(sectionState('question2', 601)).toBe('near')
    expect(sectionState('question2', 701)).toBe('over')

    expect(sectionState('arguments', 899)).toBe('under')
    expect(sectionState('arguments', 900)).toBe('ok')
    expect(sectionState('arguments', 1100)).toBe('ok')
    expect(sectionState('arguments', 1101)).toBe('near')
    expect(sectionState('arguments', 1200)).toBe('near')
    expect(sectionState('arguments', 1201)).toBe('over')

    expect(sectionState('closing', 299)).toBe('under')
    expect(sectionState('closing', 300)).toBe('ok')
    expect(sectionState('closing', 500)).toBe('ok')
    expect(sectionState('closing', 501)).toBe('near')
    expect(sectionState('closing', 601)).toBe('over')
  })

  it('falls back to ok for a key outside the baseline table', () => {
    expect(sectionState('nope' as EssaySectionKey, 99999)).toBe('ok')
  })
})

describe('bodyState（正文四态梯度）', () => {
  it('walks thin/ok/near/over with both yellow-line boundaries', () => {
    expect(bodyState(0)).toBe('thin')
    expect(bodyState(1999)).toBe('thin')
    expect(bodyState(2000)).toBe('ok')
    expect(bodyState(2399)).toBe('ok')
    expect(bodyState(2400)).toBe('near')
    expect(bodyState(2499)).toBe('near')
    expect(bodyState(2500)).toBe('over') // 红锁边界 ≥2500（裁决 #9）
    expect(bodyState(2600)).toBe('over')
  })
})

describe('capacityPercent（泳道填充占比）', () => {
  it('is linear up to the target and capped at 100', () => {
    expect(capacityPercent(0, 300)).toBe(0)
    expect(capacityPercent(150, 300)).toBe(50)
    expect(capacityPercent(300, 300)).toBe(100)
    expect(capacityPercent(450, 300)).toBe(100) // 超目标封顶
    expect(capacityPercent(600, 500)).toBe(100)
  })

  it('guards a zero target', () => {
    expect(capacityPercent(10, 0)).toBe(0)
  })
})

describe('essayCompleteness（交卷完整度）', () => {
  const blank = {
    abstract: '',
    background: '',
    question2: '',
    arguments: '',
    closing: '',
  }

  it('honestly reports 0/5 for an empty draft', () => {
    const result = essayCompleteness(blank)
    expect(result.met).toBe(0)
    expect(result.total).toBe(5)
    expect(result.issues.map((i) => i.key)).toEqual([
      'abstract',
      'background',
      'question2',
      'arguments',
      'closing',
    ])
    expect(result.issues.every((i) => i.state === 'under')).toBe(true)
  })

  it('counts 3/5 with chips only for the unmet sections', () => {
    const result = essayCompleteness({
      ...blank,
      abstract: 'a'.repeat(250), // ok（200~300）
      background: 'b'.repeat(650), // near（偏多，>600）→ 也算未达标
      question2: 'c'.repeat(450), // ok
      arguments: 'd'.repeat(1000), // ok
      closing: 'e'.repeat(100), // under
    })
    expect(result.met).toBe(3)
    expect(result.total).toBe(5)
    expect(result.issues).toEqual([
      { key: 'background', state: 'near' },
      { key: 'closing', state: 'under' },
    ])
  })

  it('reports 5/5 with no issues when every section is in band', () => {
    const result = essayCompleteness({
      ...blank,
      abstract: 'a'.repeat(300),
      background: 'b'.repeat(500),
      question2: 'c'.repeat(500),
      arguments: 'd'.repeat(1000),
      closing: 'e'.repeat(400),
    })
    expect(result.met).toBe(5)
    expect(result.total).toBe(5)
    expect(result.issues).toEqual([])
  })
})
