import { describe, it, expect } from 'vitest'
import { resources } from './index'

// Frontend-owned keys for the explain card's AI styling + recovery-aware retry
// (2026-09-28 changeset). Unlike the backend-driven keys in
// explain-labels.test.ts, these must ship natively in EVERY locale — the
// en-US fallback is not good enough for the card's primary labels.
const EXPLAIN_UI_KEYS = [
  'tasks.explain.aiLabel',
  'tasks.explain.thinking',
  'tasks.explain.aiRetry',
  'tasks.explain.manualRetry',
  'tasks.explain.recoveredNotice',
  'tasks.explain.retrySkippedRecovered',
]

const resolveDottedKey = (
  obj: Record<string, unknown>,
  dotted: string,
): unknown =>
  dotted.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object') {
      return (acc as Record<string, unknown>)[part]
    }
    return undefined
  }, obj)

describe('Explain card UI-key locale coverage', () => {
  it('every locale ships each explain-card UI key natively (no en-US fallback)', () => {
    const codes = Object.keys(resources)
    // 14 locales ship today; the loop keeps covering any added later
    expect(codes.length).toBeGreaterThanOrEqual(14)

    for (const code of codes) {
      const translation = (resources as Record<string, { translation: Record<string, unknown> }>)[
        code
      ].translation
      for (const key of EXPLAIN_UI_KEYS) {
        const value = resolveDottedKey(translation, key)
        expect(typeof value, `${code} is missing ${key}`).toBe('string')
        expect(
          (value as string).trim().length,
          `${code} has an empty ${key}`,
        ).toBeGreaterThan(0)
      }
    }
  })
})
