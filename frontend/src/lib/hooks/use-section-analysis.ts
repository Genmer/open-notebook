'use client'

import { useMutation } from '@tanstack/react-query'
import { sourceAnalysisApi, type SourceSectionAnalysisResponse } from '@/lib/api/source-analysis'
import { useToast } from '@/lib/hooks/use-toast'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getApiErrorKey } from '@/lib/utils/error-handler'

interface AnalyzeSectionArgs {
  sourceId: string
  sectionTitle: string
  sectionText: string
  pageStart?: number | null
  pageEnd?: number | null
}

/**
 * One section AI analysis per click. Strictly click-triggered — nothing here
 * fires on mount; `isPending` lets callers disable sibling buttons so a single
 * request is in flight at a time.
 */
export function useSectionAnalysis() {
  const { toast } = useToast()
  const { t, language } = useTranslation()

  return useMutation<SourceSectionAnalysisResponse, Error, AnalyzeSectionArgs>({
    mutationFn: ({ sourceId, sectionTitle, sectionText, pageStart, pageEnd }) =>
      sourceAnalysisApi.analyzeSection(sourceId, {
        section_title: sectionTitle,
        section_text: sectionText,
        page_start: pageStart ?? null,
        page_end: pageEnd ?? null,
        locale: language,
      }),
    onError: (error) => {
      toast({
        title: t('common.error'),
        description: getApiErrorKey(error, t('sources.fileView.analysisFailed')),
        variant: 'destructive',
      })
    },
  })
}
