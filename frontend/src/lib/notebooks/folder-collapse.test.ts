import { beforeEach, describe, expect, it } from 'vitest'
import {
  FOLDER_COLLAPSE_STORAGE_KEY,
  readFolderOverrides,
  setFolderOverride,
  writeFolderOverrides,
} from './folder-collapse'

describe('folder-collapse store', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('falls back to an empty map on missing key, bad JSON, wrong version or non-object byNotebook', () => {
    expect(readFolderOverrides('nb1')).toEqual({})

    window.localStorage.setItem(FOLDER_COLLAPSE_STORAGE_KEY, '{not json')
    expect(readFolderOverrides('nb1')).toEqual({})

    window.localStorage.setItem(
      FOLDER_COLLAPSE_STORAGE_KEY,
      JSON.stringify({ version: 2, byNotebook: { nb1: { g1: true } } }),
    )
    expect(readFolderOverrides('nb1')).toEqual({})

    window.localStorage.setItem(
      FOLDER_COLLAPSE_STORAGE_KEY,
      JSON.stringify({ version: 1, byNotebook: 'nope' }),
    )
    expect(readFolderOverrides('nb1')).toEqual({})
  })

  it('drops non-boolean values instead of failing the whole map', () => {
    window.localStorage.setItem(
      FOLDER_COLLAPSE_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: { nb1: { g1: 'yes', g2: true, g3: 1, ungrouped: false } },
      }),
    )
    expect(readFolderOverrides('nb1')).toEqual({ g2: true, ungrouped: false })
  })

  it('round-trips overrides through localStorage', () => {
    writeFolderOverrides('nb1', { 'group:1': true, ungrouped: false })
    expect(readFolderOverrides('nb1')).toEqual({ 'group:1': true, ungrouped: false })
  })

  it('setFolderOverride merges a single key and leaves other keys untouched', () => {
    writeFolderOverrides('nb1', { 'group:1': true, 'group:2': false })
    setFolderOverride('nb1', 'group:1', false)
    expect(readFolderOverrides('nb1')).toEqual({ 'group:1': false, 'group:2': false })
  })

  it('writeFolderOverrides replaces the whole per-notebook map', () => {
    writeFolderOverrides('nb1', { 'group:1': true, 'group:2': true })
    writeFolderOverrides('nb1', { 'group:3': false })
    expect(readFolderOverrides('nb1')).toEqual({ 'group:3': false })
  })

  it('keeps notebooks isolated from each other', () => {
    writeFolderOverrides('nb1', { 'group:1': true })
    writeFolderOverrides('nb2', { 'group:2': false })
    expect(readFolderOverrides('nb1')).toEqual({ 'group:1': true })
    expect(readFolderOverrides('nb2')).toEqual({ 'group:2': false })

    setFolderOverride('nb1', 'group:9', true)
    expect(readFolderOverrides('nb2')).toEqual({ 'group:2': false })
  })

  it('returns a fresh empty map when reading after the storage was cleared externally', () => {
    // 回归：读空存储不得复用可变单例，否则上一次 write 的残留会泄漏给下次读
    writeFolderOverrides('nb1', { 'group:1': true, ungrouped: true })
    window.localStorage.clear()
    expect(readFolderOverrides('nb1')).toEqual({})

    writeFolderOverrides('nb1', { 'group:2': false })
    expect(readFolderOverrides('nb1')).toEqual({ 'group:2': false })
  })
})
