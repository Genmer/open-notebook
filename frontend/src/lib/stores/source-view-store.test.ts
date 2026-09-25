import { describe, it, expect, beforeEach } from 'vitest'
import { useSourceViewStore, resolveActiveViewId, resolveGroupSelection, FILE_TYPE_VIEW_ID } from './source-view-store'
import { SourceGroupResponse, SourceViewResponse } from '@/lib/types/api'

function view(id: string): SourceViewResponse {
  return {
    id: `source_view:${id}`,
    name: id,
    view_type: 'custom',
    is_default: false,
    last_classified_at: null,
    classify_progress: null,
    created: null,
    updated: null,
  }
}

function group(id: string): SourceGroupResponse {
  return {
    id: `source_group:${id}`,
    view_id: 'source_view:v1',
    name: id,
    parent_id: null,
    source_count: 0,
    created: null,
    updated: null,
  }
}

describe('source-view-store', () => {
  beforeEach(() => {
    localStorage.clear()
    useSourceViewStore.setState({ activeViewId: FILE_TYPE_VIEW_ID, selectedGroupByView: {}, hasHydrated: true })
  })

  it('starts on the virtual file_type tab with no group selections', async () => {
    localStorage.removeItem('source-view-storage')
    const { useSourceViewStore: fresh } = await import('./source-view-store')
    expect(fresh.getInitialState().activeViewId).toBe(FILE_TYPE_VIEW_ID)
    expect(fresh.getInitialState().selectedGroupByView).toEqual({})
  })

  it('persists activeViewId and selectedGroupByView only', () => {
    useSourceViewStore.getState().setActiveView('source_view:v1')
    useSourceViewStore.getState().setSelectedGroup('source_view:v1', 'source_group:g1')

    const options = useSourceViewStore.persist.getOptions()
    const persisted = options.partialize?.(useSourceViewStore.getState())
    expect(persisted).toEqual({
      activeViewId: 'source_view:v1',
      selectedGroupByView: { 'source_view:v1': 'source_group:g1' },
    })
  })

  it('setActiveView / setSelectedGroup update their slices', () => {
    useSourceViewStore.getState().setActiveView('source_view:v1')
    useSourceViewStore.getState().setSelectedGroup('source_view:v1', 'ungrouped')
    expect(useSourceViewStore.getState().activeViewId).toBe('source_view:v1')
    expect(useSourceViewStore.getState().selectedGroupByView['source_view:v1']).toBe('ungrouped')
  })

  describe('resolveActiveViewId', () => {
    it('keeps the virtual tab and known view ids', () => {
      const views = [view('v1')]
      expect(resolveActiveViewId(FILE_TYPE_VIEW_ID, views)).toBe(FILE_TYPE_VIEW_ID)
      expect(resolveActiveViewId('source_view:v1', views)).toBe('source_view:v1')
    })

    it('falls back to the virtual tab for unknown ids', () => {
      expect(resolveActiveViewId('source_view:deleted', [view('v1')])).toBe(FILE_TYPE_VIEW_ID)
    })
  })

  describe('resolveGroupSelection', () => {
    it('falls back to all for unknown group ids', () => {
      expect(resolveGroupSelection('source_group:gone', 'source_view:v1', [group('g1')])).toBe('all')
    })

    it('keeps existing group ids and sentinels', () => {
      const groups = [group('g1')]
      expect(resolveGroupSelection('source_group:g1', 'source_view:v1', groups)).toBe('source_group:g1')
      expect(resolveGroupSelection('ungrouped', 'source_view:v1', groups)).toBe('ungrouped')
      expect(resolveGroupSelection('all', 'source_view:v1', groups)).toBe('all')
    })

    it('under file_type accepts source-type values and extension keys', () => {
      expect(resolveGroupSelection('link', FILE_TYPE_VIEW_ID, [])).toBe('link')
      expect(resolveGroupSelection('text', FILE_TYPE_VIEW_ID, [])).toBe('text')
      expect(resolveGroupSelection('pdf', FILE_TYPE_VIEW_ID, [])).toBe('pdf')
      expect(resolveGroupSelection('ungrouped', FILE_TYPE_VIEW_ID, [])).toBe('all')
      expect(resolveGroupSelection('source_group:g1', FILE_TYPE_VIEW_ID, [])).toBe('all')
    })

    it('under file_type falls back to all for the removed legacy file group', () => {
      expect(resolveGroupSelection('file', FILE_TYPE_VIEW_ID, [])).toBe('all')
    })

    it('defaults undefined to all', () => {
      expect(resolveGroupSelection(undefined, 'source_view:v1', [])).toBe('all')
    })
  })
})
