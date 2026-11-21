import { describe, expect, it } from 'vitest'
import {
  applyEvidence,
  effectiveScore,
  evidenceWeight,
  masteryMean,
  newConceptState,
  ratingFor,
  recordMisconception,
  updateLevel,
  type EvidenceInput
} from '../../src/shared/mastery'
import { NOW, answer, at, emptyLearner } from './helpers'

const base: EvidenceInput = {
  sessionId: 's',
  kind: 'check',
  conceptId: 'c',
  score: 1,
  hints: 0,
  attempts: 1,
  revealed: false,
  confidence: 3,
  level: null,
  cue: null,
  summary: 'x',
  primary: true
}

describe('credit for an answer', () => {
  it('help reduces credit and a revealed solution gives none', () => {
    expect(effectiveScore(1, 0, 1, false)).toBe(1)
    expect(effectiveScore(1, 1, 1, false)).toBeCloseTo(0.8)
    expect(effectiveScore(1, 0, 2, false)).toBeCloseTo(0.75)
    expect(effectiveScore(1, 10, 5, false)).toBeCloseTo(0.3)
    expect(effectiveScore(1, 0, 1, true)).toBe(0)
  })

  it('pretests weigh less than checks, and harder practice weighs more', () => {
    expect(evidenceWeight('predict', null)).toBeLessThan(evidenceWeight('probe', null))
    expect(evidenceWeight('probe', null)).toBeLessThan(evidenceWeight('check', null))
    expect(evidenceWeight('practice', 5)).toBeGreaterThan(evidenceWeight('practice', 1))
  })

  it('maps retrieval quality to FSRS ratings', () => {
    expect(ratingFor({ score: 1, hints: 0, revealed: true, confidence: 4 })).toBe(1)
    expect(ratingFor({ score: 0.3, hints: 0, revealed: false, confidence: 4 })).toBe(1)
    expect(ratingFor({ score: 1, hints: 2, revealed: false, confidence: 4 })).toBe(2)
    expect(ratingFor({ score: 1, hints: 0, revealed: false, confidence: 2 })).toBe(2)
    expect(ratingFor({ score: 1, hints: 0, revealed: false, confidence: 4 })).toBe(4)
    expect(ratingFor({ score: 0.9, hints: 1, revealed: false, confidence: 3 })).toBe(3)
  })
})

