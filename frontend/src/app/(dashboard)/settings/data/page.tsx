'use client'

import { DatabaseBackup } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { ExportCard } from '@/components/settings/data/ExportCard'
import { ImportCard } from '@/components/settings/data/ImportCard'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function DataManagementPage() {
  const { t } = useTranslation()

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight flex items-center gap-2">
              <DatabaseBackup className="h-5 w-5 text-muted-foreground" />
              {t('app.dataManagement.title')}
            </h1>
            <p className="text-muted-foreground mt-1">{t('app.dataManagement.description')}</p>
          </div>

          <ExportCard />
          <ImportCard />
        </div>
      </div>
    </AppShell>
  )
}
