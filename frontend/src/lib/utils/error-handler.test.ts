import { describe, it, expect } from 'vitest'

import { ERROR_MAP, getApiErrorKey, getApiErrorMessage } from './error-handler'

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
    const t = (key: string) => `[${key}]`
    expect(getApiErrorMessage(DUPLICATE, t)).toBe('[apiErrors.groupDuplicateName]')
  })

  it('falls back to the generic key for unrelated messages', () => {
    expect(getApiErrorKey('Something completely different')).toBe('apiErrors.genericError')
  })
})
