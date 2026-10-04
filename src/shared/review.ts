/**
 * Unified Review workspace: Changes, Tasks and Audit share one project tab
 * with internal sections. Legacy tab ids (`changes` / `tasks` / `audit`) still
 * resolve here so bookmarks, palette items and stored UI state keep working.
 */
import { MODULES, isModuleEnabled } from './modules'

export const REVIEW_SECTIONS = ['overview', 'changes', 'tasks', 'audit'] as const
export type ReviewSection = (typeof REVIEW_SECTIONS)[number]

/** Nested feature modules that live under the Review tab when grouping is on. */
export const REVIEW_NESTED_IDS = ['changes', 'tasks', 'audit'] as const
export type ReviewNestedId = (typeof REVIEW_NESTED_IDS)[number]

export function isReviewNestedId(id: string): id is ReviewNestedId {
  return (REVIEW_NESTED_IDS as readonly string[]).includes(id)
}

export function isReviewSection(id: string): id is ReviewSection {
  return (REVIEW_SECTIONS as readonly string[]).includes(id)
}

/** `review` → overview; `review:changes` → changes; anything else → null. */
export function parseReviewTab(tab: string): ReviewSection | null {
  if (tab === 'review') return 'overview'
  if (tab.startsWith('review:')) {
    const section = tab.slice('review:'.length)
    return isReviewSection(section) ? section : 'overview'
  }
  return null
}

export function reviewTabFor(section: ReviewSection): string {
  return section === 'overview' ? 'review' : `review:${section}`
}

/** True when the Review tab should replace Changes/Tasks/Audit in the project strip. */
export function isReviewGrouped(enabled: Record<string, boolean>): boolean {
  const review = MODULES.find((m) => m.id === 'review')
  if (!review || !isModuleEnabled(review, enabled)) return false
  return REVIEW_NESTED_IDS.some((id) => {
    const m = MODULES.find((x) => x.id === id)
    return !!m && isModuleEnabled(m, enabled)
  })
}

/**
 * When Review grouping is enabled, map legacy / nested ids onto `review…`.
 * When disabled, expand `review:…` back to the nested module tab id.
 */
export function canonicalizeProjectTab(tab: string, reviewGrouped: boolean): string {
  if (reviewGrouped) {
    if (isReviewNestedId(tab)) return reviewTabFor(tab)
    return tab
  }
  const section = parseReviewTab(tab)
  if (!section) return tab
  if (section === 'overview') return 'changes'
  return section
}
