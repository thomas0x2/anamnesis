// The study plan across courses: which course to work on next, about how long each day to stay on
// track for every exam, and what to do in each (reviews that are due, the problem sets whose topics
// the learner has already covered, the concepts that unlock the next ones, mock exams near the end).
//
// The model is deliberately simple and explained in the app, so the learner can trust or overrule it:
// - What is left in a course is an estimate in minutes: learning each concept of the map that is not yet
//   proficient (less for concepts already started, less for support and extra concepts), the reviews
//   due now, and the problem sets and mock exams still to do against the goal set in Exam prep (timed
//   from the learner's own logged minutes when there are some).
// - That work should be done a little before the exam (a buffer for revision), so each course needs
//   left ÷ days-to-buffer minutes a day. The sum over courses is the daily study time to stay on track.
// - The order for today: the course with the most of its daily share still open goes first (time studied
//   today counts, from the study time log when there is one); a course well behind its recent pace, or
//   with an earlier exam, moves up.
// - Blocks: once the learner has started on a course, it stays first for a block of at least
//   `blockMin` minutes (90 by default, a setting), even when another course has become a little more
//   urgent. Without this, studying one course lowers what it still needs today, the other course
//   moves up, and the plan flips between courses with similar shares. Switching subjects costs: each
//   switch needs a warm-up (Monsell 2003) and part of the attention stays on the last task (attention
//   residue, Leroy 2009), while the benefit of interleaving comes from mixing similar problem types
//   within one subject, which practice already does (Brunmair and Richter 2019). Courses are spaced
//   across blocks and days instead. See docs/LEARNING_SCIENCE.md, "Course blocks". After the minimum,
//   the block goes on while its course is still about as urgent as the next one (hysteresis: the
//   other must lead by SWITCH_MARGIN), and the plan suggests switching at the next break once it
//   clearly leads or the course's share for today is done. The learner can always switch themselves.
// It only knows what is in the app: concepts from lectures that are not out yet add to the estimate
// once their materials are added.
import { daysUntil, workItems, workState } from './exam'
import { statusRank } from './mastery'
import { openWork, rankConcepts, reviewCap } from './ordering'
import { dueConcepts } from './selection'
import type { ConceptStatus, ConceptTier, Course, CourseConcept, ExamPrep, LearnerModel, Material } from './types'

export { isCovered } from './ordering'
import { liveBlock, normalizeBlock, type FocusBlock } from './studyTime'
import { clamp, dayKey } from './util'

/** Minutes to bring a concept from its status to proficient (learn, practise, check). */
export const LEARN_MIN: Record<ConceptStatus, number> = { unseen: 30, introduced: 20, developing: 12, proficient: 0, mastered: 0 }
/** Support and extra concepts take less of the learner's time than core ones. */
export const TIER_WEIGHT: Record<ConceptTier, number> = { core: 1, support: 0.6, extra: 0.25 }
/** One review of a due concept. */
export const REVIEW_MIN = 1.5
/** A problem set and a mock exam, until the learner has logged their own times. */
export const DEFAULT_SET_MIN = 120
export const DEFAULT_MOCK_MIN = 180
/** Days before the exam that are kept for revision: the plan aims to finish the rest by then. */
export const BUFFER_DAYS = 7
/** The default minimum block on one course, in minutes. */
export const BLOCK_MIN = 90
/** After the minimum, another course takes over only when its priority is this much higher. */
export const SWITCH_MARGIN = 1.3

export interface CourseSnapshot {
  course: Pick<Course, 'id' | 'title' | 'short' | 'concepts'>
  learner: LearnerModel
  materials: Material[]
  prep: ExamPrep
}

/** Seconds studied per day and course (the study time log: day → course id → {tutor, other}). */
export type StudyDays = Record<string, Record<string, { tutor?: number; other?: number }>>

/** solvable: every topic it practises is covered; partial: some are not yet; unlinked: the map does not say what it practises */
export type Readiness = 'solvable' | 'partial' | 'unlinked'

