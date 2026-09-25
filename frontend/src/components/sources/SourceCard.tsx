'use client'

import React, { useState, useEffect, memo } from 'react'
import { useRouter } from 'next/navigation'
import { SourceListResponse } from '@/lib/types/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu'
import {
  FileText,
  ExternalLink,
  Upload,
  MoreVertical,
  Trash2,
  RefreshCw,
  Clock,
  CheckCircle,
  AlertTriangle,
  Loader2,
  Unlink,
  Pencil,
  FolderInput,
  FolderPlus
} from 'lucide-react'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { SourceContextMenuContent } from '@/components/sources/SourceContextMenu'
import { useSourceStatus } from '@/lib/hooks/use-sources'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { TFunction } from 'i18next'
import { cn } from '@/lib/utils'
import { ContextToggle } from '@/components/common/ContextToggle'
import { ContextMode } from '@/app/(dashboard)/notebooks/[id]/page'

interface SourceCardProps {
  source: SourceListResponse
  onDelete?: (sourceId: string) => void
  onRetry?: (sourceId: string) => void
  onRefreshContent?: (sourceId: string) => void
  onRemoveFromNotebook?: (sourceId: string) => void
  onClick?: (sourceId: string) => void
  onRefresh?: () => void
  className?: string
  showRemoveFromNotebook?: boolean
  contextMode?: ContextMode
  onContextModeChange?: (mode: ContextMode) => void
  // 右键菜单/⋮ 菜单共用的组织入口；四个都未传时不包 ContextMenu（保持旧调用方零变化）
  onOpenSource?: (sourceId: string) => void
  onRename?: (sourceId: string) => void
  onMoveToFolder?: (sourceId: string) => void
  onNewFolder?: () => void
  onUngroupFromFolder?: (sourceId: string) => void
  // 组织入口闭包捕获的 view/group 上下文快照，变化时必须重渲染（见 areEqual）
  menuContextKey?: string
  // 批量选择：悬停显示勾选框（选中后常显），点击勾选不触发卡片点击
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (sourceId: string) => void
}

const SOURCE_TYPE_ICONS = {
  link: ExternalLink,
  upload: Upload,
  text: FileText,
} as const

// 红色徽章只覆盖"需要人处理"的嵌入终态；queued/running 已有 teal 进行中提示
const EMBEDDING_INCOMPLETE_STATUSES = new Set(['failed', 'partial', 'not_embedded'])

const getStatusConfig = (t: TFunction) => ({
  new: {
    icon: Clock,
    color: 'text-teal',
    bgColor: 'bg-teal-tint',
    borderColor: 'border-teal/30',
    label: t('sources.statusProcessing'),
    description: t('sources.statusPreparingDesc')
  },
  queued: {
    icon: Clock,
    color: 'text-teal',
    bgColor: 'bg-teal-tint',
    borderColor: 'border-teal/30',
    label: t('sources.statusQueued'),
    description: t('sources.statusQueuedDesc')
  },
  running: {
    icon: Loader2,
    color: 'text-teal',
    bgColor: 'bg-teal-tint',
    borderColor: 'border-teal/30',
    label: t('sources.statusProcessing'),
    description: t('sources.statusProcessingDesc')
  },
  completed: {
    icon: CheckCircle,
    color: 'text-fern',
    bgColor: 'bg-fern-tint',
    borderColor: 'border-fern/30',
    label: t('sources.statusCompleted'),
    description: t('sources.statusCompletedDesc')
  },
  failed: {
    icon: AlertTriangle,
    color: 'text-destructive',
    bgColor: 'bg-destructive-tint',
    borderColor: 'border-destructive/30',
    label: t('sources.statusFailed'),
    description: t('sources.statusFailedDesc')
  }
} as const)

type SourceStatus = 'new' | 'queued' | 'running' | 'completed' | 'failed'

function isSourceStatus(status: unknown): status is SourceStatus {
  return typeof status === 'string' && ['new', 'queued', 'running', 'completed', 'failed'].includes(status)
}

function getSourceType(source: SourceListResponse): 'link' | 'upload' | 'text' {
  // Determine type based on asset information
  if (source.asset?.url) return 'link'
  if (source.asset?.file_path) return 'upload'
  return 'text'
}

