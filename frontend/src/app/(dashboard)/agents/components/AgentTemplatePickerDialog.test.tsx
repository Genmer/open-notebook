import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentTemplatePickerDialog } from './AgentTemplatePickerDialog'
import {
  AGENT_TEMPLATES,
  AGENT_TEMPLATE_CATEGORIES,
  pickTemplateText,
} from '@/lib/agent-templates'

// Mock Tooltip components to avoid Radix UI async issues in tests
// (project precedent: AgentsList.test.tsx) — this keeps TooltipContent
// children mounted so the badge tooltip copy is assertable.
vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

// useTranslation is mocked globally in setup.ts (t returns the key string,
// language is 'en-US' — so pickTemplateText resolves to the English variant).
// The picker has no data dependencies, so no other mocks are needed.

describe('AgentTemplatePickerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the picker only while open', () => {
    const { rerender } = render(
      <AgentTemplatePickerDialog open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    )
    expect(screen.queryByTestId('agent-template-picker')).not.toBeInTheDocument()

    rerender(
      <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    )
    expect(screen.getByTestId('agent-template-picker')).toBeInTheDocument()
  })

  it('shows every category group, all template cards and the blank card', () => {
    render(
      <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    )

    // category group titles come from i18n (t returns the key)
    for (const { key: category } of AGENT_TEMPLATE_CATEGORIES) {
      expect(
        screen.getByText(`agents.templateCat.${category}`)
      ).toBeInTheDocument()
    }
    // first grid cell is the dashed "start from scratch" card
    expect(screen.getByTestId('agent-template-blank')).toBeInTheDocument()
    expect(screen.getByText('agents.templateBlankName')).toBeInTheDocument()

    // one card per template, carrying the localized name
    for (const tpl of AGENT_TEMPLATES) {
      const card = screen.getByTestId(`agent-template-card-${tpl.key}`)
      expect(card).toBeInTheDocument()
      expect(card).toHaveTextContent(pickTemplateText(tpl.name, 'en-US'))
    }
  })

  it('confirms the selected template key', () => {
    const onConfirm = vi.fn()
    render(
      <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />
    )

    const card = screen.getByTestId('agent-template-card-senior-software-engineer')
    // jsdom doesn't forward label clicks to the control — click the radio
    // itself (project precedent: ImportConflictDialog.test radioValue helper).
    fireEvent.click(card.querySelector('button[role="radio"]')!)
    fireEvent.click(screen.getByTestId('agent-template-use'))

    expect(onConfirm).toHaveBeenCalledWith('senior-software-engineer')
  })

  it('confirms the blank card as "blank"', () => {
    const onConfirm = vi.fn()
    render(
      <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={onConfirm} />
    )

    const blank = screen.getByTestId('agent-template-blank')
    fireEvent.click(blank.querySelector('button[role="radio"]')!)
    fireEvent.click(screen.getByTestId('agent-template-use'))

    expect(onConfirm).toHaveBeenCalledWith('blank')
  })

  it('disables the use button until a card is selected', () => {
    render(
      <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
    )
    expect(screen.getByTestId('agent-template-use')).toBeDisabled()
  })

  it('closes via the cancel button', () => {
    const onOpenChange = vi.fn()
    render(
      <AgentTemplatePickerDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={vi.fn()}
      />
    )
    fireEvent.click(screen.getByText('common.cancel'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  // 金标「专业深化」徽章：仅 deepened 模板（两个软考论文模板）挂载。
  describe('gold deepened badge', () => {
    it('renders the badge on exactly the two deepened templates', () => {
      render(
        <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
      )
      expect(
        screen.getByTestId('agent-template-gold-ruankao-essay-coach')
      ).toBeInTheDocument()
      expect(
        screen.getByTestId('agent-template-gold-ruankao-essay-examiner')
      ).toBeInTheDocument()
      // no other card carries the badge (spot-check a non-ruankao card)
      const plainCard = screen.getByTestId('agent-template-card-senior-software-engineer')
      expect(
        within(plainCard).queryByTestId(/^agent-template-gold-/)
      ).not.toBeInTheDocument()
      // and the whole grid holds exactly two badges
      expect(screen.getAllByTestId(/^agent-template-gold-/)).toHaveLength(2)
    })

    it('badge is a gold Sparkles icon with a two-line tooltip', () => {
      render(
        <AgentTemplatePickerDialog open onOpenChange={vi.fn()} onConfirm={vi.fn()} />
      )
      const badge = screen.getByTestId('agent-template-gold-ruankao-essay-coach')
      // amber token, dark-mode safe; svg carries the size-4 icon
      expect(badge).toHaveClass('text-gold')
      expect(badge.querySelector('svg')).toHaveClass('size-4')
      // accessible name comes from the i18n key (t returns the key in tests)
      expect(badge).toHaveAttribute('aria-label', 'agents.templateGoldBadge')
      // tooltip copy: title + description, one pair per badge (t returns the key)
      expect(screen.getAllByText('agents.templateGoldBadge')).toHaveLength(2)
      expect(screen.getAllByText('agents.templateGoldBadgeDesc')).toHaveLength(2)
    })
  })
})
