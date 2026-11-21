import { describe, expect, it } from 'vitest'
import { fakeResponse } from '../../src/shared/fakeTutor'
import { normalizeGrade, normalizeStep } from '../../src/shared/normalize'
import { buildGradePrompt, buildStepPrompt, buildSystemPrompt, conceptModelLine, CORE_RULES, relevantConcepts, transcript } from '../../src/shared/prompts'
import { gradeSchema, stepSchema } from '../../src/shared/schema'
import type { Card, LlmRequest } from '../../src/shared/types'
import { NOW, answer, course, emptyLearner, graph, makeSession } from './helpers'
import { recordMisconception } from '../../src/shared/mastery'

const goal = course.concepts.find((c) => c.chapter === 2 && graph.ancestors(c.id).length >= 2)!

describe('system prompt', () => {
  it('starts with the tutor rules and describes the learn session', () => {
    const s = makeSession({ goalConceptId: goal.id })
    const p = buildSystemPrompt(course, graph, s, [{ page: 50, text: 'Satz 2.2.3 ...' }])
    expect(p.startsWith(CORE_RULES)).toBe(true)
    expect(p).toContain(`Goal concept: ${goal.title} (id ${goal.id})`)
    expect(p).toContain('Prerequisites in the course graph')
    expect(p).toContain('[PDF page 50]')
  })

  it('lists the practice scope instead of a goal', () => {
    const ids = graph.chapterConcepts(3).slice(0, 3).map((c) => c.id)
    const p = buildSystemPrompt(course, graph, makeSession({ type: 'practice', scope: ids }), [])
    expect(p).toContain('Type: PRACTICE')
    for (const id of ids) expect(p).toContain(id)
    expect(p).not.toContain('# Script excerpts')
  })
})

describe('learner model in the prompt', () => {
  it('summarizes a concept with misconceptions and both kinds of notes', () => {
    const m = answer(emptyLearner(), goal.id, [{}, { score: 0 }])
    let cs = recordMisconception(m.concepts[goal.id], 'Divides by the wrong node difference', 'active', NOW)
    cs = { ...cs, tutorNote: 'Strong on definitions.', userNote: 'I confuse n and N.' }
    const line = conceptModelLine(graph, cs, goal.id, NOW)
    expect(line).toContain(`${goal.id} "${goal.title}"`)
    expect(line).toMatch(/mastery \d+%/)
    expect(line).toContain('active misconceptions: "Divides by the wrong node difference"')
    expect(line).toContain('tutor note: Strong on definitions.')
    expect(line).toContain("learner's own note (trust this): I confuse n and N.")
    expect(conceptModelLine(graph, undefined, goal.id, NOW)).toContain('no evidence yet')
  })

  it('marks profile notes the learner wrote, and includes the goal’s prerequisites', () => {
    const learner = emptyLearner()
    learner.profile = [
      { id: 'p1', text: 'Prefers pictures first.', source: 'seed', at: NOW.toISOString() },
      { id: 'p2', text: 'Rushes the last step.', source: 'tutor', at: NOW.toISOString() }
    ]
    const s = makeSession({ goalConceptId: goal.id })
    const p = buildStepPrompt(graph, learner, s, { phase: 'probe', probeRound: 1 }, NOW)
    expect(p).toContain('- Prefers pictures first. (from the learner)')
    expect(p).toContain('- Rushes the last step.\n')
    for (const a of graph.ancestors(goal.id, 3)) expect(p).toContain(a)
    expect(p).toContain('# Your task: PROBE (round 1)')
    expect(p).toContain('this is the first step')
    expect(relevantConcepts(graph, s, null)[0]).toBe(goal.id)
  })

  it('warns the model when a step is prepared in advance', () => {
    const s = makeSession({ type: 'practice', scope: [goal.id] })
    const target = { conceptId: goal.id, level: 2, cue: 'familiar' as const, compose: [], mode: 'apply' as const }
    const p = buildStepPrompt(graph, emptyLearner(), s, { phase: 'practice', target, itemIndex: 0, itemsGoal: 5, speculative: true }, NOW)
    expect(p).toContain('# Your task: PRACTICE item 1 of 5')
    expect(p).toContain('prepared in advance')
  })
})

