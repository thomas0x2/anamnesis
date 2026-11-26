import { describe, expect, it } from 'vitest'
import { newMaterial } from '../../src/shared/courseMap'
import { emptyPrep } from '../../src/shared/exam'
import { BUFFER_DAYS, DEFAULT_SET_MIN, fmtDuration, LEARN_MIN, planCourse, planSets, studyPlan, typicalMinutes, type CourseSnapshot } from '../../src/shared/scheduler'
import type { ConceptStatus, CourseConcept, ExamPrep, LearnerModel, Material, Submission } from '../../src/shared/types'
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

const set = (id: string, title: string, kind: Material['kind'] = 'exercises'): Material => ({ ...newMaterial({ path: `/c/${id}.pdf`, name: `${id}.pdf`, size: 1 }, id, '2026-11-01T00:00:00Z'), kind, title })

function learner(statuses: Record<string, ConceptStatus>): LearnerModel {
  const concepts: LearnerModel['concepts'] = {}
  for (const [id, status] of Object.entries(statuses)) concepts[id] = { conceptId: id, status, fsrs: null, evidence: [] } as unknown as LearnerModel['concepts'][string]
  return { profile: [], concepts }
}

const iso = (d: Date): string => dayKey(d)

function snap(over: { id?: string; concepts?: CourseConcept[]; learner?: LearnerModel; materials?: Material[]; prep?: Partial<ExamPrep> } = {}): CourseSnapshot {
  const id = over.id ?? 'c1'
  return {
    course: { id, title: `Course ${id}`, short: id.toUpperCase(), concepts: over.concepts ?? [concept('a'), concept('b', ['a']), concept('c', ['b'])] },
    learner: over.learner ?? learner({}),
    materials: over.materials ?? [],
    prep: { ...emptyPrep(), ...over.prep }
  }
}

const done = (materialId: string, minutes: number | null = null): Submission =>
  ({ id: `w_${materialId}`, materialId, at: NOW.toISOString(), files: [], text: null, help: 'alone', examConditions: false, minutes, status: 'graded', error: null, score: 1, summary: null, tasks: [], strengths: [], next: [], gradedAt: NOW.toISOString(), applied: true }) as Submission

describe('planCourse', () => {
  it('needs the work left divided by the days until a week before the exam', () => {
    const p = planCourse(snap({ prep: { examDate: iso(at(37)), problemSets: 4, mockExams: 2 } }), NOW, null)
    expect(p.workDays).toBe(37 - BUFFER_DAYS)
    expect(p.left.learn).toBe(3 * LEARN_MIN.unseen)
    expect(p.left.sets).toBe(4 * DEFAULT_SET_MIN)
    expect(p.perDay).toBeCloseTo(p.left.total / 30)
    expect(p.pace).toBe('unknown')
  })

  it('is not scheduled without an exam date and asks for one first', () => {
    const p = planCourse(snap(), NOW, null)
    expect(p.perDay).toBeNull()
    expect(p.pace).toBe('no-date')
    expect(p.steps[0].kind).toBe('date')
  })

  it('counts started concepts and support material for less', () => {
    const full = planCourse(snap({ prep: { examDate: iso(at(40)) } }), NOW, null).left.learn
    const started = planCourse(snap({ learner: learner({ a: 'developing', b: 'introduced' }), prep: { examDate: iso(at(40)) } }), NOW, null).left.learn
    expect(started).toBe(LEARN_MIN.developing + LEARN_MIN.introduced + LEARN_MIN.unseen)
    const support = planCourse(snap({ concepts: [concept('a', [], { tier: 'support' })], prep: { examDate: iso(at(40)) } }), NOW, null).left.learn
    expect(support).toBeLessThan(full / 3)
  })

  it('uses the minutes the learner logged for problem sets', () => {
    const s1 = set('s1', 'Serie 1')
    const s2 = set('s2', 'Serie 2')
    const prep = { ...emptyPrep(), submissions: [done('s1', 60), done('s2', 90)] }
    expect(typicalMinutes(prep, [s1, s2], DEFAULT_SET_MIN)).toBe(75)
    expect(typicalMinutes(emptyPrep(), [s1], DEFAULT_SET_MIN)).toBe(DEFAULT_SET_MIN)
  })

  it('compares the recent pace from the study log and subtracts what was studied today', () => {
    const days: Record<string, Record<string, { tutor: number; other: number }>> = {}
    for (let i = 1; i <= 7; i++) days[iso(at(-i))] = { c1: { tutor: 3600, other: 0 } }
    days[iso(NOW)] = { c1: { tutor: 1200, other: 0 } }
    const p = planCourse(snap({ prep: { examDate: iso(at(37)) } }), NOW, days)
    expect(p.recentPerDay).toBeCloseTo(60)
    expect(p.studiedToday).toBeCloseTo(20)
    expect(p.todayLeft).toBeCloseTo(Math.max(0, (p.perDay ?? 0) - 20))
    expect(p.pace).toBe('on-track')
  })
})

