// The persistent learner model: how evidence about one concept updates its state.
//
// mastery    discounted Beta posterior over "answers items on this concept correctly"
//            (old evidence decays, so the estimate can move when understanding changes)
// retention  FSRS-6 retrievability right now (memory, separate from understanding)
// facets     understanding (teach checks and explanations), transfer (level >= 3 or unfamiliar cues),
//            independence (how little help was needed)
// status     unseen → introduced → developing → proficient → mastered (durable: spaced, unaided, transfer)
import { cardRetrievability, review, type Rating } from './fsrs'
import type { ConceptState, ConceptStatus, Evidence, EvidenceKind, LearnerModel, Misconception } from './types'
import { clamp, dayKey, daysBetween, uid } from './util'

export const PRIOR_ALPHA = 1
export const PRIOR_BETA = 1
export const DISCOUNT = 0.9
const MAX_EVIDENCE = 80

export function newConceptState(conceptId: string): ConceptState {
  return {
    conceptId,
    alpha: PRIOR_ALPHA,
    beta: PRIOR_BETA,
    fsrs: null,
    level: 1,
    streak: 0,
    understanding: null,
    transfer: null,
    independence: null,
    misconceptions: [],
    tutorNote: null,
    tutorNoteAt: null,
    userNote: null,
    evidence: [],
    firstSeen: null,
    lastSeen: null,
    status: 'unseen',
    successDays: [],
    maxLevelSolved: 0,
    proficientAt: null,
    masteredAt: null
  }
}

export function getConcept(model: LearnerModel, id: string): ConceptState {
  return model.concepts[id] ?? newConceptState(id)
}

export function masteryMean(cs: ConceptState): number {
  return cs.alpha / (cs.alpha + cs.beta)
}

export function masterySd(cs: ConceptState): number {
  const a = cs.alpha
  const b = cs.beta
  return Math.sqrt((a * b) / ((a + b) ** 2 * (a + b + 1)))
}

/** How much one piece of evidence counts, by kind. Pretests count less than checks. */
export function evidenceWeight(kind: EvidenceKind, level: number | null): number {
  switch (kind) {
    case 'predict':
      return 0.3
    case 'probe':
      return 0.6
    case 'check':
      return 1
    case 'reflect':
      return 1.2
    case 'review':
      return 1
    case 'practice':
      return 1 + 0.15 * (clamp(level ?? 1, 1, 5) - 1)
  }
}

/** Credit after help: hints, extra attempts and revealed solutions reduce what an answer says about mastery. */
export function effectiveScore(score: number, hints: number, attempts: number, revealed: boolean): number {
  if (revealed) return 0
  const factor = Math.max(0.3, 1 - 0.2 * hints - 0.25 * Math.max(0, attempts - 1))
  return clamp(score * factor, 0, 1)
}

/** Map an observed retrieval to an FSRS rating. */
export function ratingFor(ev: Pick<Evidence, 'score' | 'hints' | 'revealed' | 'confidence'>): Rating {
  if (ev.revealed || ev.score < 0.5) return 1
  if (ev.hints >= 2 || ev.score < 0.8 || (ev.confidence !== null && ev.confidence <= 2)) return 2
  if (ev.hints === 0 && ev.score >= 0.95 && ev.confidence === 4) return 4
  return 3
}

const ema = (prev: number | null, x: number, rate = 0.35): number => (prev === null ? x : prev + rate * (x - prev))

export function retentionNow(cs: ConceptState, now: Date): number | null {
  return cardRetrievability(cs.fsrs, now)
}

export function deriveStatus(cs: ConceptState, now: Date): ConceptStatus {
  if (cs.evidence.length === 0) return 'unseen'
  const m = masteryMean(cs)
  const sd = masterySd(cs)
  if (m >= 0.8 && m - sd >= 0.65 && cs.maxLevelSolved >= 3) {
    const r = retentionNow(cs, now) ?? 0
    const days = [...cs.successDays].sort()
    const span = days.length >= 2 ? daysBetween(days[0], days[days.length - 1]) : 0
    const durable = days.length >= 3 && span >= 5 && cs.maxLevelSolved >= 4 && r >= 0.8
    return durable ? 'mastered' : 'proficient'
  }
  if (m >= 0.5) return 'developing'
  return 'introduced'
}

export interface EvidenceInput {
  sessionId: string
  kind: EvidenceKind
  conceptId: string
  /** raw correctness of the final answer, 0..1 */
  score: number
  hints: number
  attempts: number
  revealed: boolean
  confidence: number | null
  level: number | null
  cue: string | null
  summary: string
  /** primary target of the item (FSRS is only updated for the primary concept) */
  primary: boolean
  /** reduce weight, e.g. for secondary concepts of a composed item */
  weightScale?: number
}

export interface EvidenceOutcome {
  state: ConceptState
  evidence: Evidence
  milestones: ('proficient' | 'mastered' | 'level_up' | 'level_down')[]
  rating: Rating | null
}

const RETRIEVAL_KINDS: EvidenceKind[] = ['check', 'practice', 'review', 'reflect']