describe('transcript', () => {
  it('describes cards and the learner’s responses compactly', () => {
    const card: Card = {
      kind: 'check',
      title: 'Evaluate the basis',
      nodeId: 'n1',
      speech: null,
      blocks: [],
      interaction: { type: 'numeric', prompt: 'Compute the value at 1.5', hints: ['h'], solution: 's', confidence: true, conceptIds: [goal.id], answer: { value: '0.75', tolerance: null, relative: false } }
    }
    const s = makeSession({
      goalConceptId: goal.id,
      steps: [
        {
          id: 'st1',
          phase: 'teach',
          nodeId: 'n1',
          target: null,
          step: { assessment: null, cards: [card], plan: null, model: null, control: { next: 'continue', nodeId: 'n1', nodeStatus: null } },
          responses: { 0: { answer: '0.7', answerText: '0.7', score: 0.5, verdict: 'partial', attempts: 2, hintsUsed: 1, revealed: false, confidence: 3, latencyMs: 9000, feedback: null, at: NOW.toISOString() } },
          createdAt: NOW.toISOString(),
          completedAt: NOW.toISOString(),
          durationMs: 1000,
          model: null
        }
      ]
    })
    const t = transcript(s)
    expect(t).toContain('## Step 1 · TEACH node n1')
    expect(t).toContain('check (numeric): Evaluate the basis Q: Compute the value at 1.5 [key 0.75]')
    expect(t).toContain('answered 0.7, ~ partial (50%), 2 attempts, 1 hint(s), confidence 3/4')
  })
})

describe('grading prompt', () => {
  it('includes the rubric, the model answer and the attempt history', () => {
    const card: Card = {
      kind: 'reflect',
      title: null,
      nodeId: null,
      speech: null,
      blocks: [],
      interaction: { type: 'free', prompt: 'Explain the chain.', hints: [], solution: 'S', confidence: false, conceptIds: [], rubric: ['names the nodes', 'states the cost'], modelAnswer: 'MA' }
    }
    const p = buildGradePrompt(card, 'my answer', 2, 'Close.')
    expect(p).toContain('- names the nodes')
    expect(p).toContain('Model answer (for you only): MA')
    expect(p).toContain('This is attempt 2. Your previous feedback: Close.')
    expect(p).toContain('"""\nmy answer\n"""')
  })
})

describe('schemas and the demo tutor', () => {
  it('declare the fields the app reads', () => {
    expect(stepSchema.required).toEqual(expect.arrayContaining(['cards', 'control']))
    expect(gradeSchema.required).toEqual(expect.arrayContaining(['score', 'verdict', 'feedback']))
  })

  it('the demo tutor produces a usable step for every phase', () => {
    const ctx = { conceptIds: new Set(course.concepts.map((c) => c.id)), defaultConceptId: goal.id }
    const req = (meta: Record<string, unknown>): LlmRequest => ({ id: 'r', kind: 'step', system: '', prompt: '', schema: {}, meta })
    const probe = normalizeStep(fakeResponse(req({ phase: 'probe', conceptId: goal.id, round: 1 })), ctx)
    expect(probe.cards.length).toBeGreaterThan(0)
    const plan = normalizeStep(fakeResponse(req({ phase: 'plan', conceptId: goal.id })), ctx)
    expect(plan.plan?.nodes.filter((n) => n.kind === 'goal')).toHaveLength(1)
    expect(plan.control.next).toBe('phase_done')
    const teach = normalizeStep(fakeResponse(req({ phase: 'teach', nodeId: plan.plan!.nodes[0].id, conceptId: goal.id })), ctx)
    expect(teach.cards.map((c) => c.kind)).toEqual(expect.arrayContaining(['predict', 'check']))
    const wrap = normalizeStep(fakeResponse(req({ phase: 'wrap', conceptId: goal.id })), ctx)
    expect(wrap.control.next).toBe('session_done')
    for (const phase of ['practice', 'review'])
      for (let i = 0; i < 4; i++) {
        const st = normalizeStep(fakeResponse(req({ phase, conceptId: goal.id, level: 2, itemIndex: i })), ctx)
        expect(st.cards[0].interaction?.type).not.toBe('continue')
      }
    const g = normalizeGrade(fakeResponse({ ...req({ answer: 'a long and careful explanation of every single step in the chain of reasoning' }), kind: 'grade' }))
    expect(g.verdict).toBe('correct')
  })
})