describe('planSets', () => {
  // Serie 1 practises a, b (both covered); Serie 2 practises b, c (c new); Serie 3 practises d (nothing covered)
  const concepts = [
    concept('a', [], { exercises: [{ material: 's1', pages: [], label: '1' }] }),
    concept('b', ['a'], { exercises: [{ material: 's1', pages: [], label: '2' }, { material: 's2', pages: [], label: '1' }] }),
    concept('c', ['b'], { exercises: [{ material: 's2', pages: [], label: '2' }] }),
    concept('d', ['c'], { exercises: [{ material: 's3', pages: [], label: '1' }] })
  ]
  const materials = [set('s3', 'Serie 3'), set('s1', 'Serie 1'), set('s2', 'Serie 2')]
  const l = learner({ a: 'proficient', b: 'developing' })

  it('marks the sets whose topics are all covered as solvable and names what the others miss', () => {
    const out = planSets(snap({ concepts, materials, learner: l }))
    expect(out.map((s) => [s.material.title, s.readiness])).toEqual([
      ['Serie 1', 'solvable'],
      ['Serie 2', 'partial'],
      ['Serie 3', 'partial']
    ])
    expect(out[1].missing).toEqual(['c'])
    expect(out[1].missingTitles).toEqual(['C'])
    expect(out[1].covered).toBeCloseTo(0.5)
  })

  it('counts a topic as covered once it is started', () => {
    const out = planSets(snap({ concepts, materials, learner: learner({ a: 'introduced', b: 'introduced', c: 'introduced' }) }))
    expect(out.filter((s) => s.readiness === 'solvable').map((s) => s.material.id)).toEqual(['s1', 's2'])
  })

  it('leaves out sets that are done', () => {
    const out = planSets(snap({ concepts, materials, learner: l, prep: { submissions: [done('s1')] } }))
    expect(out.map((s) => s.material.id)).toEqual(['s2', 's3'])
  })

  it('suggests learning the topic that brings a set closest to solvable, and never schedules sets', () => {
    const p = planCourse(snap({ concepts, materials, learner: l, prep: { examDate: iso(at(60)), problemSets: 3 } }), NOW, null)
    expect(p.steps.map((s) => s.kind)).toEqual(['learn'])
    expect(p.steps[0].conceptId).toBe('c')
    expect(p.steps[0].why).toContain('Serie 2')
    expect(p.sets.ready).toBe(1)
  })

  it('reaches a missing topic through its prerequisites', () => {
    // Serie 3 needs d, which requires c (unseen): learn c first
    const only3 = [set('s3', 'Serie 3')]
    const p = planCourse(snap({ concepts, materials: only3, learner: l, prep: { examDate: iso(at(60)) } }), NOW, null)
    expect(p.steps[0].conceptId).toBe('c')
    expect(p.steps[0].why).toContain('Serie 3 needs D')
  })

  it('splits the daily time into learning, problem sets and mock exams', () => {
    const p = planCourse(snap({ concepts, materials, learner: l, prep: { examDate: iso(at(37)), problemSets: 3, mockExams: 2 } }), NOW, null)
    const parts = p.perDayParts!
    expect(parts.learn + parts.sets + parts.mocks).toBeCloseTo(p.perDay!)
    expect(parts.sets).toBeCloseTo((3 * DEFAULT_SET_MIN) / 30)
  })
})

describe('studyPlan', () => {
  it('puts the course with more of today open first and sums the daily need', () => {
    const near = snap({ id: 'near', prep: { examDate: iso(at(20)), problemSets: 6 } })
    const far = snap({ id: 'far', prep: { examDate: iso(at(70)), problemSets: 6 } })
    const none = snap({ id: 'none' })
    const plan = studyPlan([far, none, near], NOW)
    expect(plan.courses.map((c) => c.id)).toEqual(['near', 'far', 'none'])
    expect(plan.perDay).toBeCloseTo((plan.courses[0].perDay ?? 0) + (plan.courses[1].perDay ?? 0))
    expect(plan.hasLog).toBe(false)
  })

  it('moves a course down once its share for today is studied', () => {
    const a = snap({ id: 'a', prep: { examDate: iso(at(40)), problemSets: 8 } })
    const b = snap({ id: 'b', prep: { examDate: iso(at(40)), problemSets: 6 } })
    const before = studyPlan([a, b], NOW)
    expect(before.courses[0].id).toBe('a')
    const log = { days: { [iso(NOW)]: { a: { tutor: 6 * 3600, other: 0 } } } }
    const after = studyPlan([a, b], NOW, log)
    expect(after.courses[0].id).toBe('b')
    expect(after.courses[1].todayLeft).toBe(0)
  })

  it('survives a damaged study log', () => {
    expect(() => studyPlan([snap({ prep: { examDate: iso(at(10)) } })], NOW, { days: 'x' })).not.toThrow()
    expect(studyPlan([snap()], NOW, 42).hasLog).toBe(false)
  })
})

describe('fmtDuration', () => {
  it('rounds to 5 minutes, then quarter hours', () => {
    expect(fmtDuration(12)).toBe('10 min')
    expect(fmtDuration(2)).toBe('5 min')
    expect(fmtDuration(97)).toBe('1 h 30 min')
    expect(fmtDuration(181)).toBe('3 h')
  })
})