describe('applying evidence', () => {
  it('a correct check moves an unseen concept to developing and schedules a review', () => {
    const out = applyEvidence(newConceptState('c'), base, NOW)
    expect(masteryMean(out.state)).toBeCloseTo(2 / 3)
    expect(out.state.status).toBe('developing')
    expect(out.rating).toBe(3)
    expect(out.state.fsrs?.due).toBeTruthy()
    expect(out.state.understanding).toBe(1)
  })

  it('a wrong check leaves the concept introduced', () => {
    const out = applyEvidence(newConceptState('c'), { ...base, score: 0 }, NOW)
    expect(masteryMean(out.state)).toBeCloseTo(1 / 3)
    expect(out.state.status).toBe('introduced')
    expect(out.rating).toBe(1)
  })

  it('predictions and probes do not touch the memory schedule', () => {
    for (const kind of ['predict', 'probe'] as const) {
      const out = applyEvidence(newConceptState('c'), { ...base, kind }, NOW)
      expect(out.rating).toBeNull()
      expect(out.state.fsrs).toBeNull()
    }
  })

  it('secondary concepts of a composed item get evidence but no review', () => {
    const out = applyEvidence(newConceptState('c'), { ...base, kind: 'practice', primary: false, weightScale: 0.5 }, NOW)
    expect(out.state.fsrs).toBeNull()
    expect(out.evidence.weight).toBeCloseTo(0.5)
  })

  it('is pure: the previous state is not modified', () => {
    const prev = newConceptState('c')
    applyEvidence(prev, base, NOW)
    expect(prev.evidence).toHaveLength(0)
    expect(prev.alpha).toBe(1)
  })

  it('becomes proficient after unaided level-3 work, with one milestone', () => {
    let cs = newConceptState('c')
    const milestones: string[] = []
    for (let i = 0; i < 5; i++) {
      const out = applyEvidence(cs, { ...base, kind: 'practice', level: 3, cue: 'shifted' }, NOW)
      milestones.push(...out.milestones)
      cs = out.state
    }
    expect(cs.status).toBe('proficient')
    expect(milestones.filter((m) => m === 'proficient')).toHaveLength(1)
    expect(cs.transfer).toBe(1)
  })

  it('mastery needs success spread over separate days, not one long session', () => {
    const crammed = answer(emptyLearner(), 'c', Array(9).fill({ level: 4, cue: 'novel' }))
    expect(crammed.concepts.c.status).toBe('proficient')

    const spaced = emptyLearner()
    answer(spaced, 'c', Array(3).fill({ level: 4, cue: 'novel' }), NOW)
    answer(spaced, 'c', Array(3).fill({ level: 4, cue: 'novel' }), at(3))
    answer(spaced, 'c', Array(3).fill({ level: 4, cue: 'novel' }), at(6))
    expect(spaced.concepts.c.status).toBe('mastered')
    expect(spaced.concepts.c.masteredAt).toBeTruthy()
  })

  it('old evidence fades, so a run of failures pulls mastery back down', () => {
    const m = answer(emptyLearner(), 'c', Array(6).fill({ level: 2 }))
    const high = masteryMean(m.concepts.c)
    answer(m, 'c', Array(6).fill({ level: 2, score: 0 }))
    expect(masteryMean(m.concepts.c)).toBeLessThan(0.5)
    expect(high).toBeGreaterThan(0.8)
  })
})

describe('difficulty staircase (3 up, 1 down)', () => {
  it('moves up after three successes at the current level', () => {
    let cs = newConceptState('c')
    const changes: (string | null)[] = []
    for (let i = 0; i < 3; i++) {
      const r = updateLevel(cs, cs.level, 1)
      changes.push(r.change)
      cs = r.state
    }
    expect(changes).toEqual([null, null, 'up'])
    expect(cs.level).toBe(2)
    expect(cs.streak).toBe(0)
  })

  it('moves down after one failure at the current level, never below 1', () => {
    const cs = { ...newConceptState('c'), level: 3, streak: 2 }
    const r = updateLevel(cs, 3, 0)
    expect(r.change).toBe('down')
    expect(r.state.level).toBe(2)
    expect(updateLevel(newConceptState('c'), 1, 0).state.level).toBe(1)
  })

  it('easier items do not count toward a level up', () => {
    const cs = { ...newConceptState('c'), level: 3 }
    expect(updateLevel(cs, 2, 1).state.streak).toBe(0)
  })

  it('stops at level 5', () => {
    const cs = { ...newConceptState('c'), level: 5, streak: 2 }
    const r = updateLevel(cs, 5, 1)
    expect(r.change).toBeNull()
    expect(r.state.level).toBe(5)
  })
})

describe('misconceptions', () => {
  it('merges restatements of the same misconception and tracks resolution', () => {
    let cs = newConceptState('c')
    cs = recordMisconception(cs, 'Thinks Chebyshev nodes are equispaced on the interval', 'active', NOW)
    cs = recordMisconception(cs, 'thinks chebyshev nodes are equispaced', 'active', at(1))
    expect(cs.misconceptions).toHaveLength(1)
    expect(cs.misconceptions[0].count).toBe(2)
    cs = recordMisconception(cs, 'Chebyshev nodes equispaced', 'resolved', at(2))
    expect(cs.misconceptions[0].status).toBe('resolved')
    expect(cs.misconceptions[0].resolvedAt).toBeTruthy()
  })

  it('ignores resolving something that was never recorded', () => {
    const cs = recordMisconception(newConceptState('c'), 'Mixes up n and N', 'resolved', NOW)
    expect(cs.misconceptions).toHaveLength(0)
  })
})
