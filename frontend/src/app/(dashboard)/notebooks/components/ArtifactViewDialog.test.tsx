import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ArtifactViewDialog } from './ArtifactViewDialog'

// useTranslation is mocked globally in setup.ts (t returns the key string)

// Keep the render light: only the markdown child contract matters here.
vi.mock('@/components/ui/markdown-renderer', () => ({
  MarkdownRenderer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const note = { title: 'Architecture Essay', content: '# Essay body' }

const renderDialog = (onOpenChange = vi.fn()) => {
  render(<ArtifactViewDialog open onOpenChange={onOpenChange} note={note} />)
  return {
    onOpenChange,
    content: () => document.querySelector<HTMLElement>('[data-slot="dialog-content"]')!,
  }
}

describe('ArtifactViewDialog fullscreen', () => {
  it('enters fullscreen on toggle, centering the body in a prose column', () => {
    const { content } = renderDialog()

    expect(content().className).toContain('sm:max-w-2xl')
    expect(content().className).not.toContain('w-screen')
    expect(document.querySelector('.max-w-prose')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))

    expect(content().className).toContain('!max-w-screen !max-h-screen w-screen h-screen border-none rounded-none')
    expect(screen.getByRole('button', { name: 'artifacts.exitFullscreen' })).toBeInTheDocument()

    const body = document.querySelector<HTMLElement>('.max-w-prose')!
    expect(body).not.toBeNull()
    expect(body.className).toContain('mx-auto')
    expect(body).toHaveTextContent('Essay body')
  })

  it('Escape in fullscreen exits fullscreen but keeps the dialog open', () => {
    const { onOpenChange, content } = renderDialog()

    fireEvent.click(screen.getByRole('button', { name: 'artifacts.enterFullscreen' }))
    fireEvent.keyDown(content(), { key: 'Escape' })

    // Radix would dismiss the dialog unless onEscapeKeyDown preventDefaults.
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(content().className).toContain('sm:max-w-2xl')
    expect(content().className).not.toContain('w-screen')
    expect(screen.getByRole('button', { name: 'artifacts.enterFullscreen' })).toBeInTheDocument()
  })

  it('Escape outside fullscreen lets Radix close the dialog', () => {
    const { onOpenChange, content } = renderDialog()

    fireEvent.keyDown(content(), { key: 'Escape' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('ArtifactViewDialog bottom action bar', () => {
  it('renders edit and save-as-source buttons and fires both callbacks', () => {
    const onEdit = vi.fn()
    const onSaveAsSource = vi.fn()
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        onEdit={onEdit}
        onSaveAsSource={onSaveAsSource}
      />
    )

    fireEvent.click(screen.getByTestId('artifact-view-edit'))
    expect(onEdit).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByTestId('artifact-view-save-as-source'))
    expect(onSaveAsSource).toHaveBeenCalledTimes(1)
  })

  it('labels the buttons through i18n keys', () => {
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={note}
        onEdit={vi.fn()}
        onSaveAsSource={vi.fn()}
      />
    )

    expect(screen.getByText('artifacts.editNote')).toBeInTheDocument()
    expect(screen.getByText('notebooks.saveAsSource.action')).toBeInTheDocument()
  })

  it('renders no action bar when no callbacks are provided', () => {
    render(<ArtifactViewDialog open onOpenChange={vi.fn()} note={note} />)

    expect(screen.queryByTestId('artifact-view-edit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('artifact-view-save-as-source')).not.toBeInTheDocument()
  })

  it('still renders the action bar for an empty note (empty notes need the editor most)', () => {
    render(
      <ArtifactViewDialog
        open
        onOpenChange={vi.fn()}
        note={{ title: 'Empty', content: null }}
        onEdit={vi.fn()}
      />
    )

    expect(screen.getByTestId('artifact-view-edit')).toBeInTheDocument()
    // 空内容：不渲染正文块，但操作栏仍在
    expect(screen.queryByTestId('artifact-view-save-as-source')).not.toBeInTheDocument()
  })
})
