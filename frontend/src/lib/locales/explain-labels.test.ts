import { describe, it, expect } from 'vitest'
import { resources } from './index'

// Mirrors the backend contract: ACTION_LABEL_KEYS plus the _facts() label
// keys from api/explain_service.py. tests/test_explain_contract.py asserts
// this list stays in sync with the backend constants.
const BACKEND_LABEL_KEYS = [
  'tasks.explain.actionRetry',
  'tasks.explain.actionOpenModelsSettings',
  'tasks.explain.actionOpenCredentials',
  'tasks.explain.actionCopyDiagnostics',
  'tasks.explain.actionReportIssue',
  'tasks.explain.factCommand',
  'tasks.explain.factType',
  'tasks.explain.factStatus',
  'tasks.explain.factError',
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

describe('Explain label_key locale contract', () => {
  it('every backend label_key resolves to a string in every locale', () => {
    const codes = Object.keys(resources)
    // 14 locales ship today; the loop below keeps covering any added later
    expect(codes.length).toBeGreaterThanOrEqual(14)

    for (const code of codes) {
      const translation = (resources as Record<string, { translation: Record<string, unknown> }>)[
        code
      ].translation
      for (const key of BACKEND_LABEL_KEYS) {
        const value = resolveDottedKey(translation, key)
        expect(typeof value, `${code} is missing ${key}`).toBe('string')
        expect((value as string).length, `${code} has an empty ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
