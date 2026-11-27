// The learner writes to the tutor in the middle of a lesson: the message must reach the agent at the next card
// (a tutoring turn never ends while cards keep coming), and a card the learner set aside must not hide the
// tutor's answer or swallow a later answer to it.
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentToolResult } from '@shared/agentTypes'
import type { CardResponse } from '@shared/types'
import { ChatController, newChatRecord } from '../../src/renderer/src/engine/chat'

// the system prompt is not under test here
vi.mock('@shared/agentTools', async (orig) => ({ ...(await orig<object>()), buildAgentSystemPrompt: () => 'system', agentTools: () => [] }))
vi.mock('@shared/exam', async (orig) => ({ ...(await orig<object>()), prepSummary: () => null }))

function setup() {
  const sent: string[] = []
  const results: { callId: string; text: string }[] = []
  let emit: (e: AgentEvent) => void = () => {}
  const app = {
    course: { concepts: [{ id: 'fp', title: 'Floating point' }] },
    graph: { get: () => null, title: (id: string) => id },
    state: { get: () => ({ learner: { concepts: {}, profile: [] } }) },
    cheatsheet: { get: () => ({ rules: { allowed: 'no' }, items: [] }) },
    study: { settings: { enabled: false }, agentNote: () => null },
    exam: { get: () => null },
    materials: { get: () => [] },
    recordCard: () => {},
    touchChatIndex: async () => {},
    backend: {
      writeJson: async () => {},
      agentStart: async (_req: unknown, onEvent: (e: AgentEvent) => void) => {
        emit = onEvent
        return { ok: true }
      },
      agentSend: async (_id: string, text: string) => {
        sent.push(text)
        return true
      },
      agentToolResult: async (_id: string, callId: string, r: AgentToolResult) => {
        results.push({ callId, text: r.text })
      },
      agentStop: async () => {}
    }
  }
  const chat = newChatRecord('open', 'fp', ['fp'], 'Test')
  const cc = new ChatController(app as never, chat, null)
  const ev = (e: Record<string, unknown>) => emit({ chatId: chat.id, ...e } as AgentEvent)
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const ask = (callId: string, prompt: string) => ev({ type: 'tool_call', callId, name: 'ask', args: { kind: 'check', interaction: { type: 'numeric', prompt, answer: '1' } } })
  const explain = (callId: string, md: string) => ev({ type: 'tool_call', callId, name: 'explain', args: { title: md, blocks: [{ type: 'text', md }] } })
  const answer = (step: number): void =>
    (cc as unknown as { cardDone: (s: number, r: CardResponse) => void }).cardDone(step, {
      answer: '1',
      answerText: '1',
      score: 1,
      verdict: 'correct',
      attempts: 1,
      hintsUsed: 0,
      revealed: false,
      confidence: 3,
      latencyMs: 1000,
      feedback: null,
      missing: null,
      at: new Date().toISOString()
    })
  return { cc, sent, results, ev, tick, ask, explain, answer }
}

describe('questions in the middle of a tutoring turn', () => {
  it('a message written while the tutor works goes with its next card, not to the end of the turn', async () => {
    const t = setup()
    await t.cc.begin('start')
    await t.tick()
    t.ev({ type: 'status', status: 'thinking' })
    await t.cc.send('Is epsilon the smallest double?')
    expect(t.sent).toEqual(['start'])
    // the card the tutor was writing is turned back with the question
    t.ask('c1', 'Gap at 2^40?')
    await t.tick()
    expect(t.results[0].callId).toBe('c1')
    expect(t.results[0].text).toMatch(/not shown.*Is epsilon the smallest double/s)
    expect(t.cc.cards.s.steps.length).toBe(0)
    // nothing is left over for the end of the turn
    t.ev({ type: 'turn_end', ok: true, costUsd: 0 })
    await t.tick()
    expect(t.sent).toEqual(['start'])
  })

  it('a message written after the last card of a turn goes once the turn ends', async () => {
    const t = setup()
    await t.cc.begin('start')
    t.ev({ type: 'status', status: 'writing' })
    await t.cc.send('One more thing')
    t.ev({ type: 'turn_end', ok: true, costUsd: 0 })
    await t.tick()
    expect(t.sent).toEqual(['start', 'The learner wrote: "One more thing"'])
  })

  it('the tutor’s answer card goes ahead of the card the learner set aside, and a late answer still reaches the tutor', async () => {
    const t = setup()
    await t.cc.begin('start')
    t.ask('c1', 'Gap between 1 and the next double?')
    await t.tick()
    expect(t.cc.cards.view.get().cursor).toEqual({ step: 0, card: 0 })
    await t.cc.send('Where does the leading 1 come from?')
    expect(t.results.at(-1)).toMatchObject({ callId: 'c1' })
    expect(t.results.at(-1)!.text).toMatch(/wrote instead: "Where does the leading 1 come from\?"/)
    // the answer to the question shows at once, not behind the open card
    t.explain('c2', 'Normalized numbers start with 1.')
    await t.tick()
    expect(t.cc.cards.view.get().cursor).toEqual({ step: 1, card: 0 })
    expect(t.cc.cards.s.steps[0].setAside).toBe(true)
    // the learner answers the set-aside card after all (e.g. before the tutor showed its card): the tutor hears of it
    t.answer(0)
    await t.tick()
    t.answer(1)
    await t.tick()
    expect(t.results.at(-1)!.callId).toBe('c2')
    expect(t.results.at(-1)!.text).toMatch(/Meanwhile: \[The learner went back and answered the earlier card/)
  })

  it('the answer in a card’s reply field shows as a tutor note above that card', async () => {
    const t = setup()
    await t.cc.begin('start')
    t.ev({ type: 'tool_call', callId: 'c1', name: 'ask', args: { kind: 'probe', reply: 'Because every later error bound starts here.', interaction: { type: 'numeric', prompt: 'Gap?', answer: '1' } } })
    await t.tick()
    const note = t.cc.chat.items.find((it) => it.kind === 'assistant')
    expect(note).toMatchObject({ text: 'Because every later error bound starts here.', pos: 0 })
    // notes at pos 0 are shown before the cards of step 0
    expect(t.cc.cards.s.steps.length).toBe(1)
  })
})
