import { describe, expect, it } from 'vitest'
import { parsePartialJson } from '../../src/shared/partialJson'

const doc = {
  assessment: 'Knows the definition; unsure about the cost.',
  cards: [
    { kind: 'predict', title: 'Guess first', blocks: [{ type: 'text', md: 'What is $\\ell_j(x_k)$?\nThink "δ".' }], interaction: { type: 'mcq', options: [{ id: 'a', md: '1', correct: true }] } },
    { kind: 'explain', blocks: [{ type: 'equation', latex: '\\sum_{j=0}^n y_j \\ell_j(x)' }], interaction: { type: 'continue', hints: [], level: 2, ratio: -1.5e-3 } }
  ],
  plan: null,
  control: { next: 'continue', ok: true, done: false }
}

describe('streaming JSON parser', () => {
  it('parses a complete document exactly like JSON.parse', () => {
    const src = JSON.stringify(doc, null, 2)
    const r = parsePartialJson(src)
    expect(r.complete).toBe(true)
    expect(r.value).toEqual(JSON.parse(src))
  })

  it('never throws on any prefix and only grows what it shows', () => {
    const src = JSON.stringify(doc)
    let lastCards = 0
    for (let i = 0; i <= src.length; i++) {
      const r = parsePartialJson(src.slice(0, i))
      expect(r.complete).toBe(i === src.length)
      const cards = (r.value as { cards?: unknown[] } | undefined)?.cards?.length ?? 0
      expect(cards).toBeGreaterThanOrEqual(lastCards)
      lastCards = cards
    }
  })

  it('keeps an open string and closes open containers', () => {
    const r = parsePartialJson('{"cards":[{"kind":"explain","blocks":[{"type":"text","md":"Hel')
    expect(r.complete).toBe(false)
    expect(r.value).toEqual({ cards: [{ kind: 'explain', blocks: [{ type: 'text', md: 'Hel' }] }] })
  })

  it('drops a dangling key or a half-written literal', () => {
    expect(parsePartialJson('{"a":1,"b').value).toEqual({ a: 1 })
    expect(parsePartialJson('{"a":1,"b":').value).toEqual({ a: 1 })
    expect(parsePartialJson('{"a":tr').value).toEqual({})
    expect(parsePartialJson('[1,2,nu').value).toEqual([1, 2])
  })

  it('decodes escapes and stops cleanly inside a half-written escape', () => {
    expect(parsePartialJson('{"s":"a\\nb\\u00e9\\"q\\""}').value).toEqual({ s: 'a\nbé"q"' })
    expect(parsePartialJson('{"s":"abc\\').value).toEqual({ s: 'abc' })
    expect(parsePartialJson('{"s":"x\\u00').value).toEqual({ s: 'x' })
  })

  it('reads numbers in every JSON form', () => {
    expect(parsePartialJson('{"n":-1.5e3,"m":0,"k":12.25}').value).toEqual({ n: -1500, m: 0, k: 12.25 })
  })

  it('stops at malformed input instead of guessing', () => {
    const r = parsePartialJson('{"a":1 "b":2}')
    expect(r.complete).toBe(false)
    expect(r.value).toEqual({ a: 1 })
  })
})
