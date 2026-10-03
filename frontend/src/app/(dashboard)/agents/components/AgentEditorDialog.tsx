'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { ModelSelector } from '@/components/common/ModelSelector'
import { agentsApi } from '@/lib/api/agents'
import { useCreateAgent, useUpdateAgent } from '@/lib/hooks/use-agents'
import { useTranslation } from '@/lib/hooks/use-translation'
import { Agent } from '@/lib/types/agents'
import { Bot } from 'lucide-react'

type EditorError = 'required' | 'temperature' | 'maxTokens' | 'load' | null

const ERROR_KEYS = {
  required: 'agents.validationRequired',
  temperature: 'agents.validationTemperature',
  maxTokens: 'agents.validationMaxTokens',
  load: 'agents.loadFailed',
} as const

interface AgentEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Null = create mode; otherwise edit the agent with this id. */
  agentId: string | null
}

interface FormState {
  name: string
  description: string
  system_prompt: string
  model: string
  temperature: string
  max_tokens: string
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  system_prompt: '',
  model: '',
  temperature: '',
  max_tokens: '',
  enabled: true,
}

function toForm(agent: Agent): FormState {
  return {
    name: agent.name,
    description: agent.description ?? '',
    system_prompt: agent.system_prompt,
    model: agent.model_id ?? '',
    temperature: agent.temperature !== null ? String(agent.temperature) : '',
    max_tokens: agent.max_tokens !== null ? String(agent.max_tokens) : '',
    enabled: agent.enabled,
  }
}

export function AgentEditorDialog({ open, onOpenChange, agentId }: AgentEditorDialogProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<EditorError>(null)
  const createAgent = useCreateAgent()
  const updateAgent = useUpdateAgent()

  useEffect(() => {
    if (!open) return
    setError(null)
    if (agentId) {
      agentsApi
        .get(agentId)
        .then((agent) => setForm(toForm(agent)))
        .catch(() => {
          setError('load')
          setForm(EMPTY_FORM)
        })
    } else {
      setForm(EMPTY_FORM)
    }
  }, [open, agentId])

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = () => {
    if (!form.name.trim() || !form.system_prompt.trim()) {
      setError('required')
      return
    }
    const temperature =
      form.temperature.trim() === '' ? null : Number(form.temperature)
    const max_tokens = form.max_tokens.trim() === '' ? null : Number(form.max_tokens)
    if (
      temperature !== null &&
      (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
    ) {
      setError('temperature')
      return
    }
    if (max_tokens !== null && (!Number.isFinite(max_tokens) || max_tokens <= 0)) {
      setError('maxTokens')
      return
    }

    const payload = {
      name: form.name.trim(),
      system_prompt: form.system_prompt,
      description: form.description.trim() || null,
      model: form.model || null,
      temperature,
      max_tokens,
      enabled: form.enabled,
    }

    const onSuccess = () => onOpenChange(false)
    if (agentId) {
      updateAgent.mutate({ id: agentId, data: payload }, { onSuccess })
    } else {
      createAgent.mutate(payload, { onSuccess })
    }
  }

  const isSubmitting = createAgent.isPending || updateAgent.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {agentId ? t('agents.edit') : t('agents.create')}
          </DialogTitle>
          <DialogDescription>{t('agents.editorDesc')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="agent-name">{t('agents.nameLabel')}</Label>
            <Input
              id="agent-name"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              placeholder={t('agents.namePlaceholder')}
              data-testid="agent-form-name"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agent-description">{t('agents.descriptionLabel')}</Label>
            <Input
              id="agent-description"
              value={form.description}
              onChange={(e) => setField('description', e.target.value)}
              placeholder={t('agents.descriptionPlaceholder')}
              data-testid="agent-form-description"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="agent-prompt">{t('agents.promptLabel')}</Label>
            <Textarea
              id="agent-prompt"
              value={form.system_prompt}
              onChange={(e) => setField('system_prompt', e.target.value)}
              placeholder={t('agents.promptPlaceholder')}
              rows={8}
              className="font-mono text-sm"
              data-testid="agent-form-prompt"
            />
            <p className="text-xs text-muted-foreground">{t('agents.promptHint')}</p>
          </div>

          <div className="grid gap-2">
            <ModelSelector
              label={t('agents.modelLabel')}
              modelType="language"
              value={form.model}
              onChange={(value) => setField('model', value || '')}
              placeholder={t('agents.modelPlaceholder')}
            />
            <p className="text-xs text-muted-foreground">{t('agents.modelHint')}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="agent-temperature">{t('agents.temperatureField')}</Label>
              <Input
                id="agent-temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperature}
                onChange={(e) => setField('temperature', e.target.value)}
                placeholder="0.7"
                data-testid="agent-form-temperature"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="agent-max-tokens">{t('agents.maxTokensField')}</Label>
              <Input
                id="agent-max-tokens"
                type="number"
                min={1}
                step={1}
                value={form.max_tokens}
                onChange={(e) => setField('max_tokens', e.target.value)}
                placeholder="4096"
                data-testid="agent-form-max-tokens"
              />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="agent-enabled">{t('agents.enabledLabel')}</Label>
              <p className="text-xs text-muted-foreground">{t('agents.enabledHint')}</p>
            </div>
            <Checkbox
              id="agent-enabled"
              checked={form.enabled}
              onCheckedChange={(checked) => setField('enabled', checked === true)}
              data-testid="agent-form-enabled"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="agent-form-error">
              {t(ERROR_KEYS[error])}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={isSubmitting} data-testid="agent-form-submit">
            {isSubmitting ? t('common.saving') : t('common.saveChanges')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
