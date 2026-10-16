'use client'

import { useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select'
import { Settings2 } from 'lucide-react'
import { useModelDefaults, useModels } from '@/lib/hooks/use-models'
import { useAgents } from '@/lib/hooks/use-agents'
import { useTranslation } from '@/lib/hooks/use-translation'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'

export interface ChatParticipant {
  agent?: string | null
  modelOverride?: string | null
}

interface ChatParticipantSelectorProps {
  /** Agent and model are mutually exclusive; at most one is set. */
  value: ChatParticipant
  onChange: (participant: ChatParticipant) => void
  disabled?: boolean
  testid?: string
}

/** Encode a participant into the Select value space. */
function encodeParticipant(participant: ChatParticipant): string {
  if (participant.agent) return `agent:${participant.agent}`
  if (participant.modelOverride) return `model:${participant.modelOverride}`
  return 'default'
}

/** Decode a Select value back into a mutually exclusive participant. */
export function decodeParticipant(value: string): ChatParticipant {
  if (value.startsWith('agent:')) {
    return { agent: value.slice('agent:'.length), modelOverride: null }
  }
  if (value.startsWith('model:')) {
    return { agent: null, modelOverride: value.slice('model:'.length) }
  }
  return { agent: null, modelOverride: null }
}

export function ChatParticipantSelector({
  value,
  onChange,
  disabled = false,
  testid = 'chat-participant-trigger',
}: ChatParticipantSelectorProps) {
  const { t } = useTranslation()
  const selected = encodeParticipant(value)
  const { data: models, isLoading: modelsLoading } = useModels()
  const { data: defaults } = useModelDefaults()
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

  const defaultModel = useMemo(() => {
    if (!defaults?.default_chat_model) return undefined
    return languageModels.find((model) => model.id === defaults.default_chat_model)
  }, [defaults?.default_chat_model, languageModels])

  const currentName = useMemo(() => {
    if (value.agent) {
      return (
        enabledAgents.find((agent) => agent.id === value.agent)?.name ||
        t('chat.agentMissing')
      )
    }
    if (value.modelOverride) {
      return (
        languageModels.find((model) => model.id === value.modelOverride)?.name ||
        value.modelOverride
      )
    }
    if (defaultModel) return `${t('common.default')} (${defaultModel.name})`
    return t('common.default')
  }, [value, enabledAgents, languageModels, defaultModel, t])

  const handleValueChange = (val: string) => {
    onChange(decodeParticipant(val))
  }

  return (
    <Select value={selected} onValueChange={handleValueChange} disabled={disabled}>
      <SelectTrigger
        data-testid={testid}
        className="h-8 gap-2 w-auto max-w-[220px] text-xs font-normal bg-background/80 hover:bg-background border-border/80 shadow-none shrink-0"
      >
        <Settings2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="truncate">{currentName}</span>
      </SelectTrigger>
      <SelectContent align="start" className="max-w-[340px]">
        {modelsLoading || agentsLoading ? (
          <div className="flex items-center justify-center py-2">
            <LoadingSpinner size="sm" />
          </div>
        ) : (
          <>
            <SelectGroup>
              <SelectLabel>{t('chat.groupDefault')}</SelectLabel>
              <SelectItem value="default">
                <div className="flex items-center justify-between w-full gap-2">
                  <span>
                    {defaultModel
                      ? `${t('common.default')} (${defaultModel.name})`
                      : t('transformations.systemDefault')}
                  </span>
                  {defaultModel?.provider && (
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">
                      {defaultModel.provider}
                    </span>
                  )}
                </div>
              </SelectItem>
            </SelectGroup>
            {enabledAgents.length > 0 && (
              <SelectGroup>
                <SelectLabel>{t('chat.groupAgents')}</SelectLabel>
                {enabledAgents.map((agent) => (
                  <SelectItem key={agent.id} value={`agent:${agent.id}`}>
                    <div className="flex items-center justify-between w-full gap-2">
                      <span className="truncate">{agent.name}</span>
                      {agent.model_id && (
                        <span className="text-xs text-muted-foreground ml-2 truncate max-w-[120px] shrink-0">
                          {languageModels.find((m) => m.id === agent.model_id)?.name ||
                            agent.model_id}
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            <SelectGroup>
              <SelectLabel>{t('chat.groupModels')}</SelectLabel>
              {languageModels.map((model) => (
                <SelectItem key={model.id} value={`model:${model.id}`}>
                  <div className="flex items-center justify-between w-full gap-2">
                    <span className="truncate">{model.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">
                      {model.provider}
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectGroup>
          </>
        )}
      </SelectContent>
    </Select>
  )
}
