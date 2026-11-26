import { describe, expect, it } from 'vitest'
import { emptyPrep } from '../../src/shared/exam'
import { daysTo, dueSoon, overviewTotals, whenLabel } from '../../src/shared/overview'
import { studyPlan, type CourseSnapshot } from '../../src/shared/scheduler'
import type { ExamPrep, OnlineTask } from '../../src/shared/types'
import { dayKey } from '../../src/shared/util'
import { NOW, at } from './helpers'

const task = (id: string, due: string | null): OnlineTask => ({
  id,
  kind: 'exercises',
  title: `Serie ${id}`,
  platform: 'Code Expert',
  url: null,
  conceptIds: [],
  statement: null,
  addedAt: NOW.toISOString(),
  codeExpert: { seriesId: id, due, tasks: [] }
})

function snap(id: string, prep: Partial<ExamPrep> = {}): CourseSnapshot {
  return {
    course: { id, title: `Course ${id}`, short: id.toUpperCase(), concepts: [] },
    learner: { profile: [], concepts: {} },
    materials: [],
    prep: { ...emptyPrep(), ...prep }
  }
}

describe('daysTo', () => {
  it('counts local calendar days', () => {
    expect(daysTo(new Date(2026, 10, 20, 23, 59).toISOString(), NOW)).toBe(0)
    expect(daysTo(new Date(2026, 10, 21, 0, 1).toISOString(), NOW)).toBe(1)
    expect(daysTo(at(-3).toISOString(), NOW)).toBe(-3)
    expect(daysTo('nonsense', NOW)).toBeNaN()
  })
})

describe('dueSoon', () => {
  it('lists open deadlines, near exams and reviews across courses, soonest first', () => {
    const snaps = [
      snap('a', { online: [task('ot_1', at(3).toISOString()), task('ot_2', at(30).toISOString()), task('ot_3', null)] }),
      snap('b', { examDate: dayKey(at(10)), online: [task('ot_4', at(1).toISOString())] }),
      snap('c', { examDate: dayKey(at(60)) })
    ]
    const plan = studyPlan(snaps, NOW, null)
    const items = dueSoon(snaps, plan.courses, NOW)
    expect(items.map((d) => `${d.kind}:${d.courseId}:${d.days}`)).toEqual(['deadline:b:1', 'deadline:a:3', 'exam:b:10'])
  })

  it('leaves out done sets and keeps overdue ones for a week', () => {
    const snaps = [
      snap('a', {
        online: [task('ot_1', at(2).toISOString()), task('ot_2', at(-2).toISOString()), task('ot_3', at(-9).toISOString())],
        records: { ot_1: { status: 'done', doneAt: NOW.toISOString() } }
      })
    ]
    const items = dueSoon(snaps, studyPlan(snaps, NOW, null).courses, NOW)
    expect(items.map((d) => d.materialId)).toEqual(['ot_2'])
    expect(items[0].days).toBe(-2)
  })
})

describe('overviewTotals', () => {
  it('sums reviews and finds the nearest exam ahead', () => {
    const snaps = [snap('a', { examDate: dayKey(at(-1)) }), snap('b', { examDate: dayKey(at(20)) }), snap('c', { examDate: dayKey(at(12)) })]
    const t = overviewTotals(studyPlan(snaps, NOW, null).courses)
    expect(t.due).toBe(0)
    expect(t.nextExam).toEqual({ id: 'c', short: 'C', days: 12 })
  })
})

describe('whenLabel', () => {
  it('says it plainly', () => {
    expect([0, 1, -1, 4, -3].map(whenLabel)).toEqual(['today', 'tomorrow', 'yesterday', 'in 4 days', '3 days ago'])
  })
})
