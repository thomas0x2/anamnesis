import { describe, expect, it } from 'vitest'
import { blankMatches, gradeFill, gradeMcq, gradeNumeric, gradeOrder, normalizeAnswer } from '../../src/shared/grading'
import type { Interaction } from '../../src/shared/types'

const item = (patch: Partial<Interaction>): Interaction => ({ type: 'mcq', prompt: 'q', hints: [], solution: '', confidence: true, conceptIds: ['c'], ...patch })

const single = item({
  options: [
    { id: 'a', md: 'O(n)', correct: false, feedback: 'That is the cost of one evaluation, not the setup.' },
    { id: 'b', md: 'O(n^2)', correct: true, feedback: '' },
    { id: 'c', md: 'O(n^3)', correct: false, feedback: '' }
  ]
})
const multi = item({
  multi: true,
  options: [
    { id: 'a', md: 'A', correct: true, feedback: '' },
    { id: 'b', md: 'B', correct: true, feedback: '' },
    { id: 'c', md: 'C', correct: false, feedback: '' },
    { id: 'd', md: 'D', correct: false, feedback: '' }
  ]
})

describe('multiple choice', () => {
  it('grades a single-answer question and returns the feedback of the chosen option', () => {
    expect(gradeMcq(single, ['b'])).toMatchObject({ score: 1, verdict: 'correct' })
    const wrong = gradeMcq(single, ['a'])
    expect(wrong).toMatchObject({ score: 0, verdict: 'incorrect' })
    expect(wrong.feedback).toEqual(['That is the cost of one evaluation, not the setup.'])
    expect(gradeMcq(single, ['a', 'b']).score).toBe(0)
  })

  it('gives partial credit on multi-select, never full credit unless exact', () => {
    expect(gradeMcq(multi, ['a', 'b'])).toMatchObject({ score: 1, verdict: 'correct' })
    expect(gradeMcq(multi, ['a'])).toMatchObject({ score: 0.5, verdict: 'partial' })
    expect(gradeMcq(multi, ['a', 'c']).score).toBe(0)
    expect(gradeMcq(multi, ['a', 'b', 'c']).score).toBeLessThanOrEqual(0.75)
    expect(gradeMcq(multi, []).score).toBe(0)
  })
})

describe('numeric answers', () => {
  const num = (value: string, tolerance: number | null = null, relative = false): Interaction => item({ type: 'numeric', answer: { value, tolerance, relative } })

  it('accepts expressions and decimal commas', () => {
    expect(gradeNumeric(num('1/3'), '0.3333').verdict).toBe('correct')
    expect(gradeNumeric(num('0.125'), '2^-3').verdict).toBe('correct')
    expect(gradeNumeric(num('1.5'), '1,5').verdict).toBe('correct')
    expect(gradeNumeric(num('pi/4'), '0.7854').verdict).toBe('correct')
  })

  it('honours absolute and relative tolerances', () => {
    expect(gradeNumeric(num('1/3', 1e-6), '0.3333').verdict).toBe('partial')
    expect(gradeNumeric(num('1000', 0.01, true), '1009').verdict).toBe('correct')
    expect(gradeNumeric(num('1000', 0.001, true), '1009').verdict).toBe('partial')
  })

  it('explains a sign error and an unreadable answer', () => {
    expect(gradeNumeric(num('2.5'), '-2.5').feedback).toEqual(['Right magnitude, wrong sign.'])
    const bad = gradeNumeric(num('2'), 'two-ish')
    expect(bad.verdict).toBe('incorrect')
    expect(bad.feedback[0]).toMatch(/not a number/)
    expect(gradeNumeric(num('2'), '7').feedback).toEqual([])
  })
})

describe('ordering', () => {
  it('scores the share of pairs in the right order', () => {
    expect(gradeOrder(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd'])).toMatchObject({ score: 1, verdict: 'correct' })
    const swap = gradeOrder(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd'])
    expect(swap.score).toBeCloseTo(0.75)
    expect(swap.verdict).toBe('partial')
    expect(gradeOrder(['a', 'b', 'c'], ['c', 'b', 'a']).score).toBe(0)
    expect(gradeOrder(['a', 'b'], ['a']).score).toBe(0)
  })
})

describe('fill in the blanks', () => {
  it('normalizes notation before comparing', () => {
    expect(normalizeAnswer(' O(N log N) ')).toBe('o(nlogn)')
    expect(normalizeAnswer('x**2')).toBe('x^2')
    expect(normalizeAnswer('$n+1$')).toBe('n+1')
    expect(blankMatches(['n+1'], 'N + 1')).toBe(true)
    expect(blankMatches(['1/2'], '0.5')).toBe(true)
    expect(blankMatches(['n'], '')).toBe(false)
    expect(blankMatches(['n'], 'm')).toBe(false)
  })

  it('reports which blanks are right', () => {
    const it = item({
      type: 'fill',
      template: 'The DFT of length [[1]] costs [[2]] with the FFT.',
      blanks: [
        { id: '1', accepted: ['N', 'n'] },
        { id: '2', accepted: ['O(N log N)', 'O(n log n)'] }
      ]
    })
    const g = gradeFill(it, { '1': 'N', '2': 'O(N^2)' })
    expect(g.detail).toEqual({ '1': true, '2': false })
    expect(g).toMatchObject({ score: 0.5, verdict: 'partial' })
    expect(gradeFill(it, { '1': 'n', '2': 'O(n log n)' }).verdict).toBe('correct')
  })
})
