import { describe, expect, it } from 'vitest'
import {
  FSRS6_DEFAULT_W,
  cardRetrievability,
  initialDifficulty,
  initialStability,
  intervalDays,
  isDue,
  newCard,
  retrievability,
  review
} from '../../src/shared/fsrs'
import { DAY, NOW, at } from './helpers'

describe('FSRS-6 forgetting curve', () => {
  it('starts at full recall and reaches 90% after S days', () => {
    expect(retrievability(0, 5)).toBe(1)
    for (const s of [0.5, 3, 20, 400]) expect(retrievability(s, s)).toBeCloseTo(0.9, 12)
  })

  it('decreases monotonically with time', () => {
    let prev = 1
    for (let t = 1; t < 60; t += 3) {
      const r = retrievability(t, 7)
      expect(r).toBeLessThan(prev)
      prev = r
    }
  })

  it('schedules the interval at which recall falls to the desired retention', () => {
    expect(intervalDays(10, 0.9)).toBeCloseTo(10, 10)
    expect(intervalDays(10, 0.95)).toBeLessThan(10)
    expect(intervalDays(10, 0.8)).toBeGreaterThan(10)
    const t = intervalDays(10, 0.85)
    expect(retrievability(t, 10)).toBeCloseTo(0.85, 10)
  })

  it('uses the published initial stabilities and orders difficulty by rating', () => {
    expect([1, 2, 3, 4].map((r) => initialStability(r as 1 | 2 | 3 | 4))).toEqual(FSRS6_DEFAULT_W.slice(0, 4))
    const ds = [1, 2, 3, 4].map((r) => initialDifficulty(r as 1 | 2 | 3 | 4))
    for (const d of ds) expect(d).toBeGreaterThanOrEqual(1)
    for (const d of ds) expect(d).toBeLessThanOrEqual(10)
    expect(ds[0]).toBeGreaterThan(ds[3])
  })
})

describe('review scheduling', () => {
  it('a first good answer schedules the next review in about two days', () => {
    const c = review(null, 3, NOW)
    expect(c.state).toBe('review')
    expect(c.reps).toBe(1)
    expect(c.lapses).toBe(0)
    expect((new Date(c.due!).getTime() - NOW.getTime()) / DAY).toBe(Math.round(intervalDays(FSRS6_DEFAULT_W[2])))
  })

  it('a failed first answer comes back the same day without counting a lapse', () => {
    const c = review(newCard(), 1, NOW)
    expect(c.state).toBe('learning')
    expect(c.lapses).toBe(0)
    const days = (new Date(c.due!).getTime() - NOW.getTime()) / DAY
    expect(days).toBeGreaterThan(0)
    expect(days).toBeLessThanOrEqual(0.5)
  })

  it('a successful review on the due date grows stability; forgetting shrinks it and counts a lapse', () => {
    const c1 = review(null, 3, NOW)
    const due = new Date(c1.due!)
    const good = review(c1, 3, due)
    expect(good.stability).toBeGreaterThan(c1.stability)
    expect(good.reps).toBe(2)
    const again = review(good, 1, new Date(good.due!))
    expect(again.stability).toBeLessThan(good.stability)
    expect(again.state).toBe('relearning')
    expect(again.lapses).toBe(1)
  })

  it('easy grows stability more than good, and good more than hard', () => {
    const c1 = review(null, 3, NOW)
    const when = at(5)
    const s = (r: 2 | 3 | 4): number => review(c1, r, when).stability
    expect(s(4)).toBeGreaterThan(s(3))
    expect(s(3)).toBeGreaterThan(s(2))
  })

  it('a same-day success never lowers stability', () => {
    const c1 = review(null, 3, NOW)
    const c2 = review(c1, 3, new Date(NOW.getTime() + 3600_000))
    expect(c2.stability).toBeGreaterThanOrEqual(c1.stability)
  })

  it('reports due cards and current recall', () => {
    const c = review(null, 3, NOW)
    expect(isDue(c, NOW)).toBe(false)
    expect(isDue(c, at(30))).toBe(true)
    expect(isDue(null, NOW)).toBe(false)
    expect(cardRetrievability(null, NOW)).toBeNull()
    expect(cardRetrievability(newCard(), NOW)).toBeNull()
    expect(cardRetrievability(c, NOW)).toBe(1)
    expect(cardRetrievability(c, at(1))!).toBeLessThan(1)
  })
})
