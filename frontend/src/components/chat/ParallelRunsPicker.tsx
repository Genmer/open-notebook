'use client'

import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Bot, CheckSquare, Square, Zap } from 'lucide-react'
import { useModels } from '@/lib/hooks/use-models'
import { useAgents } from '@/lib/hooks/use-agents'
import { useTranslation } from '@/lib/hooks/use-translation'

export const MAX_PARALLEL_RUNS = 5

interface ParallelRunsPickerProps {
  disabled?: boolean
  /** Called with the encoded run keys, e.g. ['default', 'agent:agent:1']. */
  onSend: (runs: string[]) => void
}

export function ParallelRunsPicker({ disabled, onSend }: ParallelRunsPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const { data: models, isLoading: modelsLoading } = useModels()
  const { data: agents, isLoading: agentsLoading } = useAgents()

  const languageModels = useMemo(() => {
    if (!models) return []
    return [...models]
      .filter((model) => model.type === 'language')
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [models])

  const enabledAgents = useMemo(() => {
    if (!agents) return []
    return [...agents]
      .filter((agent) => agent.enabled)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  }, [agents])

  const modelName = (id: string | null) =>
    id ? languageModels.find((m) => m.id === id)?.name || id : null

  const toggle = (key: string) => {
    setSelected((prev) =>
      prev.includes(key)
        ? prev.filter((k) => k !== key)
        : prev.length < MAX_PARALLEL_RUNS
          ? [...prev, key]
          : prev
    )
  }

  const handleSend = () => {
    if (selected.length === 0) return
    onSend(selected)
    setSelected([])
    setOpen(false)
  }

  const row = (key: string, name: string, sub?: string | null) => (
    <Label
      key={key}
      htmlFor={`parallel-run-${key}`}
      data-testid={`parallel-option-${key}`}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-accent cursor-pointer font-normal"
    >
      <Checkbox
        id={`parallel-run-${key}`}
        checked={selected.includes(key)}
        onCheckedChange={() => toggle(key)}
      />
      <span className="flex-1 text-sm truncate">{name}</span>
      {sub && <span className="text-xs text-muted-foreground truncate max-w-[120px]">{sub}</span>}
    </Label>
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-1.5 h-9"
          aria-label={t('chat.parallelSend')}
          title={t('chat.parallelSend')}
          data-testid="parallel-runs-trigger"
        >
          <Zap className="h-4 w-4" />
          <span className="hidden sm:inline text-xs">{t('chat.parallelSend')}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3" data-testid="parallel-runs-popover">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="h-4 w-4" />
            {t('chat.parallelPickTitle')}
          </p>
          <span className="text-xs text-muted-foreground">
            {t('chat.parallelPickCount', { count: selected.length, max: MAX_PARALLEL_RUNS })}
          </span>
        </div>
        <div className="max-h-72 overflow-y-auto space-y-0.5">
          {row('default', t('chat.groupDefault'))}
          {enabledAgents.map((agent) =>
            row(`agent:${agent.id}`, agent.name, modelName(agent.model_id))
          )}
          {languageModels.map((model) =>
            row(`model:${model.id}`, model.name, model.provider)
          )}
          {modelsLoading || agentsLoading ? (
            <p className="text-xs text-muted-foreground py-2 px-2">{t('common.loading')}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-between mt-3 pt-2 border-t">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
            {selected.length >= MAX_PARALLEL_RUNS ? (
              <>
                <CheckSquare className="h-3.5 w-3.5" />
                {t('chat.parallelMaxReached')}
              </>
            ) : (
              <>
                <Square className="h-3.5 w-3.5" />
                {t('chat.parallelPickHint')}
              </>
            )}
          </span>
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={handleSend}
            data-testid="parallel-runs-confirm"
          >
            <Bot className="h-4 w-4" />
            {t('chat.parallelConfirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
