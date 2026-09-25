'use client'

import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { SourceGroupResponse } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'

interface SourceBreadcrumbProps {
  viewName: string
  /** Ancestor chain of the current folder, root first (empty outside folders). */
  chain: SourceGroupResponse[]
  /** Current leaf label ('' when browsing the view root). */
  currentLabel: string
  /** 'all' or a group id to navigate to. */
  onNavigate: (target: string) => void
  isFileTypeView: boolean
  /** Current extension bucket label (file_type view only). */
  bucketLabel?: string
}

// Location bar above the source table; ancestors are clickable, the leaf is not.
export function SourceBreadcrumb({
  viewName,
  chain,
  currentLabel,
  onNavigate,
  isFileTypeView,
  bucketLabel,
}: SourceBreadcrumbProps) {
  const { t } = useTranslation()
  const crumbClass = 'text-sm text-muted-foreground hover:text-foreground truncate max-w-[16rem]'
  const sep = <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />

  return (
    <nav
      aria-label={t('sources.grouping.breadcrumbAria')}
      data-testid="source-breadcrumb"
      className="flex min-h-[1.75rem] items-center gap-1.5 px-1"
    >
      {isFileTypeView ? (
        <>
          <span className="text-sm font-medium truncate max-w-[16rem]">{viewName}</span>
          {bucketLabel && (
            <>
              {sep}
              <button type="button" className={crumbClass} onClick={() => onNavigate('all')}>
                {bucketLabel}
              </button>
            </>
          )}
        </>
      ) : (
        <>
          {currentLabel ? (
            <button type="button" className={crumbClass} onClick={() => onNavigate('all')}>
              {viewName}
            </button>
          ) : (
            <span className="text-sm font-medium truncate max-w-[16rem]">{viewName}</span>
          )}
          {chain.map((group) => (
            <Fragment key={group.id}>
              {sep}
              <button
                type="button"
                className={crumbClass}
                onClick={() => onNavigate(group.id)}
                data-testid={`breadcrumb-${group.id}`}
              >
                {group.name}
              </button>
            </Fragment>
          ))}
          {currentLabel && (
            <Fragment>
              {sep}
              <span className="text-sm font-medium truncate max-w-[16rem]" data-testid="breadcrumb-current">
                {currentLabel}
              </span>
            </Fragment>
          )}
        </>
      )}
    </nav>
  )
}
