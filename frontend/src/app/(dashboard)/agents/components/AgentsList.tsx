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
import { cn } from '@/lib/utils'

interface AgentsListProps {
  agents: Agent[]
  isLoading: boolean
  onEdit: (id: string) => void
}

// 头像色板（完整字面量类名，Tailwind 只提取源码里出现的完整类）：
// 按名称哈希取色，同一智能体颜色稳定，列表不再通篇黑白。
const AVATAR_PALETTE = [
  'bg-blue-500/10 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
  'bg-violet-500/10 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  'bg-pink-500/10 text-pink-600 dark:bg-pink-500/15 dark:text-pink-400',
  'bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400',
  'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
  'bg-teal-500/10 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400',
] as const

const avatarStyle = (name: string) => {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]
}

/** 头像取名字首字符：中文取第一个字，西文取首字母大写。 */
const avatarInitial = (name: string) => [...name.trim()][0]?.toUpperCase() ?? '?'

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
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-lg text-base font-semibold',
                      avatarStyle(agent.name)
                    )}
                  >
                    {avatarInitial(agent.name)}
                  </span>
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
