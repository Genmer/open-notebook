'use client'

import { RefreshCw, TriangleAlert } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface UsageErrorStateProps {
  onRetry?: () => void
}

export default function UsageErrorState({ onRetry }: UsageErrorStateProps) {
  const { t } = useTranslation()
  return (
    <Card data-testid="usage-error">
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <TriangleAlert className="h-10 w-10 text-muted-foreground/60" aria-hidden />
        <div>
          <h3 className="text-lg font-medium text-foreground">{t('usage.errorTitle')}</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{t('usage.errorDesc')}</p>
        </div>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('usage.retry')}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
