import { describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import ProjectEnvironmentsPage from './page'

vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

describe('legacy /project-environments route', () => {
  it('redirects (307) to the ruankao environments tab deep link', () => {
    ProjectEnvironmentsPage()
    expect(vi.mocked(redirect)).toHaveBeenCalledWith('/ruankao?tab=environments')
  })
})
