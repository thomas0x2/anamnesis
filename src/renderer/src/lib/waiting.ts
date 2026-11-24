// How many tutor cards are posted but not shown yet, because the learner is still on an earlier one.

/** Cards posted after the one the learner is on (later cards of this step and all later steps). */
export function waitingCards(steps: { step: { cards: unknown[] } }[], cursor: { step: number; card: number }): number {
  let n = 0
  steps.forEach((rec, si) => {
    if (si === cursor.step) n += Math.max(0, rec.step.cards.length - cursor.card - 1)
    else if (si > cursor.step) n += rec.step.cards.length
  })
  return n
}
