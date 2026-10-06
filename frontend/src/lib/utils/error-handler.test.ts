import { describe, it, expect } from 'vitest'

import { ERROR_MAP, getApiErrorKey, getApiErrorMessage } from './error-handler'

const t = (key: string) => `t:${key}`

// 后端重名报错串（api/source_group_service.py create/update 两处一致）必须映射成
// i18n 键，否则用户看到英文原文——"新建被告知已存在却看不见"的困惑会加倍。
const DUPLICATE = 'A group with this name already exists at this level'

describe('error-handler group duplicate-name mapping', () => {
  it('registers the backend duplicate-name string in ERROR_MAP', () => {
    expect(ERROR_MAP[DUPLICATE]).toBe('apiErrors.groupDuplicateName')
  })

  it('maps the raw message to the i18n key (exact match)', () => {
    expect(getApiErrorKey(DUPLICATE)).toBe('apiErrors.groupDuplicateName')
  })

  it('extracts the detail from axios-like error objects', () => {
    const error = { response: { data: { detail: DUPLICATE } } }
    expect(getApiErrorKey(error)).toBe('apiErrors.groupDuplicateName')
  })

  it('still maps when the backend appends extra text (prefix match)', () => {
    expect(getApiErrorKey(`${DUPLICATE}: choose another name`)).toBe(
      'apiErrors.groupDuplicateName'
    )
  })

  it('translates through t for display', () => {
    const localT = (key: string) => `[${key}]`
    expect(getApiErrorMessage(DUPLICATE, localT)).toBe('[apiErrors.groupDuplicateName]')
  })

  it('falls back to the generic key for unrelated messages', () => {
    expect(getApiErrorKey('Something completely different')).toBe('apiErrors.genericError')
  })
})

describe('getApiErrorMessage', () => {
  // Insight generation on a source with no text (#1394): the API's 400 detail
  // and the worker's failure message both map to one translated string.
  it.each(['Source has no text content', 'There is no text content to transform'])(
    'maps %j to the translated empty-source message',
    (detail) => {
      expect(getApiErrorMessage(detail, t, 'common.error')).toBe('t:apiErrors.sourceHasNoText')
    }
  )

  it('falls back to the given key when there is no server detail', () => {
    // SourceDetailContent passes '' for a network error with no response.
    expect(getApiErrorMessage('', t, 'common.error')).toBe('t:common.error')
  })

  it('returns an unmapped server detail as is', () => {
    expect(getApiErrorMessage('Something specific', t, 'common.error')).toBe('Something specific')
  })
})

describe('formatApiError structured detail objects', () => {
  // FastAPI 422s from project-env endpoints carry {"detail": {"message": ...,
  // "reason": ...}} — the message must surface instead of the English generic
  // fallback, or users see "An unexpected error occurred" over Chinese guidance.
  it('extracts detail.message from a structured axios-like error', () => {
    const error = {
      response: {
        data: { detail: { message: '请先在 notebook 导入资料', reason: 'knowledge_base_empty' } },
      },
    }
    expect(getApiErrorMessage(error, t, 'projectEnvs.mockGenerateFailed')).toBe(
      '请先在 notebook 导入资料'
    )
  })

  it('extracts detail.message from a bare structured error object', () => {
    expect(getApiErrorMessage({ detail: { message: '结构化提示' } }, t)).toBe('结构化提示')
  })

  it('keeps the generic fallback for object details without a string message', () => {
    // The hardcoded English fallback passes through unmapped — pre-existing
    // behavior; the point here is it does NOT leak detail.reason.
    expect(getApiErrorMessage({ response: { data: { detail: { reason: 'x' } } } }, t)).toBe(
      'An unexpected error occurred'
    )
  })
})
