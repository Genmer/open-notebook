import { describe, expect, it } from 'vitest'

import { ClassifyProgress, SourceViewResponse } from '@/lib/types/api'
import { classifyPollInterval, isClassifyActive } from './use-source-views'

function view(classify_progress: ClassifyProgress | null): SourceViewResponse {
  return {
    id: 'source_view:ai_content',
    name: 'AI Content',
    view_type: 'ai_content',
    is_default: true,
    last_classified_at: null,
    classify_progress,
    created: null,
    updated: null,
  }
}

const active: ClassifyProgress = {
  stage: 'llm',
  percent: 45,
  message: '',
  error: null,
}

const done: ClassifyProgress = {
  stage: 'done',
  percent: 100,
  message: 'ok',
  error: null,
  groups_created: 3,
  sources_classified: 15,
  unclassified: 2,
}

describe('isClassifyActive', () => {
  it('is true only for the three running stages', () => {
    expect(isClassifyActive({ ...active, stage: 'clustering' })).toBe(true)
    expect(isClassifyActive({ ...active, stage: 'llm' })).toBe(true)
    expect(isClassifyActive({ ...active, stage: 'assigning' })).toBe(true)
    expect(isClassifyActive(done)).toBe(false)
    expect(isClassifyActive({ ...active, stage: 'failed' })).toBe(false)
  })

  it('is false without progress', () => {
    expect(isClassifyActive(null)).toBe(false)
  })
})

describe('classifyPollInterval', () => {
  it('polls every 5s while a view is classifying', () => {
    expect(classifyPollInterval([view(null), view(active)])).toBe(5000)
  })

  it('stops polling on terminal states', () => {
    expect(classifyPollInterval([view(done)])).toBe(false)
    expect(classifyPollInterval([view(null)])).toBe(false)
  })

  it('handles missing views', () => {
    expect(classifyPollInterval(undefined)).toBe(false)
  })
})
