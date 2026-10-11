import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { EssayMarkEditGuardDialog } from './EssayMarkEditGuardDialog'
import { useEssayMarkStatus } from '@/lib/hooks/use-essay-marks'
import { useTranslation } from '@/lib/hooks/use-translation'

// 守卫交互流（设计稿 2.5/2.8-8）：宿主组件复刻挂点接线（statusQuery +
// pendingTitle + 确认对话框），mock use-essay-marks 的 status 与保存动作，
// 验证 effective 先确认、非 effective 直存、isError fail-closed 三分支。
const { statusMock, saveMock, toastErrorMock } = vi.hoisted(() => ({
  statusMock: vi.fn(),
  saveMock: vi.fn(),
  toastErrorMock: vi.fn(),
}))

vi.mock('@/lib/hooks/use-essay-marks', () => ({
  useEssayMarkStatus: () => statusMock(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...(args as [])),
    success: vi.fn(),
  },
}))

// 与 SourceDetailContent.handleUpdateTitle 同构的最小挂点宿主
function GuardHost() {
  const { t } = useTranslation()
  const [guardOpen, setGuardOpen] = useState(false)
  const pendingTitleRef = useRef<string | null>(null)
  const statusQuery = useEssayMarkStatus('source:s1')

  const doSave = async (title: string) => {
    await saveMock(title)
  }

  const handleSave = async (title: string) => {
    pendingTitleRef.current = title
    if (statusQuery.data?.source?.effective) {
      setGuardOpen(true)
      return
    }
    if (statusQuery.isError) {
      // fail-closed：查不到状态就阻断保存
      toast.error(t('ruankao.essayMark.editGuardStatusFailed'))
      return
    }
    await doSave(title)
  }

  return (
    <div>
      <button type="button" data-testid="host-save" onClick={() => handleSave('New Title')}>
        save
      </button>
      <EssayMarkEditGuardDialog
        open={guardOpen}
        sourceTitle="Essay One"
        onConfirm={async () => {
          setGuardOpen(false)
          if (pendingTitleRef.current) await doSave(pendingTitleRef.current)
        }}
        onCancel={() => {
          setGuardOpen(false)
          pendingTitleRef.current = null
        }}
      />
    </div>
  )
}

describe('EssayMarkEditGuardDialog', () => {
  beforeEach(() => {
    statusMock.mockReturnValue({
      data: {
        marks: [],
        stats: { marked_sources: 1, marked_groups: 0, effective_total: 1 },
        effective_source_ids: ['source:s1'],
        source: {
          id: 'source:s1',
          marked_direct: true,
          via_group_ids: [],
          effective: true,
        },
      },
      isError: false,
    })
    saveMock.mockReset()
    toastErrorMock.mockReset()
  })

  it('blocks the save on an effective model essay until confirmed, then saves the pending title', () => {
    render(<GuardHost />)

    fireEvent.click(screen.getByTestId('host-save'))
    // 确认对话框打开，保存未发出
    expect(screen.getByTestId('ruankao-essay-edit-guard')).toBeInTheDocument()
    expect(screen.getByText('ruankao.essayMark.editGuardTitle')).toBeInTheDocument()
    expect(screen.getByText(/ruankao\.essayMark\.editGuardDesc/)).toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('ruankao.essayMark.editGuardConfirm'))
    // 确认后关闭并按原参数保存
    expect(screen.queryByTestId('ruankao-essay-edit-guard')).not.toBeInTheDocument()
    expect(saveMock).toHaveBeenCalledWith('New Title')
  })

  it('cancels without saving', () => {
    render(<GuardHost />)

    fireEvent.click(screen.getByTestId('host-save'))
    expect(screen.getByTestId('ruankao-essay-edit-guard')).toBeInTheDocument()

    fireEvent.click(screen.getByText('common.cancel'))
    expect(screen.queryByTestId('ruankao-essay-edit-guard')).not.toBeInTheDocument()
    expect(saveMock).not.toHaveBeenCalled()
  })

  it('saves directly when the source is outside the red-line set', () => {
    statusMock.mockReturnValue({
      data: {
        marks: [],
        stats: { marked_sources: 0, marked_groups: 0, effective_total: 0 },
        effective_source_ids: [],
        source: null,
      },
      isError: false,
    })
    render(<GuardHost />)

    fireEvent.click(screen.getByTestId('host-save'))
    expect(saveMock).toHaveBeenCalledWith('New Title')
    expect(screen.queryByTestId('ruankao-essay-edit-guard')).not.toBeInTheDocument()
  })

  it('fail-closes with a toast when the status query errors', () => {
    statusMock.mockReturnValue({ data: undefined, isError: true })
    render(<GuardHost />)

    fireEvent.click(screen.getByTestId('host-save'))
    expect(saveMock).not.toHaveBeenCalled()
    expect(screen.queryByTestId('ruankao-essay-edit-guard')).not.toBeInTheDocument()
    expect(toastErrorMock).toHaveBeenCalledWith('ruankao.essayMark.editGuardStatusFailed')
  })
})
