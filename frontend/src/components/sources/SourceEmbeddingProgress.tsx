'use client'

import { useState } from 'react'
import { AlertTriangle, Database, Loader2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { embeddingApi } from '@/lib/api/embedding'
import { SourceEmbeddingStatus } from '@/lib/types/api'
import { useTranslation } from '@/lib/hooks/use-translation'
import { toast } from 'sonner'

interface SourceEmbeddingProgressProps {
  sourceId: string
  embedding: SourceEmbeddingStatus
  // Called after a (re)embed request is accepted so the parent can start
  // polling the status endpoint for progress updates.
  onEmbedSubmitted?: () => void
}

export function SourceEmbeddingProgress({
  sourceId,
  embedding,
  onEmbedSubmitted
}: SourceEmbeddingProgressProps) {
  const { t } = useTranslation()
  const [isRetrying, setIsRetrying] = useState(false)
  const { status, embedded_chunks: embeddedChunks, total_chunks: totalChunks, error } = embedding

  const handleRetry = async () => {
    try {
      setIsRetrying(true)
      const response = await embeddingApi.embedContent(sourceId, 'source')
      toast.success(response.message || t('common.success'))
      onEmbedSubmitted?.()
    } catch (err) {
      console.error('Failed to embed content:', err)
      toast.error(t('common.error'))
    } finally {
      setIsRetrying(false)
    }
  }

  const retryButton = (
    <div className="mt-3">
      <Button onClick={handleRetry} disabled={isRetrying} size="sm">
        {isRetrying ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('sources.embedding')}
          </>
        ) : (
          <>
            <Database className="mr-2 h-4 w-4" />
            {t('sources.embeddingRetry')}
          </>
        )}
      </Button>
    </div>
  )

  if (status === 'queued') {
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>{t('sources.embeddingStatusQueued')}</AlertTitle>
        <AlertDescription>
          <p className="text-muted-foreground">{t('sources.embeddingWaitingWorker')}</p>
          {typeof totalChunks === 'number' && totalChunks > 0 && (
            <div className="mt-3">
              <Progress value={0} />
              <p className="mt-2 text-xs text-muted-foreground">
                {t('sources.embeddingProgressChunks', { embedded: 0, total: totalChunks })}
              </p>
            </div>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'running') {
    const percent =
      typeof totalChunks === 'number' && totalChunks > 0
        ? Math.min(100, Math.round((embeddedChunks / totalChunks) * 100))
        : 0
    return (
      <Alert>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertTitle>{t('sources.embeddingStatusRunning')}</AlertTitle>
        <AlertDescription>
          <div className="mt-1">
            <Progress value={percent} />
            <p className="mt-2 text-xs text-muted-foreground">
              {t('sources.embeddingProgressChunks', {
                embedded: embeddedChunks,
                total: totalChunks ?? '?'
              })}
            </p>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'partial' || status === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>
          {status === 'partial'
            ? t('sources.embeddingPartialTitle')
            : t('sources.embeddingFailedTitle')}
        </AlertTitle>
        <AlertDescription>
          {error && <p className="text-sm">{error}</p>}
          {retryButton}
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'completed') {
    return (
      <Alert>
        <Database className="h-4 w-4" />
        <AlertTitle>{t('sources.embeddingStatusCompleted')}</AlertTitle>
        <AlertDescription>
          {t('sources.embeddingCompletedChunks', { count: embeddedChunks })}
        </AlertDescription>
      </Alert>
    )
  }

  // not_embedded: mirror the previous "not embedded yet" call-to-action.
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{t('sources.notEmbeddedAlert')}</AlertTitle>
      <AlertDescription>
        {t('sources.notEmbeddedDesc')}
        {retryButton}
      </AlertDescription>
    </Alert>
  )
}
