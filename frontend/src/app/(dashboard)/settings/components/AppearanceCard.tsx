'use client'

import { useEffect, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useThemeStore, SKINS, type Skin } from '@/lib/stores/theme-store'
import { useNotebookViewStore, type NotebookDetailStyle } from '@/lib/stores/notebook-view-store'
import { useTranslation } from '@/lib/hooks/use-translation'

// Standalone from SettingsForm on purpose: the skin applies instantly and must
// never be part of the settings form's Save lifecycle.
export function AppearanceCard() {
  const { t } = useTranslation()
  const skin = useThemeStore((s) => s.skin)
  const setSkin = useThemeStore((s) => s.setSkin)
  const detailStyle = useNotebookViewStore((s) => s.detailStyle)
  const setDetailStyle = useNotebookViewStore((s) => s.setDetailStyle)
  const [mounted, setMounted] = useState(false)

  // Local mounted gate, not the store's hasHydrated: that flag is already true
  // during SSR, so only this keeps the first client render matching the server markup.
  useEffect(() => setMounted(true), [])

  const skinOptions: { value: Skin; label: string; desc: string }[] = [
    { value: 'quiet-green', label: t('settings.skinQuietGreen'), desc: t('settings.skinQuietGreenDesc') },
    { value: 'classic', label: t('settings.skinClassic'), desc: t('settings.skinClassicDesc') },
  ]

  const styleOptions: { value: NotebookDetailStyle; label: string; desc: string }[] = [
    { value: 'open_notebook', label: t('settings.styleOpenNotebook'), desc: t('settings.styleOpenNotebookDesc') },
    { value: 'gemini_notebook', label: t('settings.styleGeminiNotebook'), desc: t('settings.styleGeminiNotebookDesc') },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance')}</CardTitle>
        <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label id="skin-group-label">{t('settings.skin')}</Label>
          <RadioGroup
            value={mounted ? skin : ''}
            aria-labelledby="skin-group-label"
            onValueChange={(value) => {
              if ((SKINS as readonly string[]).includes(value)) {
                setSkin(value as Skin)
              }
            }}
          >
            {skinOptions.map((option) => (
              <div
                key={option.value}
                className="flex items-start gap-3 rounded-md border border-border p-4"
              >
                <RadioGroupItem value={option.value} id={`skin-${option.value}`} className="mt-0.5" />
                <Label
                  htmlFor={`skin-${option.value}`}
                  className="flex flex-col items-start gap-1 font-normal"
                >
                  <span className="font-medium">{option.label}</span>
                  <span className="text-muted-foreground leading-snug">{option.desc}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>

        <div className="space-y-3 border-t border-border pt-4">
          <div className="space-y-1">
            <Label id="detail-style-group-label" className="text-sm font-medium">
              {t('settings.notebookDetailStyle')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.notebookDetailStyleDesc')}
            </p>
          </div>
          <RadioGroup
            value={mounted ? detailStyle : ''}
            aria-labelledby="detail-style-group-label"
            onValueChange={(value) => {
              if (value === 'open_notebook' || value === 'gemini_notebook') {
                setDetailStyle(value)
              }
            }}
          >
            {styleOptions.map((option) => (
              <div
                key={option.value}
                className="flex items-start gap-3 rounded-md border border-border p-4 transition-colors hover:bg-muted/40 cursor-pointer"
              >
                <RadioGroupItem value={option.value} id={`style-${option.value}`} className="mt-0.5" />
                <Label
                  htmlFor={`style-${option.value}`}
                  className="flex flex-col items-start gap-1 font-normal cursor-pointer flex-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{option.label}</span>
                    {option.value === 'gemini_notebook' && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        NotebookLM
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground leading-snug">{option.desc}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  )
}
