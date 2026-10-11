import { beforeEach, describe, expect, it } from 'vitest'
import {
  ARG_SECTION_TARGET,
  Q2_TARGET,
  TRAINING_LIMIT,
  appendSession,
  clearSessions,
  isTargetMet,
  loadSessions,
  saveSessions,
  newSessionId,
  type RuankaoTrainingSession,
} from './training-store'

// 设计稿 5.4-1：store 纯函数——写入 / 上限 50 / 解析失败回退

function makeSession(partial: Partial<RuankaoTrainingSession> = {}): RuankaoTrainingSession {
  return {
    id: newSessionId(),
    topic: '论分布式缓存',
    outline: '主旨句：多级缓存…',
    startedAt: '2026-10-10T08:00:00.000Z',
    endedAt: '2026-10-10T08:25:00.000Z',
    durationSec: 1500,
    argChars: 1024,
    q2Chars: 410,
    targetMet: true,
    ...partial,
  }
}

beforeEach(() => {
  window.localStorage.clear()
})

describe('training-store targets', () => {
  it('uses the coach-flow word targets: arguments 1000 / q2 400', () => {
    expect(ARG_SECTION_TARGET).toBe(1000)
    expect(Q2_TARGET).toBe(400)
  })

  it('isTargetMet requires both sections at target', () => {
    expect(isTargetMet(1000, 400)).toBe(true)
    expect(isTargetMet(999, 400)).toBe(false)
    expect(isTargetMet(1000, 399)).toBe(false)
  })
})

describe('training-store persistence', () => {
  it('round-trips saved sessions, normalizing to newest-first order', () => {
    const first = makeSession({ id: 't1', endedAt: '2026-10-10T08:25:00.000Z' })
    const second = makeSession({ id: 't2', endedAt: '2026-10-10T09:25:00.000Z' })
    saveSessions([first, second])

    // 保存即归一化为最新在前（最近 50 轮列表的展示序）
    const loaded = loadSessions()
    expect(loaded.map((s) => s.id)).toEqual(['t2', 't1'])
    expect(loaded[1]).toEqual(first)
  })

  it('appendSession prepends and persists the new round', () => {
    const older = makeSession({ id: 't-old' })
    saveSessions([older])

    const fresh = makeSession({ id: 't-new', endedAt: '2026-10-11T08:25:00.000Z' })
    const next = appendSession(fresh)

    expect(next.map((s) => s.id)).toEqual(['t-new', 't-old'])
    expect(loadSessions()[0].id).toBe('t-new')
  })

  it('caps history at 50 rounds, dropping the oldest', () => {
    const many = Array.from({ length: TRAINING_LIMIT + 5 }, (_, i) =>
      makeSession({
        id: `t-${String(i).padStart(3, '0')}`,
        endedAt: new Date(Date.UTC(2026, 9, 1 + i)).toISOString(),
      }),
    )
    saveSessions(many)

    const loaded = loadSessions()
    expect(loaded).toHaveLength(TRAINING_LIMIT)
    // 最旧的 5 轮被丢弃，保留 endedAt 最新的 50 轮（存储序=最新在前）
    expect(loaded[0].id).toBe('t-054')
    expect(loaded[TRAINING_LIMIT - 1].id).toBe('t-005')
    expect(loaded.some((s) => s.id === 't-000')).toBe(false)
  })

  it('falls back to an empty list on corrupted or non-array payloads', () => {
    window.localStorage.setItem('ruankao.trainingSessions.v1', '{not json')
    expect(loadSessions()).toEqual([])

    window.localStorage.setItem('ruankao.trainingSessions.v1', '{"a":1}')
    expect(loadSessions()).toEqual([])

    // 单条损坏被剔除，合法条目保留
    const good = makeSession({ id: 't-good' })
    window.localStorage.setItem(
      'ruankao.trainingSessions.v1',
      JSON.stringify([{ id: 'broken', topic: 123 }, good]),
    )
    expect(loadSessions().map((s) => s.id)).toEqual(['t-good'])
  })

  it('returns an empty list before hydration (no window storage reads on server)', () => {
    // jsdom 环境下 window 恒存在；此用例钉「无 key 时回退空」的行为契约
    expect(loadSessions()).toEqual([])
  })

  it('clearSessions removes the stored history', () => {
    saveSessions([makeSession()])
    expect(loadSessions()).toHaveLength(1)

    clearSessions()
    expect(loadSessions()).toEqual([])
    expect(window.localStorage.getItem('ruankao.trainingSessions.v1')).toBeNull()
  })
})
