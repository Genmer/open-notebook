import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { enUS } from '@/lib/locales/en-US'
import { zhCN } from '@/lib/locales/zh-CN'
import { resources } from '@/lib/locales'
import {
  displayTransformationDescription,
  displayTransformationTitle,
} from './transformation-display'

const en = enUS as unknown as Record<string, Record<string, string>>
// t() backed by the real en-US strings so the test asserts values, not key echo.
const t = ((key: string) => {
  const [section, leaf] = key.split('.')
  return en[section][leaf]
}) as TFunction

const zh = zhCN as unknown as Record<string, Record<string, string>>
const tZh = ((key: string) => {
  const [section, leaf] = key.split('.')
  return zh[section][leaf]
}) as TFunction

function expectAllKeysInEveryLocale(keys: string[]) {
  const locales = Object.entries(resources)
  expect(locales.length).toBeGreaterThanOrEqual(14)
  for (const [code, resource] of locales) {
    const leaves = resource.translation as unknown as Record<string, Record<string, string>>
    for (const key of keys) {
      const [section, leaf] = key.split('.')
      expect(typeof leaves[section]?.[leaf], `${code} missing ${key}`).toBe('string')
      expect(leaves[section][leaf].length, `${code} empty ${key}`).toBeGreaterThan(0)
    }
  }
}

describe('displayTransformationTitle', () => {
  it('resolves the six preset transformation titles', () => {
    expect(displayTransformationTitle('Dense Summary', t)).toBe('Dense Summary')
    expect(displayTransformationTitle('Paper Analysis', t)).toBe('Paper Analysis')
    expect(displayTransformationTitle('Reflection Questions', t)).toBe('Reflection Questions')
    expect(displayTransformationTitle('Simple Summary', t)).toBe('Simple Summary')
    expect(displayTransformationTitle('Table of Contents', t)).toBe('Table of Contents')
    expect(displayTransformationTitle('Key Insights', t)).toBe('Key Insights')
  })

  it('returns user-defined titles verbatim', () => {
    expect(displayTransformationTitle('我的自定义规则', t)).toBe('我的自定义规则')
    expect(displayTransformationTitle('dense summary', t)).toBe('dense summary')
  })

  it('maps a title to the exact i18n key', () => {
    const keyEcho = (key: string) => key
    expect(
      displayTransformationTitle('Dense Summary', keyEcho as TFunction)
    ).toBe('sources.transformationTitleDenseSummary')
  })

  it('returns undefined for null, undefined and empty titles', () => {
    expect(displayTransformationTitle(null, t)).toBeUndefined()
    expect(displayTransformationTitle(undefined, t)).toBeUndefined()
    expect(displayTransformationTitle('', t)).toBeUndefined()
  })

  it('resolves presets to the zh-CN bilingual format', () => {
    expect(displayTransformationTitle('Dense Summary', tZh)).toBe('Dense Summary（稠密摘要）')
    expect(displayTransformationTitle('Paper Analysis', tZh)).toBe('Paper Analysis（论文分析）')
    expect(displayTransformationTitle('Reflection Questions', tZh)).toBe(
      'Reflection Questions（反思问题）'
    )
    expect(displayTransformationTitle('Simple Summary', tZh)).toBe('Simple Summary（简单摘要）')
    expect(displayTransformationTitle('Table of Contents', tZh)).toBe('Table of Contents（目录）')
    expect(displayTransformationTitle('Key Insights', tZh)).toBe('Key Insights（核心见解）')
    // User-defined titles stay verbatim in every locale.
    expect(displayTransformationTitle('我的自定义规则', tZh)).toBe('我的自定义规则')
  })

  it('has all six preset keys in every locale', () => {
    const keys = [
      'sources.transformationTitleDenseSummary',
      'sources.transformationTitlePaperAnalysis',
      'sources.transformationTitleReflectionQuestions',
      'sources.transformationTitleSimpleSummary',
      'sources.transformationTitleTableOfContents',
      'sources.transformationTitleKeyInsights',
    ]
    expectAllKeysInEveryLocale(keys)
  })
})

describe('displayTransformationDescription', () => {
  // Exact English seed strings from open_notebook/database/migrations/5.surrealql
  // (preset transformation rows). Changing a seed silently falls back to English,
  // so the test pins them verbatim.
  const SEED_DESCRIPTIONS = [
    'Analyses a technical/scientific paper',
    'Extracts important insights and actionable items',
    'Creates a rich, deep summary of the content',
    'Generates reflection questions from the document to help explore it further',
    'Describes the different topics of the document',
    'Generates a small summary of the content',
  ]

  it('maps every seeded English description to its exact i18n key', () => {
    const keyEcho = (key: string) => key
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[0], keyEcho as TFunction)).toBe(
      'sources.transformationDescPaperAnalysis'
    )
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[1], keyEcho as TFunction)).toBe(
      'sources.transformationDescKeyInsights'
    )
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[2], keyEcho as TFunction)).toBe(
      'sources.transformationDescDenseSummary'
    )
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[3], keyEcho as TFunction)).toBe(
      'sources.transformationDescReflectionQuestions'
    )
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[4], keyEcho as TFunction)).toBe(
      'sources.transformationDescTableOfContents'
    )
    expect(displayTransformationDescription(SEED_DESCRIPTIONS[5], keyEcho as TFunction)).toBe(
      'sources.transformationDescSimpleSummary'
    )
  })

  it('resolves the six preset descriptions against real en-US strings', () => {
    for (const seed of SEED_DESCRIPTIONS) {
      // en-US carries the seed text itself, so the round-trip is identity
      expect(displayTransformationDescription(seed, t)).toBe(seed)
    }
  })

  it('resolves preset descriptions to zh-CN translations', () => {
    expect(
      displayTransformationDescription('Analyses a technical/scientific paper', tZh)
    ).toBe('分析技术类或科研类论文')
    expect(
      displayTransformationDescription('Creates a rich, deep summary of the content', tZh)
    ).toBe('为内容生成详尽深入的摘要')
  })

  it('returns user-defined descriptions verbatim', () => {
    expect(displayTransformationDescription('我的自定义描述', t)).toBe('我的自定义描述')
    expect(displayTransformationDescription('creates a rich summary', t)).toBe(
      'creates a rich summary'
    )
  })

  it('returns undefined for null, undefined and empty descriptions', () => {
    expect(displayTransformationDescription(null, t)).toBeUndefined()
    expect(displayTransformationDescription(undefined, t)).toBeUndefined()
    expect(displayTransformationDescription('', t)).toBeUndefined()
  })

  it('has all six preset keys in every locale', () => {
    expectAllKeysInEveryLocale([
      'sources.transformationDescDenseSummary',
      'sources.transformationDescPaperAnalysis',
      'sources.transformationDescReflectionQuestions',
      'sources.transformationDescSimpleSummary',
      'sources.transformationDescTableOfContents',
      'sources.transformationDescKeyInsights',
    ])
  })
})
