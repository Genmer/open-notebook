import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import ScanPageNotice from './ScanPageNotice'

// The global setup mocks use-translation with an identity t(), so the copy
// assertions check the finalized i18n key itself (i18n parity is covered by
// the locales suite, task F10).

describe('ScanPageNotice', () => {
  it('renders a persistent status region with the scan-page copy', () => {
    render(<ScanPageNotice />)

    const notice = screen.getByTestId('scan-page-notice')
    expect(notice).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('scan-page-notice-text')).toHaveTextContent(
      'sources.annotations.scanNotice'
    )
  })

  it('merges a consumer className for layout around the viewer toolbar', () => {
    render(<ScanPageNotice className="mt-2 w-full" />)

    expect(screen.getByTestId('scan-page-notice')).toHaveClass('mt-2', 'w-full')
  })
})
