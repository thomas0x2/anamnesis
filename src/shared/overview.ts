// Today, across every course: what is due soon (deadlines of problem sets synced from Code Expert,
// exams coming up, reviews due now) and the totals for the glance row. It reads the same course
// snapshots and plan as the Plan page, so it never depends on which course is open.
import { workState } from './exam'
import type { CourseSnapshot, CoursePlan } from './scheduler'

const DAY = 86_400_000

export type DueKind = 'deadline' | 'exam' | 'review'

export interface DueItem {
  kind: DueKind
  courseId: string
  short: string
  title: string
  /** local days from today: 0 today, negative overdue; reviews are due now (0) */
  days: number
  /** the problem set behind a deadline */
  materialId?: string
  /** reviews due */
  count?: number
}

/** Days from today to a date-time, counted in local calendar days (tonight at 23:59 is 0). */
export function daysTo(iso: string, now: Date): number {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return Number.NaN
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((a - b) / DAY)
}

/** Exams this many days away or closer are listed as due. */
export const EXAM_HORIZON = 30
/** Deadlines this many days away or closer are listed; overdue ones for a week. */
export const DEADLINE_HORIZON = 14
export const OVERDUE_DAYS = 7

/**
 * What is due across all courses, soonest first: open problem sets with a deadline (Code Expert series),
 * exams within a month and the reviews due now. A done set is never listed.
 */
export function dueSoon(snaps: CourseSnapshot[], plans: CoursePlan[], now: Date): DueItem[] {
  const out: DueItem[] = []
  const rank: Record<DueKind, number> = { deadline: 0, exam: 1, review: 2 }
  for (const snap of snaps) {
    const { course, prep } = snap
    for (const t of prep.online) {
      const due = t.codeExpert?.due
      if (!due || workState(prep, t.id).done) continue
      const days = daysTo(due, now)
      if (!Number.isFinite(days) || days > DEADLINE_HORIZON || days < -OVERDUE_DAYS) continue
      out.push({ kind: 'deadline', courseId: course.id, short: course.short, title: t.title, days, materialId: t.id })
    }
  }
  for (const p of plans) {
    if (p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= EXAM_HORIZON) out.push({ kind: 'exam', courseId: p.id, short: p.short, title: `${p.short} exam`, days: p.daysLeft })
    if (p.due > 0) out.push({ kind: 'review', courseId: p.id, short: p.short, title: `${p.due} ${p.due === 1 ? 'review' : 'reviews'} in ${p.short}`, days: 0, count: p.due })
  }
  return out.sort((a, b) => a.days - b.days || rank[a.kind] - rank[b.kind] || a.short.localeCompare(b.short))
}

export interface OverviewTotals {
  /** reviews due now, all courses */
  due: number
  /** the nearest exam still ahead */
  nextExam: { id: string; short: string; days: number } | null
  /** courses with an exam date that are behind their pace */
  behind: string[]
}

export function overviewTotals(plans: CoursePlan[]): OverviewTotals {
  const due = plans.reduce((n, p) => n + p.due, 0)
  const ahead = plans.filter((p) => p.daysLeft !== null && p.daysLeft >= 0).sort((a, b) => (a.daysLeft as number) - (b.daysLeft as number))
  const nextExam = ahead[0] ? { id: ahead[0].id, short: ahead[0].short, days: ahead[0].daysLeft as number } : null
  return { due, nextExam, behind: plans.filter((p) => p.pace === 'behind').map((p) => p.short) }
}

/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function whenLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}
