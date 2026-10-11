import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TrainingPanel,
  formatClock,
  writeTrainingIntoDrafts,
} from './TrainingPanel'
import type { RuankaoEssayDraft } from '@/lib/ruankao/essay-drafts'

// 测试基建（EssayPanel.test 同款）：coach-handoff 整模块打桩 + sonner toast 罐头
// + 恒等 t mock（全局 setup）。题库/草稿/训练记录三个 localStorage store 走真实
// 实现（jsdom localStorage）。Radix Select（题库选择/存草稿目标）不做 UI 驱动
// ——本仓测试从不驱动 radix Select（批次2/3/4 同约定），「追加到既有草稿」分支
// 由导出的纯函数 writeTrainingIntoDrafts 直接钉行为；题库合并数据由批次3 的
// question-bank 测试覆盖。
const { handoffMock, toastErrorMock, toastSuccessMock, toastInfoMock } = vi.hoisted(() => ({
  handoffMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastInfoMock: vi.fn(),
}))

vi.mock('@/lib/ruankao/coach-handoff', () => ({
  writeCoachHandoff: (...args: unknown[]) => handoffMock(...args),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
    info: toastInfoMock,
  },
}))

function renderPanel() {
  return render(<TrainingPanel />)
}

/** setup → run：填题目与提纲后点开始（题目/提纲非空才启用，设计稿 5.2） */
function startRun(
  topic = '论分布式缓存的应用',
  outline = '主旨句：多级缓存 + 旁路缓存\n锚点：命中率基线 82%'
) {
  fireEvent.change(screen.getByTestId('ruankao-train-topic'), {
    target: { value: topic },
  })
  fireEvent.change(screen.getByTestId('ruankao-train-outline'), {
    target: { value: outline },
  })
  fireEvent.click(screen.getByTestId('ruankao-train-start'))
  expect(screen.getByTestId('ruankao-train-run-root')).toBeInTheDocument()
}

/** run → done：填两段正文后交卷（按段模式先手动「下一段」） */
function submitRound(argText: string, q2Text: string) {
  fireEvent.change(screen.getByTestId('ruankao-train-input-arguments'), {
    target: { value: argText },
  })
  const next = screen.queryByTestId('ruankao-train-next-section')
  if (next) fireEvent.click(next)
  fireEvent.change(screen.getByTestId('ruankao-train-input-question2'), {
    target: { value: q2Text },
  })
  fireEvent.click(screen.getByTestId('ruankao-train-submit'))
  expect(screen.getByTestId('ruankao-train-done-root')).toBeInTheDocument()
}

beforeEach(() => {
  handoffMock.mockReset()
  toastErrorMock.mockReset()
  toastSuccessMock.mockReset()
  toastInfoMock.mockReset()
  window.localStorage.clear()
})

