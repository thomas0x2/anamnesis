import { describe, expect, it } from 'vitest'
import {
  completeCardsFromPartial,
  normalizeBlock,
  normalizeCard,
  normalizeChat,
  normalizeGrade,
  normalizeInteraction,
  normalizePlan,
  normalizeStep,
  type NormalizeContext
} from '../../src/shared/normalize'

const ctx: NormalizeContext = { conceptIds: new Set(['lagrange', 'cheb-nodes']), defaultConceptId: 'lagrange' }

describe('blocks', () => {
  it('turns strings into text and strips math delimiters from equations', () => {
    expect(normalizeBlock('Hello')).toEqual({ type: 'text', md: 'Hello' })
    expect(normalizeBlock('  ')).toBeNull()
    expect(normalizeBlock({ type: 'equation', latex: '$$ x^2 $$' })?.latex).toBe('x^2')
    expect(normalizeBlock({ type: 'equation', latex: '\\[ \\int_0^1 f \\]' })?.latex).toBe('\\int_0^1 f')
    expect(normalizeBlock({ latex: 'a+b' })?.type).toBe('equation')
    expect(normalizeBlock({ type: 'weird', text: 'fallback' })).toEqual({ type: 'text', md: 'fallback' })
  })

  it('keeps plots only with at least one usable series and a valid range', () => {
    expect(normalizeBlock({ type: 'plot', plot: { series: [] } })).toBeNull()
    const p = normalizeBlock({ type: 'plot', plot: { xMin: 2, xMax: 1, series: [{ expr: 'sin(x)' }, { points: [['x', 2]] }, { label: 'empty' }] } })
    expect(p?.plot?.series).toHaveLength(1)
    expect(p!.plot!.xMax).toBeGreaterThan(p!.plot!.xMin)
  })

  it('reads widgets, also nested as a JSON string or written as a sketch with kit code', () => {
    const code = 'K.demo({ draw(p, g) { g.fn((x) => x * x) } })'
    expect(normalizeBlock({ type: 'widget', widget: { title: 'Parabola', code, height: 9000 } })?.widget).toEqual({ title: 'Parabola', code, caption: null, height: 720 })
    expect(normalizeBlock({ type: 'widget', widget: JSON.stringify({ code: '```js\n' + code + '\n```' }), md: 'Try it' })?.widget).toEqual({ title: null, code, caption: 'Try it', height: null })
    expect(normalizeBlock({ type: 'sketch', code, title: 'Old name' })).toMatchObject({ type: 'widget', widget: { title: 'Old name', code } })
    expect(normalizeBlock({ type: 'widget', widget: { code: '' }, md: 'fallback' })).toEqual({ type: 'text', md: 'fallback' })
    expect(normalizeBlock({ type: 'widget', widget: { code: 'x'.repeat(30_000) } })).toBeNull()
  })

  it('falls back to text for unknown demos and clamps sketch heights', () => {
    expect(normalizeBlock({ type: 'demo', demo: { id: 'not-a-demo' }, md: 'see the figure' })).toEqual({ type: 'text', md: 'see the figure' })
    const d = normalizeBlock({ type: 'demo', demo: { id: 'chebyshev', params: { n: 8 } } })
    expect(d?.demo).toEqual({ id: 'chebyshev', params: '{"n":8}', caption: null })
    expect(normalizeBlock({ type: 'sketch', html: '<canvas></canvas>', height: 5000 })?.height).toBe(720)
    expect(normalizeBlock({ type: 'script', page: '57.4' })?.page).toBe(57)
    expect(normalizeBlock({ type: 'mermaid', md: '```mermaid\ngraph LR; A-->B\n```' })?.md).toBe('graph LR; A-->B')
  })
})

