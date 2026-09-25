'use client'

import { useEffect, useState } from 'react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { useThemeStore, SKINS, type Skin } from '@/lib/stores/theme-store'
import { useTranslation } from '@/lib/hooks/use-translation'

// Standalone from SettingsForm on purpose: the skin applies instantly and must
// never be part of the settings form's Save lifecycle.
export function AppearanceCard() {
  const { t } = useTranslation()
  const skin = useThemeStore((s) => s.skin)
  const setSkin = useThemeStore((s) => s.setSkin)
  const [mounted, setMounted] = useState(false)

  // Local mounted gate, not the store's hasHydrated: that flag is already true
  // during SSR, so only this keeps the first client render matching the server markup.
  useEffect(() => setMounted(true), [])

  const options: { value: Skin; label: string; desc: string }[] = [
    { value: 'quiet-green', label: t('settings.skinQuietGreen'), desc: t('settings.skinQuietGreenDesc') },
    { value: 'classic', label: t('settings.skinClassic'), desc: t('settings.skinClassicDesc') },
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.appearance')}</CardTitle>
        <CardDescription>{t('settings.appearanceDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
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
          {options.map((option) => (
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
      </CardContent>
    </Card>
  )
}
