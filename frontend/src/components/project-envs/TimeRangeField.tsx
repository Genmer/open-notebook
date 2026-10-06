'use client'

import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import {
  isMonth,
  latestAllowedEnd,
  nowMonth,
  shiftMonth,
  spanMonths,
  validatePeriod,
  type ProjectEnvMode,
  type TimeViolation,
} from '@/lib/utils/project-env-time'

interface TimeRangeFieldProps {
  value: { start: string; end: string }
  onChange: (value: { start: string; end: string }) => void
  // real: R2/R3 are warnings (yellow, submit passes); mock: they are
  // blocking errors (red, submit disabled). R1 always blocks.
  mode: ProjectEnvMode
  disabled?: boolean
  idPrefix?: string
}

function monthOptions(): string[] {
  // Real projects may predate the legal window (R3 only warns there), so the
  // picker spans 20 years back; future months are pointless for a past project.
  const max = nowMonth()
  const min = shiftMonth(max, -240)
  const options: string[] = []
  let current = min
  while (current <= max) {
    options.push(current)
    current = shiftMonth(current, 1)
  }
  return options.reverse()
}

function violationMessage(
  violation: TimeViolation,
  t: ReturnType<typeof useTranslation>['t']
): string {
  if (violation.rule === 'R1') return t('projectEnvs.r1Message')
  if (violation.rule === 'R2') {
    return t('projectEnvs.r2Message', { count: violation.span_months ?? 0 })
  }
  return t('projectEnvs.r3Message', {
    end: violation.latest_allowed_end ?? latestAllowedEnd(),
  })
}

export function TimeRangeField({
  value,
  onChange,
  mode,
  disabled,
  idPrefix = 'env-period',
}: TimeRangeFieldProps) {
  const { t } = useTranslation()
  const options = useMemo(monthOptions, [])
  const span = isMonth(value.start) && isMonth(value.end) ? spanMonths(value.start, value.end) : null
  const violations = useMemo(
    () => validatePeriod(value.start, value.end, mode),
    [value.start, value.end, mode]
  )

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-start`} className="text-xs text-muted-foreground">
            {t('projectEnvs.periodStart')}
          </Label>
          <Select
            value={value.start || undefined}
            onValueChange={(next) => onChange({ ...value, start: next })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-start`} className="w-[130px]">
              <SelectValue placeholder="YYYY.MM" />
            </SelectTrigger>
            <SelectContent>
              {options.map((month) => (
                <SelectItem key={month} value={month}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="pb-2 text-muted-foreground">–</span>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-end`} className="text-xs text-muted-foreground">
            {t('projectEnvs.periodEnd')}
          </Label>
          <Select
            value={value.end || undefined}
            onValueChange={(next) => onChange({ ...value, end: next })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-end`} className="w-[130px]">
              <SelectValue placeholder="YYYY.MM" />
            </SelectTrigger>
            <SelectContent>
              {options.map((month) => (
                <SelectItem key={month} value={month}>
                  {month}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {span !== null && (
          <span className="pb-2.5 text-xs text-muted-foreground">
            {t('projectEnvs.spanMonths', { count: span })}
          </span>
        )}
      </div>
      {violations.map((violation, index) => (
        <p
          key={`${violation.rule}-${index}`}
          className={cn(
            'text-xs',
            violation.severity === 'block'
              ? 'text-destructive'
              : 'text-warn'
          )}
        >
          {violationMessage(violation, t)}
        </p>
      ))}
    </div>
  )
}
