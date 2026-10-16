import { act, render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ContextIndicator } from './ContextIndicator'
import {
  CONTEXT_COMBOS_CHANGED_EVENT,
  CONTEXT_COMBOS_STORAGE_KEY,
} from '@/lib/notebooks/context-combos'
import type { SourceListResponse, NoteResponse } from '@/lib/types/api'
import type { ContextSelections } from '@/lib/types/notebook-context'

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

vi.mock('@/lib/hooks/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params && Object.keys(params).length > 0) {
        const query = Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')
        return `${key} (${query})`
      }
      return key
    },
  }),
}))

// Radix DropdownMenu 在 jsdom 里常开 mock（项目既有先例，见 NotesColumn.test.tsx）
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    onClick,
    ...rest
  }: {
    children: React.ReactNode
    onSelect?: () => void
    disabled?: boolean
    onClick?: (e: React.MouseEvent) => void
    [key: string]: unknown
  }) => (
    <button
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.()
      }}
      {...rest}
    >
      {children}
    </button>
  ),
}))

describe('ContextIndicator', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockToastSuccess.mockClear()
    mockToastError.mockClear()
  })

  const baseProps = {
    sourcesInsights: 1,
    sourcesFull: 2,
    notesCount: 1,
    tokenCount: 1500,
    charCount: 3000,
  }

  const sampleSelections: ContextSelections = {
    sources: { s1: 'full', s2: 'insights', s3: 'off' },
    notes: { n1: 'full' },
  }

  const sampleSources: SourceListResponse[] = [
    {
      id: 's1',
      title: '论文1',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 3,
      created: '',
      updated: '',
    },
    {
      id: 's2',
      title: '论文2',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '',
      updated: '',
    },
    {
      id: 's3',
      title: '未选文件',
      asset: null,
      embedded: false,
      embedded_chunks: 0,
      insights_count: 0,
      created: '',
      updated: '',
    },
  ]

  const sampleNotes: NoteResponse[] = [
    { id: 'n1', title: '笔记1', content: null, note_type: null, created: '', updated: '' },
  ]

  it('renders read-only view when neither onOpenPicker nor combosEnabled is passed', () => {
    render(<ContextIndicator {...baseProps} />)
    expect(screen.getByText('chat.contextLabel')).toBeInTheDocument()
    expect(screen.queryByTestId('context-combo-dropdown-trigger')).not.toBeInTheDocument()
    expect(screen.queryByTestId('open-context-picker-button')).not.toBeInTheDocument()
  })

  it('renders open-picker button and invokes callback on click', () => {
    const onOpenPicker = vi.fn()
    render(<ContextIndicator {...baseProps} onOpenPicker={onOpenPicker} />)

    const pickerBtn = screen.getByTestId('open-context-picker-button')
    expect(pickerBtn).toBeInTheDocument()
    fireEvent.click(pickerBtn)
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
  })

  it('does not render combo dropdown when combosEnabled is false', () => {
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={false}
        onApplyCombo={vi.fn()}
      />
    )
    expect(screen.queryByTestId('context-combo-dropdown-trigger')).not.toBeInTheDocument()
  })

  it('renders combo dropdown button when combosEnabled is true with notebookId and onApplyCombo', () => {
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )
    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('chat.contextCombosMenuLabel')
  })

  it('shows empty hint in dropdown when no combos are saved', () => {
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
      />
    )
    expect(screen.getByTestId('context-combos-empty-hint')).toHaveTextContent(
      'chat.contextCombosEmpty'
    )
  })

  it('recognizes and displays matched combo name on the trigger button', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文精读',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full', s2: 'insights' },
              notes: { n1: 'full' },
            },
          ],
        },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent('chat.contextComboPrefix')
    expect(trigger).toHaveTextContent('论文精读')
  })

  it('still matches a combo whose deleted entries no longer exist in the pools', () => {
    // 存活条目匹配：s9/n9 已被删除（池外），匹配只比较池内存活条目，
    // 不因组合里带着已删 id 而整体失配
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-stale',
              name: '带已删条目的组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full', s9: 'full' },
              notes: { n1: 'full', n9: 'full' },
            },
          ],
        },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        // 判别场景：勾选表只含池内条目（s9/n9 完全不在勾选里）。若无池过滤，
        // 组合侧 2 条 vs 勾选侧 1 条会长度失配 → 不再误判为失配
        contextSelections={{
          sources: { s1: 'full', s2: 'off', s3: 'off' },
          notes: { n1: 'full' },
        }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent('带已删条目的组合')
  })

  it('applies a combo when clicked in the dropdown menu', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-case',
              name: '案例分析',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s2: 'full' },
              notes: {},
            },
          ],
        },
      })
    )

    const onApplyCombo = vi.fn()
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={onApplyCombo}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const comboItem = screen.getByTestId('context-combo-item-c-case')
    fireEvent.click(comboItem)

    expect(onApplyCombo).toHaveBeenCalledTimes(1)
    const replacement = onApplyCombo.mock.calls[0][0]
    expect(onApplyCombo.mock.calls[0][1]).toBe('c-case')
    expect(replacement.sources.s2).toBe('full')
    expect(replacement.sources.s1).toBe('off')
    expect(replacement.sources.s3).toBe('off')
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'chat.contextComboApplied (name=案例分析)'
    )

    // 切换组合后激活记忆写入 activeByNotebook（干净激活）
    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    expect(stored.activeByNotebook.nb1).toEqual({ id: 'c-case', dirty: false })
  })

  it('marks the combo recorded as active over an identical earlier combo', () => {
    // 两个组合内容完全相同，激活记录指向后者：触发按钮应显示后者（按激活
    // 记忆精准标记，而非按列表顺序先匹配到谁算谁）
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-first',
              name: '组合一',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full', s2: 'insights' },
              notes: { n1: 'full' },
            },
            {
              id: 'c-second',
              name: '组合二',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full', s2: 'insights' },
              notes: { n1: 'full' },
            },
          ],
        },
        activeByNotebook: { nb1: 'c-second' },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent('组合二')
    expect(trigger).not.toHaveTextContent('组合一')
  })

  it('highlights only the active combo with the check mark in the dropdown', () => {
    // 菜单高亮 = 勾选图标只出现在激活记录指向的条目上（两个组合内容相同，
    // 高亮必须由激活记忆而不是内容匹配顺序决定）
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-first',
              name: '组合一',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
            {
              id: 'c-second',
              name: '组合二',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: 'c-second' },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{ sources: { s1: 'full' }, notes: {} }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const activeItem = screen.getByTestId('context-combo-item-c-second')
    const inactiveItem = screen.getByTestId('context-combo-item-c-first')
    expect(activeItem.querySelector('svg.lucide-check')).not.toBeNull()
    expect(inactiveItem.querySelector('svg.lucide-check')).toBeNull()
  })

  it('saves current selections into a new combo via save dialog', () => {
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    // Click "save as new"
    const saveMenuItem = screen.getByTestId('context-combo-save-as-new')
    fireEvent.click(saveMenuItem)

    // Input combo name in the dialog
    const input = screen.getByTestId('new-combo-name-input')
    fireEvent.change(input, { target: { value: '软考论文' } })

    // Click confirm save
    const confirmBtn = screen.getByTestId('confirm-save-combo-button')
    fireEvent.click(confirmBtn)

    // Verify localStorage
    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    expect(stored.byNotebook.nb1).toHaveLength(1)
    expect(stored.byNotebook.nb1[0].name).toBe('软考论文')
    expect(stored.byNotebook.nb1[0].sources).toEqual({ s1: 'full', s2: 'insights' })
    expect(stored.byNotebook.nb1[0].notes).toEqual({ n1: 'full' })
    // 保存即激活：新组合 id 写入 activeByNotebook
    expect(stored.activeByNotebook.nb1).toEqual({
      id: stored.byNotebook.nb1[0].id,
      dirty: false,
    })
    expect(mockToastSuccess).toHaveBeenCalledWith('chat.contextComboSaved (name=软考论文)')
  })

  it('deletes a combo with confirmation dialog', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-del',
              name: '待删组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    // Click trash button
    const deleteBtn = screen.getByTestId('delete-combo-c-del')
    fireEvent.click(deleteBtn)

    // Confirm dialog appears
    const confirmDeleteBtn = screen.getByRole('button', { name: 'common.delete' })
    fireEvent.click(confirmDeleteBtn)

    // Check deleted from localStorage
    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    expect(stored.byNotebook.nb1).toHaveLength(0)
    expect(mockToastSuccess).toHaveBeenCalledWith('chat.contextComboDeleted')
  })

  it('opens the picker on row click and Enter/Space keys', () => {
    const onOpenPicker = vi.fn()
    render(
      <ContextIndicator
        {...baseProps}
        combosEnabled={false}
        onOpenPicker={onOpenPicker}
      />
    )

    const bar = screen.getByTestId('context-indicator-bar')
    expect(bar).toHaveAttribute('role', 'button')
    expect(bar).toHaveAttribute('tabindex', '0')

    fireEvent.click(bar)
    fireEvent.keyDown(bar, { key: 'Enter' })
    fireEvent.keyDown(bar, { key: ' ' })
    expect(onOpenPicker).toHaveBeenCalledTimes(3)
  })

  it('keeps inner bar interactions from opening the picker (bubbling isolated)', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      })
    )

    const onOpenPicker = vi.fn()
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        onOpenPicker={onOpenPicker}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    fireEvent.click(screen.getByTestId('context-combo-dropdown-trigger'))
    fireEvent.click(screen.getByTestId('context-combo-item-c1'))
    fireEvent.click(screen.getByTestId('delete-combo-c1'))
    // 更新入口先于默认入口：点默认入口会把激活切到默认组合，更新入口随之隐藏
    fireEvent.click(screen.getByTestId('context-combo-update-current'))
    fireEvent.click(screen.getByTestId('context-combo-default-entry'))
    fireEvent.click(screen.getByTestId('context-combo-save-as-new'))
    expect(onOpenPicker).not.toHaveBeenCalled()
  })

  it('opens the picker from the row surface only — Enter/Space on inner buttons never triggers the row', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      })
    )

    const onOpenPicker = vi.fn()
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        onOpenPicker={onOpenPicker}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    // 行本身可点（组合启用 + onOpenPicker 同时存在时仍成立）
    fireEvent.click(screen.getByTestId('context-indicator-bar'))
    expect(onOpenPicker).toHaveBeenCalledTimes(1)

    // 焦点在行内按钮上按 Enter/Space：事件冒泡到行也不得触发行点击
    fireEvent.keyDown(screen.getByTestId('context-combo-dropdown-trigger'), {
      key: 'Enter',
    })
    fireEvent.keyDown(screen.getByTestId('open-context-picker-button'), {
      key: ' ',
    })
    expect(onOpenPicker).toHaveBeenCalledTimes(1)
  })

  it('creates the default combo on first click, applies it as all-off, and never duplicates it', () => {
    const onApplyCombo = vi.fn()
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={onApplyCombo}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    fireEvent.click(screen.getByTestId('context-combo-default-entry'))

    // 创建：storage 出现唯一的 isDefault 条目
    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    const defaults = stored.byNotebook.nb1.filter(
      (c: { isDefault?: boolean }) => c.isDefault
    )
    expect(defaults).toHaveLength(1)

    // 应用：整表替换全 off + 默认组合 id；toast 名走默认组合键
    expect(onApplyCombo).toHaveBeenCalledTimes(1)
    expect(onApplyCombo.mock.calls[0][0]).toEqual({
      sources: { s1: 'off', s2: 'off', s3: 'off' },
      notes: { n1: 'off' },
    })
    expect(onApplyCombo.mock.calls[0][1]).toBe(defaults[0].id)
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'chat.contextComboApplied (name=chat.contextComboDefaultName)'
    )

    // 点击 = 激活：默认组合成为当前激活组合（干净）
    expect(stored.activeByNotebook.nb1).toEqual({ id: defaults[0].id, dirty: false })

    // 二次点击不重复创建
    fireEvent.click(screen.getByTestId('context-combo-default-entry'))
    const storedAfter = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    expect(
      storedAfter.byNotebook.nb1.filter((c: { isDefault?: boolean }) => c.isDefault)
    ).toHaveLength(1)
  })

  it('labels the trigger with the modified suffix when the active combo is dirty', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文精读',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent(
      'chat.contextComboActiveModifiedLabel (name=论文精读)'
    )
  })

  it('labels the trigger with the default combo name when it is active on empty selections', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
          ],
        },
        activeByNotebook: { nb1: 'c-def' },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{ sources: { s1: 'off', s3: 'off' }, notes: {} }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent('chat.contextComboPrefix')
    expect(trigger).toHaveTextContent('chat.contextComboDefaultName')
    expect(trigger).not.toHaveTextContent('__default__')
  })

  it('hides the update entry while the default combo is active (even dirty)', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c-def', dirty: true } },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{ sources: { s1: 'off' }, notes: {} }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    expect(screen.queryByTestId('context-combo-update-current')).not.toBeInTheDocument()
  })

  it('never renders a delete button for the default combo', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c-def',
              name: '__default__',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: {},
              notes: {},
              isDefault: true,
            },
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    expect(screen.queryByTestId('delete-combo-c-def')).not.toBeInTheDocument()
    expect(screen.getByTestId('delete-combo-c1')).toBeInTheDocument()
  })

  it('hides the update entry when no combo is active', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    expect(screen.queryByTestId('context-combo-update-current')).not.toBeInTheDocument()
  })

  it('disables the update entry while the active combo is clean', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{
          sources: { s1: 'full', s2: 'off', s3: 'off' },
          notes: { n1: 'off' },
        }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    expect(screen.getByTestId('context-combo-update-current')).toBeDisabled()
  })

  it('updates the active combo snapshot from the update entry and clears dirty', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{
          sources: { s1: 'insights', s2: 'full', s3: 'off' },
          notes: { n1: 'full' },
        }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    fireEvent.click(screen.getByTestId('context-combo-update-current'))

    const stored = JSON.parse(
      window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY) ?? 'null'
    )
    // 快照=当前勾选（off 过滤），激活记录 dirty 清零
    expect(stored.byNotebook.nb1[0].sources).toEqual({ s1: 'insights', s2: 'full' })
    expect(stored.byNotebook.nb1[0].notes).toEqual({ n1: 'full' })
    expect(stored.activeByNotebook.nb1).toEqual({ id: 'c1', dirty: false })
    // 覆盖按 id 进行：id/createdAt 不变
    expect(stored.byNotebook.nb1[0].id).toBe('c1')
    expect(stored.byNotebook.nb1[0].createdAt).toBe('2026-10-13T00:00:00.000Z')
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'chat.contextComboUpdated (name=论文组合)'
    )
  })

  it('refreshes the trigger label when a combos-changed event arrives from another surface', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: { id: 'c1', dirty: true } },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={sampleSelections}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )
    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent(
      'chat.contextComboActiveModifiedLabel (name=论文组合)'
    )

    // 模拟弹窗侧 updateCombo 落盘：快照改为与勾选一致 + 清 dirty，再广播
    const raw = window.localStorage.getItem(CONTEXT_COMBOS_STORAGE_KEY)!
    const store = JSON.parse(raw) as {
      byNotebook: Record<string, Array<{ sources: Record<string, string>; notes: Record<string, string> }>>
      activeByNotebook: Record<string, { id: string; dirty: boolean }>
    }
    store.byNotebook.nb1[0].sources = { s1: 'full', s2: 'insights' }
    store.byNotebook.nb1[0].notes = { n1: 'full' }
    store.activeByNotebook.nb1 = { id: 'c1', dirty: false }
    window.localStorage.setItem(CONTEXT_COMBOS_STORAGE_KEY, JSON.stringify(store))
    act(() => {
      window.dispatchEvent(new CustomEvent(CONTEXT_COMBOS_CHANGED_EVENT))
    })

    // 跨表面脏读修复：无需重开下拉，标签立即回到干净前缀
    expect(trigger).toHaveTextContent('chat.contextComboPrefix')
    expect(trigger).toHaveTextContent('论文组合')
    expect(trigger).not.toHaveTextContent('chat.contextComboActiveModifiedLabel')
  })

  it('marks the trigger modified and enables the update entry when a default-filled source drifts from a clean snapshot', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      })
    )

    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        // s3 是快照之外被默认填充进来的来源：现场失配 → 已修改标签 + 更新入口可点
        contextSelections={{
          sources: { s1: 'full', s2: 'off', s3: 'full' },
          notes: {},
        }}
        sources={sampleSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent(
      'chat.contextComboActiveModifiedLabel (name=论文组合)'
    )
    expect(screen.getByTestId('context-combo-update-current')).toBeEnabled()
  })

  it('marks the trigger modified when a picker-made selection sits outside the paginated pool', () => {
    window.localStorage.setItem(
      CONTEXT_COMBOS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        byNotebook: {
          nb1: [
            {
              id: 'c1',
              name: '论文组合',
              createdAt: '2026-10-13T00:00:00.000Z',
              updatedAt: '2026-10-13T00:00:00.000Z',
              sources: { s1: 'full' },
              notes: {},
            },
          ],
        },
        activeByNotebook: { nb1: 'c1' },
      })
    )

    // sources prop 不含 s2（分页池漏掉），但弹窗（全量树）勾了 s2:full：
    // 并集口径让 s2 参与比对 → 已修改标签 + 更新入口可点，与弹窗判定一致
    const paginatedSources = sampleSources.filter((s) => s.id !== 's2')
    render(
      <ContextIndicator
        {...baseProps}
        notebookId="nb1"
        combosEnabled={true}
        onApplyCombo={vi.fn()}
        contextSelections={{
          sources: { s1: 'full', s2: 'full', s3: 'off' },
          notes: { n1: 'full' },
        }}
        sources={paginatedSources}
        notes={sampleNotes}
      />
    )

    const trigger = screen.getByTestId('context-combo-dropdown-trigger')
    expect(trigger).toHaveTextContent(
      'chat.contextComboActiveModifiedLabel (name=论文组合)'
    )
    expect(screen.getByTestId('context-combo-update-current')).toBeEnabled()
  })
})