describe('formatClock', () => {
  it('formats seconds as mm:ss with zero-padded seconds', () => {
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(59)).toBe('0:59')
    expect(formatClock(60)).toBe('1:00')
    expect(formatClock(25 * 60)).toBe('25:00')
    expect(formatClock(120 * 60)).toBe('120:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('TrainingPanel setup', () => {
  it('disables start until both topic and outline are filled', () => {
    renderPanel()

    expect(screen.getByTestId('ruankao-train-setup-root')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-start')).toBeDisabled()

    fireEvent.change(screen.getByTestId('ruankao-train-topic'), {
      target: { value: '论负载均衡' },
    })
    expect(screen.getByTestId('ruankao-train-start')).toBeDisabled()

    fireEvent.change(screen.getByTestId('ruankao-train-outline'), {
      target: { value: '主旨句：四层/七层分流' },
    })
    expect(screen.getByTestId('ruankao-train-start')).toBeEnabled()
  })

  it('offers the question-bank picker next to the topic input (same localStorage source)', () => {
    renderPanel()

    // 题库选择入口在场（批次3 的 ruankao.questions.v1 同源直读，零新通道）；
    // 选项交互走 radix Select，不做 UI 驱动（见文件头注释）
    expect(screen.getByTestId('ruankao-train-bank')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-bank')).toHaveTextContent(
      'ruankao.training.pickFromBank'
    )
  })
})

describe('TrainingPanel run (盲写)', () => {
  it('shows the focused view: topic, read-only outline anchor card, stuck hint; no coach button', () => {
    renderPanel()
    startRun()

    expect(screen.getByTestId('ruankao-train-topic')).toHaveTextContent('论分布式缓存的应用')
    expect(screen.getByTestId('ruankao-train-outline-card')).toHaveTextContent(
      '主旨句：多级缓存 + 旁路缓存'
    )
    expect(screen.getByTestId('ruankao-train-outline-card')).toHaveTextContent(
      '锚点：命中率基线 82%'
    )
    expect(screen.getByTestId('ruankao-train-stuck-hint')).toHaveTextContent(
      'ruankao.training.stuckHint'
    )
    // 盲写期间无任何 AI 入口（设计稿 5.4-2：DOM 断言级可验）
    expect(screen.queryByTestId('ruankao-train-copy-coach')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-train-save-draft')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ruankao-train-retrain')).not.toBeInTheDocument()
  })

  it('counts down every second and updates the live char progress on input', () => {
    vi.useFakeTimers()
    try {
      renderPanel()
      startRun()
      expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('25:00')

      act(() => {
        vi.advanceTimersByTime(2000)
      })
      expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('24:58')

      // 字数随输入更新（countChars 码点口径）
      const input = screen.getByTestId('ruankao-train-input-arguments')
      expect(screen.getByTestId('ruankao-train-progress-arguments')).toHaveAttribute(
        'aria-valuenow',
        '0'
      )
      fireEvent.change(input, { target: { value: '12345' } })
      expect(screen.getByTestId('ruankao-train-progress-arguments')).toHaveAttribute(
        'aria-valuenow',
        '5'
      )
      // 目标口径与 5.1 表一致：论点区 1000 / 问题2 400
      expect(screen.getByTestId('ruankao-train-progress-arguments')).toHaveAttribute(
        'aria-valuemax',
        '1000'
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('per-section mode: next section switches the editor and resets the timer to the q2 budget', () => {
    vi.useFakeTimers()
    try {
      renderPanel()
      startRun()
      act(() => {
        vi.advanceTimersByTime(30000)
      })
      expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('24:30')

      fireEvent.click(screen.getByTestId('ruankao-train-next-section'))
      expect(screen.queryByTestId('ruankao-train-input-arguments')).not.toBeInTheDocument()
      expect(screen.getByTestId('ruankao-train-input-question2')).toBeInTheDocument()
      // 问题2 默认 20 分钟，切换后重新起表
      expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('20:00')
      // 已在最后一段：下一段按钮消失，交卷常在
      expect(screen.queryByTestId('ruankao-train-next-section')).not.toBeInTheDocument()
      expect(screen.getByTestId('ruankao-train-submit')).toBeEnabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('full-simulation mode: both sections visible, one 120-minute clock, no next-section button', () => {
    renderPanel()
    fireEvent.change(screen.getByTestId('ruankao-train-topic'), {
      target: { value: '论微服务治理' },
    })
    fireEvent.change(screen.getByTestId('ruankao-train-outline'), {
      target: { value: '主旨句：注册中心 + 熔断' },
    })
    fireEvent.click(screen.getByTestId('ruankao-train-mode-fullSimulation'))
    expect(screen.getByTestId('ruankao-train-minutes-total')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('ruankao-train-start'))
    expect(screen.getByTestId('ruankao-train-input-arguments')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-input-question2')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('120:00')
    expect(screen.queryByTestId('ruankao-train-next-section')).not.toBeInTheDocument()
  })

  it('honours edited minute budgets', () => {
    renderPanel()
    fireEvent.change(screen.getByTestId('ruankao-train-topic'), {
      target: { value: '论消息中间件' },
    })
    fireEvent.change(screen.getByTestId('ruankao-train-outline'), {
      target: { value: '主旨句：削峰填谷' },
    })
    fireEvent.change(screen.getByTestId('ruankao-train-minutes-arg'), {
      target: { value: '15' },
    })
    fireEvent.click(screen.getByTestId('ruankao-train-start'))
    expect(screen.getByTestId('ruankao-train-clock')).toHaveTextContent('15:00')
  })
})

describe('TrainingPanel done (交卷页)', () => {
  it('records the round honestly: unmet badge below target, met badge at target; retrain resets', () => {
    renderPanel()
    startRun()
    submitRound('只有一小段', '也很短')
    expect(screen.getByTestId('ruankao-train-unmet-badge')).toHaveTextContent(
      'ruankao.training.doneUnmet'
    )
    expect(screen.queryByTestId('ruankao-train-met-badge')).not.toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-done-count-arguments')).toHaveTextContent(
      'ruankao.training.runCurrent'
    )

    // 换角度重练：同题目回 setup，提纲与正文清空（设计稿 5.2）
    fireEvent.click(screen.getByTestId('ruankao-train-retrain'))
    expect(screen.getByTestId('ruankao-train-setup-root')).toBeInTheDocument()
    expect(screen.getByTestId('ruankao-train-topic')).toHaveValue('论分布式缓存的应用')
    expect(screen.getByTestId('ruankao-train-outline')).toHaveValue('')

    // 达标轮：论点区 ≥1000 且问题2 ≥400
    startRun()
    submitRound('字'.repeat(1000), '字'.repeat(400))
    expect(screen.getByTestId('ruankao-train-met-badge')).toHaveTextContent(
      'ruankao.training.doneMet'
    )
  })

  it('sends only the argument section to the coach after submit (handoff bridge reused)', async () => {
    renderPanel()
    startRun()
    submitRound('论点区正文草稿', '问题2正文草稿')
    handoffMock.mockResolvedValue({ ok: true, notebookId: 'notebook:n1' })

    // 交卷前批改不可达（run 用例已断言）；交卷后解锁，text=论点区
    fireEvent.click(screen.getByTestId('ruankao-train-copy-coach'))
    await waitFor(() => {
      expect(handoffMock).toHaveBeenCalledWith({
        text: '论点区正文草稿',
        projectEnvId: null,
      })
    })
    expect(toastSuccessMock).toHaveBeenCalledWith('ruankao.essay.write.handoffReady')

    handoffMock.mockResolvedValue({ ok: false, reason: 'no_notebook' })
    fireEvent.click(screen.getByTestId('ruankao-train-copy-coach'))
    await waitFor(() => {
      expect(toastInfoMock).toHaveBeenCalledWith('ruankao.essay.write.handoffNoNotebook')
    })
  })

  it('saves the round into essay-drafts as a new draft by default (title = topic)', () => {
    renderPanel()
    startRun()
    submitRound('论点区正文草稿', '问题2正文草稿')

    fireEvent.click(screen.getByTestId('ruankao-train-save-draft'))
    expect(toastSuccessMock).toHaveBeenCalledWith('ruankao.training.saveToDraftDone')

    const stored = JSON.parse(
      window.localStorage.getItem('ruankao.essayDrafts.v1') as string
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].title).toBe('论分布式缓存的应用')
    expect(stored[0].sections.arguments).toBe('论点区正文草稿')
    expect(stored[0].sections.question2).toBe('问题2正文草稿')
  })
})

describe('writeTrainingIntoDrafts (存草稿纯函数)', () => {
  const existing: RuankaoEssayDraft = {
    id: 'd1',
    title: '既有草稿',
    projectEnvId: null,
    sections: {
      abstract: '',
      background: '',
      question2: '',
      arguments: '既有论点',
      closing: '',
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  }

  it('creates a new draft titled with the topic when target is not an existing draft', () => {
    const next = writeTrainingIntoDrafts(
      [existing],
      '__new__',
      { title: '论分布式缓存的应用', arguments: '本轮论点', question2: '本轮问题2' },
      '未命名草稿'
    )

    expect(next).toHaveLength(2)
    expect(next[0].title).toBe('论分布式缓存的应用')
    expect(next[0].sections.arguments).toBe('本轮论点')
    expect(next[0].sections.question2).toBe('本轮问题2')
    // 既有草稿不动
    expect(next[1]).toEqual(existing)
  })

  it('falls back to the untitled label for an empty topic', () => {
    const [head] = writeTrainingIntoDrafts(
      [],
      '__new__',
      { title: '  ', arguments: 'a', question2: 'b' },
      '未命名草稿'
    )
    expect(head.title).toBe('未命名草稿')
  })

  it('appends the round to the target draft arguments section without clobbering', () => {
    const next = writeTrainingIntoDrafts(
      [existing],
      'd1',
      { title: '论分布式缓存的应用', arguments: '本轮论点', question2: '本轮问题2' },
      '未命名草稿'
    )

    expect(next).toHaveLength(1)
    expect(next[0].sections.arguments).toBe('既有论点\n\n本轮论点')
    // 追加分支只动论点区（设计稿 5.2：追加到既有草稿的 arguments 段）
    expect(next[0].sections.question2).toBe('')
    expect(next[0].updatedAt).not.toBe('2026-10-01T00:00:00.000Z')
  })

  it('writes the round directly when the target arguments section is empty', () => {
    const empty = { ...existing, sections: { ...existing.sections, arguments: '  ' } }
    const next = writeTrainingIntoDrafts(
      [empty],
      'd1',
      { title: 't', arguments: '本轮论点', question2: 'q' },
      '未命名草稿'
    )
    expect(next[0].sections.arguments).toBe('本轮论点')
  })
})

describe('TrainingPanel history (训练记录)', () => {
  it('starts collapsed with the empty state, records rounds, and clears after confirm', async () => {
    renderPanel()
    fireEvent.click(screen.getByTestId('ruankao-train-history-toggle'))
    expect(screen.getByTestId('ruankao-train-history-empty')).toHaveTextContent(
      'ruankao.training.historyEmpty'
    )
    expect(screen.queryByTestId('ruankao-train-history-clear')).not.toBeInTheDocument()

    // 交卷自动落账（localStorage ruankao.trainingSessions.v1）；run 阶段历史折叠
    // 区不渲染（专注），done 后以原开关状态回归（此处为收起，重新展开）
    fireEvent.click(screen.getByTestId('ruankao-train-history-toggle'))
    startRun()
    expect(screen.queryByTestId('ruankao-train-history')).not.toBeInTheDocument()
    submitRound('字'.repeat(1000), '字'.repeat(400))
    expect(screen.getByTestId('ruankao-train-history')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('ruankao-train-history-toggle'))

    const stored = JSON.parse(
      window.localStorage.getItem('ruankao.trainingSessions.v1') as string
    )
    expect(stored).toHaveLength(1)
    expect(stored[0].topic).toBe('论分布式缓存的应用')
    expect(stored[0].targetMet).toBe(true)
    const item = screen.getByTestId(`ruankao-train-history-item-${stored[0].id}`)
    expect(item).toHaveTextContent('ruankao.training.historyItem')
    expect(item).toHaveTextContent('ruankao.training.doneMet')

    // 清空记录：confirm 对话框确认后列表回空态
    fireEvent.click(screen.getByTestId('ruankao-train-history-clear'))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'ruankao.training.historyClear' })
    )
    expect(window.localStorage.getItem('ruankao.trainingSessions.v1')).toBeNull()
    expect(screen.getByTestId('ruankao-train-history-empty')).toBeInTheDocument()
  })

  it('shows the unmet badge on history rows for below-target rounds', () => {
    renderPanel()
    startRun()
    submitRound('短', '短')

    fireEvent.click(screen.getByTestId('ruankao-train-history-toggle'))
    const stored = JSON.parse(
      window.localStorage.getItem('ruankao.trainingSessions.v1') as string
    )
    const item = screen.getByTestId(`ruankao-train-history-item-${stored[0].id}`)
    expect(item).toHaveTextContent('ruankao.training.doneUnmet')
  })
})
