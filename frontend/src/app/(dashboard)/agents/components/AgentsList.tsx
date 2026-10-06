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
  'bg-gradient-to-br from-blue-500 to-indigo-600',
  'bg-gradient-to-br from-violet-500 to-purple-600',
  'bg-gradient-to-br from-emerald-600 to-teal-600',
  'bg-gradient-to-br from-amber-600 to-orange-600',
  'bg-gradient-to-br from-pink-500 to-rose-600',
  'bg-gradient-to-br from-cyan-600 to-sky-600',
  'bg-gradient-to-br from-rose-500 to-red-600',
  'bg-gradient-to-br from-teal-600 to-green-600',
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
        className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6!"
        data-testid="agents-list"
      >
        {agents.map((agent) => (
          <Card
            key={agent.id}
            className="gap-0 border-border/80 py-0 shadow-xs transition-all duration-200 hover:border-primary/40 hover:shadow-md"
            data-testid={`agent-card-${agent.id}`}
          >
            <CardContent className="px-3 py-2 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span
                    aria-hidden
                    data-testid={`agent-avatar-${agent.id}`}
                    className={cn(
                      'flex size-12 shrink-0 select-none items-center justify-center rounded-full text-lg font-semibold text-white shadow-sm',
                      avatarStyle(agent.name)
                    )}
                  >
                    {avatarInitial(agent.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold truncate">{agent.name}</span>
                      {!agent.enabled && (
                        <Badge variant="secondary" className="h-4 px-1.5 text-[10px] leading-none">
                          {t('agents.disabled')}
                        </Badge>
                      )}
                      {agent.in_use_session_count > 0 && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px] leading-none">
                          {t('agents.inUse', { count: agent.in_use_session_count })}
                        </Badge>
                      )}
                    </div>
                    {agent.description && (
                      <p className="mt-0.5 text-sm leading-snug text-muted-foreground line-clamp-3">
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

              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
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
