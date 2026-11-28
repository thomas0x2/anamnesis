import { describe, expect, it } from 'vitest'
import { newMaterial } from '../../src/shared/courseMap'
import { emptyPrep } from '../../src/shared/exam'
import { CourseGraph } from '../../src/shared/graph'
import { conceptOrder, MAX_REVIEWS, MIN_REVIEWS, rankConcepts, REVIEW_SHARE, reviewCap } from '../../src/shared/ordering'
import { planCourse, REVIEW_MIN } from '../../src/shared/scheduler'
import type { ConceptStatus, Course, CourseConcept, LearnerModel, Material } from '../../src/shared/types'
import { dayKey } from '../../src/shared/util'
import { NOW, at } from './helpers'

const concept = (id: string, requires: string[] = [], over: Partial<CourseConcept> = {}): CourseConcept => ({
  id,
  chapter: 1,
  title: id.toUpperCase(),
  de: '',
  summary: '',
  why: '',
  requires,
  pages: [],
  refs: [],
  demos: [],
  tier: 'core',
  ...over
})
const ex = (...materials: string[]): Partial<CourseConcept> => ({ exercises: materials.map((material, i) => ({ material, pages: [], label: String(i + 1) })) })
const set = (id: string, title: string, kind: Material['kind'] = 'exercises'): Material => ({ ...newMaterial({ path: `/c/${id}.pdf`, name: `${id}.pdf`, size: 1 }, id, '2026-11-01T00:00:00Z'), kind, title })

function learner(statuses: Record<string, ConceptStatus>, due: string[] = []): LearnerModel {
  const concepts: LearnerModel['concepts'] = {}
  for (const [id, status] of Object.entries(statuses))
    concepts[id] = {
      conceptId: id,
      status,
      fsrs: due.includes(id) ? { due: at(-1).toISOString(), lastReview: at(-5).toISOString(), stability: 2, difficulty: 5, reps: 1, lapses: 0, state: 'review' } : null,
      evidence: [],
      misconceptions: []
    } as unknown as LearnerModel['concepts'][string]
  return { profile: [], concepts }
}

describe('conceptOrder without exam work', () => {
  it('follows the course: refreshers last, core first, then chapter and map order', () => {
    const cs = [concept('r', [], { chapter: 0 }), concept('x', [], { chapter: 1, tier: 'extra' }), concept('b', [], { chapter: 2 }), concept('a', [], { chapter: 1 })]
    expect(conceptOrder(cs, learner({}))).toEqual(['a', 'b', 'x', 'r'])
  })

  it('offers a concept once its prerequisites are developing, and ignores prerequisites the map does not know', () => {
    const cs = [concept('a'), concept('b', ['a']), concept('c', ['gone'])]
    expect(conceptOrder(cs, learner({}))).toEqual(['a', 'c'])
    expect(conceptOrder(cs, learner({ a: 'developing' }))).toEqual(['b', 'c'])
  })
})

describe('conceptOrder with problem sets and mock exams', () => {
  // a and p are both ready. Only p leads to examined topics: q (Serie 1, the mock) and r (Serie 2, the mock)
  const cs = [concept('a'), concept('p', [], { chapter: 2 }), concept('q', ['p'], ex('s1', 'm1')), concept('r', ['p'], ex('s2', 'm1'))]
  const materials = [set('s1', 'Serie 1'), set('s2', 'Serie 2'), set('m1', 'Mock 2025', 'exam')]

  it('puts the concept the sets and mocks need first, ahead of the course order', () => {
    const ranked = rankConcepts(cs, learner({}), { materials, prep: emptyPrep() })
    expect(ranked.map((r) => r.concept.id)).toEqual(['p', 'a'])
    expect(ranked[0].value).toBe(4)
    expect(ranked[0].direct).toBe(false)
    expect(ranked[1].value).toBe(0)
  })

  it('prefers the concept that brings a set closest to solvable at equal value', () => {
    const two = [concept('a', [], ex('s1')), concept('b', [], ex('s2')), concept('c', [], ex('s2'))]
    const ranked = rankConcepts(two, learner({ c: 'introduced' }), { materials, prep: emptyPrep() })
    // a and b each lead to one topic and finish their set: course order; c (started, covered) leads to none
    expect(ranked.map((r) => r.concept.id)).toEqual(['a', 'b', 'c'])
    const three = [concept('a', [], ex('s1')), concept('a2', [], ex('s1')), concept('b', [], ex('s2'))]
    expect(conceptOrder(three, learner({}), { materials, prep: emptyPrep() })[0]).toBe('b')
  })

  it('gives the same order on the map, the Course tab and the study plan', () => {
    const course = { id: 'c', title: 'C', short: 'C', concepts: cs, chapters: [], exam: { format: '' } } as unknown as Course
    const g = new CourseGraph(course)
    const l = learner({})
    const prep = { ...emptyPrep(), examDate: dayKey(at(40)) }
    const plan = planCourse({ course, learner: l, materials, prep }, NOW, null)
    expect(g.frontier(l, { materials, prep })[0]).toBe('p')
    expect(plan.steps.find((s) => s.kind === 'learn')?.conceptId).toBe('p')
  })
})

describe('reviews', () => {
  it('caps a backlog to a share of the day while new material is left', () => {
    expect(reviewCap(40, { dailyMinutes: 120, minutesPerReview: REVIEW_MIN, newLeft: true })).toBe(Math.floor((REVIEW_SHARE * 120) / REVIEW_MIN) > MAX_REVIEWS ? MAX_REVIEWS : Math.floor((REVIEW_SHARE * 120) / REVIEW_MIN))
    expect(reviewCap(40, { dailyMinutes: 12, minutesPerReview: REVIEW_MIN, newLeft: true })).toBe(MIN_REVIEWS)
    expect(reviewCap(2, { dailyMinutes: 12, minutesPerReview: REVIEW_MIN, newLeft: true })).toBe(2)
    expect(reviewCap(40, { dailyMinutes: 12, minutesPerReview: REVIEW_MIN, newLeft: false })).toBe(MAX_REVIEWS)
    expect(reviewCap(40, { dailyMinutes: null, minutesPerReview: REVIEW_MIN, newLeft: true })).toBe(MAX_REVIEWS)
    expect(reviewCap(0, { dailyMinutes: 60, minutesPerReview: REVIEW_MIN, newLeft: true })).toBe(0)
  })

  it('keeps a review backlog from taking the plan over, and still suggests something new', () => {
    const cs = Array.from({ length: 12 }, (_, i) => concept(`k${i}`)).concat([concept('n')])
    const ids = cs.slice(0, 12).map((c) => c.id)
    const l = learner(Object.fromEntries(ids.map((id) => [id, 'proficient' as ConceptStatus])), ids)
    const course = { id: 'c', title: 'C', short: 'C', concepts: cs }
    // little daily time is needed for one new concept, so reviews get only a few slots
    const plan = planCourse({ course, learner: l, materials: [], prep: { ...emptyPrep(), examDate: dayKey(at(10)), problemSets: 0, mockExams: 0 } }, NOW, null)
    const review = plan.steps.find((s) => s.kind === 'review')!
    expect(plan.due).toBe(12)
    expect(review.title).toBe(`Review ${MIN_REVIEWS} concepts`)
    expect(review.why).toContain(`other ${12 - MIN_REVIEWS} due`)
    expect(plan.steps.find((s) => s.kind === 'learn')?.conceptId).toBe('n')
  })
})