describe('interactions', () => {
  it('turns an MCQ without a correct option into a free answer', () => {
    const it = normalizeInteraction({ type: 'mcq', prompt: 'Which?', options: ['a', 'b'], solution: 'Because.' }, ctx)!
    expect(it.type).toBe('free')
    expect(it.modelAnswer).toBe('Because.')
    expect(it.allowVoice).toBe(true)
  })

  it('repairs options: string options, duplicate ids, multi-select inferred', () => {
    const it = normalizeInteraction(
      {
        type: 'mcq',
        prompt: 'Pick',
        options: [
          { id: 'a', md: 'one', correct: true },
          { id: 'a', md: 'two', correct: true },
          { md: 'three' },
          { id: 'z', md: '' }
        ],
        misconceptions: [{ optionId: 'c', text: 'thinks three' }, { optionId: 'nope', text: 'dropped' }]
      },
      ctx
    )!
    expect(it.options!.map((o) => o.id)).toEqual(['a', 'a1', 'c'])
    expect(it.multi).toBe(true)
    expect(it.misconceptions).toEqual([{ optionId: 'c', text: 'thinks three' }])
  })

  it('keeps known concept ids, falls back to the session concept, clamps levels', () => {
    const it = normalizeInteraction({ type: 'numeric', prompt: 'x?', answer: '1/3', conceptIds: ['nope'], level: 9 }, ctx)!
    expect(it.conceptIds).toEqual(['lagrange'])
    expect(it.level).toBe(5)
    expect(it.answer).toEqual({ value: '1/3', tolerance: null, relative: false })
    expect(normalizeInteraction({ type: 'numeric', prompt: 'x?', conceptIds: ['cheb-nodes'] }, ctx)!.type).toBe('free')
  })

  it('maps positional blanks onto the template markers, or appends missing ones', () => {
    const mapped = normalizeInteraction({ type: 'fill', prompt: 'f', template: 'cost [[x]] and [[y]]', blanks: [{ accepted: ['O(n)'] }, { accepted: ['O(n^2)'] }] }, ctx)!
    expect(mapped.blanks!.map((b) => b.id)).toEqual(['x', 'y'])
    const appended = normalizeInteraction({ type: 'fill', prompt: 'f', template: 'cost:', blanks: [{ id: 'b1', accepted: ['n'] }] }, ctx)!
    expect(appended.template).toContain('[[b1]]')
    const broken = normalizeInteraction({ type: 'fill', prompt: 'f', template: 'a [[p]] b [[q]] c [[r]]', blanks: [{ id: 'z', accepted: ['n'] }] }, ctx)!
    expect(broken.type).toBe('free')
  })
})

describe('cards and steps', () => {
  it('drops empty cards and fills a missing prompt', () => {
    expect(normalizeCard({ kind: 'explain', blocks: [] }, ctx)).toBeNull()
    const c = normalizeCard({ kind: 'predict', blocks: ['What next?'], interaction: { type: 'free' } }, ctx)!
    expect(c.interaction!.prompt).toBe('What do you predict?')
    expect(normalizeCard({ kind: 'nonsense', blocks: ['x'] }, ctx)!.kind).toBe('explain')
  })

  it('normalizes a whole step with safe defaults', () => {
    const s = normalizeStep({ cards: [{ kind: 'explain', blocks: ['hi'] }, null], control: { next: 'jump', nodeStatus: 'weird' }, model: { notes: [{ conceptId: 'nope', note: 'x' }], profile: ['a', 'b', 'c', 'd'] } }, ctx)
    expect(s.cards).toHaveLength(1)
    expect(s.control).toEqual({ next: 'continue', nodeId: null, nodeStatus: null })
    expect(s.model).toEqual({ notes: [], misconceptions: [], profile: ['a', 'b', 'c'] })
    expect(normalizeStep('garbage', ctx).cards).toEqual([])
  })

  it('sanitizes a plan and keeps only known concept ids', () => {
    const p = normalizePlan({ goal: 'g', nodes: [{ id: 'a', title: 'A', conceptId: 'lagrange' }, { id: 'b', requires: ['a', 'x'], conceptId: 'unknown', kind: 'goal' }] }, ctx)!
    expect(p.nodes.map((n) => [n.id, n.conceptId, n.requires])).toEqual([
      ['a', 'lagrange', []],
      ['b', null, ['a']]
    ])
    expect(normalizePlan({ nodes: [] }, ctx)).toBeNull()
  })

  it('shows only finished cards while a step is still streaming', () => {
    const partial = { cards: [{ kind: 'explain', blocks: ['one'] }, { kind: 'explain', blocks: ['tw'] }] }
    expect(completeCardsFromPartial(partial, ctx)).toHaveLength(1)
    expect(completeCardsFromPartial({ ...partial, control: {} }, ctx)).toHaveLength(2)
    expect(completeCardsFromPartial(null, ctx)).toEqual([])
  })
})

describe('grades and chat', () => {
  it('clamps scores and derives a missing verdict', () => {
    expect(normalizeGrade({ score: 1.7 })).toMatchObject({ score: 1, verdict: 'correct' })
    expect(normalizeGrade({ score: '0.5' })).toMatchObject({ score: 0.5, verdict: 'partial' })
    expect(normalizeGrade({})).toMatchObject({ score: 0, verdict: 'incorrect', feedback: '', missing: [] })
  })

  it('never returns an empty chat reply', () => {
    expect(normalizeChat({}).blocks).toEqual([{ type: 'text', md: '…' }])
    expect(normalizeChat({ text: 'plain' }).blocks).toEqual([{ type: 'text', md: 'plain' }])
  })
})
