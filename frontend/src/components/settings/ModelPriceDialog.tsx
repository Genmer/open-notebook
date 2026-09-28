'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2 } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import { useRefreshModelPrice, useSaveModelPrice } from '@/lib/hooks/use-models'
import { Model } from '@/lib/types/models'

interface ModelPriceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  model: Model
}

// Per-1M-token prices in CNY, either fetched from the public LiteLLM price
// database or entered manually. Both land on the model record and feed the
// cost estimate on the usage page.
export function ModelPriceDialog({ open, onOpenChange, model }: ModelPriceDialogProps) {
  const { t } = useTranslation()
  const refreshPrice = useRefreshModelPrice()
  const savePrice = useSaveModelPrice()
  const [inputPrice, setInputPrice] = useState('')
  const [outputPrice, setOutputPrice] = useState('')

  // Resync the fields whenever the dialog opens for a (possibly updated) model.
  useEffect(() => {
    if (open) {
      setInputPrice(model.price_input_per_m != null ? String(model.price_input_per_m) : '')
      setOutputPrice(model.price_output_per_m != null ? String(model.price_output_per_m) : '')
    }
  }, [open, model])

  const parsedInput = parseFloat(inputPrice)
  const parsedOutput = parseFloat(outputPrice)
  const isValid =
    Number.isFinite(parsedInput) &&
    Number.isFinite(parsedOutput) &&
    parsedInput >= 0 &&
    parsedOutput >= 0

  const handleFetch = () => {
    refreshPrice.mutate(model.id, {
      onSuccess: (result) => {
        if (result.found) {
          setInputPrice(result.price_input_per_m != null ? String(result.price_input_per_m) : '')
          setOutputPrice(
            result.price_output_per_m != null ? String(result.price_output_per_m) : ''
          )
        }
      },
    })
  }

  const handleSave = () => {
    if (!isValid) return
    savePrice.mutate(
      { modelId: model.id, data: { price_input_per_m: parsedInput, price_output_per_m: parsedOutput } },
      { onSuccess: () => onOpenChange(false) }
    )
  }

  const busy = refreshPrice.isPending || savePrice.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('models.priceTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="font-mono text-sm">{model.name}</p>
          <p className="text-sm text-muted-foreground">{t('models.priceDesc')}</p>
          {model.price_source && (
            <p className="text-xs text-muted-foreground">
              {t('models.priceSource', {
                source:
                  model.price_source === 'litellm'
                    ? model.price_matched_key || 'litellm'
                    : t('models.priceSourceManual'),
              })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="price-input">{t('models.priceInput')}</Label>
              <Input
                id="price-input"
                type="number"
                min="0"
                step="any"
                value={inputPrice}
                onChange={(e) => setInputPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="price-output">{t('models.priceOutput')}</Label>
              <Input
                id="price-output"
                type="number"
                min="0"
                step="any"
                value={outputPrice}
                onChange={(e) => setOutputPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleFetch} disabled={busy}>
            {refreshPrice.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('models.priceFetch')}
          </Button>
          <Button onClick={handleSave} disabled={!isValid || busy}>
            {savePrice.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
