import { describe, expect, it } from 'vitest'
import { sanitizePlan, topoSort } from '../../src/shared/graph'
import { DEMO_IDS, type Plan, type PlanNode } from '../../src/shared/types'
import { answer, course, emptyLearner, graph } from './helpers'

describe('NumCS course data', () => {
  it('has unique ids and only known prerequisites', () => {
    const ids = course.concepts.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const c of course.concepts) for (const r of c.requires) expect(graph.get(r), `${c.id} requires ${r}`).toBeDefined()
  })

  it('is acyclic', () => {
    const state = new Map<string, number>()
    const visit = (id: string, path: string[]): void => {
      if (state.get(id) === 2) return
      if (state.get(id) === 1) throw new Error(`cycle: ${[...path, id].join(' → ')}`)
      state.set(id, 1)
      for (const r of graph.get(id)!.requires) visit(r, [...path, id])
      state.set(id, 2)
    }
    for (const c of course.concepts) expect(() => visit(c.id, [])).not.toThrow()
  })

  it('places every concept inside its chapter’s pages, with valid tiers and demos', () => {
    const chapters = new Map(course.chapters.map((ch) => [ch.number, ch]))
    for (const c of course.concepts) {
      const ch = chapters.get(c.chapter)
      expect(ch, c.id).toBeDefined()
      expect(['core', 'support', 'extra']).toContain(c.tier)
      for (const d of c.demos) expect(DEMO_IDS as readonly string[]).toContain(d)
      if (!c.pages.length) continue
      expect(c.pages).toHaveLength(2)
      expect(c.pages[0]).toBeLessThanOrEqual(c.pages[1])
      if (ch!.pages.length === 2) {
        expect(c.pages[0], c.id).toBeGreaterThanOrEqual(ch!.pages[0])
        expect(c.pages[1], c.id).toBeLessThanOrEqual(ch!.pages[1])
      }
    }
  })

  it('has chapters in increasing, non-overlapping page ranges', () => {
    const ranged = course.chapters.filter((c) => c.pages.length === 2)
    for (let i = 1; i < ranged.length; i++) expect(ranged[i].pages[0]).toBeGreaterThan(ranged[i - 1].pages[1])
  })
})

describe('CourseGraph', () => {
  const someWithPrereqs = course.concepts.find((c) => c.requires.length >= 2)!

  it('lists prerequisites nearest first and inverts them as descendants', () => {
    const anc = graph.ancestors(someWithPrereqs.id)
    expect(anc.slice(0, someWithPrereqs.requires.length).sort()).toEqual([...someWithPrereqs.requires].sort())
    for (const a of anc) expect(graph.descendants(a)).toContain(someWithPrereqs.id)
    expect(graph.ancestors(someWithPrereqs.id, 1).sort()).toEqual([...someWithPrereqs.requires].sort())
  })

  it('offers only concepts without prerequisites to a new learner, refreshers last', () => {
    const f = graph.frontier(emptyLearner())
    expect(f.length).toBeGreaterThan(0)
    for (const id of f) expect(graph.get(id)!.requires).toEqual([])
    const firstRefresher = f.findIndex((id) => graph.get(id)!.chapter === 0)
    if (firstRefresher >= 0) for (const id of f.slice(firstRefresher)) expect(graph.get(id)!.chapter).toBe(0)
  })

  it('unlocks a concept once all its prerequisites are developing', () => {
    const target = course.concepts.find((c) => c.requires.length === 1 && graph.get(c.requires[0])!.requires.length === 0)!
    const model = emptyLearner()
    expect(graph.frontier(model)).not.toContain(target.id)
    answer(model, target.requires[0], [{ kind: 'check' }])
    expect(model.concepts[target.requires[0]].status).toBe('developing')
    expect(graph.frontier(model)).toContain(target.id)
    expect(graph.frontier(model)).not.toContain(target.requires[0])
  })

  it('finds siblings that share a prerequisite', () => {
    const parent = course.concepts.find((c) => (graph.children.get(c.id) ?? []).length >= 2)!
    const [a, b] = graph.children.get(parent.id)!
    expect(graph.siblings(a)).toContain(b)
    expect(graph.siblings(a)).not.toContain(a)
  })
})

const node = (id: string, requires: string[] = [], kind: PlanNode['kind'] = 'new'): PlanNode => ({ id, title: id, detail: '', kind, requires, conceptId: null })
const isTopological = (nodes: PlanNode[]): boolean => nodes.every((n, i) => n.requires.every((r) => nodes.findIndex((m) => m.id === r) < i))

describe('plan sanitizing', () => {
  it('orders nodes so every step comes after what it builds on', () => {
    const out = topoSort([node('goal', ['b'], 'goal'), node('b', ['a']), node('a')])
    expect(out.map((n) => n.id)).toEqual(['a', 'b', 'goal'])
  })

  it('repairs a sloppy model plan: duplicate ids, unknown and self references, cycles, goals', () => {
    const plan: Plan = {
      goal: 'g',
      approach: '',
      nodes: [node('a', ['c', 'zzz', 'a']), node('b', ['a']), node('c', ['b']), node('b', ['a'], 'goal'), node('', [], 'goal'), node('d', ['b', 'b'], 'goal')]
    }
    const out = sanitizePlan(plan)
    const ids = out.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain("b'")
    for (const n of out.nodes) {
      expect(n.requires).not.toContain(n.id)
      for (const r of n.requires) expect(ids).toContain(r)
      expect(new Set(n.requires).size).toBe(n.requires.length)
    }
    expect(isTopological(out.nodes)).toBe(true)
    expect(out.nodes.filter((n) => n.kind === 'goal').map((n) => n.id)).toEqual(['d'])
  })

  it('makes the last node the goal when the model forgot one', () => {
    const out = sanitizePlan({ goal: '', approach: '', nodes: [node('a'), node('b', ['a'])] })
    expect(out.nodes.find((n) => n.kind === 'goal')?.id).toBe('b')
  })
})