function SourceCardImpl({
  source,
  onClick,
  onDelete,
  onRetry,
  onRefreshContent,
  onRemoveFromNotebook,
  onRefresh,
  className,
  showRemoveFromNotebook = false,
  contextMode,
  onContextModeChange,
  onOpenSource,
  onRename,
  onMoveToFolder,
  onNewFolder,
  onUngroupFromFolder,
  selectable,
  selected = false,
  onToggleSelect
}: SourceCardProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const statusConfigMap = getStatusConfig(t)
  
  // Only fetch status for sources that might have async processing
  const sourceWithStatus = source as SourceListResponse & { command_id?: string; status?: string }

  // Track processing state to continue polling until we detect completion
  const [wasProcessing, setWasProcessing] = useState(false)

  // Only poll status while the source is actually being processed (or just finished
  // and we still need one more poll to catch completion). The list endpoint already
  // populates `status` alongside `command_id`, so we no longer poll for every
  // completed source — that scaled linearly with the number of cards and caused the
  // list lag reported in #503.
  //
  // A source with a `command_id` but no resolved `status` yet is still ambiguous
  // (it renders as a synthetic "new"), so keep polling those until a real status
  // arrives — otherwise such a card would be stuck "processing" forever.
  const shouldFetchStatus =
    sourceWithStatus.status === 'new' ||
    sourceWithStatus.status === 'queued' ||
    sourceWithStatus.status === 'running' ||
    (!!sourceWithStatus.command_id && !sourceWithStatus.status) ||
    wasProcessing // Keep polling if we were processing to catch the completion

  const { data: statusData, isLoading: statusLoading } = useSourceStatus(
    source.id,
    shouldFetchStatus
  )

  // Determine current status
  // If source has a command_id but no status, treat as "new" (just created)
  const rawStatus = statusData?.status || sourceWithStatus.status
  const currentStatus: SourceStatus = isSourceStatus(rawStatus)
    ? rawStatus
    : (sourceWithStatus.command_id ? 'new' : 'completed')


  // Track processing state and detect completion
  useEffect(() => {
    const currentStatusFromData = statusData?.status || sourceWithStatus.status

    // If we're currently processing, mark that we were processing
    if (currentStatusFromData === 'new' || currentStatusFromData === 'running' || currentStatusFromData === 'queued') {
      setWasProcessing(true)
    }

    // If we were processing and now completed/failed, trigger refresh and stop polling
    if (wasProcessing &&
        (currentStatusFromData === 'completed' || currentStatusFromData === 'failed')) {
      setWasProcessing(false) // Stop polling

      if (onRefresh) {
        setTimeout(() => onRefresh(), 500) // Small delay to ensure API is updated
      }
    }
  }, [statusData, sourceWithStatus.status, wasProcessing, onRefresh, source.id])
  
  const statusConfig = statusConfigMap[currentStatus] || statusConfigMap.completed
  const StatusIcon = statusConfig.icon
  const sourceType = getSourceType(source)
  const SourceTypeIcon = SOURCE_TYPE_ICONS[sourceType]
  
   const title = source.title || t('sources.untitledSource')

  const handleRetry = () => {
    if (onRetry) {
      onRetry(source.id)
    }
  }

  const handleRefreshContent = () => {
    if (onRefreshContent) {
      onRefreshContent(source.id)
    }
  }

  const handleDelete = () => {
    if (onDelete) {
      onDelete(source.id)
    }
  }

  const handleRemoveFromNotebook = () => {
    if (onRemoveFromNotebook) {
      onRemoveFromNotebook(source.id)
    }
  }

  const handleCardClick = () => {
    if (onClick) {
      onClick(source.id)
    }
  }

  const isProcessing: boolean = currentStatus === 'new' || currentStatus === 'running' || currentStatus === 'queued'
  const isFailed: boolean = currentStatus === 'failed'
  const isCompleted: boolean = currentStatus === 'completed'
  // null/undefined（极旧数据）不算未完成，避免误报
  const hasIncompleteEmbedding: boolean = !!source.embedding_status && EMBEDDING_INCOMPLETE_STATUSES.has(source.embedding_status)

  const hasMenuActions = !!(onOpenSource || onRename || onMoveToFolder || onNewFolder)

  const card = (
    <Card
      className={cn(
        'transition-colors duration-150 shadow-none hover:border-sage/50 group relative cursor-pointer border',
        selectable && selected && 'border-sage/70 ring-1 ring-sage/40',
        className
      )}
      onClick={handleCardClick}
    >
      {selectable && onToggleSelect && (
        <span
          className={cn(
            'absolute left-1.5 top-1.5 z-10 rounded-md bg-background/80 p-0.5 backdrop-blur-sm transition-opacity',
            selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          )}
          onClick={e => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect(source.id)}
            aria-label={title}
            data-testid={`source-select-${source.id}`}
          />
        </span>
      )}
      <CardContent className="px-3 py-1">
        {/* Header with status indicator */}
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="flex-1 min-w-0">
            {/* Status badge - only show if not completed */}
            {!isCompleted && (
              <div className="flex items-center gap-2 mb-2">
                <div className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium',
                  statusConfig.bgColor,
                  statusConfig.color
                )}>
                  <StatusIcon className={cn(
                    'h-3 w-3',
                    isProcessing && 'animate-spin'
                  )} />
                  {statusLoading && shouldFetchStatus ? t('sources.checking') : statusConfig.label}
                </div>

                {/* Source type indicator */}
                <div className="flex items-center gap-1 text-muted-foreground">
                  <SourceTypeIcon className="h-3 w-3" />
                  <span className="text-xs capitalize">{t('common.source')}</span>
                </div>
              </div>
            )}

            {/* Title */}
            <div className={cn('mb-1.5', !isCompleted && 'mb-1')}>
              <h4
                className="text-sm font-medium leading-tight line-clamp-2 break-all pr-6"
                title={title}
              >
                {title}
              </h4>
            </div>

            {/* Processing message for active statuses */}
            {statusData?.message && (isProcessing || isFailed) && (
              <p className="text-xs text-muted-foreground mb-2 italic">
                {statusData.message}
              </p>
            )}

            {/* One-line metadata row: type + meta in a single muted line */}
            <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted-foreground min-w-0">
              <span className="inline-flex items-center gap-1">
                <SourceTypeIcon className="h-3 w-3" />
                {sourceType === 'link' ? t('sources.addUrl') : sourceType === 'upload' ? t('sources.uploadFile') : t('sources.enterText')}
              </span>

              {isCompleted && source.insights_count > 0 && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('sources.insightsCount', { count: source.insights_count })}</span>
                </>
              )}
              {(source.embedding_status === 'running' || source.embedding_status === 'queued') && (
                <>
                  <span aria-hidden>·</span>
                  <span className="inline-flex items-center gap-1 text-teal">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('sources.embeddingInProgress')}
                  </span>
                </>
              )}
              {source.topics && source.topics.length > 0 && isCompleted && (
                <>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    {source.topics.slice(0, 2).join(', ')}
                    {source.topics.length > 2 && ` +${source.topics.length - 2}`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Context toggle and actions */}
          <div className="flex items-center gap-1">
            {/* 嵌入未完成提醒：stopPropagation 防止同时触发卡片 onClick 的 openModal 双跳 */}
            {hasIncompleteEmbedding && (
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium bg-destructive-tint text-destructive hover:bg-destructive-tint/80 transition-colors cursor-pointer flex-shrink-0"
                title={t('sources.embeddingIncompleteHint')}
                onClick={(e) => {
                  e.stopPropagation()
                  router.push(`/sources/${source.id}`)
                }}
              >
                <AlertTriangle className="h-3 w-3" />
                {t('sources.embeddingIncomplete')}
              </button>
            )}

            {/* Context toggle - only show if handler provided */}
            {onContextModeChange && contextMode && (
              <ContextToggle
                mode={contextMode}
                hasInsights={source.insights_count > 0}
                onChange={onContextModeChange}
              />
            )}

            {/* Actions dropdown — ⋮ pinned to the card's top-right */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute top-1.5 right-1.5 h-7 w-7 p-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {onRename && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onRename(source.id)
                  }}
                >
                  <Pencil className="h-4 w-4 mr-2" />
                  {t('sources.grouping.renameSource')}
                </DropdownMenuItem>
              )}
              {onMoveToFolder && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onMoveToFolder(source.id)
                  }}
                >
                  <FolderInput className="h-4 w-4 mr-2" />
                  {t('sources.grouping.moveToFolder')}
                </DropdownMenuItem>
              )}
              {onNewFolder && (
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation()
                    onNewFolder()
                  }}
                >
                  <FolderPlus className="h-4 w-4 mr-2" />
                  {t('sources.grouping.newFolder')}
                </DropdownMenuItem>
              )}
              {showRemoveFromNotebook && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRemoveFromNotebook()
                    }}
                    disabled={!onRemoveFromNotebook}
                  >
                    <Unlink className="h-4 w-4 mr-2" />
                    {t('sources.removeFromNotebook')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {isFailed && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRetry()
                    }}
                    disabled={!onRetry}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('sources.retryProcessing')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              {sourceType === 'link' && isCompleted && onRefreshContent && (
                <>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRefreshContent()
                    }}
                  >
                    <RefreshCw className="h-4 w-4 mr-2" />
                    {t('sources.refreshContent')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}

              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete()
                }}
                disabled={!onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {t('sources.deleteSource')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>
        {/* Prominent retry action surfaced directly on failed cards so it's
            discoverable without opening the dropdown menu (#726). */}
        {isFailed ? (
          <div className="flex gap-2 pt-2 border-t">
            <Button
              variant="default"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                handleRetry()
              }}
              disabled={!onRetry}
              className="h-7 text-xs"
            >
              <RefreshCw className="h-3 w-3 mr-1" />
              {t('sources.retryProcessing')}
            </Button>
          </div>
        ) : null}

        {/* Processing progress indicator */}
        {isProcessing && typeof statusData?.processing_info?.progress === 'number' && (
          <div className="mt-3 pt-2 border-t">
            <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-muted-foreground">{t('common.progress')}</span>
              <span className="text-xs text-muted-foreground">
                {Math.round(statusData.processing_info.progress as number)}%
              </span>
            </div>
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-teal h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${statusData.processing_info.progress as number}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )

  if (!hasMenuActions) return card

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <SourceContextMenuContent
        onOpen={onOpenSource ? () => onOpenSource(source.id) : undefined}
        onRename={onRename ? () => onRename(source.id) : undefined}
        onMove={onMoveToFolder ? () => onMoveToFolder(source.id) : undefined}
        onNewFolder={onNewFolder}
        onUngroup={onUngroupFromFolder ? () => onUngroupFromFolder(source.id) : undefined}
        onRemoveFromNotebook={
          showRemoveFromNotebook && onRemoveFromNotebook ? handleRemoveFromNotebook : undefined
        }
        onDelete={onDelete ? handleDelete : undefined}
      />
    </ContextMenu>
  )
}

