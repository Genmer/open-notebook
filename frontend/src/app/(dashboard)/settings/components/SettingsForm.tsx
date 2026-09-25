'use client'

import { useForm, Controller, Control } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettings, useUpdateSettings } from '@/lib/hooks/use-settings'
import { useCapabilities } from '@/lib/hooks/use-capabilities'
import { useToast } from '@/lib/hooks/use-toast'
import { useEffect, useState } from 'react'
import { ChevronDownIcon, HelpCircleIcon } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'

const settingsSchema = z.object({
  default_content_processing_engine_doc: z.enum(['auto', 'docling', 'simple']).optional(),
  default_content_processing_engine_url: z.enum(['auto', 'firecrawl', 'jina', 'crawl4ai', 'simple']).optional(),
  default_embedding_option: z.enum(['ask', 'always', 'never']).optional(),
  auto_delete_files: z.enum(['yes', 'no']).optional(),
  docling_ocr: z.boolean().optional(),
  docling_formulas: z.boolean().optional(),
  docling_vision: z.boolean().optional(),
  usage_tracking_enabled: z.boolean().optional(),
  chunk_size: z.number().int().min(100).optional(),
  chunk_overlap: z.number().int().min(0).optional(),
  min_chunk_size: z.number().int().min(0).optional(),
  embedding_batch_size: z.number().int().min(1).optional(),
}).superRefine((data, ctx) => {
  if (
    data.chunk_overlap !== undefined &&
    data.chunk_size !== undefined &&
    data.chunk_overlap >= data.chunk_size
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['chunk_overlap'],
      message: 'chunk_overlap must be less than chunk_size',
    })
  }
})

type SettingsFormData = z.infer<typeof settingsSchema>

type VectorParamFieldProps = {
  id: string
  name: 'chunk_size' | 'chunk_overlap' | 'min_chunk_size' | 'embedding_batch_size'
  label: string
  help: string
  min: number
  placeholder: string
  control: Control<SettingsFormData>
  disabled?: boolean
}

function VectorParamField({ id, name, label, help, min, placeholder, control, disabled }: VectorParamFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={id}>{label}</Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={label}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            >
              <HelpCircleIcon className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p>{help}</p>
          </TooltipContent>
        </Tooltip>
      </div>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Input
            id={id}
            type="number"
            min={min}
            placeholder={placeholder}
            value={field.value ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              field.onChange(raw === '' ? undefined : Number(raw))
            }}
            onBlur={field.onBlur}
            disabled={disabled}
            className="max-w-40"
          />
        )}
      />
    </div>
  )
}

const VECTOR_PARAM_FIELDS = ['chunk_size', 'chunk_overlap', 'min_chunk_size', 'embedding_batch_size'] as const