export interface SetPlan {
  material: Material
  kind: 'exercises' | 'exam'
  /** 0..1, the share of the topics it practises that the learner has covered; null when it is not linked to concepts */
  covered: number | null
  readiness: Readiness
  /** concepts it practises that are not covered yet, in course order */
  missing: string[]
  missingTitles: string[]
  conceptCount: number
}

export type StepKind = 'review' | 'learn' | 'date'

export interface PlanStep {
  kind: StepKind
  /** short, for the list */
  title: string
  /** why this step, one sentence */
  why: string
  minutes: number | null
  materialId?: string
  conceptId?: string
  /** concepts to learn first (for a set that is almost ready) */
  conceptIds?: string[]
}

export type PaceStatus = 'no-date' | 'over' | 'done' | 'on-track' | 'behind' | 'unknown'

export interface CoursePlan {
  id: string
  title: string
  short: string
  examDate: string | null
  daysLeft: number | null
  /** days left to do the work (until the revision buffer) */
  workDays: number | null
  concepts: { total: number; covered: number; proficient: number }
  /** ready: problem sets not done yet whose topics are all covered */
  sets: { done: number; total: number; ready: number }
  mocks: { done: number; goal: number }
  due: number
  /** what is left, in minutes */
  left: { learn: number; review: number; sets: number; mocks: number; total: number }
  setMinutes: number
  mockMinutes: number
  /** minutes a day this course needs to finish by the buffer; null without an exam date */
  perDay: number | null
  /** perDay split into in-app learning (incl. reviews), problem sets and mock exams */
  perDayParts: DayParts | null
  /** average minutes a day spent on it over the last week, from the study log; null without a log */
  recentPerDay: number | null
  studiedToday: number
  /** minutes still to do today (perDay minus what was studied today) */
  todayLeft: number
  pace: PaceStatus
  /** higher goes first */
  priority: number
  sets_: SetPlan[]
  steps: PlanStep[]
}

export interface DayParts {
  learn: number
  sets: number
  mocks: number
}

export interface StudyPlan {
  courses: CoursePlan[]
  /** minutes a day across all courses with an exam date */
  perDay: number
  perDayParts: DayParts
  /** what is left of that today */
  todayLeft: number
  studiedToday: number
  /** average minutes a day over the last two weeks across all courses; null without a log */
  recentPerDay: number | null
  hasLog: boolean
  /** the course block running now, when it is on a scheduled course; null otherwise */
  focus: Focus | null
}

/**
 * The block on one course that is running now.
 * hold: under the minimum, the course stays first whatever else moved up;
 * extend: past the minimum, but no other course clearly leads, so it stays first;
 * switch: past the minimum and another course clearly leads (or this one's share for today is done):
 * the plan suggests moving on at the next break.
 */
export interface Focus {
  courseId: string
  short: string
  state: 'hold' | 'extend' | 'switch'
  /** minutes studied in the block */
  minutes: number
  /** the minimum block */
  target: number
  /** the course the plan would pick without the block (the one to switch to); null when none */
  nextId: string | null
}

export interface PlanOptions {
  /** minimum block on one course in minutes; 0 turns blocks off (default BLOCK_MIN) */
  blockMin?: number
}

const conceptWeight = (c: CourseConcept): number => TIER_WEIGHT[c.tier] ?? 1
const rankOf = (learner: LearnerModel, id: string): number => statusRank(learner.concepts[id]?.status ?? 'unseen')

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The learner's own time for a set or mock, from the minutes they logged; the default until there are some. */
export function typicalMinutes(prep: ExamPrep, items: Material[], fallback: number): number {
  const ids = new Set(items.map((m) => m.id))
  const mins = prep.submissions.filter((s) => ids.has(s.materialId) && s.minutes && s.minutes > 0).map((s) => s.minutes as number)
  const med = median(mins)
  return med ? clamp(Math.round(med), 15, 600) : fallback
}

/** Seconds studied in a course on the given local days. */
function secondsOn(days: StudyDays | null, courseId: string, keys: string[]): number {
  if (!days) return 0
  let s = 0
  for (const k of keys) {
    const t = days[k]?.[courseId]
    if (t) s += (Number(t.tutor) || 0) + (Number(t.other) || 0)
  }
  return s
}

