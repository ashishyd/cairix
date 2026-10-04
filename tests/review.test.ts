import { describe, expect, it } from 'vitest'
import {
  canonicalizeProjectTab,
  isReviewGrouped,
  parseReviewTab,
  reviewTabFor
} from '../src/shared/review'

describe('review tab routing', () => {
  it('maps overview and nested sections to tab ids', () => {
    expect(reviewTabFor('overview')).toBe('review')
    expect(reviewTabFor('changes')).toBe('review:changes')
    expect(parseReviewTab('review')).toBe('overview')
    expect(parseReviewTab('review:tasks')).toBe('tasks')
    expect(parseReviewTab('scripts')).toBeNull()
  })

  it('canonicalizes legacy tabs when Review is grouped', () => {
    expect(canonicalizeProjectTab('changes', true)).toBe('review:changes')
    expect(canonicalizeProjectTab('tasks', true)).toBe('review:tasks')
    expect(canonicalizeProjectTab('audit', true)).toBe('review:audit')
    expect(canonicalizeProjectTab('scripts', true)).toBe('scripts')
  })

  it('expands review tabs when grouping is off', () => {
    expect(canonicalizeProjectTab('review', false)).toBe('changes')
    expect(canonicalizeProjectTab('review:audit', false)).toBe('audit')
    expect(canonicalizeProjectTab('scripts', false)).toBe('scripts')
  })

  it('groups when Review and at least one nested module are enabled', () => {
    expect(isReviewGrouped({})).toBe(true)
    expect(isReviewGrouped({ review: false })).toBe(false)
    expect(isReviewGrouped({ changes: false, tasks: false, audit: false })).toBe(false)
    expect(isReviewGrouped({ changes: false, tasks: true, audit: false })).toBe(true)
  })
})
