import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  INDUSTRY_POOL,
  INDUSTRY_PROFILES,
} from '@/lib/ruankao/industry-pool'

// 选中行业的就地信息卡（用户裁决 2026-10-11：行业池价值必须上屏，不该只进
// prompt）。池内命中 → hint 一句话常驻 + 「行业画像」三行可折叠（生成时这些
// 内容随方案B注入上下文，所见即所注入）；池外自定义行业 → 返回 null，调用方
// 回落静态 helper 文案。展示复用 IndustryCombobox hover 的同三条 i18n 键，
// 口径单一。
export function IndustryContextCard({
  industry,
  testId = 'env-industry-context-card',
}: {
  industry: string
  testId?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const entry = INDUSTRY_POOL.find((item) => item.name === industry)
  if (!entry) return null
  const profile = INDUSTRY_PROFILES[entry.name]

  return (
    <div
      className="grid gap-1 rounded-md border bg-muted/30 px-2.5 py-2 text-xs"
      data-testid={testId}
    >
      <p data-testid={`${testId}-hint`} className="text-muted-foreground">
        {t('ruankao.industry.hintLine', { hint: entry.hint })}
      </p>
      {profile && (
        <>
          <button
            type="button"
            className="-mx-1 flex w-fit items-center gap-1 rounded px-1 py-0.5 font-medium text-primary hover:underline"
            aria-expanded={open}
            data-testid={`${testId}-toggle`}
            onClick={() => setOpen((prev) => !prev)}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
              aria-hidden
            />
            {open
              ? t('ruankao.industry.profileHide')
              : t('ruankao.industry.profileShow')}
          </button>
          {open && (
            <div
              className="grid gap-1 border-l pl-2.5 text-muted-foreground"
              data-testid={`${testId}-profile`}
            >
              <p>
                {t('ruankao.industry.profileFormsLine', {
                  items: profile.projectForms.join('；'),
                })}
              </p>
              <p>
                {t('ruankao.industry.profileTechLine', {
                  items: profile.techStack.join('；'),
                })}
              </p>
              <p>
                {t('ruankao.industry.profileFlowsLine', {
                  items: profile.businessFlows.join('；'),
                })}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