/**
 * SourceCard is rendered in long lists (one per source). Without memoization, any
 * parent re-render (layout toggles, context-selection changes elsewhere) re-rendered
 * every card, causing UI jank that scaled with the number of sources (#503).
 *
 * We compare only the props that affect this card's rendered output. Handler identity
 * is intentionally ignored for id-capturing closures, but the organization handlers
 * (rename/move/new-folder/ungroup) capture view/group context, so their presence and
 * menuContextKey must be compared or the menu goes stale after a filter switch.
 */
function topicsEqual(a?: string[], b?: string[]): boolean {
  if (a === b) return true
  if ((a?.length ?? 0) !== (b?.length ?? 0)) return false
  if (!a || !b) return true // both empty/undefined (lengths matched above)
  return a.every((topic, i) => topic === b[i])
}

function areEqual(prev: SourceCardProps, next: SourceCardProps): boolean {
  if (prev === next) return true

  const p = prev.source as SourceListResponse & { command_id?: string; status?: string }
  const n = next.source as SourceListResponse & { command_id?: string; status?: string }

  return (
    p.id === n.id &&
    p.title === n.title &&
    p.updated === n.updated &&
    p.status === n.status &&
    p.command_id === n.command_id &&
    p.embedded === n.embedded &&
    p.embedding_status === n.embedding_status &&
    p.insights_count === n.insights_count &&
    p.asset?.url === n.asset?.url &&
    p.asset?.file_path === n.asset?.file_path &&
    topicsEqual(p.topics, n.topics) &&
    prev.contextMode === next.contextMode &&
    prev.showRemoveFromNotebook === next.showRemoveFromNotebook &&
    prev.className === next.className &&
    prev.menuContextKey === next.menuContextKey &&
    // 组织入口的存在性与捕获的上下文随 views 加载/分组筛选翻转，漏比会固化旧菜单
    Boolean(prev.onOpenSource) === Boolean(next.onOpenSource) &&
    Boolean(prev.onRename) === Boolean(next.onRename) &&
    Boolean(prev.onMoveToFolder) === Boolean(next.onMoveToFolder) &&
    Boolean(prev.onNewFolder) === Boolean(next.onNewFolder) &&
    Boolean(prev.onUngroupFromFolder) === Boolean(next.onUngroupFromFolder) &&
    prev.selected === next.selected &&
    Boolean(prev.onToggleSelect) === Boolean(next.onToggleSelect)
  )
}

export const SourceCard = memo(SourceCardImpl, areEqual)
