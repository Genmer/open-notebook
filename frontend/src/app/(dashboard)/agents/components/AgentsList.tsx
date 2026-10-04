'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Bot, Edit, HelpCircle, Trash2 } from 'lucide-react'
import { Agent } from '@/lib/types/agents'
import { useDeleteAgent } from '@/lib/hooks/use-agents'
import { useModels } from '@/lib/hooks/use-models'
import { useTranslation } from '@/lib/hooks/use-translation'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

interface AgentsListProps {
  agents: Agent[]
  isLoading: boolean
  onEdit: (id: string) => void
}

export function AgentsList({ agents, isLoading, onEdit }: AgentsListProps) {
  const { t } = useTranslation()
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null)
  const deleteAgent = useDeleteAgent()
  const { data: models } = useModels()

  const modelName = (modelId: string | null) => {
    if (!modelId) return null
    return models?.find((model) => model.id === modelId)?.name || modelId
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div
        className="rounded-lg border border-dashed p-6 text-center text-muted-foreground"
        data-testid="agents-empty"
      >
        <Bot className="mx-auto mb-3 h-8 w-8 opacity-50" />
        <p>{t('agents.empty')}</p>
      </div>
    )
  }

  return (
    <>
      <div
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
        data-testid="agents-list"
      >
        {agents.map((agent) => (
          <Card key={agent.id} className="py-4" data-testid={`agent-card-${agent.id}`}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold truncate">{agent.name}</span>
                    {!agent.enabled && (
                      <Badge variant="secondary">{t('agents.disabled')}</Badge>
                    )}
                    {agent.in_use_session_count > 0 && (
                      <Badge variant="outline">
                        {t('agents.inUse', { count: agent.in_use_session_count })}
                      </Badge>
                    )}
                  </div>
                  {agent.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                      {agent.description}
                    </p>
                  )}
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(agent.id)}
                    aria-label={t('agents.edit')}
                    data-testid={`agent-edit-${agent.id}`}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => setDeletingAgent(agent)}
                    aria-label={t('agents.delete')}
                    data-testid={`agent-delete-${agent.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                {modelName(agent.model_id) && (
                  <span className="inline-flex items-center gap-1">
                    <Bot className="h-3 w-3" />
                    {modelName(agent.model_id)}
                  </span>
                )}
                {agent.temperature !== null && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        aria-label={t('agents.temperatureHelp')}
                        className="inline-flex items-center gap-0.5 cursor-help rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {t('agents.temperatureLabel', { value: agent.temperature })}
                        <HelpCircle className="h-3 w-3 text-muted-foreground" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p>{t('agents.temperatureHelp')}</p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {agent.max_tokens !== null && (
                  <span>{t('agents.maxTokensLabel', { value: agent.max_tokens })}</span>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={!!deletingAgent}
        onOpenChange={(open) => !open && setDeletingAgent(null)}
        title={t('agents.deleteConfirmTitle')}
        description={t('agents.deleteConfirmDesc', {
          name: deletingAgent?.name ?? '',
          count: deletingAgent?.in_use_session_count ?? 0,
        })}
        onConfirm={() => {
          if (deletingAgent) {
            deleteAgent.mutate(deletingAgent.id)
            setDeletingAgent(null)
          }
        }}
      />
    </>
  )
}
