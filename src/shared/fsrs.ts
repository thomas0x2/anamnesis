// FSRS-6 memory model (Free Spaced Repetition Scheduler, open-spaced-repetition).
// One "card" per course concept: stability S (days until retrievability falls to 90%)
// and difficulty D (1..10). Default parameters are the published FSRS-6 defaults.
import type { FsrsCard } from './types'

export const FSRS6_DEFAULT_W = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
]

/** 1 Again, 2 Hard, 3 Good, 4 Easy */
export type Rating = 1 | 2 | 3 | 4

const S_MIN = 0.001
const S_MAX = 36500
const DAY_MS = 86_400_000

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))
const clampS = (s: number): number => clamp(s, S_MIN, S_MAX)
const clampD = (d: number): number => clamp(d, 1, 10)

export function decay(w = FSRS6_DEFAULT_W): number {
  return -w[20]
}

export function factor(w = FSRS6_DEFAULT_W): number {
  return Math.pow(0.9, 1 / decay(w)) - 1
}

/** Probability of recall after t days for stability S. */
export function retrievability(tDays: number, stability: number, w = FSRS6_DEFAULT_W): number {
  if (stability <= 0) return 0
  return Math.pow(1 + (factor(w) * Math.max(0, tDays)) / stability, decay(w))
}

/** Days until retrievability drops to the desired retention. */
export function intervalDays(stability: number, desiredRetention = 0.9, w = FSRS6_DEFAULT_W): number {
  return (stability / factor(w)) * (Math.pow(desiredRetention, 1 / decay(w)) - 1)
}

export function initialStability(r: Rating, w = FSRS6_DEFAULT_W): number {
  return clampS(w[r - 1])
}

export function initialDifficulty(r: Rating, w = FSRS6_DEFAULT_W, clampIt = true): number {
  const d = w[4] - Math.exp(w[5] * (r - 1)) + 1
  return clampIt ? clampD(d) : d
}

export function nextDifficulty(d: number, r: Rating, w = FSRS6_DEFAULT_W): number {
  const delta = -w[6] * (r - 3)
  const damped = d + (delta * (10 - d)) / 9
  const reverted = w[7] * initialDifficulty(4, w, false) + (1 - w[7]) * damped
  return clampD(reverted)
}

export function nextRecallStability(d: number, s: number, rNow: number, r: Rating, w = FSRS6_DEFAULT_W): number {
  const hardPenalty = r === 2 ? w[15] : 1
  const easyBonus = r === 4 ? w[16] : 1
  return clampS(
    s * (1 + Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - rNow) * w[10]) - 1) * hardPenalty * easyBonus)
  )
}

export function nextForgetStability(d: number, s: number, rNow: number, w = FSRS6_DEFAULT_W): number {
  const longTerm = w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - rNow) * w[14])
  const shortTerm = s / Math.exp(w[17] * w[18])
  return clampS(Math.min(longTerm, shortTerm))
}

export function shortTermStability(s: number, r: Rating, w = FSRS6_DEFAULT_W): number {
  let inc = Math.exp(w[17] * (r - 3 + w[18])) * Math.pow(s, -w[19])
  if (r >= 3) inc = Math.max(inc, 1)
  return clampS(s * inc)
}

export function newCard(): FsrsCard {
  return { stability: 0, difficulty: 0, lastReview: null, due: null, reps: 0, lapses: 0, state: 'new' }
}

export function cardRetrievability(card: FsrsCard | null, now: Date, w = FSRS6_DEFAULT_W): number | null {
  if (!card || !card.lastReview || card.stability <= 0) return null
  const t = (now.getTime() - new Date(card.lastReview).getTime()) / DAY_MS
  return retrievability(t, card.stability, w)
}

/** Apply one review with rating r at time `now`. Pure: returns a new card. */
export function review(card: FsrsCard | null, r: Rating, now: Date, desiredRetention = 0.9, w = FSRS6_DEFAULT_W): FsrsCard {
  const c = card ?? newCard()
  let s: number
  let d: number
  let lapses = c.lapses
  if (c.state === 'new' || !c.lastReview || c.stability <= 0) {
    s = initialStability(r, w)
    d = initialDifficulty(r, w)
  } else {
    const elapsed = (now.getTime() - new Date(c.lastReview).getTime()) / DAY_MS
    if (elapsed < 1) {
      s = shortTermStability(c.stability, r, w)
    } else {
      const rNow = retrievability(elapsed, c.stability, w)
      s = r === 1 ? nextForgetStability(c.difficulty, c.stability, rNow, w) : nextRecallStability(c.difficulty, c.stability, rNow, r, w)
    }
    d = nextDifficulty(c.difficulty, r, w)
  }
  if (r === 1 && c.state !== 'new') lapses += 1
  let days = intervalDays(s, desiredRetention, w)
  // A failed concept comes back the same day (half a day at most); successes wait at least a day.
  days = r === 1 ? Math.min(Math.max(days, 0.02), 0.5) : clamp(Math.round(days), 1, 365)
  const state: FsrsCard['state'] = r === 1 ? (c.state === 'new' ? 'learning' : 'relearning') : 'review'
  return {
    stability: s,
    difficulty: d,
    lastReview: now.toISOString(),
    due: new Date(now.getTime() + days * DAY_MS).toISOString(),
    reps: c.reps + 1,
    lapses,
    state
  }
}

export function isDue(card: FsrsCard | null, now: Date): boolean {
  return !!card?.due && new Date(card.due).getTime() <= now.getTime()
}
