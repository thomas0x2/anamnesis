// Application controller: owns the course graph, the persistent learner model, settings,
// the script index, rewards, routing and the active session.
import courseJson from '@courses/numcs/course.json'
import { CourseGraph } from '@shared/graph'
import { applyEvidence, getConcept, recordMisconception, updateLevel, type EvidenceInput } from '@shared/mastery'
import { milestoneReward, rewardsForResponse } from '@shared/rewards'
import type {
  AppState,
  Backend,
  Card,
  CardResponse,
  ConceptState,
  Course,
  DeepPartial,
  EvidenceKind,
  ModelUpdate,
  PracticeTarget,
  RewardEvent,
  Session,
  SessionSummary,
  Settings
} from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'
import { nowIso, truncate, uid } from '@shared/util'
import type { AgentMode } from '@shared/agentTools'
import { ChatController, newChatRecord, type ChatIndexEntry, type ChatRecord } from './chat'
import { ScriptIndex } from './script'
import { SessionController } from './session'
import { createStore, type Store } from './store'

export type Route =
  | { name: 'home' }
  | { name: 'map'; conceptId?: string }
  | { name: 'session' }
  | { name: 'chat' }
  | { name: 'mind'; conceptId?: string }
  | { name: 'stats' }
  | { name: 'script'; page?: number }
  | { name: 'settings' }

export interface Toast {
  id: string
  kind: 'reward' | 'milestone' | 'info' | 'error'
  text: string
  points?: number
}

export interface UiState {
  route: Route
  toasts: Toast[]
  onboarding: boolean
  scriptPeek: { page: number; label: string | null } | null
}

/** Starting notes the learner can pick during setup (first person: they are shown as-is and read by the tutor). */
export const SEED_PROFILE = [
  'Refresh the prerequisites briefly when a topic relies on them.',
  'I want the motivation (why are we doing this?) before the formulas.',
  'I like a picture or a plot before the algebra.',
  'Show me a worked example before I try a problem myself.',
  'I prefer to understand the concepts before practising exercises.',
  'Keep explanations short and ask me often.'
]

function freshState(): AppState {
  const t = nowIso()
  return {
    version: 1,
    createdAt: t,
    updatedAt: t,
    learner: { profile: [], concepts: {} },
    rewards: { total: 0, events: [] },
    calibration: [],
    sessions: [],
    activeSessionId: null
  }
}

const EVIDENCE_KIND: Partial<Record<Card['kind'], EvidenceKind>> = {
  probe: 'probe',
  predict: 'predict',
  check: 'check',
  practice: 'practice',
  review: 'review',
  reflect: 'reflect'
}

