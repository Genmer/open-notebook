import type { TFunction } from 'i18next'

// Preset transformations ship as DB rows with English titles; this maps an
// exact title to its i18n key so the UI can show a localized label. User-created
// transformations are not in the map and render verbatim.
const TRANSFORMATION_TITLE_KEYS = new Map<string, string>([
  ['Dense Summary', 'sources.transformationTitleDenseSummary'],
  ['Paper Analysis', 'sources.transformationTitlePaperAnalysis'],
  ['Reflection Questions', 'sources.transformationTitleReflectionQuestions'],
  ['Simple Summary', 'sources.transformationTitleSimpleSummary'],
  ['Table of Contents', 'sources.transformationTitleTableOfContents'],
  ['Key Insights', 'sources.transformationTitleKeyInsights'],
])

export function displayTransformationTitle(
  title: string | null | undefined,
  t: TFunction
): string | undefined {
  if (!title) return undefined
  const key = TRANSFORMATION_TITLE_KEYS.get(title)
  return key ? t(key) : title
}
