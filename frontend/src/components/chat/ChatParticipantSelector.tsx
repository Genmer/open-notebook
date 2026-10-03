'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Bot, Settings2 } from 'lucide-react'
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
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(() => encodeParticipant(value))
  const { data: models, isLoading: modelsLoading } = useModels()
  const { data: defaults } = useModelDefaults()
  const { data: agents, isLoading: agentsLoading } = useAgents()

  useEffect(() => {
    setSelected(encodeParticipant(value))
  }, [value])

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

  const handleSave = () => {
    onChange(decodeParticipant(selected))
    setOpen(false)
  }

  const handleReset = () => {
    setSelected('default')
    onChange({ agent: null, modelOverride: null })
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          className="gap-2"
          data-testid={testid}
        >
          <Settings2 className="h-4 w-4" />
          <span className="text-xs max-w-[160px] truncate">{currentName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {t('chat.participantConfig')}
          </DialogTitle>
          <DialogDescription>{t('chat.participantDesc')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <Select value={selected} onValueChange={setSelected}>
            <SelectTrigger data-testid="chat-participant-select">
              <SelectValue placeholder={t('chat.participantPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {modelsLoading || agentsLoading ? (
                <div className="flex items-center justify-center py-2">
                  <LoadingSpinner size="sm" />
                </div>
              ) : (
                <>
                  <SelectGroup>
                    <SelectLabel>{t('chat.groupDefault')}</SelectLabel>
                    <SelectItem value="default">
                      <div className="flex items-center justify-between w-full">
                        <span>
                          {defaultModel
                            ? `${t('common.default')} (${defaultModel.name})`
                            : t('transformations.systemDefault')}
                        </span>
                        {defaultModel?.provider && (
                          <span className="text-xs text-muted-foreground ml-2">
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
                          <div className="flex items-center justify-between w-full">
                            <span className="truncate">{agent.name}</span>
                            {agent.model_id && (
                              <span className="text-xs text-muted-foreground ml-2 truncate max-w-[120px]">
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
                        <div className="flex items-center justify-between w-full">
                          <span>{model.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">
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
          {selected !== 'default' && (
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">
                {selected.startsWith('agent:')
                  ? t('chat.participantAgentHint')
                  : t('chat.participantModelHint')}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex justify-between">
          <Button variant="outline" onClick={handleReset}>
            {t('common.resetToDefault')}
          </Button>
          <Button onClick={handleSave}>{t('common.saveChanges')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
