import { describe, it, expect } from 'vitest'
import { groupParallelMessages } from './parallel-messages'

const msg = (id: string, type: 'human' | 'ai', extra: Record<string, unknown> = {}) => ({
  id,
  type,
  content: `content-${id}`,
  ...extra,
})

describe('groupParallelMessages', () => {
  it('passes untagged messages through as single items', () => {
    const items = groupParallelMessages([msg('1', 'human'), msg('2', 'ai')])
    expect(items).toEqual([
      { kind: 'single', message: expect.objectContaining({ id: '1' }) },
      { kind: 'single', message: expect.objectContaining({ id: '2' }) },
    ])
  })

  it('folds one group into question + answers + synthesis', () => {
    const items = groupParallelMessages([
      msg('1', 'human'),
      msg('q', 'human', { group_id: 'par_a' }),
      msg('a1', 'ai', { group_id: 'par_a', run_role: 'answer', model_name: 'm1' }),
      msg('a2', 'ai', { group_id: 'par_a', run_role: 'answer', agent_name: 'R' }),
      msg('sy', 'ai', { group_id: 'par_a', run_role: 'synthesis' }),
      msg('2', 'human'),
    ])
    expect(items).toHaveLength(3)
    expect(items[0].kind).toBe('single')
    expect(items[1]).toMatchObject({
      kind: 'parallel',
      groupId: 'par_a',
      question: expect.objectContaining({ id: 'q' }),
      answers: [expect.objectContaining({ id: 'a1' }), expect.objectContaining({ id: 'a2' })],
      synthesis: expect.objectContaining({ id: 'sy' }),
    })
    expect(items[2].kind).toBe('single')
  })

  it('keeps two groups separate and in order', () => {
    const items = groupParallelMessages([
      msg('q1', 'human', { group_id: 'par_1' }),
      msg('a1', 'ai', { group_id: 'par_1' }),
      msg('q2', 'human', { group_id: 'par_2' }),
      msg('a2', 'ai', { group_id: 'par_2' }),
    ])
    expect(items.map((i) => i.groupId)).toEqual(['par_1', 'par_2'])
    expect(items[0].answers).toHaveLength(1)
    expect(items[1].answers).toHaveLength(1)
  })

  it('treats ai messages without run_role as answers', () => {
    const items = groupParallelMessages([
      msg('q', 'human', { group_id: 'par_a' }),
      msg('a', 'ai', { group_id: 'par_a' }),
    ])
    expect(items[0].answers).toHaveLength(1)
    expect(items[0].synthesis).toBeUndefined()
  })
})
