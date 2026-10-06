'use client'

import { ScanText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'

/**
 * Inline persistent notice for a scanned (text-layer-less) page — plan §3.1
 * "MVP 期扫描页提示" / MVP task F8.
 *
 * Mounting is the parent's page-level routing decision (PDR-003 ruling 1:
 * interaction routing is per page, decoupled from the whole-file nature):
 * render it only when the current page's `getTextContent()` came back empty
 * AND the MVP stays on the selection-first branch (plan §5.6 — on the
 * rectangle-selection branch this notice must NOT render, its copy would
 * promise "next phase" about the current main path).
 *
 * Deliberately a persistent `role="status"` bar (plan §3.7), not a toast:
 * repeated selection attempts on a scan page must not re-interrupt. Styling
 * follows the annotation elements' banner rule (§4.1): light wash + hairline
 * border, no shadow, rounded-sm.
 */
export interface ScanPageNoticeProps {
  /** Consumer layout hook (margins/width around the viewer toolbar). */
  className?: string
}

export default function ScanPageNotice({ className }: ScanPageNoticeProps) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      data-testid="scan-page-notice"
      className={cn(
        'flex items-center gap-2 rounded-sm border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
        className
      )}
    >
      <ScanText aria-hidden className="h-4 w-4 shrink-0" />
      <span data-testid="scan-page-notice-text">{t('sources.annotations.scanNotice')}</span>
    </div>
  )
}