function lastDays(now: Date, n: number, skipToday: boolean): string[] {
  const out: string[] = []
  for (let i = skipToday ? 1 : 0; i < n + (skipToday ? 1 : 0); i++) out.push(dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i, 12)))
  return out
}

/** Read the study time log defensively; null when there is none yet. */
export function studyDays(raw: unknown): StudyDays | null {
  const days = (raw as { days?: unknown } | null)?.days
  if (!days || typeof days !== 'object') return null
  return days as StudyDays
}

/** Problem sets and mock exams not yet done, marked by whether every topic they practise is covered. */
export function planSets(snap: CourseSnapshot): SetPlan[] {
  const { course, learner, materials, prep } = snap
  const title = (id: string): string => course.concepts.find((c) => c.id === id)?.title ?? id
  // in course order (Serie 1 before Serie 2), problem sets before mock exams
  return openWork(course.concepts, learner, { materials, prep }).map(({ material, kind, ids, missing }) =>
    ids.length
      ? { material, kind, covered: (ids.length - missing.length) / ids.length, readiness: missing.length ? 'partial' : 'solvable', missing, missingTitles: missing.map(title), conceptCount: ids.length }
      : { material, kind, covered: null, readiness: 'unlinked', missing: [], missingTitles: [], conceptCount: 0 }
  )
}

/** Every concept that builds on `id`, directly or not. */
function descendantsOf(concepts: CourseConcept[], id: string): string[] {
  const out = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const x = stack.pop() as string
    for (const c of concepts)
      if (c.requires.includes(x) && !out.has(c.id)) {
        out.add(c.id)
        stack.push(c.id)
      }
  }
  return [...out]
}

