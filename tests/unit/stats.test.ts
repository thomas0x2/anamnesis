import { describe, expect, it } from 'vitest'
import { applyEvidence, newConceptState } from '../../src/shared/mastery'
import { rewardsForResponse, selfCheckReward } from '../../src/shared/rewards'
import {
  accuracyByLevel,
  activityByDay,
  allEvidence,
  brierScore,
  calibrationBins,
  chapterReadiness,
  confidenceBias,
  dueForecast,
  overview
} from '../../src/shared/stats'
import type { CalibrationPoint, CardResponse } from '../../src/shared/types'
import { NOW, answer, at, emptyLearner, emptyState, graph } from './helpers'

const pt = (confidence: number, correct: number): CalibrationPoint => ({ at: NOW.toISOString(), confidence, correct, conceptId: 'c' })

describe('calibration', () => {
  it('bins answers by stated confidence', () => {
    const bins = calibrationBins([pt(4, 1), pt(4, 0), pt(2, 1), pt(2, 1), pt(2, 0)])
    expect(bins.map((b) => b.n)).toEqual([0, 3, 0, 2])
    expect(bins[3]).toMatchObject({ confidence: 4, claimed: 0.95, observed: 0.5 })
    expect(bins[0].observed).toBeNull()
  })

  it('scores calibration with Brier and a signed bias', () => {
    expect(brierScore([])).toBeNull()
    expect(brierScore([pt(4, 1)])).toBeCloseTo(0.0025)
    expect(brierScore([pt(2, 1), pt(2, 0)])).toBeCloseTo(0.25)
    expect(confidenceBias([pt(4, 0), pt(4, 0)])).toBeCloseTo(0.95)
    expect(confidenceBias([pt(1, 1)])).toBeCloseTo(-0.75)
  })
})

describe('evidence summaries', () => {
  const learner = emptyLearner()
  answer(learner, 'a', [{ level: 1 }, { level: 3, score: 0 }, { kind: 'predict', score: 0 }], at(-2))
  answer(learner, 'b', [{ level: 3 }, { kind: 'review', level: 3, score: 0.5 }], NOW)
  const state = emptyState(learner)
  const evs = allEvidence(state)

  it('collects evidence in time order', () => {
    expect(evs).toHaveLength(5)
    for (let i = 1; i < evs.length; i++) expect(evs[i].at >= evs[i - 1].at).toBe(true)
  })

  it('reports accuracy by difficulty from practice and reviews only', () => {
    const acc = accuracyByLevel(evs)
    expect(acc[0]).toMatchObject({ level: 1, n: 1, mean: 1 })
    expect(acc[2]).toMatchObject({ level: 3, n: 3, mean: 0.5 })
    expect(acc[4]).toMatchObject({ n: 0, mean: null })
  })

  it('counts activity per day and leaves out predictions', () => {
    const days = activityByDay(evs, NOW, 7)
    expect(days).toHaveLength(7)
    expect(days.at(-1)!.n).toBe(2)
    expect(days.at(-3)!.n).toBe(2)
    expect(days.reduce((s, d) => s + d.n, 0)).toBe(4)
  })

  it('forecasts due reviews, counting overdue ones as today', () => {
    const f = dueForecast(state, at(10), 7)
    expect(f).toHaveLength(7)
    expect(f[0]).toBe(2)
  })

  it('summarizes readiness per chapter between 0 and 1', () => {
    const rows = chapterReadiness(graph, emptyState(), NOW)
    expect(rows).toHaveLength(graph.course.chapters.length)
    for (const r of rows) expect(r.readiness).toBe(0)
    const ch2 = graph.chapterConcepts(2).filter((c) => c.tier !== 'extra')
    const l = emptyLearner()
    for (const c of ch2) answer(l, c.id, Array(6).fill({ level: 3 }))
    const row = chapterReadiness(graph, emptyState(l), NOW).find((r) => r.chapter === 2)!
    expect(row.seen).toBe(ch2.length)
    expect(row.readiness).toBeGreaterThan(0.7)
    expect(row.readiness).toBeLessThanOrEqual(1)
  })

  it('gives an overview that ignores pretests', () => {
    const o = overview(graph, state, NOW)
    expect(o.items7d).toBe(4)
    expect(o.accuracy7d).toBeCloseTo((1 + 0 + 1 + 0.5) / 4)
  })
})

describe('insight points', () => {
  const resp = (patch: Partial<CardResponse>): CardResponse => ({
    answer: null,
    answerText: '',
    score: 1,
    verdict: 'correct',
    attempts: 1,
    hintsUsed: 0,
    revealed: false,
    confidence: 3,
    latencyMs: 1000,
    feedback: null,
    at: NOW.toISOString(),
    ...patch
  })
  const ctx = (cardKind: 'check' | 'practice' | 'review' | 'predict' | 'probe', response: CardResponse, level: number | null = null) => ({
    cardKind,
    response,
    conceptId: 'c',
    conceptTitle: 'Lagrange basis',
    level,
    sessionId: 's',
    now: NOW,
    before: null
  })
  const total = (evs: { points: number }[]): number => evs.reduce((s, e) => s + e.points, 0)

  it('pays for understanding, less with help, nothing for a revealed solution', () => {
    expect(total(rewardsForResponse(ctx('check', resp({}))))).toBe(10)
    expect(total(rewardsForResponse(ctx('check', resp({ hintsUsed: 1 }))))).toBe(7)
    expect(rewardsForResponse(ctx('check', resp({ revealed: true })))).toEqual([])
  })

  it('pays more for harder practice', () => {
    const l1 = total(rewardsForResponse(ctx('practice', resp({}), 1)))
    const l5 = total(rewardsForResponse(ctx('practice', resp({}), 5)))
    expect(l5).toBeGreaterThan(2 * l1)
  })

  it('rewards committing to a prediction even when it is wrong', () => {
    const r = rewardsForResponse(ctx('predict', resp({ score: 0, verdict: 'incorrect' })))
    expect(total(r)).toBe(2)
    expect(rewardsForResponse(ctx('predict', resp({ verdict: 'dontknow', score: null })))).toEqual([])
    expect(selfCheckReward('c', 's', NOW).points).toBe(3)
  })

  it('rewards calibration and honest uncertainty', () => {
    expect(rewardsForResponse(ctx('check', resp({ confidence: 4 }))).map((e) => e.kind)).toContain('calibrated')
    expect(rewardsForResponse(ctx('check', resp({ confidence: 1, score: 0, verdict: 'incorrect' }))).map((e) => e.kind)).toEqual(['honest'])
  })

  it('gives a hypercorrection bonus when a confident error is fixed unaided', () => {
    const before = applyEvidence(newConceptState('c'), { sessionId: 's', kind: 'check', conceptId: 'c', score: 0, hints: 0, attempts: 1, revealed: false, confidence: 4, level: null, cue: null, summary: '', primary: true }, at(-1)).state
    const r = rewardsForResponse({ ...ctx('check', resp({})), before })
    expect(r.map((e) => e.kind)).toContain('hypercorrection')
  })

  it('rewards spaced retention on reviews', () => {
    const before = applyEvidence(newConceptState('c'), { sessionId: 's', kind: 'check', conceptId: 'c', score: 1, hints: 0, attempts: 1, revealed: false, confidence: 3, level: null, cue: null, summary: '', primary: true }, at(-4)).state
    const r = rewardsForResponse({ ...ctx('review', resp({}), 2), before })
    expect(r.find((e) => e.kind === 'retained')?.reason).toBe('Still knew it after 4 days')
  })
})
