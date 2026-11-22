// A tutor session driven by an agent: one Claude Code agent with the app's tools. The agent writes
// short messages and calls tools; the app runs each tool here. Cards go into the session's
// SessionController in agent mode (the same screen, grading and evidence as guided sessions), a plan
// goes to the plan review and the side panel, look-ups read the course graph, the learner model and
// the lecture notes. The phase in the header follows the tools the agent uses.
import { AGENT_TOOLS, buildAgentSystemPrompt, type AgentMode } from '@shared/agentTools'
import type { AgentEvent, AgentToolResult } from '@shared/agentTypes'
import { sanitizePlan } from '@shared/graph'
import { getConcept } from '@shared/mastery'
import { normalizeCard, normalizeModelUpdate, normalizePlan, type NormalizeContext } from '@shared/normalize'
import { parsePartialJson } from '@shared/partialJson'
import { conceptModelLine, describeResponse } from '@shared/prompts'
import { dueConcepts } from '@shared/selection'
import type { Card, CardResponse, PlanNodeState, PlanState, PracticeTarget, Session, SessionType } from '@shared/types'
import { nowIso, truncate, uid } from '@shared/util'
import type { AppController } from './app'
import { SessionController } from './session'
import { createStore, type Store } from './store'

/** Every item remembers how many card steps existed when it was made (pos), to place it in the stream. */
export type ChatItem = { pos?: number } & (
  | { id: string; kind: 'user'; text: string; at: string }
  | { id: string; kind: 'assistant'; text: string; at: string }
  | {
      id: string
      kind: 'tool'
      name: string
      toolUseId: string | null
      callId: string | null
      json: string
      args: Record<string, unknown> | null
      status: 'streaming' | 'running' | 'done' | 'interrupted' | 'error'
      /** card tools: the step in the card session that holds the card */
      step: number | null
      result: string | null
      at: string
    }
  | { id: string; kind: 'note'; tone: 'info' | 'error'; text: string; at: string }
)

export type ToolItem = Extract<ChatItem, { kind: 'tool' }>

export interface ChatRecord {
  version: 1
  id: string
  title: string
  mode: AgentMode
  goalConceptId: string | null
  scope: string[]
  createdAt: string
  updatedAt: string
  /** Claude Code session id; resumed when the chat is reopened */
  cliSessionId: string
  cliStarted: boolean
  /** the card session (type "chat") that holds the agent's cards */
  sessionId: string
  items: ChatItem[]
  plan: PlanState | null
  finished: boolean
  costUsd: number
}

export interface ChatIndexEntry {
  id: string
  title: string
  mode: AgentMode
  goalConceptId: string | null
  updatedAt: string
}

export interface ChatView {
  chat: ChatRecord
  agent: 'off' | 'starting' | 'thinking' | 'writing' | 'waiting' | 'idle'
  model: string | null
  error: string | null
}

const CARD_TOOLS = new Set(['explain', 'ask'])
const ASK_KINDS = new Set(['probe', 'predict', 'check', 'practice', 'review', 'reflect'])

export function newChatRecord(mode: AgentMode, goalConceptId: string | null, scope: string[], title: string): ChatRecord {
  const t = nowIso()
  return {
    version: 1,
    id: uid('c_'),
    title,
    mode,
    goalConceptId,
    scope,
    createdAt: t,
    updatedAt: t,
    cliSessionId: crypto.randomUUID(),
    cliStarted: false,
    sessionId: uid('s_'),
    items: [],
    plan: null,
    finished: false,
    costUsd: 0
  }
}

export function sessionType(mode: AgentMode): SessionType {
  return mode === 'open' ? 'chat' : mode
}

export function chatSession(c: ChatRecord): Session {
  const type = sessionType(c.mode)
  return {
    id: c.sessionId,
    type,
    agentChatId: c.id,
    goalConceptId: c.goalConceptId,
    scope: c.scope,
    startedAt: c.createdAt,
    endedAt: null,
    phase: type === 'learn' ? 'probe' : type,
    steps: [],
    plan: null,
    currentNodeId: null,
    queue: [],
    itemsGoal: 0,
    chat: [],
    pointsEarned: 0,
    summary: null
  }
}