export class AppController {
  readonly course = courseJson as Course
  readonly graph = new CourseGraph(this.course)
  readonly state: Store<AppState> = createStore(freshState())
  readonly settings: Store<Settings> = createStore(DEFAULT_SETTINGS)
  readonly ui: Store<UiState> = createStore<UiState>({ route: { name: 'home' }, toasts: [], onboarding: false, scriptPeek: null })
  readonly session: Store<SessionController | null> = createStore<SessionController | null>(null)
  readonly chat: Store<ChatController | null> = createStore<ChatController | null>(null)
  readonly chats: Store<ChatIndexEntry[]> = createStore<ChatIndexEntry[]>([])
  readonly script: ScriptIndex
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly backend: Backend) {
    this.script = new ScriptIndex(backend)
  }

  async init(): Promise<void> {
    this.settings.set(await this.backend.getSettings())
    const saved = await this.backend.readJson<AppState>('state')
    if (saved && saved.version === 1) this.state.set({ ...freshState(), ...saved })
    if (!this.settings.get().onboarded) this.ui.set((u) => ({ ...u, onboarding: true }))
    void this.script.load()
    this.chats.set((await this.backend.readJson<ChatIndexEntry[]>('chats-index')) ?? [])
    const active = this.state.get().activeSessionId
    if (active) {
      const s = await this.backend.readJson<Session>(`sessions/${active}`)
      if (s && s.phase !== 'done') this.session.set(new SessionController(this, s))
    }
  }

  // ------------------------------------------------------------ persistence
  updateState(fn: (s: AppState) => AppState): void {
    this.state.set((s) => ({ ...fn(s), updatedAt: nowIso() }))
    this.scheduleSave()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.flush(), 400)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    await this.backend.writeJson('state', this.state.get())
  }

  async saveSettings(patch: DeepPartial<Settings>): Promise<void> {
    this.settings.set(await this.backend.setSettings(patch))
  }

  /** Let the learner pick the lecture-notes PDF (desktop app only), then index it. */
  async chooseScript(): Promise<boolean> {
    const path = await this.backend.chooseScript()
    if (!path) return false
    this.settings.set(await this.backend.getSettings())
    await this.script.load(true)
    return true
  }

  // ------------------------------------------------------------ navigation & toasts
  go(route: Route): void {
    this.ui.set((u) => ({ ...u, route }))
  }

  toast(t: Omit<Toast, 'id'>, ms = 4200): void {
    const id = uid('t_')
    this.ui.set((u) => ({ ...u, toasts: [...u.toasts.slice(-2), { ...t, id }] }))
    setTimeout(() => this.ui.set((u) => ({ ...u, toasts: u.toasts.filter((x) => x.id !== id) })), ms)
  }

  peekScript(page: number, label: string | null = null): void {
    this.ui.set((u) => ({ ...u, scriptPeek: { page, label } }))
  }

  // ------------------------------------------------------------ learner model
  concept(id: string): ConceptState {
    return getConcept(this.state.get().learner, id)
  }

  addRewards(events: RewardEvent[]): void {
    if (!events.length) return
    this.updateState((s) => ({
      ...s,
      rewards: { total: s.rewards.total + events.reduce((a, e) => a + e.points, 0), events: [...s.rewards.events, ...events].slice(-600) }
    }))
    const sum = events.reduce((a, e) => a + e.points, 0)
    const sc = this.session.get()
    const cc = this.chat.get()
    if (cc && events.some((e) => e.sessionId === cc.cards.s.id)) cc.cards.addPoints(sum)
    else if (sc) sc.addPoints(sum)
    for (const e of events) this.toast({ kind: ['proficient', 'mastered', 'plan_done'].includes(e.kind) ? 'milestone' : 'reward', text: e.reason, points: e.points })
  }

  /** Record one finished card as evidence: mastery, memory, staircase, misconceptions, calibration, rewards. */
  recordCard(session: Session, card: Card, response: CardResponse, target: PracticeTarget | null, selectedMisconceptions: string[] = []): void {
    const it = card.interaction
    const kind = EVIDENCE_KIND[card.kind]
    const now = new Date()
    if (!it || it.type === 'continue' || !kind) return
    const known = it.conceptIds.filter((c) => this.graph.get(c))
    const primary = target?.conceptId ?? (session.goalConceptId && known.includes(session.goalConceptId) ? session.goalConceptId : known[0])
    const concepts = [...new Set([primary, ...known])].filter(Boolean) as string[]
    const graded = response.score !== null
    const rewards: RewardEvent[] = []
    const desired = this.settings.get().learning.desiredRetention
    const before = primary ? this.concept(primary) : null

    this.updateState((s) => {
      const conceptsMap = { ...s.learner.concepts }
      for (const cid of concepts) {
        let cs = conceptsMap[cid] ?? getConcept(s.learner, cid)
        if (graded || response.verdict === 'dontknow') {
          const input: EvidenceInput = {
            sessionId: session.id,
            kind,
            conceptId: cid,
            score: response.score ?? 0,
            hints: response.hintsUsed,
            attempts: response.attempts,
            revealed: response.revealed,
            confidence: response.confidence,
            level: it.level ?? target?.level ?? null,
            cue: it.cue ?? target?.cue ?? null,
            summary: truncate(it.prompt, 160),
            primary: cid === primary,
            weightScale: cid === primary ? 1 : 0.6
          }
          const out = applyEvidence(cs, input, now, desired)
          cs = out.state
          const title = this.graph.title(cid)
          for (const m of out.milestones) if (m === 'proficient' || m === 'mastered') rewards.push(milestoneReward(m, title, { conceptId: cid, sessionId: session.id, now }))
          if (cid === primary && (kind === 'practice' || kind === 'review') && graded) {
            const lvl = it.level ?? target?.level ?? cs.level
            const eff = out.evidence.score
            const st = updateLevel(cs, lvl, eff)
            cs = st.state
            if (st.change === 'up') rewards.push(milestoneReward('level_up', title, { conceptId: cid, sessionId: session.id, now }, cs.level))
          }
        }
        if (cid === primary) for (const m of selectedMisconceptions) cs = recordMisconception(cs, m, 'active', now)
        conceptsMap[cid] = cs
      }
      const calibration =
        graded && response.confidence && primary
          ? [...s.calibration, { at: now.toISOString(), confidence: response.confidence, correct: (response.score ?? 0) >= 0.8 ? 1 : 0, conceptId: primary }].slice(-1500)
          : s.calibration
      return { ...s, learner: { ...s.learner, concepts: conceptsMap }, calibration }
    })

    rewards.unshift(
      ...rewardsForResponse({
        cardKind: card.kind,
        response,
        conceptId: primary ?? null,
        conceptTitle: primary ? this.graph.title(primary) : 'this topic',
        level: it.level ?? target?.level ?? null,
        sessionId: session.id,
        now,
        before
      })
    )
    this.addRewards(rewards)
  }

  applyModelUpdate(update: ModelUpdate | null): void {
    if (!update) return
    const now = new Date()
    this.updateState((s) => {
      const concepts = { ...s.learner.concepts }
      for (const n of update.notes) {
        const cs = concepts[n.conceptId] ?? getConcept(s.learner, n.conceptId)
        concepts[n.conceptId] = { ...cs, tutorNote: n.note, tutorNoteAt: now.toISOString() }
      }
      for (const m of update.misconceptions) {
        const cs = concepts[m.conceptId] ?? getConcept(s.learner, m.conceptId)
        concepts[m.conceptId] = recordMisconception(cs, m.text, m.status, now)
      }
      let profile = s.learner.profile
      for (const p of update.profile) {
        const low = p.toLowerCase()
        if (!profile.some((x) => x.text.toLowerCase() === low)) profile = [...profile, { id: uid('pf_'), text: p, source: 'tutor' as const, at: now.toISOString() }].slice(-20)
      }
      return { ...s, learner: { ...s.learner, concepts, profile } }
    })
  }

  recordFreeMisconceptions(conceptId: string | null, texts: string[]): void {
    if (!conceptId || !texts.length) return
    const now = new Date()
    this.updateState((s) => {
      let cs = s.learner.concepts[conceptId] ?? getConcept(s.learner, conceptId)
      for (const t of texts) cs = recordMisconception(cs, t, 'active', now)
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: cs } } }
    })
  }

  setUserNote(conceptId: string, note: string): void {
    this.updateState((s) => {
      const cs = s.learner.concepts[conceptId] ?? getConcept(s.learner, conceptId)
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: { ...cs, userNote: note.trim() || null } } } }
    })
  }

  setMisconceptionStatus(conceptId: string, id: string, status: 'active' | 'resolved' | 'deleted'): void {
    this.updateState((s) => {
      const cs = s.learner.concepts[conceptId]
      if (!cs) return s
      const list =
        status === 'deleted'
          ? cs.misconceptions.filter((m) => m.id !== id)
          : cs.misconceptions.map((m) => (m.id === id ? { ...m, status, resolvedAt: status === 'resolved' ? nowIso() : null } : m))
      return { ...s, learner: { ...s.learner, concepts: { ...s.learner.concepts, [conceptId]: { ...cs, misconceptions: list } } } }
    })
  }

  setProfile(texts: { id?: string; text: string; source?: 'seed' | 'tutor' | 'user' }[]): void {
    this.updateState((s) => ({
      ...s,
      learner: {
        ...s.learner,
        profile: texts.filter((t) => t.text.trim()).map((t) => ({ id: t.id ?? uid('pf_'), text: t.text.trim(), source: t.source ?? 'user', at: nowIso() }))
      }
    }))
  }

  // ------------------------------------------------------------ sessions
  private newSession(type: Session['type'], goal: string | null, scope: string[], queue: PracticeTarget[], itemsGoal: number): Session {
    return {
      id: uid('s_'),
      type,
      goalConceptId: goal,
      scope,
      startedAt: nowIso(),
      endedAt: null,
      phase: type === 'learn' ? 'probe' : type,
      steps: [],
      plan: null,
      currentNodeId: null,
      queue,
      itemsGoal,
      chat: [],
      pointsEarned: 0,
      summary: null
    }
  }

  private async begin(s: Session): Promise<void> {
    const prev = this.session.get()
    if (prev) await prev.pause()
    const sc = new SessionController(this, s)
    this.session.set(sc)
    this.updateState((st) => ({ ...st, activeSessionId: s.id }))
    this.go({ name: 'session' })
    await sc.save()
    void sc.start()
  }

  private get agentMode(): boolean {
    return this.settings.get().learning.tutorMode !== 'guided'
  }

  startLearn(conceptId: string): Promise<void> {
    if (this.agentMode) return this.startChat('learn', conceptId, [conceptId])
    return this.begin(this.newSession('learn', conceptId, [conceptId], [], 0))
  }

  startPractice(scope: string[]): Promise<void> {
    if (this.agentMode) return this.startChat('practice', null, scope)
    const n = this.settings.get().learning.practiceItems
    return this.begin(this.newSession('practice', null, scope, [], n))
  }

  startReview(): Promise<void> {
    if (this.agentMode) return this.startChat('review', null, [])
    return this.begin(this.newSession('review', null, [], [], 10))
  }

  // ------------------------------------------------------------ tutor chats (agent)
  private chatTitle(mode: AgentMode, goal: string | null, scope: string[]): string {
    if (mode === 'learn' && goal) return this.graph.title(goal)
    if (mode === 'practice') return scope.length === 1 ? `Practice: ${this.graph.title(scope[0])}` : 'Mixed practice'
    if (mode === 'review') return 'Spaced review'
    return 'Open chat'
  }

  /** Start a new tutor chat. `opening` is the learner's first message (open chats); otherwise the app briefs the agent. */
  async startChat(mode: AgentMode, goal: string | null, scope: string[], opening?: string): Promise<void> {
    await this.closeChatAgent()
    const rec = newChatRecord(mode, goal, scope, opening ? opening.slice(0, 60) : this.chatTitle(mode, goal, scope))
    const cc = new ChatController(this, rec, null)
    this.chat.set(cc)
    this.go({ name: 'chat' })
    await cc.save()
    if (opening) await cc.send(opening)
    else
      await cc.begin(
        mode === 'learn'
          ? `Start the learning session for "${this.chatTitle(mode, goal, scope)}": probe first.`
          : mode === 'practice'
            ? 'Start the practice session: pick the first item from the learner model.'
            : mode === 'review'
              ? 'Start the spaced review with what is due.'
              : 'Greet the learner in one sentence and ask what they want to work on.'
      )
  }

  async openChat(id: string): Promise<void> {
    if (this.chat.get()?.chat.id === id) return this.go({ name: 'chat' })
    const rec = await this.backend.readJson<ChatRecord>(`chats/${id}`)
    if (!rec || rec.version !== 1) {
      this.toast({ kind: 'error', text: 'That chat could not be opened.' })
      return
    }
    await this.closeChatAgent()
    const s = await this.backend.readJson<Session>(`sessions/${rec.sessionId}`)
    this.chat.set(new ChatController(this, rec, s))
    this.go({ name: 'chat' })
  }

  /** Stop the running agent (the chat stays and resumes on the next message). */
  async closeChatAgent(): Promise<void> {
    const cc = this.chat.get()
    if (cc) await cc.stop()
  }

  async touchChatIndex(c: ChatRecord): Promise<void> {
    const entry: ChatIndexEntry = { id: c.id, title: c.title, mode: c.mode, goalConceptId: c.goalConceptId, updatedAt: c.updatedAt }
    const list = [entry, ...this.chats.get().filter((x) => x.id !== c.id)].slice(0, 100)
    this.chats.set(list)
    await this.backend.writeJson('chats-index', list)
  }

  async finishSession(s: Session, summary: SessionSummary): Promise<void> {
    this.updateState((st) => ({
      ...st,
      sessions: [...st.sessions.filter((x) => x.id !== summary.id), summary].slice(-300),
      activeSessionId: st.activeSessionId === s.id ? null : st.activeSessionId
    }))
    await this.flush()
  }

  closeSession(): void {
    const sc = this.session.get()
    if (sc) void sc.pause()
    this.session.set(null)
    this.updateState((st) => ({ ...st, activeSessionId: null }))
    this.go({ name: 'home' })
  }

  async resetAll(): Promise<void> {
    this.session.set(null)
    this.state.set(freshState())
    await this.flush()
  }

  exportData(): string {
    return JSON.stringify({ exportedAt: nowIso(), state: this.state.get() }, null, 1)
  }

  importData(json: string): boolean {
    try {
      const d = JSON.parse(json) as { state?: AppState }
      if (!d.state || d.state.version !== 1) return false
      this.state.set(d.state)
      void this.flush()
      return true
    } catch {
      return false
    }
  }
}

let instance: AppController | null = null

export function createApp(backend: Backend): AppController {
  instance = new AppController(backend)
  return instance
}

export function useApp(): AppController {
  if (!instance) throw new Error('app not created')
  return instance
}
