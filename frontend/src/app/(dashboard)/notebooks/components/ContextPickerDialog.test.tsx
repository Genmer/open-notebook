import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextPickerDialog } from './ContextPickerDialog'
import { useContextTree } from '@/lib/hooks/use-context-tree'
import { CONTEXT_COMBOS_STORAGE_KEY } from '@/lib/notebooks/context-combos'
import { FOLDER_COLLAPSE_STORAGE_KEY } from '@/lib/notebooks/folder-collapse'
import type { ContextSelections } from '@/lib/types/notebook-context'

// 本文件覆盖 setup.ts 的全局 t() mock：键回显之外把插值参数追加为可断言文本
// （chat.contextComboCount (count=2)），让组合计数/删除确认里的名称可断言
vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (!params) return key
      const args = Object.entries(params)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(', ')
      return `${key} (${args})`
    },
    language: 'en-US',
    setLanguage: vi.fn(),
  }),
}))

const { mockToastSuccess, mockToastError } = vi.hoisted(() => ({
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    warning: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/lib/hooks/use-context-tree')

const treeData = {
  sources: [
    { id: 's1', title: '范文一', insights_count: 2 },
    { id: 's2', title: '范文二', insights_count: 0 },
    { id: 's3', title: '零散来源', insights_count: 0 },
  ],
  groups: [{ id: 'g1', name: '论文夹', parent_id: null }],
  memberships: [
    { source_id: 's1', group_id: 'g1' },
    { source_id: 's2', group_id: 'g1' },
  ],
}

function mockTree(overrides: Partial<Record<string, unknown>> = {}) {
  vi.mocked(useContextTree).mockReturnValue({
    data: treeData,
    isLoading: false,
    isSuccess: true,
    isError: false,
    ...overrides,
  } as unknown as ReturnType<typeof useContextTree>)
}

const baseProps = {
  open: true,
  onOpenChange: vi.fn(),
  notebookId: 'nb1',
  viewId: 'view1' as string | null,
  sources: [] as never[],
  notes: [{ id: 'n1', title: '我的笔记' }],
  selections: {
    sources: { s1: 'insights' },
    notes: { n1: 'full' },
  } as ContextSelections,
  onSourceModeChange: vi.fn(),
  onFolderApply: vi.fn(),
  onNoteModeChange: vi.fn(),
  onClearAll: vi.fn(),
}

describe('ContextPickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    mockTree()
  })

  it('renders folder tree, ungrouped bucket and notes section', () => {
    render(<ContextPickerDialog {...baseProps} />)

    expect(screen.getByText('论文夹')).toBeInTheDocument()
    expect(screen.getByText('范文一')).toBeInTheDocument()
    expect(screen.getByText('范文二')).toBeInTheDocument()
    expect(screen.getByText('零散来源')).toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
    expect(screen.getByText('chat.contextNotesSection')).toBeInTheDocument()
    expect(screen.getByText('我的笔记')).toBeInTheDocument()
  })

  it('cycles a source mode via its toggle', () => {
    render(<ContextPickerDialog {...baseProps} />)

    const row = screen.getByText('范文一').closest('[class*="justify-between"]') as HTMLElement
    fireEvent.click(within(row).getByRole('button'))

    // insights -> full (has insights, three-state cycle)
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s1', 'full')
  })

  it('source checkbox includes the source with full content', () => {
    render(<ContextPickerDialog {...baseProps} />)

    // 零散来源 is off; checking the box pulls the full text into context.
    fireEvent.click(screen.getByLabelText('零散来源'))
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s3', 'full')

    // 范文一 is included (insights); unchecking removes it entirely.
    fireEvent.click(screen.getByLabelText('范文一'))
    expect(baseProps.onSourceModeChange).toHaveBeenCalledWith('s1', 'off')
  })

  it('folder checkbox applies full content to the whole folder', () => {
    const { rerender } = render(<ContextPickerDialog {...baseProps} />)

    // Partially included (s1 only) -> checking includes everything.
    fireEvent.click(screen.getByRole('checkbox', { name: '论文夹' }))
    expect(baseProps.onFolderApply).toHaveBeenCalledWith(
      [
        { id: 's1', insights_count: 2 },
        { id: 's2', insights_count: 0 },
      ],
      'full'
    )

    // Fully included -> unchecking excludes the whole folder.
    rerender(
      <ContextPickerDialog
        {...baseProps}
        selections={{
          sources: { s1: 'insights', s2: 'full' },
          notes: { n1: 'full' },
        } as ContextSelections}
      />
    )
    fireEvent.click(screen.getByRole('checkbox', { name: '论文夹' }))
    expect(baseProps.onFolderApply).toHaveBeenCalledWith(
      [
        { id: 's1', insights_count: 2 },
        { id: 's2', insights_count: 0 },
      ],
      'exclude'
    )
  })

  it('toggles a note off through its checkbox', () => {
    render(<ContextPickerDialog {...baseProps} />)

    fireEvent.click(screen.getByLabelText('我的笔记'))

    expect(baseProps.onNoteModeChange).toHaveBeenCalledWith('n1', 'off')
  })

  it('search filters matching sources only', () => {
    render(<ContextPickerDialog {...baseProps} />)

    fireEvent.change(screen.getByPlaceholderText('chat.contextSearchPlaceholder'), {
      target: { value: '范文一' },
    })

    expect(screen.getByText('范文一')).toBeInTheDocument()
    expect(screen.queryByText('范文二')).not.toBeInTheDocument()
    expect(screen.queryByText('零散来源')).not.toBeInTheDocument()
  })

  it('falls back to the loaded source list when the tree endpoint fails', () => {
    mockTree({ data: undefined, isSuccess: false, isError: true })
    render(
      <ContextPickerDialog
        {...baseProps}
        sources={[
          { id: 's1', title: '范文一', insights_count: 2 } as never,
        ]}
      />
    )

    expect(screen.getByText('范文一')).toBeInTheDocument()
    // No tree data: no folder rows, sources sit in the ungrouped bucket.
    expect(screen.queryByText('论文夹')).not.toBeInTheDocument()
    expect(screen.getByText('sources.grouping.ungrouped')).toBeInTheDocument()
  })

  it('restores a persisted folder collapse and writes a toggle back to the shared store', () => {
    window.localStorage.setItem(
      FOLDER_COLLAPSE_STORAGE_KEY,
      JSON.stringify({ version: 1, byNotebook: { nb1: { g1: true } } }),
    )
    render(<ContextPickerDialog {...baseProps} />)

    // g1 上次被收起 → 挂载后 s1/s2 隐藏，未触碰的 g1 来源恒默认展开语义不变
    expect(screen.getByText('论文夹')).toBeInTheDocument()
    expect(screen.queryByText('范文一')).not.toBeInTheDocument()
    expect(screen.getByText('零散来源')).toBeInTheDocument()

    // 再点一次展开 → 覆盖写回共享 store
    fireEvent.click(screen.getByText('论文夹'))
    expect(screen.getByText('范文一')).toBeInTheDocument()
    const stored = JSON.parse(
      window.localStorage.getItem(FOLDER_COLLAPSE_STORAGE_KEY) ?? 'null',
    ) as { version: number; byNotebook: Record<string, Record<string, boolean>> }
    expect(stored.byNotebook.nb1).toEqual({ g1: false })
  })

  it('hides the combos section when combosEnabled is not passed', () => {
    render(<ContextPickerDialog {...baseProps} />)

    expect(screen.queryByText('chat.contextCombosTitle')).not.toBeInTheDocument()
  })

  it('renders a seeded combo with its surviving-entry count (deleted ids not counted)', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'insights', s9: 'full' },
              notes: { n1: 'full' },
            },
          ],
        },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    expect(screen.getByText('论文组合')).toBeInTheDocument()
    // s9 已不在池内（已删）不计入：现存 s1 + n1 = 2 项
    expect(screen.getByText('chat.contextComboCount (count=2)')).toBeInTheDocument()
  })

  it('shows the empty hint when no combos are saved', () => {
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    expect(screen.getByText('chat.contextCombosEmpty')).toBeInTheDocument()
  })

  it('saves a named combo into the store', () => {
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('chat.contextComboNamePlaceholder'), {
      target: { value: '我的组合' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'chat.contextComboSave' }))

    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
    ) as { version: number; byNotebook: Record<string, Array<{ name: string; sources: Record<string, string> }>> }
    expect(stored.byNotebook.nb1).toHaveLength(1)
    expect(stored.byNotebook.nb1[0].name).toBe('我的组合')
    // 当前勾选快照：s1=insights + n1=full，off 等价不存
    expect(stored.byNotebook.nb1[0].sources).toEqual({ s1: 'insights' })
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'chat.contextComboSaved (name=我的组合)',
    )
    // 保存后输入框清空
    expect(
      (screen.getByPlaceholderText('chat.contextComboNamePlaceholder') as HTMLInputElement).value,
    ).toBe('')
  })

  it('disables save and writes nothing when the selection is empty', () => {
    render(
      <ContextPickerDialog
        {...baseProps}
        combosEnabled
        onApplyCombo={vi.fn()}
        selections={{ sources: {}, notes: {} } as ContextSelections}
      />,
    )

    expect(screen.getByRole('button', { name: 'chat.contextComboSave' })).toBeDisabled()
    expect(window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)).toBeNull()
  })

  it('applies a combo as a whole-map replacement with off outside the combo', () => {
    const onApplyCombo = vi.fn()
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'insights' },
              notes: {},
            },
          ],
        },
      }),
    )
    render(
      <ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={onApplyCombo} />,
    )

    // 组合行按钮的可达名来自内容（名称+徽标文本），title 仅作悬浮提示
    fireEvent.click(screen.getByRole('button', { name: /论文组合/ }))

    // 整表替换：池内组合外一律 off；笔记未在组合内 → off；第二参透传组合 id
    expect(onApplyCombo).toHaveBeenCalledWith(
      {
        sources: { s1: 'insights', s2: 'off', s3: 'off' },
        notes: { n1: 'off' },
      },
      'c1',
    )
    expect(mockToastSuccess).toHaveBeenCalledWith('chat.contextComboApplied')
  })

  it('applies a saved combo after the selection changed and reproduces the saved snapshot', () => {
    // 验收主流程：勾选 2 文件 + 1 note → 保存 → 改勾选 → 应用 → 回到保存时的快照
    const onApplyCombo = vi.fn()
    const savedSelections = {
      sources: { s1: 'insights', s2: 'full' },
      notes: { n1: 'full' },
    } as ContextSelections
    const { rerender } = render(
      <ContextPickerDialog
        {...baseProps}
        combosEnabled
        onApplyCombo={onApplyCombo}
        selections={savedSelections}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('chat.contextComboNamePlaceholder'), {
      target: { value: '论文组合' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'chat.contextComboSave' }))
    expect(screen.getByText('论文组合')).toBeInTheDocument()

    // 改勾选：只剩 s3，笔记全撤
    rerender(
      <ContextPickerDialog
        {...baseProps}
        combosEnabled
        onApplyCombo={onApplyCombo}
        selections={{ sources: { s3: 'full' }, notes: {} } as ContextSelections}
      />,
    )

    // 应用 = 整表替换：组合内有值，改选的 s3 一律 off；第二参为保存出的组合 id
    // （保存即激活 → 更新按钮文案也含组合名，这里用行按钮的 title 精确定位）
    fireEvent.click(screen.getByTitle('chat.contextComboApplyTitle'))
    expect(onApplyCombo).toHaveBeenCalledTimes(1)
    const storedComboId = (
      JSON.parse(
        window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
      ) as { byNotebook: Record<string, Array<{ id: string }>> }
    ).byNotebook.nb1[0].id
    expect(onApplyCombo).toHaveBeenCalledWith(
      {
        sources: { s1: 'insights', s2: 'full', s3: 'off' },
        notes: { n1: 'full' },
      },
      storedComboId,
    )
  })

  it('applies a combo with ids missing from the loaded pool without error', () => {
    const onApplyCombo = vi.fn()
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '过时组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'full', s9: 'full' },
              notes: { n1: 'full', n9: 'full' },
            },
          ],
        },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={onApplyCombo} />)

    // 行计数只算现存：s1 + n1 = 3 项中的 2 项（s9/n9 已删不计）
    expect(screen.getByText('chat.contextComboCount (count=2)')).toBeInTheDocument()

    // 应用不报错：池外 id（已删或分页未加载）按组合值保留，后续分页加载
    // 该来源时沿用组合值而不是回落默认
    fireEvent.click(screen.getByRole('button', { name: /过时组合/ }))
    expect(onApplyCombo).toHaveBeenCalledTimes(1)
    const replacement = onApplyCombo.mock.calls[0][0] as ContextSelections
    expect(replacement.sources).toEqual({ s1: 'full', s2: 'off', s3: 'off', s9: 'full' })
    expect(replacement.notes).toEqual({ n1: 'full', n9: 'full' })
  })

  it('deletes a combo through the destructive confirm dialog', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'insights' },
              notes: {},
            },
          ],
        },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'chat.contextComboDeleteTitle' }))

    // 确认弹窗带组合名 + destructive 确认按钮
    expect(
      screen.getByText('chat.contextComboDeleteDesc (name=论文组合)'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))

    waitFor(() => {
      const stored = JSON.parse(
        window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
      ) as { byNotebook: Record<string, unknown[]> }
      expect(stored.byNotebook.nb1).toHaveLength(0)
    })
    expect(screen.queryByText('论文组合')).not.toBeInTheDocument()
  })

  it('renders the default combo entry and applies it as all-off with activation', () => {
    const onApplyCombo = vi.fn()
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={onApplyCombo} />)

    expect(screen.getByTestId('context-picker-combo-default-entry')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('context-picker-combo-default-entry'))

    // 应用 = 整表替换全 off；第二参透传默认组合 id
    expect(onApplyCombo).toHaveBeenCalledTimes(1)
    expect(onApplyCombo.mock.calls[0][0]).toEqual({
      sources: { s1: 'off', s2: 'off', s3: 'off' },
      notes: { n1: 'off' },
    })
    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
    ) as {
      byNotebook: Record<string, Array<{ id: string; isDefault?: boolean }>>
    }
    const defaults = stored.byNotebook.nb1.filter(c => c.isDefault)
    expect(defaults).toHaveLength(1)
    expect(onApplyCombo.mock.calls[0][1]).toBe(defaults[0].id)
    expect(mockToastSuccess).toHaveBeenCalledWith('chat.contextComboApplied')

    // 双击幂等：再次点击仍只有一条 isDefault 条目（重复应用、不重复创建）
    fireEvent.click(screen.getByTestId('context-picker-combo-default-entry'))
    const storedAfter = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
    ) as {
      byNotebook: Record<string, Array<{ id: string; isDefault?: boolean }>>
    }
    expect(
      storedAfter.byNotebook.nb1.filter(c => c.isDefault),
    ).toHaveLength(1)
    expect(storedAfter.byNotebook.nb1[0].id).toBe(defaults[0].id)
  })

  it('hides the update button when no combo is active', () => {
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    expect(
      screen.queryByTestId('context-picker-combo-update-current'),
    ).not.toBeInTheDocument()
  })

  it('hides the update button while the default combo is active (even dirty)', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c-def', dirty: true } },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    expect(
      screen.queryByTestId('context-picker-combo-update-current'),
    ).not.toBeInTheDocument()
  })

  it('offers no deletable combo rows when only the default combo exists', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
          ],
        },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    // 默认组合不是用户组合：不渲染可删行，列表仍显示空提示
    expect(
      screen.queryByRole('button', { name: 'chat.contextComboDeleteTitle' }),
    ).not.toBeInTheDocument()
    expect(screen.getByText('chat.contextCombosEmpty')).toBeInTheDocument()
  })

  it('disables the update button while the active combo is clean', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'insights' },
              notes: { n1: 'full' },
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      }),
    )
    render(<ContextPickerDialog {...baseProps} combosEnabled onApplyCombo={vi.fn()} />)

    expect(screen.getByTestId('context-picker-combo-update-current')).toBeDisabled()
  })

  it('enables the update button when a clean snapshot drifts from the current selections', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'insights' },
              notes: { n1: 'full' },
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      }),
    )
    render(
      <ContextPickerDialog
        {...baseProps}
        combosEnabled
        onApplyCombo={vi.fn()}
        // s2 是快照之外被默认填充进勾选的来源：现场失配 → 更新入口立即可点
        selections={{
          sources: { s1: 'insights', s2: 'full' },
          notes: { n1: 'full' },
        } as ContextSelections}
      />,
    )

    expect(screen.getByTestId('context-picker-combo-update-current')).toBeEnabled()
  })

  it('updates the active combo snapshot from the update button and clears dirty', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      }),
    )
    render(
      <ContextPickerDialog
        {...baseProps}
        combosEnabled
        onApplyCombo={vi.fn()}
        selections={{
          sources: { s1: 'insights', s2: 'full', s3: 'off' },
          notes: { n1: 'full' },
        } as ContextSelections}
      />,
    )

    fireEvent.click(screen.getByTestId('context-picker-combo-update-current'))

    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null',
    ) as {
      byNotebook: Record<string, Array<{
        id: string
        createdAt: string
        sources: Record<string, string>
        notes: Record<string, string>
      }>>
      activeByNotebook: Record<string, { id: string; dirty: boolean }>
    }
    // 快照=当前勾选（off 过滤），激活记录 dirty 清零
    expect(stored.byNotebook.nb1[0].sources).toEqual({ s1: 'insights', s2: 'full' })
    expect(stored.byNotebook.nb1[0].notes).toEqual({ n1: 'full' })
    expect(stored.activeByNotebook.nb1).toEqual({ id: 'c1', dirty: false })
    // 覆盖按 id 进行：id/createdAt 不变
    expect(stored.byNotebook.nb1[0].id).toBe('c1')
    expect(stored.byNotebook.nb1[0].createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'chat.contextComboUpdated (name=论文组合)',
    )
  })
})