export function SettingsForm() {
  const { t } = useTranslation()
  const { data: settings, isLoading, error } = useSettings()
  const { data: capabilities, isError: capabilitiesError } = useCapabilities()
  const updateSettings = useUpdateSettings()
  const { toast } = useToast()
  // Opt-in heavy runtimes are installed on demand at container startup, so an
  // engine is only offered when the backend probe confirms it's actually
  // available. While the probe is still loading, default to available to avoid a
  // flash of disabled controls on a correctly-configured install; but if the
  // probe *fails*, fail closed (treat as unavailable) rather than advertising an
  // engine the backend couldn't verify.
  const doclingAvailable = capabilities?.docling_available ?? !capabilitiesError
  const crawl4aiAvailable = capabilities?.crawl4ai_available ?? !capabilitiesError
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    doc: false,
    url: false,
    embedding: false,
    files: false
  })
  const [hasResetForm, setHasResetForm] = useState(false)
  
  
  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, dirtyFields }
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      default_content_processing_engine_doc: undefined,
      default_content_processing_engine_url: undefined,
      default_embedding_option: undefined,
      auto_delete_files: undefined,
      docling_ocr: undefined,
      docling_formulas: undefined,
      docling_vision: undefined,
      usage_tracking_enabled: undefined,
      chunk_size: undefined,
      chunk_overlap: undefined,
      min_chunk_size: undefined,
      embedding_batch_size: undefined,
    }
  })


  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }))
  }

  useEffect(() => {
    if (settings && settings.default_content_processing_engine_doc && !hasResetForm) {
      const formData = {
        default_content_processing_engine_doc: settings.default_content_processing_engine_doc as 'auto' | 'docling' | 'simple',
        default_content_processing_engine_url: settings.default_content_processing_engine_url as 'auto' | 'firecrawl' | 'jina' | 'crawl4ai' | 'simple',
        default_embedding_option: settings.default_embedding_option as 'ask' | 'always' | 'never',
        auto_delete_files: settings.auto_delete_files as 'yes' | 'no',
        docling_ocr: settings.docling_ocr ?? true,
        docling_formulas: settings.docling_formulas ?? false,
        docling_vision: settings.docling_vision ?? false,
        usage_tracking_enabled: settings.usage_tracking_enabled ?? true,
        // Raw DB values: empty input = follow env/default.
        chunk_size: settings.chunk_size ?? undefined,
        chunk_overlap: settings.chunk_overlap ?? undefined,
        min_chunk_size: settings.min_chunk_size ?? undefined,
        embedding_batch_size: settings.embedding_batch_size ?? undefined,
      }
      reset(formData)
      setHasResetForm(true)
    }
  }, [hasResetForm, reset, settings])

  const onSubmit = async (data: SettingsFormData) => {
    // Only vector params explicitly touched by the user are submitted —
    // sending resolved values back would freeze env vars into the DB.
    const payload: SettingsFormData = { ...data }
    for (const field of VECTOR_PARAM_FIELDS) {
      if (!dirtyFields[field]) {
        delete payload[field]
      }
    }
    await updateSettings.mutateAsync(payload)
    if (dirtyFields.chunk_size || dirtyFields.chunk_overlap || dirtyFields.min_chunk_size) {
      toast({ description: t('settings.chunkParamsChangedToast') })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{t('settings.loadFailed')}</AlertTitle>
        <AlertDescription>
          {error instanceof Error ? error.message : t('common.error')}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.contentProcessing')}</CardTitle>
          <CardDescription>
            {t('settings.contentProcessingDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label htmlFor="doc_engine">{t('settings.docEngine')}</Label>
            <Controller
              name="default_content_processing_engine_doc"
              control={control}
              render={({ field }) => (
                  <Select
                    key={field.value}
                    name={field.name}
                    value={field.value || ''}
                    onValueChange={field.onChange}
                    disabled={field.disabled || isLoading}
                  >
                      <SelectTrigger id="doc_engine" className="w-full">
                        <SelectValue placeholder={t('settings.docEnginePlaceholder')} />
                      </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t('settings.autoRecommended')}</SelectItem>
                      <SelectItem value="docling" disabled={!doclingAvailable}>{t('settings.docling')}</SelectItem>
                      <SelectItem value="simple">{t('settings.simple')}</SelectItem>
                    </SelectContent>
                  </Select>
              )}
            />
            {!doclingAvailable && (
              <p className="text-sm text-muted-foreground">{t('settings.enableDoclingHint')}</p>
            )}
            <Collapsible open={expandedSections.doc} onOpenChange={() => toggleSection('doc')}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${expandedSections.doc ? 'rotate-180' : ''}`} />
                {t('settings.helpMeChoose')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 text-sm text-muted-foreground space-y-2">
                <p>{t('settings.docHelp')}</p>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Controller
                name="docling_ocr"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="docling_ocr"
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                    disabled={field.disabled || isLoading || !doclingAvailable}
                  />
                )}
              />
              <Label htmlFor="docling_ocr">{t('settings.ocrEnabled')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('settings.ocrHelp')}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Controller
                name="docling_formulas"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="docling_formulas"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    disabled={field.disabled || isLoading || !doclingAvailable}
                  />
                )}
              />
              <Label htmlFor="docling_formulas">{t('settings.formulasEnabled')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('settings.formulasHelp')}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Controller
                name="docling_vision"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="docling_vision"
                    checked={field.value ?? false}
                    onCheckedChange={field.onChange}
                    disabled={field.disabled || isLoading || !doclingAvailable}
                  />
                )}
              />
              <Label htmlFor="docling_vision">{t('settings.visionEnabled')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('settings.visionHelp')}</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Controller
                name="usage_tracking_enabled"
                control={control}
                render={({ field }) => (
                  <Checkbox
                    id="usage_tracking_enabled"
                    checked={field.value ?? true}
                    onCheckedChange={field.onChange}
                    disabled={field.disabled || isLoading}
                  />
                )}
              />
              <Label htmlFor="usage_tracking_enabled">{t('usage.trackingEnabled')}</Label>
            </div>
            <p className="text-sm text-muted-foreground">{t('usage.privacyDesc')}</p>
          </div>

          <div className="space-y-3">
            <Label htmlFor="url_engine">{t('settings.urlEngine')}</Label>
            <Controller
              name="default_content_processing_engine_url"
              control={control}
              render={({ field }) => (
                <Select
                  key={field.value}
                  name={field.name}
                  value={field.value || ''}
                  onValueChange={field.onChange}
                  disabled={field.disabled || isLoading}
                >
                  <SelectTrigger id="url_engine" className="w-full">
                    <SelectValue placeholder={t('settings.urlEnginePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('settings.autoRecommended')}</SelectItem>
                    <SelectItem value="firecrawl">{t('settings.firecrawl')}</SelectItem>
                    <SelectItem value="jina">{t('settings.jina')}</SelectItem>
                    <SelectItem value="crawl4ai" disabled={!crawl4aiAvailable}>{t('settings.crawl4ai')}</SelectItem>
                    <SelectItem value="simple">{t('settings.simple')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
            {!crawl4aiAvailable && (
              <p className="text-sm text-muted-foreground">{t('settings.enableCrawl4aiHint')}</p>
            )}
             <Collapsible open={expandedSections.url} onOpenChange={() => toggleSection('url')}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${expandedSections.url ? 'rotate-180' : ''}`} />
                {t('settings.helpMeChoose')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 text-sm text-muted-foreground space-y-2">
                <p>{t('settings.urlHelp')}</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>

       <Card>
        <CardHeader>
          <CardTitle>{t('settings.embeddingAndSearch')}</CardTitle>
          <CardDescription>
            {t('settings.embeddingAndSearchDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
           <div className="space-y-3">
            <Label htmlFor="embedding">{t('settings.defaultEmbeddingOption')}</Label>
            <Controller
              name="default_embedding_option"
              control={control}
              render={({ field }) => (
                <Select
                  key={field.value}
                  name={field.name}
                  value={field.value || ''}
                  onValueChange={field.onChange}
                  disabled={field.disabled || isLoading}
                >
                  <SelectTrigger id="embedding" className="w-full">
                    <SelectValue placeholder={t('settings.embeddingOptionPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ask">{t('settings.ask')}</SelectItem>
                    <SelectItem value="always">{t('settings.always')}</SelectItem>
                    <SelectItem value="never">{t('settings.never')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
             <Collapsible open={expandedSections.embedding} onOpenChange={() => toggleSection('embedding')}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${expandedSections.embedding ? 'rotate-180' : ''}`} />
                {t('settings.helpMeChoose')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 text-sm text-muted-foreground space-y-2">
                <p>{t('settings.embeddingHelp')}</p>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <VectorParamField
              id="chunk_size"
              name="chunk_size"
              label={t('settings.chunkSize')}
              help={t('settings.chunkSizeHelp')}
              min={100}
              placeholder={String(settings?.effective_chunk_size ?? '')}
              control={control}
              disabled={isLoading}
            />
            <VectorParamField
              id="chunk_overlap"
              name="chunk_overlap"
              label={t('settings.chunkOverlap')}
              help={t('settings.chunkOverlapHelp')}
              min={0}
              placeholder={String(settings?.effective_chunk_overlap ?? '')}
              control={control}
              disabled={isLoading}
            />
            <VectorParamField
              id="min_chunk_size"
              name="min_chunk_size"
              label={t('settings.minChunkSize')}
              help={t('settings.minChunkSizeHelp')}
              min={0}
              placeholder={String(settings?.effective_min_chunk_size ?? '')}
              control={control}
              disabled={isLoading}
            />
            <VectorParamField
              id="embedding_batch_size"
              name="embedding_batch_size"
              label={t('settings.embeddingBatchSize')}
              help={t('settings.embeddingBatchSizeHelp')}
              min={1}
              placeholder={String(settings?.effective_embedding_batch_size ?? '')}
              control={control}
              disabled={isLoading}
            />
          </div>
        </CardContent>
      </Card>

       <Card>
        <CardHeader>
          <CardTitle>{t('settings.fileManagement')}</CardTitle>
          <CardDescription>
            {t('settings.fileManagementDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
           <div className="space-y-3">
            <Label htmlFor="auto_delete">{t('settings.autoDeleteFiles')}</Label>
            <Controller
              name="auto_delete_files"
              control={control}
              render={({ field }) => (
                <Select
                  key={field.value}
                  name={field.name}
                  value={field.value || ''}
                  onValueChange={field.onChange}
                  disabled={field.disabled || isLoading}
                >
                  <SelectTrigger id="auto_delete" className="w-full">
                    <SelectValue placeholder={t('settings.autoDeletePlaceholder')} />
                  </SelectTrigger>
                   <SelectContent>
                    <SelectItem value="yes">{t('common.yes')}</SelectItem>
                    <SelectItem value="no">{t('common.no')}</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
             <Collapsible open={expandedSections.files} onOpenChange={() => toggleSection('files')}>
              <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
                <ChevronDownIcon className={`h-4 w-4 transition-transform ${expandedSections.files ? 'rotate-180' : ''}`} />
                {t('settings.helpMeChoose')}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 text-sm text-muted-foreground space-y-2">
                <p>{t('settings.filesHelp')}</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
         <Button 
          type="submit" 
          disabled={!isDirty || updateSettings.isPending}
        >
          {updateSettings.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </div>
    </form>
  )
}