export function applyEvidence(prev: ConceptState, input: EvidenceInput, now: Date, desiredRetention = 0.9): EvidenceOutcome {
  const cs: ConceptState = { ...prev, evidence: prev.evidence.slice(), successDays: prev.successDays.slice() }
  const eff = effectiveScore(input.score, input.hints, input.attempts, input.revealed)
  const weight = evidenceWeight(input.kind, input.level) * (input.weightScale ?? 1)
  const d = Math.pow(DISCOUNT, weight)
  cs.alpha = PRIOR_ALPHA + (cs.alpha - PRIOR_ALPHA) * d + weight * eff
  cs.beta = PRIOR_BETA + (cs.beta - PRIOR_BETA) * d + weight * (1 - eff)

  if (input.kind === 'check' || input.kind === 'reflect' || input.kind === 'predict') {
    cs.understanding = ema(cs.understanding, eff, input.kind === 'predict' ? 0.15 : 0.35)
  }
  if ((input.level ?? 1) >= 3 || (input.cue && input.cue !== 'familiar')) cs.transfer = ema(cs.transfer, eff)
  if (input.kind !== 'predict' && input.kind !== 'probe') {
    cs.independence = ema(cs.independence, input.revealed ? 0 : 1 - Math.min(1, input.hints / 3))
  }

  let rating: Rating | null = null
  const ev: Evidence = {
    id: uid('ev_'),
    at: now.toISOString(),
    sessionId: input.sessionId,
    kind: input.kind,
    conceptId: input.conceptId,
    score: eff,
    weight,
    confidence: input.confidence,
    hints: input.hints,
    revealed: input.revealed,
    level: input.level,
    cue: input.cue,
    summary: input.summary
  }
  if (input.primary && RETRIEVAL_KINDS.includes(input.kind)) {
    rating = ratingFor({ score: input.score * (input.attempts > 1 ? 0.75 : 1), hints: input.hints, revealed: input.revealed, confidence: input.confidence })
    cs.fsrs = review(cs.fsrs, rating, now, desiredRetention)
  }

  const unaided = input.score >= 0.8 && input.hints === 0 && !input.revealed && input.attempts <= 1
  if (unaided && RETRIEVAL_KINDS.includes(input.kind)) {
    const lvl = input.level ?? (input.kind === 'check' ? 2 : 1)
    cs.maxLevelSolved = Math.max(cs.maxLevelSolved, lvl)
    if (lvl >= 2) {
      const day = dayKey(now)
      if (!cs.successDays.includes(day)) cs.successDays.push(day)
      if (cs.successDays.length > 30) cs.successDays = cs.successDays.slice(-30)
    }
  }

  cs.evidence.push(ev)
  if (cs.evidence.length > MAX_EVIDENCE) cs.evidence = cs.evidence.slice(-MAX_EVIDENCE)
  cs.firstSeen = cs.firstSeen ?? ev.at
  cs.lastSeen = ev.at

  const milestones: EvidenceOutcome['milestones'] = []
  const before = prev.status
  cs.status = deriveStatus(cs, now)
  if (cs.status === 'proficient' && before !== 'proficient' && before !== 'mastered' && !cs.proficientAt) {
    cs.proficientAt = ev.at
    milestones.push('proficient')
  }
  if (cs.status === 'mastered' && before !== 'mastered' && !cs.masteredAt) {
    cs.masteredAt = ev.at
    milestones.push('mastered')
  }
  return { state: cs, evidence: ev, milestones, rating }
}

/**
 * Practice difficulty staircase per concept: 3 successes in a row move up a level, one failure moves down.
 * A 3-up/1-down rule settles where the learner succeeds about 80% of the time.
 */
export function updateLevel(cs: ConceptState, itemLevel: number, effScore: number): { state: ConceptState; change: 'up' | 'down' | null } {
  const next = { ...cs }
  if (effScore >= 0.8) {
    if (itemLevel >= cs.level) next.streak = cs.streak + 1
    if (next.streak >= 3 && cs.level < 5) {
      next.level = cs.level + 1
      next.streak = 0
      return { state: next, change: 'up' }
    }
    return { state: next, change: null }
  }
  if (effScore < 0.5) {
    next.streak = 0
    if (cs.level > 1 && itemLevel >= cs.level) {
      next.level = cs.level - 1
      return { state: next, change: 'down' }
    }
    return { state: next, change: null }
  }
  next.streak = 0
  return { state: next, change: null }
}

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9äöü]+/g, ' ').trim()

function similar(a: string, b: string): boolean {
  const x = new Set(norm(a).split(' ').filter((w) => w.length > 3))
  const y = new Set(norm(b).split(' ').filter((w) => w.length > 3))
  if (!x.size || !y.size) return norm(a) === norm(b)
  let inter = 0
  for (const w of x) if (y.has(w)) inter++
  return inter / Math.min(x.size, y.size) >= 0.6
}

export function recordMisconception(cs: ConceptState, text: string, status: 'active' | 'resolved', now: Date): ConceptState {
  const list = cs.misconceptions.slice()
  const at = now.toISOString()
  const i = list.findIndex((m) => similar(m.text, text))
  if (i >= 0) {
    const m = list[i]
    list[i] =
      status === 'resolved'
        ? { ...m, status: 'resolved', resolvedAt: at, lastSeen: at }
        : { ...m, status: 'active', resolvedAt: null, lastSeen: at, count: m.count + 1 }
  } else if (status === 'active') {
    const m: Misconception = { id: uid('mc_'), text: text.trim(), status: 'active', firstSeen: at, lastSeen: at, resolvedAt: null, count: 1 }
    list.push(m)
  }
  return { ...cs, misconceptions: list.slice(-20) }
}

export const STATUS_ORDER: ConceptStatus[] = ['unseen', 'introduced', 'developing', 'proficient', 'mastered']
export const statusRank = (s: ConceptStatus): number => STATUS_ORDER.indexOf(s)
