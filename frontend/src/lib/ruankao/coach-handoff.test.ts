import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  consumeCoachHandoff,
  findCoachAgentId,
  writeCoachHandoff,
} from './coach-handoff'

const notebooksListMock = vi.hoisted(() => vi.fn())
const agentsListMock = vi.hoisted(() => vi.fn())
const windowOpenMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/notebooks', () => ({
  notebooksApi: { list: (...args: unknown[]) => notebooksListMock(...args) },
}))

vi.mock('@/lib/api/agents', () => ({
  agentsApi: { list: (...args: unknown[]) => agentsListMock(...args) },
}))

beforeEach(() => {
  window.sessionStorage.clear()
  notebooksListMock.mockReset()
  agentsListMock.mockReset()
  windowOpenMock.mockReset()
  window.open = windowOpenMock as unknown as typeof window.open
})

describe('writeCoachHandoff', () => {
  it('seeds sessionStorage and opens the first notebook chat', async () => {
    notebooksListMock.mockResolvedValue([
      { id: 'notebook:n1', name: 'First' },
      { id: 'notebook:n2', name: 'Second' },
    ])

    const result = await writeCoachHandoff({
      text: '论点区草稿……',
      projectEnvId: 'project_env:e1',
    })

    expect(result).toEqual({ ok: true, notebookId: 'notebook:n1' })
    expect(windowOpenMock).toHaveBeenCalledWith('/notebooks/notebook%3An1')
    const seeded = window.sessionStorage.getItem('ruankao.coachHandoff.v1')
    expect(seeded).toContain('"notebookId":"notebook:n1"')
    expect(seeded).toContain('论点区草稿……')
  })

  it('returns no_notebook without seeding when the list is empty', async () => {
    notebooksListMock.mockResolvedValue([])

    const result = await writeCoachHandoff({ text: 'x' })

    expect(result).toEqual({ ok: false, reason: 'no_notebook' })
    expect(window.sessionStorage.getItem('ruankao.coachHandoff.v1')).toBeNull()
    expect(windowOpenMock).not.toHaveBeenCalled()
  })
})

describe('consumeCoachHandoff', () => {
  it('returns the seed once for the matching notebook and clears it', async () => {
    notebooksListMock.mockResolvedValue([{ id: 'notebook:n1' }])
    await writeCoachHandoff({ text: '草稿', projectEnvId: 'project_env:e1' })

    const first = consumeCoachHandoff('notebook:n1')
    expect(first).not.toBeNull()
    expect(first?.text).toBe('草稿')
    expect(first?.projectEnvId).toBe('project_env:e1')
    expect(first?.notebookId).toBe('notebook:n1')

    // 一次性：第二次读不到
    expect(consumeCoachHandoff('notebook:n1')).toBeNull()
    expect(window.sessionStorage.getItem('ruankao.coachHandoff.v1')).toBeNull()
  })

  it('does not consume a seed meant for another notebook', async () => {
    notebooksListMock.mockResolvedValue([{ id: 'notebook:n1' }])
    await writeCoachHandoff({ text: '草稿' })

    expect(consumeCoachHandoff('notebook:other')).toBeNull()
    // 未匹配的种子保留在 storage（不误删），由目标笔记本消费
    expect(window.sessionStorage.getItem('ruankao.coachHandoff.v1')).not.toBeNull()
  })

  it('returns null on empty or malformed storage', () => {
    expect(consumeCoachHandoff('notebook:n1')).toBeNull()
    window.sessionStorage.setItem('ruankao.coachHandoff.v1', 'not-json')
    expect(consumeCoachHandoff('notebook:n1')).toBeNull()
  })
})

describe('findCoachAgentId', () => {
  it('matches the coach by template name (zh or en)', async () => {
    agentsListMock.mockResolvedValue([
      { id: 'agent:a1', name: '资深安全工程师' },
      { id: 'agent:coach', name: '软考论文写作教练' },
    ])
    await expect(findCoachAgentId()).resolves.toBe('agent:coach')

    agentsListMock.mockResolvedValue([
      { id: 'agent:coach-en', name: 'Ruankao Essay Writing Coach' },
    ])
    await expect(findCoachAgentId()).resolves.toBe('agent:coach-en')
  })

  it('resolves to null when the coach agent is absent (renamed/deleted)', async () => {
    agentsListMock.mockResolvedValue([{ id: 'agent:a1', name: '别的智能体' }])
    await expect(findCoachAgentId()).resolves.toBeNull()
  })
})
