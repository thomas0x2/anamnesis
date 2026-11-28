// Course progress for the top bar: how much of the work towards the exam is done, as one share.
//
// It uses the plan's own model (src/shared/scheduler.ts), so the top bar and the Plan page never
// disagree: a course is its concepts (minutes to bring each to proficient, weighted by tier), its
// problem sets (the goal from Exam prep, or the sets in the course if there are more) and its mock
// exams, each timed as the plan times them. Progress is the part of that already done: a concept
// counts in part as soon as it is started and in full once proficient, a set or mock once it is done.
// Reviews are upkeep, not progress, so they are left out.
//
// The share can go down when a course grows (new lectures add concepts), which is honest. Milestones
// are kept per course, so one that was celebrated is never celebrated again after such a dip.
import { workItems, workState } from './exam'
import { DEFAULT_MOCK_MIN, DEFAULT_SET_MIN, LEARN_MIN, TIER_WEIGHT, typicalMinutes, type CourseSnapshot } from './scheduler'

export interface Progress {
  /** minutes of work done */
  done: number
  /** minutes of work in the course in all */
  total: number
  /** done / total, 0..1; null when the course has nothing to measure yet */
  share: number | null
  concepts: { total: number; proficient: number }
  sets: { done: number; total: number }
  mocks: { done: number; goal: number }
}

/** Shares (in %) worth a small celebration. */
export const MILESTONES = [10, 25, 50, 75, 100] as const

export function courseProgress(snap: CourseSnapshot): Progress {
  const { course, learner, materials, prep } = snap
  let done = 0
  let total = 0
  let proficient = 0
  for (const c of course.concepts) {
    const w = TIER_WEIGHT[c.tier] ?? 1
    const full = LEARN_MIN.unseen * w
    const left = LEARN_MIN[learner.concepts[c.id]?.status ?? 'unseen'] * w
    total += full
    done += full - (left ?? full)
    if ((left ?? full) === 0) proficient++
  }
  const { sets, mocks } = workItems(materials, prep)
  const setsDone = sets.filter((m) => workState(prep, m.id).done).length
  const mocksDone = mocks.filter((m) => workState(prep, m.id).done).length
  const setsTotal = Math.max(prep.problemSets ?? 0, sets.length)
  const mocksGoal = Math.max(prep.mockExams ?? 0, 0)
  const setMin = typicalMinutes(prep, sets, DEFAULT_SET_MIN)
  const mockMin = typicalMinutes(prep, mocks, DEFAULT_MOCK_MIN)
  total += setsTotal * setMin + mocksGoal * mockMin
  done += Math.min(setsDone, setsTotal) * setMin + Math.min(mocksDone, mocksGoal) * mockMin
  return {
    done,
    total,
    share: total > 0 ? Math.min(1, Math.max(0, done / total)) : null,
    concepts: { total: course.concepts.length, proficient },
    sets: { done: setsDone, total: setsTotal },
    mocks: { done: mocksDone, goal: mocksGoal }
  }
}

/** All courses together, weighted by how much work each holds (a big course counts for more). */
export function overallProgress(list: Progress[]): { done: number; total: number; share: number | null; courses: number } {
  const counted = list.filter((p) => p.total > 0)
  const done = counted.reduce((s, p) => s + p.done, 0)
  const total = counted.reduce((s, p) => s + p.total, 0)
  return { done, total, share: total > 0 ? Math.min(1, done / total) : null, courses: counted.length }
}

/** The share as a whole percent for display; never shows 100 before everything is done. */
export function percent(share: number | null): number | null {
  if (share === null) return null
  const p = Math.floor(share * 100 + 1e-9)
  return share >= 1 ? 100 : Math.min(99, p)
}

/** The highest milestone at or below a percent; 0 below the first. */
export function milestoneAt(pct: number | null): number {
  if (pct === null) return 0
  let m = 0
  for (const x of MILESTONES) if (pct >= x) m = x
  return m
}

/**
 * The milestone to celebrate now, if any: the highest one reached that is above the best celebrated
 * before. Without a record (first time the course is seen) nothing is celebrated: the record just starts
 * where the learner is, so opening the app on a course already at 60% does not throw a party.
 */
export function newMilestone(best: number | undefined, pct: number | null): number | null {
  if (best === undefined) return null
  const m = milestoneAt(pct)
  return m > best ? m : null
}

/** A short line for a milestone, for the toast. */
export function milestoneLine(m: number, name: string): string {
  switch (m) {
    case 10:
      return `${name}: the first 10% is done. Good start.`
    case 25:
      return `${name}: a quarter of the way there.`
    case 50:
      return `${name}: halfway there.`
    case 75:
      return `${name}: three quarters done. The end is in sight.`
    case 100:
      return `${name}: everything in the plan is done. Reviews keep it fresh.`
    default:
      return `${name}: ${m}% done.`
  }
}