/** The plan for one course. */
export function planCourse(snap: CourseSnapshot, now: Date, days: StudyDays | null): CoursePlan {
  const { course, learner, materials, prep } = snap
  const title = (id: string): string => course.concepts.find((c) => c.id === id)?.title ?? id
  const known = new Set(course.concepts.map((c) => c.id))
  const { sets, mocks } = workItems(materials, prep)
  const setsDone = sets.filter((m) => workState(prep, m.id).done).length
  const mocksDone = mocks.filter((m) => workState(prep, m.id).done).length
  const setsTotal = Math.max(prep.problemSets ?? 0, sets.length)
  const setMinutes = typicalMinutes(prep, sets, DEFAULT_SET_MIN)
  const mockMinutes = typicalMinutes(prep, mocks, DEFAULT_MOCK_MIN)

  let learn = 0
  let covered = 0
  let proficient = 0
  for (const c of course.concepts) {
    const r = rankOf(learner, c.id)
    if (r >= 1) covered++
    if (r >= 3) proficient++
    learn += LEARN_MIN[learner.concepts[c.id]?.status ?? 'unseen'] * conceptWeight(c)
  }
  const due = dueConcepts(learner, now).filter((id) => known.has(id)).length
  const review = due * REVIEW_MIN
  const setsLeft = Math.max(0, setsTotal - setsDone)
  const mocksLeft = Math.max(0, prep.mockExams - mocksDone)
  const left = { learn: Math.round(learn), review: Math.round(review), sets: setsLeft * setMinutes, mocks: mocksLeft * mockMinutes, total: 0 }
  left.total = left.learn + left.review + left.sets + left.mocks

  const daysLeft = prep.examDate ? daysUntil(prep.examDate, now) : null
  const buffer = daysLeft === null ? 0 : daysLeft > 2 * BUFFER_DAYS ? BUFFER_DAYS : Math.floor(Math.max(0, daysLeft) / 4)
  const workDays = daysLeft === null || daysLeft < 0 ? null : Math.max(1, daysLeft - buffer)
  const perDay = workDays === null ? null : left.total / workDays
  const perDayParts = workDays === null ? null : { learn: (left.learn + left.review) / workDays, sets: left.sets / workDays, mocks: left.mocks / workDays }

  const studiedToday = secondsOn(days, course.id, lastDays(now, 1, false)) / 60
  const recentPerDay = days ? secondsOn(days, course.id, lastDays(now, 7, true)) / 60 / 7 : null
  const todayLeft = perDay === null ? 0 : Math.max(0, perDay - studiedToday)

  let pace: PaceStatus
  if (daysLeft === null) pace = 'no-date'
  else if (daysLeft < 0) pace = 'over'
  else if (left.total < 1) pace = 'done'
  else if (recentPerDay === null) pace = 'unknown'
  else pace = recentPerDay >= (perDay ?? 0) * 0.85 ? 'on-track' : 'behind'

  // the order: what is still open today, pushed up when behind and when the exam is close
  const behindBy = perDay && recentPerDay !== null ? clamp((perDay - recentPerDay) / perDay, 0, 1) : 0
  const closeness = daysLeft !== null && daysLeft >= 0 ? 1 + 14 / (daysLeft + 14) : 1
  const priority = perDay === null ? -1 : todayLeft * (1 + 0.5 * behindBy) * closeness

  const setPlans = planSets(snap)
  const steps: PlanStep[] = []
  if (daysLeft === null) steps.push({ kind: 'date', title: 'Set the exam date', why: 'The plan paces each course to its exam; without a date this one is not scheduled.', minutes: null })
  // reviews come first but get a modest share of the day while there is new material left, so a backlog
  // of reviews cannot crowd it out; the rest stay due for the next days
  const reviews = reviewCap(due, { dailyMinutes: perDay, minutesPerReview: REVIEW_MIN, newLeft: left.learn > 0 })
  if (reviews > 0) {
    const later = due - reviews
    steps.push({
      kind: 'review',
      title: `Review ${reviews === 1 ? 'one concept' : `${reviews} concepts`}`,
      why: later
        ? `They are fading the most. The other ${later} due can wait a day or two, so new material keeps most of today's time.`
        : 'They are starting to fade: recalling them now keeps them for the exam at little cost.',
      minutes: Math.max(3, Math.round(reviews * REVIEW_MIN))
    })
  }

  // learn the concept the exam work needs most (see ordering.ts): it leads to the most topics of the
  // problem sets and mock exams not done yet, and brings one of them closest to solvable
  const top = rankConcepts(course.concepts, learner, { materials, prep })[0]
  if (top) {
    const id = top.concept.id
    const w = top.towards
    const plan = w ? setPlans.find((x) => x.material.id === w.material.id) : undefined
    let why = 'Next in the course, and everything it builds on is in place.'
    if (w && plan) {
      const rest = w.missing.length - (top.direct ? 1 : 0)
      const kids = new Set(descendantsOf(course.concepts, id))
      const builds = plan.missing.filter((m) => kids.has(m)).map((m) => title(m))
      const named = builds.length ? builds : plan.missingTitles
      why = !top.direct
        ? `${w.material.title} needs ${named.slice(0, 2).join(', ')}, which build${named.length === 1 ? 's' : ''} on it.`
        : rest
          ? `${w.material.title} still needs it and ${rest === 1 ? 'one more topic' : `${rest} more topics`}.`
          : `It is the last topic ${w.material.title} needs: after it you can solve the whole ${w.kind === 'exam' ? 'exam' : 'set'}.`
      if (top.value >= 3) why += ` It leads to ${top.value} topics across your problem sets and mock exams.`
    }
    steps.push({ kind: 'learn', title: `Learn ${top.concept.title}`, why, minutes: LEARN_MIN[learner.concepts[id]?.status ?? 'unseen'], conceptId: id, ...(w ? { materialId: w.material.id } : {}) })
  }

  return {
    id: course.id,
    title: course.title,
    short: course.short || course.title,
    examDate: prep.examDate,
    daysLeft,
    workDays,
    concepts: { total: course.concepts.length, covered, proficient },
    sets: { done: setsDone, total: setsTotal, ready: setPlans.filter((x) => x.kind === 'exercises' && x.readiness === 'solvable').length },
    mocks: { done: mocksDone, goal: prep.mockExams },
    due,
    left,
    setMinutes,
    mockMinutes,
    perDay,
    perDayParts,
    recentPerDay,
    studiedToday,
    todayLeft,
    pace,
    priority,
    sets_: setPlans,
    steps: steps.slice(0, 4)
  }
}

