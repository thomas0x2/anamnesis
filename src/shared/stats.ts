// Numbers for the stats view. Everything here is derived from the evidence log, so it is honest:
// it measures performance on retrieval items, not time or clicks.
import { cardRetrievability } from './fsrs'
import type { CourseGraph } from './graph'
import { masteryMean, masterySd } from './mastery'
import type { AppState, CalibrationPoint, ConceptStatus, Evidence } from './types'
import { dayKey, mean } from './util'

/** What each confidence level claims, as a probability of being right. */
export const CONFIDENCE_PROB = [0, 0.25, 0.5, 0.75, 0.95]
export const CONFIDENCE_LABEL = ['', 'Guess', 'Unsure', 'Fairly sure', 'Certain']

export interface CalibrationBin {
  confidence: number
  claimed: number
  observed: number | null
  n: number
}

export function calibrationBins(points: CalibrationPoint[]): CalibrationBin[] {
  return [1, 2, 3, 4].map((c) => {
    const xs = points.filter((p) => p.confidence === c).map((p) => p.correct)
    return { confidence: c, claimed: CONFIDENCE_PROB[c], observed: mean(xs), n: xs.length }
  })
}

/** Brier score of confidence vs correctness (0 perfect, 0.25 = always saying 50%). */
export function brierScore(points: CalibrationPoint[]): number | null {
  if (!points.length) return null
  return points.reduce((s, p) => s + (CONFIDENCE_PROB[p.confidence] - p.correct) ** 2, 0) / points.length
}

/** Positive = overconfident, negative = underconfident (in percentage points / 100). */
export function confidenceBias(points: CalibrationPoint[]): number | null {
  if (!points.length) return null
  return (mean(points.map((p) => CONFIDENCE_PROB[p.confidence])) ?? 0) - (mean(points.map((p) => p.correct)) ?? 0)
}

export function allEvidence(state: AppState): Evidence[] {
  return Object.values(state.learner.concepts)
    .flatMap((c) => c.evidence)
    .sort((a, b) => a.at.localeCompare(b.at))
}

export function accuracyByLevel(evs: Evidence[]): { level: number; n: number; mean: number | null }[] {
  return [1, 2, 3, 4, 5].map((level) => {
    const xs = evs.filter((e) => (e.kind === 'practice' || e.kind === 'review') && (e.level ?? 1) === level).map((e) => e.score)
    return { level, n: xs.length, mean: mean(xs) }
  })
}

export function activityByDay(evs: Evidence[], now: Date, days = 28): { day: string; n: number; mean: number | null }[] {
  const out: { day: string; n: number; mean: number | null }[] = []
  for (let k = days - 1; k >= 0; k--) {
    const d = new Date(now.getTime() - k * 86_400_000)
    const key = dayKey(d)
    const xs = evs.filter((e) => dayKey(e.at) === key && e.kind !== 'predict' && e.kind !== 'probe').map((e) => e.score)
    out.push({ day: key, n: xs.length, mean: mean(xs) })
  }
  return out
}

export function hintTrend(evs: Evidence[], weeks = 6, now = new Date()): { week: number; hintsPerItem: number | null; n: number }[] {
  const out: { week: number; hintsPerItem: number | null; n: number }[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const end = now.getTime() - w * 7 * 86_400_000
    const start = end - 7 * 86_400_000
    const xs = evs.filter((e) => {
      const t = new Date(e.at).getTime()
      return t > start && t <= end && (e.kind === 'practice' || e.kind === 'review' || e.kind === 'check')
    })
    out.push({ week: -w, hintsPerItem: mean(xs.map((e) => e.hints + (e.revealed ? 3 : 0))), n: xs.length })
  }
  return out
}

export const STATUS_SCORE: Record<ConceptStatus, number> = { unseen: 0, introduced: 0.25, developing: 0.5, proficient: 0.8, mastered: 1 }

