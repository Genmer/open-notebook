import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import UsageRecordsTable from './UsageRecordsTable'
import { UsageRecord } from '@/lib/types/api'

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  id: 'model_usage:1',
  created: '2026-09-20T10:00:00Z',
  day: '2026-09-20',
  model_name: 'gpt-4o',
  provider: 'openai',
  call_type: 'chat',
  input_tokens: 10,
  output_tokens: 5,
  total_tokens: 15,
  is_estimated: false,
  success: true,
  error: null,
  ...overrides,
})

describe('UsageRecordsTable', () => {
  it('renders rows with status badges and the estimate marker', () => {
    render(
      <UsageRecordsTable
        records={[record(), record({ id: 'model_usage:2', success: false, error: 'boom', is_estimated: true })]}
        total={2}
        language="en-US"
      />
    )

    expect(screen.getByText('usage.success')).toBeInTheDocument()
    const failure = screen.getByText('usage.failure')
    expect(failure.closest('[title="boom"]')).not.toBeNull()
    expect(screen.getByText('≈')).toBeInTheDocument()
  })

  it('localizes timestamps with the interface language', () => {
    render(
      <UsageRecordsTable records={[record()]} total={1} language="de-DE" />
    )

    expect(
      screen.getByText(new Date('2026-09-20T10:00:00Z').toLocaleString('de-DE'))
    ).toBeInTheDocument()
  })

  it('offers load-more while more records exist and disables it while fetching', () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(
      <UsageRecordsTable records={[record()]} total={3} language="en-US" onLoadMore={onLoadMore} />
    )

    expect(screen.getByText('usage.recordsShown')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'usage.loadMore' })
    fireEvent.click(button)
    expect(onLoadMore).toHaveBeenCalledTimes(1)

    rerender(
      <UsageRecordsTable
        records={[record()]}
        total={3}
        language="en-US"
        onLoadMore={onLoadMore}
        isLoadingMore
      />
    )
    expect(screen.getByRole('button', { name: 'usage.loadMore' })).toBeDisabled()
  })

  it('hides load-more once everything is shown', () => {
    render(<UsageRecordsTable records={[record()]} total={1} language="en-US" onLoadMore={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'usage.loadMore' })).not.toBeInTheDocument()
  })

  it('renders fallback keys for rows without ids (created:type:index)', () => {
    render(
      <UsageRecordsTable
        records={[
          record({ id: null }),
          record({ id: null, call_type: 'chat' }),
        ]}
        total={2}
        language="en-US"
      />
    )

    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('renders a dash for missing token counts', () => {
    render(
      <UsageRecordsTable
        records={[record({ input_tokens: null, output_tokens: null, total_tokens: null })]}
        total={1}
        language="en-US"
      />
    )

    expect(screen.getAllByText('-').length).toBeGreaterThanOrEqual(3)
  })
})
