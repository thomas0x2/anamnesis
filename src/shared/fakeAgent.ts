// A scripted stand-in for the tutor agent: same events and tool calls as the Claude Code agent,
// with the demo tutor's generic content. Used by the in-browser demo, the dev server's fake mode and tests.
import type { AgentEvent, AgentStartRequest, AgentToolResult } from './agentTypes'
import { planStep, practiceStep, probeStep, teachStep, wrapStep, type Meta } from './fakeTutor'

type Emit = (e: AgentEvent) => void
interface FakeCard {
  kind: string
  title?: string | null
  nodeId?: string | null
  blocks: unknown[]
  interaction?: { type: string } | null
  speech?: string | null
}
interface Run {
  emit: Emit
  pending: Map<string, (r: AgentToolResult) => void>
  queue: string[]
  busy: boolean
  stopped: boolean
  started: boolean
  mode: string
  goal: string | null
}

const ASK = new Set(['probe', 'predict', 'check', 'practice', 'review', 'reflect'])

export class FakeAgentHost {
  private runs = new Map<string, Run>()
  private n = 0
  constructor(private delayMs = 120) {}

  async start(req: AgentStartRequest, emit: Emit): Promise<{ ok: boolean }> {
    this.stop(req.chatId)
    const mode = /Mode: (\w+)/.exec(req.system)?.[1]?.toLowerCase() ?? 'open'
    const goal = /\(id ([\w-]+)\)/.exec(req.system)?.[1] ?? null
    this.runs.set(req.chatId, { emit, pending: new Map(), queue: [], busy: false, stopped: false, started: !!req.resume, mode, goal })
    emit({ chatId: req.chatId, type: 'status', status: 'ready', model: 'demo' })
    return { ok: true }
  }

  send(chatId: string, text: string): boolean {
    const run = this.runs.get(chatId)
    if (!run) return false
    if (run.busy) run.queue.push(text)
    else void this.turn(chatId, run, text)
    return true
  }

  toolResult(chatId: string, callId: string, result: AgentToolResult): boolean {
    const p = this.runs.get(chatId)?.pending
    const fn = p?.get(callId)
    if (!fn) return false
    p!.delete(callId)
    fn(result)
    return true
  }

  stop(chatId: string): void {
    const run = this.runs.get(chatId)
    if (!run) return
    run.stopped = true
    this.runs.delete(chatId)
    for (const [id, fn] of run.pending) {
      run.emit({ chatId, type: 'tool_cancel', callId: id })
      fn({ text: 'cancelled', isError: true })
    }
    run.emit({ chatId, type: 'exit' })
  }

  private sleep(ms = this.delayMs): Promise<void> {
    return new Promise((r) => setTimeout(r, ms))
  }

  private async say(chatId: string, run: Run, text: string): Promise<void> {
    const blockId = `fb${++this.n}`
    run.emit({ chatId, type: 'status', status: 'writing' })
    for (const part of text.match(/.{1,24}(\s|$)/g) ?? [text]) {
      if (run.stopped) return
      run.emit({ chatId, type: 'text', blockId, delta: part })
      await this.sleep(this.delayMs / 6)
    }
  }

  private async tool(chatId: string, run: Run, name: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    if (run.stopped) throw new Error('stopped')
    const toolUseId = `ftu${++this.n}`
    const json = JSON.stringify(args)
    run.emit({ chatId, type: 'tool_input', toolUseId, name, json: json.slice(0, Math.floor(json.length / 2)), done: false })
    await this.sleep()
    run.emit({ chatId, type: 'tool_input', toolUseId, name, json, done: true })
    const callId = `fcall${++this.n}`
    const result = new Promise<AgentToolResult>((resolve) => run.pending.set(callId, resolve))
    run.emit({ chatId, type: 'tool_call', callId, name, args })
    const r = await result
    if (run.stopped) throw new Error('stopped')
    return r
  }

