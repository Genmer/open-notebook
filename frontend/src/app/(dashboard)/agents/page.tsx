'use client'

import { useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Bot, Plus, RefreshCw } from 'lucide-react'
import { AgentsList } from './components/AgentsList'
import { AgentEditorDialog } from './components/AgentEditorDialog'
import { useAgents } from '@/lib/hooks/use-agents'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function AgentsPage() {
  const { t } = useTranslation()
  const { data: agents, isLoading, refetch } = useAgents()
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const handleCreate = () => {
    setEditingId(null)
    setEditorOpen(true)
  }

  const handleEdit = (id: string) => {
    setEditingId(id)
    setEditorOpen(true)
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="font-display text-2xl font-bold tracking-tight">
                {t('agents.title')}
              </h1>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <Button size="sm" onClick={handleCreate} data-testid="agent-create-button">
              <Plus className="h-4 w-4" />
              {t('agents.create')}
            </Button>
          </div>

          <div className="max-w-5xl">
            <p className="text-muted-foreground flex items-center gap-2">
              <Bot className="h-4 w-4 flex-shrink-0" />
              {t('agents.desc')}
            </p>
          </div>

          <AgentsList
            agents={agents ?? []}
            isLoading={isLoading}
            onEdit={handleEdit}
          />

          <AgentEditorDialog
            open={editorOpen}
            onOpenChange={setEditorOpen}
            agentId={editingId}
          />
        </div>
      </div>
    </AppShell>
  )
}
