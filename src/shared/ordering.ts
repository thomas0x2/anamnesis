// The one order in which new concepts are suggested: the Plan and Today pages, the Course tab, the map,
// the mind view, onboarding and "what next" after a session all read it from here.
//
// A concept is ready to learn once every prerequisite is at least developing (and it is not itself).
// Among the ready ones, what counts most is what the exam asks for:
// 1. Exam value: how many topics of the problem sets and mock exams not done yet it leads to (itself, or a
//    missing topic that builds on it), counted once per set or mock. A topic that three sets practise
//    counts three times; a concept no set needs counts zero.
// 2. Then the one that brings a set or mock closest to solvable (fewest topics still missing).
// 3. Then the course's own order: refreshers (chapter 0) last, core before support before extra, by
//    chapter, by the order of the course map.
// Without linked problem sets every value is zero, so the order is simply the course's own order.
import { practisedConcepts, workItems, workState } from './exam'
import { statusRank } from './mastery'
import type { ConceptTier, CourseConcept, ExamPrep, LearnerModel, Material } from './types'

/** What the ranking needs to know about the exam: the course's materials and its exam prep. */
export interface ExamContext {
  materials: Material[]
  prep: ExamPrep
}

/** A problem set or mock exam that is not done yet, with the topics it practises. */
export interface OpenWork {
  material: Material
  kind: 'exercises' | 'exam'
  /** the course concepts it practises, in course order (empty when the map does not say) */
  ids: string[]
  /** those the learner has not covered yet, in course order */
  missing: string[]
}

export interface RankedConcept {
  concept: CourseConcept
  /** set and mock topics it leads to (see above) */
  value: number
  /** the set or mock it brings closest to solvable, if any needs it */
  towards: OpenWork | null
  /** it is itself one of the topics `towards` is missing (otherwise one of them builds on it) */
  direct: boolean
}

const TIER: Record<ConceptTier, number> = { core: 0, support: 1, extra: 2 }
const rankOf = (learner: LearnerModel, id: string): number => statusRank(learner.concepts[id]?.status ?? 'unseen')
/** A topic counts as covered once the learner has started it in the app (introduced or beyond), or marked it known. */
export const isCovered = (learner: LearnerModel, id: string): boolean => rankOf(learner, id) >= 1

/** Problem sets, then mock exams, not done yet, each with what it practises and what of that is not covered. */
export function openWork(concepts: CourseConcept[], learner: LearnerModel, ctx: ExamContext): OpenWork[] {
  const { sets, mocks } = workItems(ctx.materials, ctx.prep)
  const order = new Map(concepts.map((c, i) => [c.id, i]))
  const out: OpenWork[] = []
  for (const m of [...sets, ...mocks]) {
    if (workState(ctx.prep, m.id).done) continue
    const ids = practisedConcepts(m, concepts, ctx.prep)
      .filter((id) => order.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    out.push({ material: m, kind: m.kind === 'exam' ? 'exam' : 'exercises', ids, missing: ids.filter((id) => !isCovered(learner, id)) })
  }
  return out
}

/** Concepts ready to learn: not yet developing, every prerequisite (that the map knows) at least developing. Unordered. */
export function readyConcepts(concepts: CourseConcept[], learner: LearnerModel): CourseConcept[] {
  const known = new Set(concepts.map((c) => c.id))
  return concepts.filter((c) => rankOf(learner, c.id) < 2 && c.requires.every((r) => !known.has(r) || rankOf(learner, r) >= 2))
}

/** The concepts ready to learn, best first, with why each is where it is. */
export function rankConcepts(concepts: CourseConcept[], learner: LearnerModel, ctx: ExamContext | null = null): RankedConcept[] {
  const ready = readyConcepts(concepts, learner)
  const readyIds = new Set(ready.map((c) => c.id))
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const order = new Map(concepts.map((c, i) => [c.id, i]))
  const value = new Map<string, number>()
  const best = new Map<string, { w: OpenWork; direct: boolean }>()

  // the concepts a missing topic still waits on: itself and every prerequisite not yet developing
  const path = (id: string): Set<string> => {
    const seen = new Set<string>()
    const stack = [id]
    while (stack.length) {
      const x = stack.pop() as string
      if (seen.has(x)) continue
      seen.add(x)
      for (const r of byId.get(x)?.requires ?? []) if (rankOf(learner, r) < 2) stack.push(r)
    }
    return seen
  }
  const paths = new Map<string, Set<string>>()
  for (const w of ctx ? openWork(concepts, learner, ctx) : []) {
    for (const m of w.missing) {
      if (!paths.has(m)) paths.set(m, path(m))
      for (const c of paths.get(m)!) {
        if (!readyIds.has(c)) continue
        value.set(c, (value.get(c) ?? 0) + 1)
        const cur = best.get(c)
        const direct = w.missing.includes(c)
        // closest to solvable first; at a tie, the set it is itself a topic of, then the earlier set
        if (!cur || w.missing.length < cur.w.missing.length || (w.missing.length === cur.w.missing.length && direct && !cur.direct)) best.set(c, { w, direct })
      }
    }
  }

  const missingOf = (id: string): number => best.get(id)?.w.missing.length ?? Infinity
  const chapter = (c: CourseConcept): number => c.chapter || 99
  return ready
    .sort(
      (a, b) =>
        (value.get(b.id) ?? 0) - (value.get(a.id) ?? 0) ||
        missingOf(a.id) - missingOf(b.id) ||
        Number(a.chapter === 0) - Number(b.chapter === 0) ||
        (TIER[a.tier] ?? 0) - (TIER[b.tier] ?? 0) ||
        chapter(a) - chapter(b) ||
        (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    )
    .map((c) => ({ concept: c, value: value.get(c.id) ?? 0, towards: best.get(c.id)?.w ?? null, direct: best.get(c.id)?.direct ?? false }))
}

/** Just the ids, best first. */
export function conceptOrder(concepts: CourseConcept[], learner: LearnerModel, ctx: ExamContext | null = null): string[] {
  return rankConcepts(concepts, learner, ctx).map((r) => r.concept.id)
}

// ------------------------------------------------------------------ reviews

/** Reviews take at most this share of a day's study time in a course while new material is still to learn. */
export const REVIEW_SHARE = 0.25
/** A few reviews always fit, however short the day. */
export const MIN_REVIEWS = 3
/** And never more than this many in one go. */
export const MAX_REVIEWS = 10

/**
 * How many due reviews to take now. With nothing new left to learn, or no daily time known (no exam date),
 * that is everything due up to MAX_REVIEWS; otherwise reviews get REVIEW_SHARE of the day, so a backlog of
 * reviews cannot crowd out the material still to learn before the exam. The rest stay due for later.
 */
export function reviewCap(due: number, opts: { dailyMinutes: number | null; minutesPerReview: number; newLeft: boolean }): number {
  if (due <= 0) return 0
  if (!opts.newLeft || opts.dailyMinutes === null) return Math.min(due, MAX_REVIEWS)
  const fit = Math.floor((REVIEW_SHARE * opts.dailyMinutes) / opts.minutesPerReview)
  return Math.min(due, MAX_REVIEWS, Math.max(MIN_REVIEWS, fit))
}