  /** Show one card; if the learner wrote instead of answering, reply and continue. */
  private async card(chatId: string, run: Run, c: FakeCard): Promise<void> {
    const ask = ASK.has(c.kind) && c.interaction && c.interaction.type !== 'continue'
    const r = ask
      ? await this.tool(chatId, run, 'ask', { kind: c.kind, title: c.title ?? null, blocks: c.blocks, interaction: c.interaction, speech: c.speech ?? null, nodeId: c.nodeId ?? null })
      : await this.tool(chatId, run, 'explain', { title: c.title ?? null, blocks: c.blocks, speech: c.speech ?? null, nodeId: c.nodeId ?? null })
    const wrote = /learner wrote(?: instead)?: "([\s\S]*)"/i.exec(r.text)?.[1]
    if (wrote) await this.say(chatId, run, `Good question. Think about what stays the same for every $j$. *(demo tutor; you asked: ${wrote.slice(0, 80)})* `)
  }

  private async turn(chatId: string, run: Run, text: string): Promise<void> {
    run.busy = true
    run.emit({ chatId, type: 'status', status: 'thinking' })
    await this.sleep()
    try {
      if (!run.started) {
        run.started = true
        await this.script(chatId, run)
      } else await this.say(chatId, run, `Good question. Think about what stays the same for every $j$. *(demo tutor; you asked: ${text.slice(0, 80)})*`)
      run.emit({ chatId, type: 'turn_end', ok: true, costUsd: 0 })
    } catch {
      /* stopped */
    }
    run.busy = false
    run.emit({ chatId, type: 'status', status: 'idle' })
    const next = run.queue.shift()
    if (next !== undefined && !run.stopped) void this.turn(chatId, run, next)
  }

  private async script(chatId: string, run: Run): Promise<void> {
    const m: Meta = { conceptId: run.goal ?? undefined }
    if (run.mode === 'practice' || run.mode === 'review') {
      await this.say(chatId, run, 'A few items at your level. Answer in the cards; type here any time to ask me something. ')
      for (let i = 0; i < 3; i++) {
        const step = practiceStep({ ...m, itemIndex: i, level: 1 + i }, run.mode as 'practice' | 'review') as { cards: FakeCard[] }
        for (const c of step.cards) await this.card(chatId, run, c)
      }
      await this.tool(chatId, run, 'finish', { takeaways: ['Practised three items at rising levels.'], pages: null })
      await this.say(chatId, run, 'That was the set. Well done.')
      return
    }
    await this.say(chatId, run, "Let's first see what you already know. Answer what you can; \"I don't know\" is a fine answer. ")
    for (const c of (probeStep(m) as { cards: FakeCard[] }).cards) await this.card(chatId, run, c)
    const plan = planStep(m) as { plan: { goal: string; approach: string; nodes: { id: string; kind: string; title: string }[] } }
    await this.tool(chatId, run, 'show_plan', plan.plan)
    await this.say(chatId, run, `Here is the plan: ${plan.plan.approach} `)
    for (const node of plan.plan.nodes.filter((n) => n.kind !== 'known')) {
      await this.tool(chatId, run, 'update_plan', { nodeId: node.id, status: 'current' })
      for (const c of (teachStep({ ...m, nodeId: node.id, nodeTitle: node.title }) as { cards: FakeCard[] }).cards) await this.card(chatId, run, c)
      await this.tool(chatId, run, 'update_plan', { nodeId: node.id, status: 'done' })
    }
    for (const c of (wrapStep(m) as { cards: FakeCard[] }).cards.filter((c) => c.kind !== 'summary')) await this.card(chatId, run, c)
    await this.tool(chatId, run, 'update_learner', { notes: [], misconceptions: [], profile: [] })
    await this.tool(chatId, run, 'finish', { takeaways: ['The weights depend only on the nodes.', 'Dividing by the interpolant of 1 cancels the shared factor.'], pages: null })
    await this.say(chatId, run, 'That is the whole chain. Nicely done.')
  }
}
