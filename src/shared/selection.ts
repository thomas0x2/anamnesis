// Choosing what to practice and review next.
// Practice: weakest and most forgettable concepts first, interleaved (no back-to-back repeats),
// difficulty from each concept's staircase level, composition partners from the course graph.
// Review: concepts whose FSRS due date has passed, least retrievable first.
import { cardRetrievability, isDue } from './fsrs'
import type { CourseGraph } from './graph'
import { masteryMean, statusRank } from './mastery'
import type { ConceptState, LearnerModel, PracticeTarget } from './types'
import { clamp, hashString } from './util'

export function cueForLevel(level: number, index: number): PracticeTarget['cue'] {
  if (level <= 1) return 'familiar'
  if (level === 2) return index % 3 === 2 ? 'shifted' : 'familiar'
  if (level === 3) return 'shifted'
  return 'novel'
}

export function modeForLevel(level: number, hasPartner: boolean, index: number): PracticeTarget['mode'] {
  if (level <= 1) return 'recall'
  if (level === 2) return 'apply'
  if (level === 3) return hasPartner ? 'compose' : 'discriminate'
  if (level === 4) return index % 2 === 0 ? 'discriminate' : hasPartner ? 'compose' : 'discriminate'
  return 'exam'
}

function partnersFor(graph: CourseGraph, model: LearnerModel, id: string, count: number, seed: number): string[] {
  if (count <= 0) return []
  const known = (x: string): boolean => statusRank(model.concepts[x]?.status ?? 'unseen') >= 2
  const pool = [...graph.ancestors(id, 2), ...graph.siblings(id), ...graph.descendants(id, 1)].filter((x, i, a) => a.indexOf(x) === i && known(x))
  if (!pool.length) return []
  const out: string[] = []
  for (let k = 0; k < pool.length && out.length < count; k++) out.push(pool[(seed + k * 7) % pool.length])
  return [...new Set(out)]
}

export function makeTarget(graph: CourseGraph, model: LearnerModel, conceptId: string, index: number, levelOverride?: number): PracticeTarget {
  const cs = model.concepts[conceptId]
  const level = clamp(levelOverride ?? cs?.level ?? 1, 1, 5)
  const compose = level >= 3 ? partnersFor(graph, model, conceptId, level >= 5 ? 2 : 1, hashString(conceptId) + index) : []
  return { conceptId, level, cue: cueForLevel(level, index), compose, mode: modeForLevel(level, compose.length > 0, index) }
}

function priority(cs: ConceptState | undefined, now: Date, tier: string): number {
  if (!cs) return 0.3
  const m = masteryMean(cs)
  const r = cardRetrievability(cs.fsrs, now)
  const forget = cs.fsrs ? (isDue(cs.fsrs, now) ? 1 : 1 - (r ?? 1)) : 0.5
  const active = cs.misconceptions.some((x) => x.status === 'active') ? 1 : 0
  return 0.45 * (1 - m) + 0.25 * forget + 0.15 * active + (tier === 'core' ? 0.15 : 0.05)
}

/** A practice queue of n items over `scope` (concept ids; empty = everything seen). */
export function practiceQueue(graph: CourseGraph, model: LearnerModel, scope: string[], n: number, now: Date): PracticeTarget[] {
  const seen = (id: string): boolean => statusRank(model.concepts[id]?.status ?? 'unseen') >= 1
  let pool = (scope.length ? scope : graph.course.concepts.map((c) => c.id)).filter((id) => graph.get(id))
  const seenPool = pool.filter(seen)
  pool = seenPool.length ? seenPool : pool.slice(0, 6)
  const scored = pool
    .map((id) => ({ id, p: priority(model.concepts[id], now, graph.get(id)?.tier ?? 'core') }))
    .sort((a, b) => b.p - a.p)
  const maxRepeats = Math.max(1, Math.ceil(n / Math.max(1, Math.min(scored.length, 4))))
  const counts = new Map<string, number>()
  const out: PracticeTarget[] = []
  let last = ''
  for (let k = 0; out.length < n && k < n * 4; k++) {
    // take the highest-priority concept that is not the previous one and not over its repeat budget,
    // then lower its priority so others get their turn (interleaving)
    const pick = scored.find((s) => s.id !== last && (counts.get(s.id) ?? 0) < maxRepeats) ?? (scored.length === 1 ? scored[0] : undefined)
    if (!pick) break
    counts.set(pick.id, (counts.get(pick.id) ?? 0) + 1)
    out.push(makeTarget(graph, model, pick.id, out.length))
    last = pick.id
    pick.p *= 0.55
    scored.sort((a, b) => b.p - a.p)
  }
  return out
}

export function dueConcepts(model: LearnerModel, now: Date): string[] {
  return Object.values(model.concepts)
    .filter((cs) => cs.fsrs && isDue(cs.fsrs, now))
    .sort((a, b) => (cardRetrievability(a.fsrs, now) ?? 0) - (cardRetrievability(b.fsrs, now) ?? 0))
    .map((cs) => cs.conceptId)
}

export function reviewQueue(graph: CourseGraph, model: LearnerModel, now: Date, limit = 10): PracticeTarget[] {
  return dueConcepts(model, now)
    .filter((id) => graph.get(id))
    .slice(0, limit)
    .map((id, i) => {
      const cs = model.concepts[id]
      const level = clamp((cs?.level ?? 1) - 1, 1, 3)
      return { conceptId: id, level, cue: 'shifted' as const, compose: [], mode: level >= 2 ? ('apply' as const) : ('recall' as const), index: i }
    })
    .map(({ index: _i, ...t }) => t)
}

export function nextDue(model: LearnerModel): string | null {
  const dues = Object.values(model.concepts)
    .map((c) => c.fsrs?.due)
    .filter((d): d is string => !!d)
    .sort()
  return dues[0] ?? null
}
