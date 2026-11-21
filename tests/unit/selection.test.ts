import { describe, expect, it } from 'vitest'
import { review } from '../../src/shared/fsrs'
import { newConceptState } from '../../src/shared/mastery'
import { cueForLevel, dueConcepts, makeTarget, modeForLevel, nextDue, practiceQueue, reviewQueue } from '../../src/shared/selection'
import { NOW, answer, at, course, emptyLearner, graph } from './helpers'

const chapter2 = graph.chapterConcepts(2).map((c) => c.id)

describe('practice targets', () => {
  it('makes cues less familiar and demands more composed as the level rises', () => {
    expect(cueForLevel(1, 0)).toBe('familiar')
    expect([0, 1, 2].map((i) => cueForLevel(2, i))).toEqual(['familiar', 'familiar', 'shifted'])
    expect(cueForLevel(3, 0)).toBe('shifted')
    expect(cueForLevel(5, 0)).toBe('novel')
    expect(modeForLevel(1, true, 0)).toBe('recall')
    expect(modeForLevel(2, true, 0)).toBe('apply')
    expect(modeForLevel(3, true, 0)).toBe('compose')
    expect(modeForLevel(3, false, 0)).toBe('discriminate')
    expect(modeForLevel(5, true, 0)).toBe('exam')
  })

  it('composes a level-3 item only with concepts the learner already has', () => {
    const goal = course.concepts.find((c) => c.requires.length > 0 && c.chapter === 2)!
    const model = emptyLearner()
    for (const r of graph.ancestors(goal.id, 2)) answer(model, r, [{}, {}])
    answer(model, goal.id, [{}])
    model.concepts[goal.id].level = 3
    const t = makeTarget(graph, model, goal.id, 0)
    expect(t.level).toBe(3)
    expect(t.compose.length).toBe(1)
    expect(model.concepts[t.compose[0]].status).not.toBe('unseen')
    expect(t.mode).toBe('compose')
    expect(makeTarget(graph, emptyLearner(), goal.id, 0, 3).compose).toEqual([])
  })
})

describe('practice queue', () => {
  it('interleaves: never the same concept twice in a row when there is a choice', () => {
    const model = emptyLearner()
    for (const id of chapter2.slice(0, 4)) answer(model, id, [{ score: 0.6 }])
    const q = practiceQueue(graph, model, chapter2.slice(0, 4), 8, NOW)
    expect(q).toHaveLength(8)
    for (let i = 1; i < q.length; i++) expect(q[i].conceptId).not.toBe(q[i - 1].conceptId)
    expect(new Set(q.map((t) => t.conceptId)).size).toBe(4)
  })

  it('puts the weakest concept first', () => {
    const [weak, strong] = chapter2
    const model = emptyLearner()
    answer(model, strong, [{}, {}, {}, {}])
    answer(model, weak, [{ score: 0 }, { score: 0.2 }])
    const q = practiceQueue(graph, model, [strong, weak], 2, NOW)
    expect(q[0].conceptId).toBe(weak)
  })

  it('uses only concepts the learner has seen, or the first few when nothing is seen yet', () => {
    const model = emptyLearner()
    answer(model, chapter2[1], [{}])
    const q = practiceQueue(graph, model, chapter2, 3, NOW)
    expect(q.every((t) => t.conceptId === chapter2[1])).toBe(true)
    const fresh = practiceQueue(graph, emptyLearner(), chapter2, 4, NOW)
    for (const t of fresh) expect(chapter2.slice(0, 6)).toContain(t.conceptId)
  })
})

describe('reviews', () => {
  it('queues due concepts, least retrievable first, at an easier level and a shifted cue', () => {
    const model = emptyLearner()
    const [a, b, c] = chapter2
    answer(model, a, [{}], at(-20))
    answer(model, b, [{}], at(-5))
    answer(model, c, [{}], NOW)
    model.concepts[a].level = 4
    expect(dueConcepts(model, NOW)).toEqual([a, b])
    const q = reviewQueue(graph, model, NOW)
    expect(q.map((t) => t.conceptId)).toEqual([a, b])
    expect(q[0]).toMatchObject({ level: 3, cue: 'shifted', compose: [], mode: 'apply' })
    expect(q[1]).toMatchObject({ level: 1, mode: 'recall' })
  })

  it('reports the next due date', () => {
    const model = emptyLearner()
    expect(nextDue(model)).toBeNull()
    model.concepts.x = { ...newConceptState('x'), fsrs: review(null, 3, at(2)) }
    model.concepts.y = { ...newConceptState('y'), fsrs: review(null, 3, NOW) }
    expect(nextDue(model)).toBe(model.concepts.y.fsrs!.due)
  })
})
