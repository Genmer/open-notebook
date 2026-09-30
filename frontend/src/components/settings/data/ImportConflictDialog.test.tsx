import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

import { ImportConflictDialog } from './ImportConflictDialog'
import type { ImportScanResponse } from '@/lib/api/dataTransfer'

const scan: ImportScanResponse = {
  scan_id: 'scan-1',
  package_type: 'models',
  format_version: 2,
  counts: { credential: 2, model: 1, default_models: 1 },
  conflicts: [
    {
      kind: 'credential',
      id: 'credential:c1',
      local: { name: 'Local', provider: 'openai', api_key: '***5678', model_count: 2 },
      package: { name: 'Pkg', provider: 'vertex', api_key: '***3210', model_count: 1 },
      diff_fields: ['name', 'provider', 'api_key'],
      default_action: 'skip',
    },
    {
      kind: 'model',
      id: 'model:m1',
      local: { name: 'GPT', provider: 'openai', type: 'language', credential: 'Local' },
      package: { name: 'Gemini', provider: 'vertex', type: 'language', credential: 'Pkg' },
      diff_fields: ['name', 'provider'],
      default_action: 'skip',
    },
  ],
  decisions_required: 2,
}

function radioValue(container: HTMLElement): string | null {
  return container.getAttribute('aria-checked') === 'true'
    ? (container.getAttribute('value') ?? null)
    : null
}

function rowRadios(id: string): HTMLElement[] {
  // Each conflict row is a bordered container holding its own radio group.
  const row = screen.getByText(id).closest('div.rounded-md')
  if (!row) throw new Error(`row ${id} not found`)
  return Array.from(row.querySelectorAll('button[role="radio"]'))
}

describe('ImportConflictDialog', () => {
  let onCancel: Mock
  let onConfirm: Mock

  beforeEach(() => {
    vi.clearAllMocks()
    onCancel = vi.fn()
    onConfirm = vi.fn()
  })

  it('renders both sides with diff highlighting and defaults everything to skip', () => {
    render(
      <ImportConflictDialog
        open
        scan={scan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    expect(screen.getByText('dataManagement.import.conflict.title')).toBeInTheDocument()
    // Both sides render a header per conflict row.
    expect(
      screen.getAllByText('dataManagement.import.conflict.localColumn')
    ).toHaveLength(2)
    expect(
      screen.getAllByText('dataManagement.import.conflict.packageColumn')
    ).toHaveLength(2)
    // Kind badges resolve to their labels.
    expect(
      screen.getByText('dataManagement.import.conflict.kindCredential')
    ).toBeInTheDocument()
    expect(screen.getByText('dataManagement.import.conflict.kindModel')).toBeInTheDocument()
    // Masked keys are rendered as-is on both sides.
    expect(screen.getByText('***5678')).toBeInTheDocument()
    expect(screen.getByText('***3210')).toBeInTheDocument()
    // default_models>0 shows the note.
    expect(
      screen.getByText('dataManagement.import.conflict.defaultNote')
    ).toBeInTheDocument()

    for (const id of ['credential:c1', 'model:m1']) {
      const [skipRadio, overwriteRadio] = rowRadios(id)
      expect(radioValue(skipRadio)).toBe('skip')
      expect(radioValue(overwriteRadio)).toBe(null)
    }

    fireEvent.click(screen.getByText('dataManagement.import.conflict.startImport'))
    expect(onConfirm).toHaveBeenCalledWith([
      { kind: 'credential', id: 'credential:c1', action: 'skip' },
      { kind: 'model', id: 'model:m1', action: 'skip' },
    ])
  })

  it('switches a single row to overwrite via its radio group', () => {
    render(
      <ImportConflictDialog
        open
        scan={scan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    const [, overwriteRadio] = rowRadios('credential:c1')
    fireEvent.click(overwriteRadio)

    fireEvent.click(screen.getByText('dataManagement.import.conflict.startImport'))
    expect(onConfirm).toHaveBeenCalledWith([
      { kind: 'credential', id: 'credential:c1', action: 'overwrite' },
      { kind: 'model', id: 'model:m1', action: 'skip' },
    ])
  })

  it('applies the global skip-all and overwrite-all buttons', () => {
    render(
      <ImportConflictDialog
        open
        scan={scan}
        onCancel={onConfirm}
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByText('dataManagement.import.conflict.overwriteAll'))
    for (const id of ['credential:c1', 'model:m1']) {
      const [, overwriteRadio] = rowRadios(id)
      expect(radioValue(overwriteRadio)).toBe('overwrite')
    }

    fireEvent.click(screen.getByText('dataManagement.import.conflict.skipAll'))
    for (const id of ['credential:c1', 'model:m1']) {
      const [skipRadio] = rowRadios(id)
      expect(radioValue(skipRadio)).toBe('skip')
    }
  })

  it('cancel closes without confirming', () => {
    render(
      <ImportConflictDialog
        open
        scan={scan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByText('common.cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('hides the default-models note when the package carries none', () => {
    const noDefaults: ImportScanResponse = {
      ...scan,
      counts: { credential: 1, model: 1 },
    }
    render(
      <ImportConflictDialog
        open
        scan={noDefaults}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )

    expect(
      screen.queryByText('dataManagement.import.conflict.defaultNote')
    ).not.toBeInTheDocument()
  })

  it('resets row choices when a new scan arrives', () => {
    const { rerender } = render(
      <ImportConflictDialog
        open
        scan={scan}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    )
    const [, overwriteRadio] = rowRadios('credential:c1')
    fireEvent.click(overwriteRadio)

    const nextScan: ImportScanResponse = {
      ...scan,
      scan_id: 'scan-2',
      conflicts: [scan.conflicts[0]],
      decisions_required: 1,
    }
    act(() => {
      rerender(
        <ImportConflictDialog
          open
          scan={nextScan}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      )
    })

    const [skipRadio] = rowRadios('credential:c1')
    expect(radioValue(skipRadio)).toBe('skip')

    fireEvent.click(screen.getByText('dataManagement.import.conflict.startImport'))
    expect(onConfirm).toHaveBeenCalledWith([
      { kind: 'credential', id: 'credential:c1', action: 'skip' },
    ])
  })
})
