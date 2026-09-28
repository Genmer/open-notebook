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
