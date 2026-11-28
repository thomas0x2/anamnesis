import { describe, expect, it } from 'vitest'
import { newMaterial } from '../../src/shared/courseMap'
import { emptyPrep } from '../../src/shared/exam'
import { courseProgress, milestoneAt, milestoneLine, newMilestone, overallProgress, percent } from '../../src/shared/progress'
import { DEFAULT_MOCK_MIN, DEFAULT_SET_MIN, LEARN_MIN, planCourse, type CourseSnapshot } from '../../src/shared/scheduler'
import type { ConceptStatus, CourseConcept, ExamPrep, LearnerModel, Material, Submission } from '../../src/shared/types'
import { NOW } from './helpers'

const concept = (id: string, over: Partial<CourseConcept> = {}): CourseConcept =>
  ({ id, chapter: 1, title: id, de: '', summary: '', why: '', requires: [], pages: [], refs: [], demos: [], tier: 'core', ...over }) as CourseConcept

const set = (id: string, kind: Material['kind'] = 'exercises'): Material => ({ ...newMaterial({ path: `/c/${id}.pdf`, name: `${id}.pdf`, size: 1 }, id, '2026-11-01T00:00:00Z'), kind, title: id })

function learner(statuses: Record<string, ConceptStatus>): LearnerModel {
  const concepts: LearnerModel['concepts'] = {}
  for (const [id, status] of Object.entries(statuses)) concepts[id] = { conceptId: id, status, fsrs: null, evidence: [] } as unknown as LearnerModel['concepts'][string]
  return { profile: [], concepts }
}

const done = (materialId: string): Submission =>
  ({ id: `w_${materialId}`, materialId, at: NOW.toISOString(), files: [], text: null, help: 'alone', examConditions: false, minutes: null, status: 'graded', error: null, score: 1, summary: null, tasks: [], strengths: [], next: [], gradedAt: NOW.toISOString(), applied: true }) as Submission

function snap(over: { concepts?: CourseConcept[]; learner?: LearnerModel; materials?: Material[]; prep?: Partial<ExamPrep> } = {}): CourseSnapshot {
  return {
    course: { id: 'c1', title: 'Course', short: 'C1', concepts: over.concepts ?? [concept('a'), concept('b'), concept('c')] },
    learner: over.learner ?? learner({}),
    materials: over.materials ?? [],
    prep: { ...emptyPrep(), mockExams: 0, ...over.prep }
  }
}

describe('courseProgress', () => {
  it('starts at zero and is complete once every concept is proficient and every set and mock is done', () => {
    expect(courseProgress(snap()).share).toBe(0)
    const all = courseProgress(snap({ learner: learner({ a: 'proficient', b: 'mastered', c: 'proficient' }), materials: [set('s1'), set('m1', 'exam')], prep: { problemSets: 1, mockExams: 1, submissions: [done('s1'), done('m1')] } }))
    expect(all.share).toBe(1)
    expect(all.concepts.proficient).toBe(3)
  })

  it('counts a started concept in part, so it moves while learning', () => {
    const intro = courseProgress(snap({ learner: learner({ a: 'introduced' }) })).share as number
    const dev = courseProgress(snap({ learner: learner({ a: 'developing' }) })).share as number
    const prof = courseProgress(snap({ learner: learner({ a: 'proficient' }) })).share as number
    expect(intro).toBeGreaterThan(0)
    expect(dev).toBeGreaterThan(intro)
    expect(prof).toBeCloseTo(1 / 3)
  })

  it('weighs sets and mocks the way the plan times them, against the goal from Exam prep', () => {
    const p = courseProgress(snap({ materials: [set('s1')], prep: { problemSets: 4, mockExams: 2, submissions: [done('s1')] } }))
    const total = 3 * LEARN_MIN.unseen + 4 * DEFAULT_SET_MIN + 2 * DEFAULT_MOCK_MIN
    expect(p.total).toBe(total)
    expect(p.done).toBe(DEFAULT_SET_MIN)
    expect(p.sets).toEqual({ done: 1, total: 4 })
  })

  it('done plus what the plan says is left is the whole course', () => {
    const s = snap({ learner: learner({ a: 'developing', b: 'proficient' }), materials: [set('s1'), set('s2')], prep: { problemSets: 3, mockExams: 1, submissions: [done('s2')] } })
    const p = courseProgress(s)
    const plan = planCourse(s, NOW, null)
    expect(p.done + plan.left.learn + plan.left.sets + plan.left.mocks).toBeCloseTo(p.total, 0)
  })

  it('has nothing to show for an empty course', () => {
    expect(courseProgress(snap({ concepts: [] })).share).toBeNull()
  })
})

describe('overallProgress', () => {
  it('weighs each course by the work it holds and skips empty ones', () => {
    const a = courseProgress(snap({ learner: learner({ a: 'proficient', b: 'proficient', c: 'proficient' }) }))
    const b = courseProgress(snap({ concepts: [concept('x'), concept('y'), concept('z')] }))
    const empty = courseProgress(snap({ concepts: [] }))
    const all = overallProgress([a, b, empty])
    expect(all.share).toBeCloseTo(0.5)
    expect(all.courses).toBe(2)
    expect(overallProgress([empty]).share).toBeNull()
  })
})

describe('milestones', () => {
  it('shows whole percents and never 100 before everything is done', () => {
    expect(percent(0.999)).toBe(99)
    expect(percent(1)).toBe(100)
    expect(percent(0.257)).toBe(25)
    expect(percent(null)).toBeNull()
  })

  it('celebrates the highest new milestone once, and nothing the first time a course is seen', () => {
    expect(milestoneAt(9)).toBe(0)
    expect(milestoneAt(52)).toBe(50)
    expect(newMilestone(undefined, 60)).toBeNull()
    expect(newMilestone(25, 49)).toBeNull()
    expect(newMilestone(25, 50)).toBe(50)
    expect(newMilestone(25, 80)).toBe(75)
    expect(newMilestone(50, 50)).toBeNull()
    expect(newMilestone(75, 40)).toBeNull()
    expect(newMilestone(75, 100)).toBe(100)
  })

  it('has a line for each milestone', () => {
    expect(milestoneLine(50, 'SPCA')).toBe('SPCA: halfway there.')
  })
})