export interface ChapterReadiness {
  chapter: number
  title: string
  concepts: number
  seen: number
  counts: Record<ConceptStatus, number>
  mastery: number | null
  retention: number | null
  readiness: number
}

/**
 * Readiness per chapter: average over its core and support concepts of status score × memory factor.
 * The memory factor is the current FSRS retrievability, so readiness drops as you forget.
 */
export function chapterReadiness(graph: CourseGraph, state: AppState, now: Date): ChapterReadiness[] {
  return graph.course.chapters.map((ch) => {
    const cs = graph.chapterConcepts(ch.number).filter((c) => c.tier !== 'extra')
    const counts: Record<ConceptStatus, number> = { unseen: 0, introduced: 0, developing: 0, proficient: 0, mastered: 0 }
    const masteries: number[] = []
    const rets: number[] = []
    let score = 0
    for (const c of cs) {
      const s = state.learner.concepts[c.id]
      const status = s?.status ?? 'unseen'
      counts[status]++
      if (s && status !== 'unseen') masteries.push(masteryMean(s))
      const r = s ? cardRetrievability(s.fsrs, now) : null
      if (r !== null) rets.push(r)
      const memory = r ?? (status === 'unseen' ? 0 : 0.6)
      score += STATUS_SCORE[status] * Math.max(0.3, memory)
    }
    return {
      chapter: ch.number,
      title: ch.title,
      concepts: cs.length,
      seen: cs.length - counts.unseen,
      counts,
      mastery: mean(masteries),
      retention: mean(rets),
      readiness: cs.length ? score / cs.length : 0
    }
  })
}

/** How many concepts become due on each of the next `days` days (0 = today, including overdue). */
export function dueForecast(state: AppState, now: Date, days = 7): number[] {
  const out = new Array(days).fill(0)
  const today = new Date(dayKey(now) + 'T00:00:00')
  for (const c of Object.values(state.learner.concepts)) {
    if (!c.fsrs?.due) continue
    const d = Math.floor((new Date(c.fsrs.due).getTime() - today.getTime()) / 86_400_000)
    if (d < days) out[Math.max(0, d)]++
  }
  return out
}

export interface OverviewStats {
  counts: Record<ConceptStatus, number>
  avgRetention: number | null
  brier: number | null
  bias: number | null
  independence: number | null
  items7d: number
  accuracy7d: number | null
  points7d: number
}

export function overview(graph: CourseGraph, state: AppState, now: Date): OverviewStats {
  const counts: Record<ConceptStatus, number> = { unseen: 0, introduced: 0, developing: 0, proficient: 0, mastered: 0 }
  const rets: number[] = []
  const indep: number[] = []
  for (const c of graph.course.concepts) {
    const s = state.learner.concepts[c.id]
    counts[s?.status ?? 'unseen']++
    const r = s ? cardRetrievability(s.fsrs, now) : null
    if (r !== null) rets.push(r)
    if (s?.independence !== null && s?.independence !== undefined) indep.push(s.independence)
  }
  const weekAgo = now.getTime() - 7 * 86_400_000
  const evs = allEvidence(state).filter((e) => new Date(e.at).getTime() > weekAgo && e.kind !== 'predict' && e.kind !== 'probe')
  return {
    counts,
    avgRetention: mean(rets),
    brier: brierScore(state.calibration),
    bias: confidenceBias(state.calibration),
    independence: mean(indep),
    items7d: evs.length,
    accuracy7d: mean(evs.map((e) => e.score)),
    points7d: state.rewards.events.filter((e) => new Date(e.at).getTime() > weekAgo).reduce((s, e) => s + e.points, 0)
  }
}

export function masteryInterval(c: { alpha: number; beta: number }): [number, number] {
  const m = c.alpha / (c.alpha + c.beta)
  const sd = masterySd(c as never)
  return [Math.max(0, m - sd), Math.min(1, m + sd)]
}
