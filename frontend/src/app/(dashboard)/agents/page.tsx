'use client'

import { useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Bot, Plus, RefreshCw } from 'lucide-react'
import { AgentsList } from './components/AgentsList'
import { AgentEditorDialog } from './components/AgentEditorDialog'
import { AgentTemplatePickerDialog } from './components/AgentTemplatePickerDialog'
import { useAgents } from '@/lib/hooks/use-agents'
import { useTranslation } from '@/lib/hooks/use-translation'

export default function AgentsPage() {
  const { t } = useTranslation()
  const { data: agents, isLoading, refetch } = useAgents()
  const [pickerOpen, setPickerOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [initialTemplateKey, setInitialTemplateKey] = useState<string | null>(null)

  // 新建智能体：先弹模板面板，选中模板（或「从空白开始」）后再进编辑弹窗。
  const handleCreate = () => {
    setPickerOpen(true)
  }

  const handleTemplateConfirm = (templateKey: string) => {
    setPickerOpen(false)
    setEditingId(null)
    setInitialTemplateKey(templateKey)
    setEditorOpen(true)
  }

  const handleEditorOpenChange = (open: boolean) => {
    setEditorOpen(open)
    // 编辑弹窗关闭后清掉初始模板，避免下次新建残留上一次的灌入。
    if (!open) setInitialTemplateKey(null)
  }

  const handleEdit = (id: string) => {
    setEditingId(id)
    setInitialTemplateKey(null)
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

          <AgentTemplatePickerDialog
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            onConfirm={handleTemplateConfirm}
          />

          <AgentEditorDialog
            open={editorOpen}
            onOpenChange={handleEditorOpenChange}
            agentId={editingId}
            initialTemplateKey={initialTemplateKey}
          />
        </div>
      </div>
    </AppShell>
  )
}
