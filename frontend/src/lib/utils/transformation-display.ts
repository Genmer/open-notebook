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

// Same for the preset descriptions, seeded as English DB rows
// (open_notebook/database/migrations/5.surrealql) and otherwise leaking
// untranslated English into non-English locales. Exact-match, verbatim
// fallback — user-edited descriptions are never rewritten.
const TRANSFORMATION_DESC_KEYS = new Map<string, string>([
  ['Analyses a technical/scientific paper', 'sources.transformationDescPaperAnalysis'],
  ['Extracts important insights and actionable items', 'sources.transformationDescKeyInsights'],
  ['Creates a rich, deep summary of the content', 'sources.transformationDescDenseSummary'],
  [
    'Generates reflection questions from the document to help explore it further',
    'sources.transformationDescReflectionQuestions',
  ],
  ['Describes the different topics of the document', 'sources.transformationDescTableOfContents'],
  ['Generates a small summary of the content', 'sources.transformationDescSimpleSummary'],
])

export function displayTransformationTitle(
  title: string | null | undefined,
  t: TFunction
): string | undefined {
  if (!title) return undefined
  const key = TRANSFORMATION_TITLE_KEYS.get(title)
  return key ? t(key) : title
}

export function displayTransformationDescription(
  description: string | null | undefined,
  t: TFunction
): string | undefined {
  if (!description) return undefined
  const key = TRANSFORMATION_DESC_KEYS.get(description)
  return key ? t(key) : description
}
