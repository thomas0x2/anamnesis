import { describe, expect, it } from 'vitest'
import { waitingCards } from '../../src/renderer/src/lib/waiting'

const steps = (...n: number[]) => n.map((k) => ({ step: { cards: Array.from({ length: k }) } }))

describe('tutor cards waiting behind the open one', () => {
  it('counts later cards of this step and all later steps', () => {
    expect(waitingCards(steps(1, 1), { step: 0, card: 0 })).toBe(1)
    expect(waitingCards(steps(1, 2, 1), { step: 0, card: 0 })).toBe(3)
    expect(waitingCards(steps(3), { step: 0, card: 1 })).toBe(1)
  })
  it('is zero once the learner has reached the newest card or gone past the end', () => {
    expect(waitingCards(steps(1, 1), { step: 1, card: 0 })).toBe(0)
    expect(waitingCards(steps(1), { step: 0, card: 1 })).toBe(0)
    expect(waitingCards([], { step: 0, card: 0 })).toBe(0)
  })
})
