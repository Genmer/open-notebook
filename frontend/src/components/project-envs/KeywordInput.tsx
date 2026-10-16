'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { X } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'

const KEYWORD_MIN = 2
const KEYWORD_MAX = 8

export { KEYWORD_MIN, KEYWORD_MAX }

export function KeywordInput({
  keywords,
  onChange,
  disabled,
}: {
  keywords: string[]
  onChange: (keywords: string[]) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  const addDraft = () => {
    const parts = draft
      .split(/[,，、;；\s]+/)
      .map((part) => part.trim())
      .filter(Boolean)
    const next = [...keywords]
    for (const part of parts) {
      if (next.length >= KEYWORD_MAX) break
      if (!next.includes(part)) next.push(part)
    }
    if (next.length > keywords.length) onChange(next)
    setDraft('')
  }

  return (
    <div className="space-y-1.5">
      <div className="flex min-h-[38px] flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 text-sm">
        {keywords.map((keyword) => (
          <Badge key={keyword} variant="secondary" className="gap-1 font-normal">
            {keyword}
            <button
              type="button"
              aria-label={`${t('common.remove')} ${keyword}`}
              disabled={disabled}
              onClick={() => onChange(keywords.filter((item) => item !== keyword))}
              className="rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          className="min-w-[120px] flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
          value={draft}
          disabled={disabled}
          placeholder={
            keywords.length ? '' : t('projectEnvs.mockKeywordsPlaceholder')
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault()
              addDraft()
            } else if (
              event.key === 'Backspace' &&
              !draft &&
              keywords.length &&
              !disabled
            ) {
              onChange(keywords.slice(0, -1))
            }
          }}
          onBlur={addDraft}
        />
      </div>
      <p className="text-xs text-muted-foreground">{t('projectEnvs.mockKeywordsHint')}</p>
    </div>
  )
}