/** The plan across all courses, the one to work on first at the top. */
export function studyPlan(snaps: CourseSnapshot[], now: Date, log: unknown = null, opts: PlanOptions = {}): StudyPlan {
  const days = studyDays(log)
  let courses = snaps.map((s) => planCourse(s, now, days))
  courses.sort((a, b) => b.priority - a.priority || (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || a.title.localeCompare(b.title))
  const block = liveBlock(normalizeBlock((log as { block?: unknown } | null)?.block), now)
  const focus = focusOf(courses, block, opts.blockMin ?? BLOCK_MIN)
  // the block's course goes first while it holds, the rest keep their order
  if (focus && focus.state !== 'switch') courses = [...courses.filter((c) => c.id === focus.courseId), ...courses.filter((c) => c.id !== focus.courseId)]
  const scheduled = courses.filter((c) => c.perDay !== null)
  const perDay = scheduled.reduce((a, c) => a + (c.perDay ?? 0), 0)
  const studiedToday = courses.reduce((a, c) => a + c.studiedToday, 0)
  const todayLeft = scheduled.reduce((a, c) => a + c.todayLeft, 0)
  let recent: number | null = null
  if (days) {
    const keys = lastDays(now, 14, true)
    recent = courses.reduce((a, c) => a + secondsOn(days, c.id, keys), 0) / 60 / 14
  }
  const perDayParts: DayParts = { learn: 0, sets: 0, mocks: 0 }
  for (const c of scheduled) {
    perDayParts.learn += c.perDayParts?.learn ?? 0
    perDayParts.sets += c.perDayParts?.sets ?? 0
    perDayParts.mocks += c.perDayParts?.mocks ?? 0
  }
  return { courses, perDay, perDayParts, todayLeft, studiedToday, recentPerDay: recent, hasLog: !!days, focus }
}

/** Courses the plan can send the learner to: an exam date and work left. */
export const scheduledCourses = (courses: CoursePlan[]): CoursePlan[] => courses.filter((c) => c.perDay !== null && c.pace !== 'done')

/** The course to work on now: the block's course while it holds, else the first with today's share open. */
export function firstCourse(plan: StudyPlan): CoursePlan | null {
  const open = scheduledCourses(plan.courses)
  const f = plan.focus
  if (f && f.state !== 'switch') {
    const c = open.find((x) => x.id === f.courseId)
    if (c) return c
  }
  return open.find((c) => c.todayLeft >= 5) ?? null
}

function focusOf(sorted: CoursePlan[], block: FocusBlock | null, blockMin: number): Focus | null {
  if (!block || blockMin <= 0) return null
  const open = scheduledCourses(sorted)
  const cur = open.find((c) => c.id === block.courseId)
  if (!cur) return null
  const minutes = block.sec / 60
  const leader = open.find((c) => c.todayLeft >= 5 && c.id !== cur.id) ?? null
  let state: Focus['state']
  if (minutes < blockMin) state = 'hold'
  else if (cur.todayLeft < 5 && leader) state = 'switch'
  else if (leader && leader.priority > cur.priority * SWITCH_MARGIN) state = 'switch'
  else state = 'extend'
  return { courseId: cur.id, short: cur.short, state, minutes, target: blockMin, nextId: leader?.id ?? null }
}

/** Round a duration for display: to 5 minutes under an hour, to a quarter hour above. */
export function roundMinutes(m: number): number {
  if (m <= 0) return 0
  return m < 60 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 15) * 15
}

/** "learning 40 min · problem sets 30 min · mock exams 10 min", leaving out what is zero. */
export function fmtParts(p: DayParts): string {
  const parts: [string, number][] = [
    ['learning', p.learn],
    ['problem sets', p.sets],
    ['mock exams', p.mocks]
  ]
  return parts
    .filter(([, m]) => m >= 2.5)
    .map(([k, m]) => `${k} ${fmtDuration(m)}`)
    .join(' · ')
}

export function fmtDuration(m: number): string {
  const r = roundMinutes(m)
  if (r < 60) return `${r} min`
  const h = Math.floor(r / 60)
  const rest = r % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}