/** What the agent learns from one answered card. */
export function describeForAgent(card: Card, r: CardResponse): string {
  if (card.interaction?.type === 'continue' || !card.interaction) return 'read'
  const parts = [`The learner ${describeResponse(card, r)}.`]
  if (r.feedback) parts.push(`Feedback shown: ${truncate(r.feedback, 400)}`)
  if (r.reasoning) parts.push(`Their reasoning (spoken or typed): "${truncate(r.reasoning, 800)}"`)
  if (card.kind === 'probe' || card.kind === 'predict') {
    if (card.interaction.type === 'free' && r.answerText) parts.push(`Their words: "${truncate(r.answerText, 800)}"`)
  }
  parts.push(`Latency ${Math.round(r.latencyMs / 1000)} s.`)
  return parts.join(' ')
}

export class ChatController {
  readonly view: Store<ChatView>
  readonly cards: SessionController
  private ctx: NormalizeContext
  private waiters = new Map<number, (r: CardResponse) => void>()
  private planWaiter: ((s: Record<string, PlanNodeState>) => void) | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(
    private app: AppController,
    chat: ChatRecord,
    session: Session | null
  ) {
    // tool calls that were waiting when the app closed are gone: their cards stay answerable
    const items = chat.items.map((it) => (it.kind === 'tool' && (it.status === 'running' || it.status === 'streaming') ? { ...it, status: 'interrupted' as const, callId: null } : it))
    this.view = createStore<ChatView>({ chat: { ...chat, items }, agent: 'off', model: null, error: null })
    this.ctx = { conceptIds: new Set(app.course.concepts.map((c) => c.id)), defaultConceptId: chat.goalConceptId ?? chat.scope[0] ?? null }
    this.cards = new SessionController(app, session ?? chatSession(chat), {
      onCardDone: (step, _card, resp) => this.cardDone(step, resp),
      onPlanConfirmed: (nodeState) => this.planConfirmed(nodeState),
      retry: () => this.retry()
    })
  }

  get chat(): ChatRecord {
    return this.view.get().chat
  }

