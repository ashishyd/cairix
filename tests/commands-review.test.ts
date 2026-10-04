import { describe, expect, it } from 'vitest'
import { COMMANDS, comboProblem, effectiveBindings } from '../src/shared/keybindings'
import { canonicalizeProjectTab, isReviewGrouped, reviewTabFor } from '../src/shared/review'

const REVIEW_IDS = [
  'nav.plugins',
  'project.scripts',
  'project.review',
  'project.changes',
  'project.tasks',
  'project.audit',
  'review.section.next',
  'review.section.prev',
  'review.ai',
  'tasks.new'
]

describe('review / AI shortcuts', () => {
  it('registers the new Review and project commands', () => {
    for (const id of REVIEW_IDS) {
      expect(COMMANDS.find((c) => c.id === id), id).toBeTruthy()
    }
  })

  it('keeps every default binding valid and unique', () => {
    const bindings = effectiveBindings({})
    const seen = new Set<string>()
    for (const c of COMMANDS) {
      expect(comboProblem(c.default), c.id).toBeNull()
      expect(seen.has(bindings[c.id]), `duplicate default ${bindings[c.id]} on ${c.id}`).toBe(false)
      seen.add(bindings[c.id])
    }
  })

  it('project.* shortcuts land on Review sections when grouping is on', () => {
    expect(isReviewGrouped({})).toBe(true)
    expect(canonicalizeProjectTab('changes', true)).toBe(reviewTabFor('changes'))
    expect(canonicalizeProjectTab('tasks', true)).toBe(reviewTabFor('tasks'))
    expect(canonicalizeProjectTab('audit', true)).toBe(reviewTabFor('audit'))
    expect(canonicalizeProjectTab('review', true)).toBe('review')
  })
})
