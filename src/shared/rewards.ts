// Insight points: rewards for evidence of understanding, never for time spent or clicks.
// Feedback is informational: every award says what the learner did that deserved it.
import type { CardKind, CardResponse, ConceptState, RewardEvent } from './types'
import { daysBetween, uid } from './util'

export const LEVEL_MULT = [1, 1, 1.25, 1.5, 2, 2.5]

export interface RewardContext {
  cardKind: CardKind
  response: CardResponse
  conceptId: string | null
  conceptTitle: string
  level: number | null
  sessionId: string
  now: Date
  /** state before this answer, to detect corrected confident errors and spaced retention */
  before: ConceptState | null
}

function ev(points: number, kind: string, reason: string, ctx: RewardContext): RewardEvent {
  return {
    id: uid('rw_'),
    at: ctx.now.toISOString(),
    points: Math.round(points),
    kind,
    reason,
    conceptId: ctx.conceptId,
    sessionId: ctx.sessionId
  }
}

export function rewardsForResponse(ctx: RewardContext): RewardEvent[] {
  const r = ctx.response
  const out: RewardEvent[] = []
  const score = r.score ?? 0
  const clean = !r.revealed && r.hintsUsed === 0 && r.attempts <= 1
  const topic = ctx.conceptTitle

  if (ctx.cardKind === 'predict') {
    if (r.verdict !== 'dontknow') out.push(ev(2, 'prediction', 'Committed to a prediction before seeing the answer', ctx))
    if (r.score !== null && score >= 0.8) out.push(ev(4, 'prediction_right', 'Prediction right: you reasoned it out before being told', ctx))
    if (r.selfCheck === 'right') out.push(ev(3, 'prediction_right', 'Your prediction matched the reveal', ctx))
    return out
  }
  if (ctx.cardKind === 'probe') {
    if (r.verdict !== 'dontknow') out.push(ev(1, 'probe', 'Honest attempt on a diagnostic question', ctx))
    if (score >= 0.8) out.push(ev(2, 'probe_right', `Already knew a piece of ${topic}`, ctx))
    return out
  }
  if (r.revealed || r.score === null) return out

  if (ctx.cardKind === 'check') {
    if (score >= 0.8) {
      const pts = clean ? 10 : Math.max(3, 10 - 3 * r.hintsUsed - 3 * (r.attempts - 1))
      out.push(ev(pts, 'check', clean ? `Applied ${topic} on your own` : `Got ${topic} right with a nudge`, ctx))
    } else if (score >= 0.5) out.push(ev(3, 'check_partial', `Partly right on ${topic}`, ctx))
  } else if (ctx.cardKind === 'reflect') {
    if (score >= 0.8) out.push(ev(15, 'explain', 'Explained the whole chain in your own words', ctx))
    else if (score >= 0.5) out.push(ev(8, 'explain', 'Explained most of the chain in your own words', ctx))
  } else if (ctx.cardKind === 'practice' || ctx.cardKind === 'review') {
    const lvl = Math.min(5, Math.max(1, ctx.level ?? 1))
    const base = 8 * LEVEL_MULT[lvl]
    const helpFactor = Math.max(0.2, 1 - 0.2 * r.hintsUsed - 0.25 * (r.attempts - 1))
    if (score >= 0.8) out.push(ev(base * helpFactor, 'practice', `Solved a level ${lvl} item on ${topic}${clean ? ' without help' : ''}`, ctx))
    else if (score >= 0.5) out.push(ev((base * helpFactor) / 2, 'practice_partial', `Partly solved a level ${lvl} item`, ctx))
    const prev = ctx.before
    if (ctx.cardKind === 'review' && score >= 0.8 && prev?.fsrs?.lastReview) {
      const gap = Math.round(daysBetween(prev.fsrs.lastReview, ctx.now))
      if (gap >= 1) out.push(ev(4, 'retained', `Still knew it after ${gap} day${gap === 1 ? '' : 's'}`, ctx))
    }
  }

  // calibration
  if (r.confidence !== null) {
    if (r.confidence === 4 && score >= 0.8 && clean) out.push(ev(2, 'calibrated', 'Certain and right: well calibrated', ctx))
    if (r.confidence <= 2 && score < 0.5) out.push(ev(1, 'honest', 'Flagged your uncertainty honestly', ctx))
  }

  // hypercorrection: a confident error on this concept recently, now fixed without help
  const before = ctx.before
  if (before && score >= 0.8 && clean) {
    const recentConfidentError = before.evidence
      .slice(-12)
      .some((e) => e.confidence !== null && e.confidence >= 3 && e.score < 0.5 && daysBetween(e.at, ctx.now) <= 14)
    if (recentConfidentError) out.push(ev(6, 'hypercorrection', 'Corrected an error you were confident about. Those corrections stick.', ctx))
  }
  return out
}

export function milestoneReward(kind: 'proficient' | 'mastered' | 'level_up' | 'plan_done', title: string, ctx: Pick<RewardContext, 'conceptId' | 'sessionId' | 'now'>, level?: number): RewardEvent {
  const c = { ...ctx, cardKind: 'summary' as CardKind, response: null as unknown as CardResponse, conceptTitle: title, level: null, before: null }
  switch (kind) {
    case 'proficient':
      return ev(30, 'proficient', `${title}: proficient (solid at level 3+)`, c)
    case 'mastered':
      return ev(60, 'mastered', `${title}: mastered (unaided on 3+ separate days, transfer at level 4+)`, c)
    case 'level_up':
      return ev(5, 'level_up', `${title}: level ${level} unlocked`, c)
    case 'plan_done':
      return ev(20, 'plan_done', `Walked the whole dependency tree to ${title}`, c)
  }
}

/** The learner judged that their open prediction matched the reveal. */
export function selfCheckReward(conceptId: string | null, sessionId: string, now: Date): RewardEvent {
  return { id: uid('rw_'), at: now.toISOString(), points: 3, kind: 'prediction_right', reason: 'Your prediction matched the reveal', conceptId, sessionId }
}