  // ------------------------------------------------------------ persistence
  private patch(fn: (c: ChatRecord) => ChatRecord): void {
    this.view.set((v) => ({ ...v, chat: { ...fn(v.chat), updatedAt: nowIso() } }))
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), 500)
  }

  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await Promise.all([this.app.backend.writeJson(`chats/${this.chat.id}`, this.chat), this.cards.save()])
    await this.app.touchChatIndex(this.chat)
  }

  private add(item: ChatItem): void {
    const pos = item.pos ?? this.cards.s.steps.length
    this.patch((c) => ({ ...c, items: [...c.items, { ...item, pos }] }))
  }

  private updateItem(id: string, fn: (it: ChatItem) => ChatItem): void {
    this.patch((c) => ({ ...c, items: c.items.map((it) => (it.id === id ? fn(it) : it)) }))
  }

  private setAgent(agent: ChatView['agent'], extra: Partial<ChatView> = {}): void {
    this.view.set((v) => ({ ...v, agent, ...extra }))
    const label = { starting: 'Starting the tutor…', thinking: 'The tutor is thinking…', writing: 'The tutor is writing…' }[agent as string] ?? null
    this.cards.setAgentStatus(label)
    if ('error' in extra) this.cards.setAgentError(extra.error ? { message: extra.error, kind: 'agent', canRetry: true } : null)
  }

  // ------------------------------------------------------------ agent lifecycle
  private async ensureAgent(): Promise<boolean> {
    if (this.running) return true
    this.setAgent('starting', { error: null })
    const c = this.chat
    const system = buildAgentSystemPrompt(this.app.course, this.app.graph, this.app.state.get().learner, { mode: c.mode, goalConceptId: c.goalConceptId, scope: c.scope, queue: this.cards.s.queue }, new Date())
    const settings = this.app.settings.get()
    const r = await this.app.backend.agentStart(
      { chatId: c.id, system, tools: AGENT_TOOLS, resume: c.cliStarted ? c.cliSessionId : null, sessionId: c.cliSessionId, model: settings.cli.model, effort: settings.cli.effort },
      (e) => this.onEvent(e)
    )
    if (!r.ok) {
      this.setAgent('off', { error: r.error ?? 'The tutor could not start.' })
      return false
    }
    this.running = true
    if (!c.cliStarted) this.patch((x) => ({ ...x, cliStarted: true }))
    return true
  }

  /** The learner writes in the chat. A card the agent is waiting on gets the message as its result. */
  async send(text: string): Promise<void> {
    const t = text.trim()
    if (!t) return
    this.add({ id: uid('m_'), kind: 'user', text: t, at: nowIso() })
    const waiting = this.chat.items.find((it): it is ToolItem => it.kind === 'tool' && it.status === 'running' && (CARD_TOOLS.has(it.name) || it.name === 'show_plan') && !!it.callId)
    if (waiting?.name === 'show_plan' && this.running) {
      this.planWaiter = null
      this.updateItem(waiting.id, (it) => ({ ...(it as ToolItem), status: 'interrupted' }))
      await this.reply(waiting, { text: `The learner has not confirmed the plan yet (it stays on screen). The learner wrote instead: "${t}"` })
      return
    }
    if (waiting && this.running) {
      this.updateItem(waiting.id, (it) => ({ ...(it as ToolItem), status: 'interrupted' }))
      await this.reply(waiting, { text: `The learner did not answer this card yet. The learner wrote instead: "${t}"` })
      return
    }
    await this.message(t)
  }

  /** Kick off the agent for a fresh chat. */
  async begin(opening: string): Promise<void> {
    await this.message(opening)
  }

  private async message(text: string): Promise<void> {
    if (!(await this.ensureAgent())) return
    this.setAgent('thinking')
    const ok = await this.app.backend.agentSend(this.chat.id, text)
    if (!ok) {
      this.running = false
      if (await this.ensureAgent()) await this.app.backend.agentSend(this.chat.id, text)
    }
  }

  async stop(): Promise<void> {
    this.running = false
    await this.app.backend.agentStop(this.chat.id).catch(() => {})
    this.setAgent('off')
    await this.save()
  }

  async retry(): Promise<void> {
    this.setAgent('off', { error: null })
    await this.message('Please continue where we left off.')
  }

  // ------------------------------------------------------------ events
  private onEvent(e: AgentEvent): void {
    switch (e.type) {
      case 'status':
        if (e.status === 'ready') this.view.set((v) => ({ ...v, model: e.model ?? v.model }))
        else if (e.status === 'idle') this.setAgent(this.hasWaiting() ? 'waiting' : 'idle')
        else if (e.status === 'thinking' || e.status === 'writing') this.setAgent(e.status)
        else this.setAgent('starting')
        return
      case 'text': {
        const id = `a_${e.blockId}`
        const exists = this.chat.items.some((it) => it.id === id)
        if (!exists) this.add({ id, kind: 'assistant', text: e.delta, at: nowIso() })
        else this.updateItem(id, (it) => ({ ...(it as Extract<ChatItem, { kind: 'assistant' }>), text: (it as { text: string }).text + e.delta }))
        return
      }
      case 'tool_input': {
        const existing = this.chat.items.find((it): it is ToolItem => it.kind === 'tool' && it.toolUseId === e.toolUseId)
        if (!existing && CARD_TOOLS.has(e.name)) this.cards.setAgentStatus(e.name === 'ask' ? 'Writing a question…' : 'Writing the next card…')
        if (existing) this.updateItem(existing.id, (it) => ({ ...(it as ToolItem), json: e.json }))
        else
          this.add({ id: uid('tl_'), kind: 'tool', name: e.name, toolUseId: e.toolUseId, callId: null, json: e.json, args: null, status: 'streaming', step: null, result: null, at: nowIso() })
        return
      }
      case 'tool_call':
        void this.runTool(e.callId, e.name, e.args)
        return
      case 'tool_cancel': {
        const it = this.chat.items.find((x): x is ToolItem => x.kind === 'tool' && x.callId === e.callId)
        if (it && it.status === 'running') this.updateItem(it.id, (x) => ({ ...(x as ToolItem), status: 'interrupted' }))
        return
      }
      case 'turn_end':
        if (e.costUsd) this.patch((c) => ({ ...c, costUsd: c.costUsd + (e.costUsd ?? 0) }))
        if (!e.ok) this.add({ id: uid('n_'), kind: 'note', tone: 'error', text: e.error || 'The tutor stopped with an error.', at: nowIso() })
        this.setAgent(this.hasWaiting() ? 'waiting' : 'idle')
        return
      case 'exit':
        this.running = false
        for (const it of this.chat.items) if (it.kind === 'tool' && it.status === 'running') this.updateItem(it.id, (x) => ({ ...(x as ToolItem), status: 'interrupted', callId: null }))
        this.setAgent('off', e.error ? { error: e.error } : {})
        return
    }
  }

  private hasWaiting(): boolean {
    return this.chat.items.some((it) => it.kind === 'tool' && it.status === 'running')
  }

  private async reply(item: ToolItem, result: AgentToolResult): Promise<void> {
    if (!item.callId) return
    this.updateItem(item.id, (it) => ({ ...(it as ToolItem), result: truncate(result.text, 2000), status: (it as ToolItem).status === 'interrupted' ? 'interrupted' : result.isError ? 'error' : 'done' }))
    await this.app.backend.agentToolResult(this.chat.id, item.callId, result)
    if (!this.hasWaiting() && this.view.get().agent === 'waiting') this.setAgent('thinking')
  }

  private async runTool(callId: string, name: string, args: Record<string, unknown>): Promise<void> {
    // the call follows its streamed input: attach it to that item
    let item = [...this.chat.items].reverse().find((it): it is ToolItem => it.kind === 'tool' && it.name === name && !it.callId && it.status === 'streaming')
    if (item) this.updateItem(item.id, (it) => ({ ...(it as ToolItem), callId, args, status: 'running' }))
    else this.add({ id: uid('tl_'), kind: 'tool', name, toolUseId: null, callId, json: JSON.stringify(args), args, status: 'running', step: null, result: null, at: nowIso() })
    item = this.chat.items.find((it): it is ToolItem => it.kind === 'tool' && it.callId === callId)!
    if (CARD_TOOLS.has(name) || name === 'show_plan') this.setAgent('waiting')
    let result: AgentToolResult
    try {
      result = await this.execute(item, name, args)
    } catch (e) {
      result = { text: `Tool error: ${String((e as Error)?.message ?? e)}`, isError: true }
    }
    const now = this.chat.items.find((it): it is ToolItem => it.kind === 'tool' && it.id === item!.id)
    if (now && now.status !== 'interrupted') await this.reply(now, result)
  }

  private async execute(item: ToolItem, name: string, args: Record<string, unknown>): Promise<AgentToolResult> {
    switch (name) {
      case 'explain':
      case 'ask': {
        const kind = name === 'explain' ? 'explain' : ASK_KINDS.has(String(args.kind)) ? String(args.kind) : 'check'
        const card = normalizeCard({ ...args, kind, interaction: name === 'explain' ? null : args.interaction }, this.ctx)
        if (!card) return { text: 'The card was empty or invalid: it needs blocks (explain) or an interaction (ask).', isError: true }
        if (name === 'ask' && card.interaction?.type === 'continue') return { text: 'ask needs a real interaction (mcq, numeric, free, order or fill). Use explain for content.', isError: true }
        this.followPhase(card)
        const target = this.target(args.item)
        const step = this.cards.pushStep([card], card.nodeId, target)
        this.updateItem(item.id, (it) => ({ ...(it as ToolItem), step }))
        const resp = await new Promise<CardResponse>((resolve) => this.waiters.set(step, resolve))
        return { text: describeForAgent(card, resp) }
      }
      case 'show_plan': {
        const p = normalizePlan(args, this.ctx)
        if (!p || !p.nodes.length) return { text: 'The plan needs nodes.', isError: true }
        const plan = sanitizePlan(p)
        const confirmed = new Promise<Record<string, PlanNodeState>>((resolve) => (this.planWaiter = resolve))
        this.cards.showPlan(plan)
        const st = await confirmed
        const known = plan.nodes.filter((n) => st[n.id] === 'known')
        const teach = plan.nodes.filter((n) => st[n.id] !== 'known')
        return {
          text: `The learner reviewed the plan. Already known (skip, use as anchors): ${known.map((n) => `${n.id} "${n.title}"`).join(', ') || 'none'}. To teach, in order: ${teach.map((n) => `${n.id} "${n.title}"`).join(', ') || 'none'}.`
        }
      }
      case 'update_plan': {
        const ps = this.cards.s.plan
        const id = String(args.nodeId ?? '')
        if (!ps || !ps.plan.nodes.some((n) => n.id === id)) return { text: `No plan node "${id}". Call show_plan first.`, isError: true }
        const st = String(args.status)
        this.cards.setNodeState(id, st === 'current' ? 'active' : st === 'done' ? 'done' : st === 'shaky' ? 'shaky' : 'pending')
        return { text: 'ok' }
      }
      case 'read_script':
        return this.readScript(args)
      case 'course':
        return this.course(args)
      case 'learner':
        return this.learner(args)
      case 'update_learner': {
        const u = normalizeModelUpdate(args, this.ctx)
        if (!u) return { text: 'Nothing to update.', isError: true }
        this.app.applyModelUpdate(u)
        return { text: `Recorded ${u.notes.length} note(s), ${u.misconceptions.length} misconception(s), ${u.profile.length} profile line(s).` }
      }
      case 'finish': {
        const takeaways = (Array.isArray(args.takeaways) ? args.takeaways : []).map(String).filter(Boolean)
        const pages = (Array.isArray(args.pages) ? args.pages : []).map(Number).filter((n) => Number.isFinite(n) && n > 0)
        const blocks = [
          { type: 'text', md: takeaways.map((t) => `- ${t}`).join('\n') },
          ...pages.slice(0, 3).map((page) => ({ type: 'script', page, label: null, md: 'Reread' }))
        ]
        const card = normalizeCard({ kind: 'summary', title: 'Takeaways', blocks }, this.ctx)
        if (card) {
          const step = this.cards.pushStep([card])
          this.updateItem(item.id, (it) => ({ ...(it as ToolItem), step }))
        }
        this.patch((c) => ({ ...c, finished: true }))
        this.cards.setPhase('wrap')
        await this.cards.finish()
        return { text: 'Summary shown and the session recorded. The learner can keep chatting.' }
      }
      default:
        return { text: `Unknown tool ${name}`, isError: true }
    }
  }

  /** The header's phase follows what the agent does: probing, teaching a node, wrapping up. */
  private followPhase(card: Card): void {
    const s = this.cards.s
    if (s.type !== 'learn') return
    if (card.kind === 'probe' && !s.plan) this.cards.setPhase('probe')
    else if (card.kind === 'reflect' || card.kind === 'summary') this.cards.setPhase('wrap')
    else if (card.nodeId && s.plan?.plan.nodes.some((n) => n.id === card.nodeId) && s.plan.nodeState[card.nodeId] !== 'active' && s.plan.nodeState[card.nodeId] !== 'done')
      this.cards.setNodeState(card.nodeId, 'active')
    else if (s.plan && s.phase !== 'teach' && s.phase !== 'wrap' && card.kind !== 'probe') this.cards.setPhase('teach')
  }

  /** Practice and review items come from the app's queue (spacing, levels); the agent names the item. */
  private target(item: unknown): PracticeTarget | null {
    const q = this.cards.s.queue
    const n = Number(item)
    if (!q.length || !Number.isInteger(n) || n < 1 || n > q.length) return null
    return q[n - 1]
  }

  private planConfirmed(nodeState: Record<string, PlanNodeState>): void {
    const w = this.planWaiter
    this.planWaiter = null
    if (w) return w(nodeState)
    // the plan tool call is gone (the learner wrote meanwhile, or the app restarted)
    const nodes = this.cards.s.plan?.plan.nodes ?? []
    void this.message(
      `[The learner confirmed the plan. Already known: ${nodes.filter((n) => nodeState[n.id] === 'known').map((n) => n.id).join(', ') || 'none'}. To teach: ${nodes.filter((n) => nodeState[n.id] !== 'known').map((n) => n.id).join(', ') || 'none'}.]`
    )
  }

  private cardDone(step: number, resp: CardResponse): void {
    const w = this.waiters.get(step)
    if (w) {
      this.waiters.delete(step)
      w(resp)
      return
    }
    // a card whose tool call is gone (the learner wrote instead, or the app restarted)
    const item = this.chat.items.find((it): it is ToolItem => it.kind === 'tool' && it.step === step)
    const card = this.cards.s.steps[step]?.step.cards[0]
    if (!item || !card || card.interaction?.type === 'continue') return
    this.updateItem(item.id, (it) => ({ ...(it as ToolItem), result: describeForAgent(card, resp) }))
    void this.message(`[The learner went back and answered the earlier card "${truncate(card.interaction?.prompt ?? card.title ?? '', 120)}": ${describeForAgent(card, resp)}]`)
  }

  // ------------------------------------------------------------ look-ups
  private readScript(args: Record<string, unknown>): AgentToolResult {
    const sc = this.app.script
    if (!sc.ready) return { text: 'The lecture notes PDF is not loaded in the app (the learner can add it in Settings). Use the page references from the course concepts instead.' }
    const pages = Array.isArray(args.pages) ? args.pages.map(Number).filter((n) => Number.isFinite(n)) : []
    if (pages.length) {
      const a = Math.max(1, Math.round(pages[0]))
      const b = Math.max(a, Math.min(a + 3, Math.round(pages[1] ?? pages[0])))
      const got = sc.range([a, b], 4)
      if (!got.length) return { text: `No text on pages ${a}-${b}.` }
      return { text: got.map((p) => `[PDF page ${p.page}]\n${p.text.trim()}`).join('\n\n') }
    }
    const q = typeof args.query === 'string' ? args.query : ''
    if (!q.trim()) return { text: 'Give pages or a query.', isError: true }
    const hits = sc.search(q, 12)
    if (!hits.length) return { text: `No matches for "${q}".` }
    return { text: hits.map((h) => `p. ${h.page} ${h.title}: ${h.snippet}`).join('\n') }
  }

  private course(args: Record<string, unknown>): AgentToolResult {
    const g = this.app.graph
    const ids = Array.isArray(args.conceptIds) ? args.conceptIds.map(String).filter((id) => g.get(id)) : []
    if (ids.length) {
      return {
        text: ids
          .slice(0, 12)
          .map((id) => {
            const c = g.get(id)!
            return [
              `${c.id}: ${c.title} (${c.de}), chapter ${c.chapter}, ${c.tier}`,
              `  summary: ${c.summary}`,
              `  why: ${c.why}`,
              `  requires: ${c.requires.map((r) => `${r} (${g.title(r)})`).join(', ') || 'nothing'}`,
              `  enables: ${g.descendants(id, 1).map((r) => `${r} (${g.title(r)})`).join(', ') || 'nothing'}`,
              `  script: ${c.refs.join(', ') || 'no labels'}${c.pages.length ? `, PDF pages ${c.pages[0]}-${c.pages[1]}` : ''}`,
              c.demos.length ? `  demos: ${c.demos.join(', ')}` : ''
            ]
              .filter(Boolean)
              .join('\n')
          })
          .join('\n\n')
      }
    }
    const q = String(args.query ?? '').toLowerCase().trim()
    const list = this.app.course.concepts.filter((c) => !q || `${c.id} ${c.title} ${c.de} ${c.summary}`.toLowerCase().includes(q))
    if (!list.length) return { text: `No concept matches "${q}".` }
    return { text: list.slice(0, 40).map((c) => `${c.id}: ${c.title} (${c.de}) [ch. ${c.chapter}]`).join('\n') }
  }

  private learner(args: Record<string, unknown>): AgentToolResult {
    const g = this.app.graph
    const learner = this.app.state.get().learner
    const now = new Date()
    const due = dueConcepts(learner, now).filter((id) => g.get(id))
    let ids = Array.isArray(args.conceptIds) ? args.conceptIds.map(String).filter((id) => g.get(id)) : []
    if (!ids.length) ids = [...new Set([...Object.keys(learner.concepts).filter((id) => getConcept(learner, id).evidence.length), ...due])].filter((id) => g.get(id))
    const lines = ids.slice(0, 40).map((id) => conceptModelLine(g, learner.concepts[id], id, now))
    const out = [lines.length ? lines.join('\n') : 'No evidence about any concept yet: this learner is new to the app.']
    out.push('', due.length ? `Due for spaced review now: ${due.slice(0, 15).map((id) => `${id} (${g.title(id)})`).join(', ')}` : 'Nothing is due for review.')
    if (learner.profile.length) out.push('', 'Profile:', ...learner.profile.slice(-12).map((p) => `- ${p.text}`))
    return { text: out.join('\n') }
  }

  /** A streamed, not yet called card tool: the parsed partial input, for an early preview. */
  static preview(item: ToolItem): Record<string, unknown> | null {
    if (item.args) return item.args
    const p = parsePartialJson(item.json)
    return p.value && typeof p.value === 'object' ? (p.value as Record<string, unknown>) : null
  }
}
