// The study clock: counts study time only while the learner has started it (Start / Pause next to the
// clock in the top bar), runs breaks, and tells the tutor when one is due. One log for all courses: study-time.json in the data folder.
import {
  accrue,
  backFromBreakNote,
  breakNote,
  breakStatus,
  countsNow,
  setTimerMode,
  switchBlock,
  emptyStudyLog,
  endBreak,
  normalizeBreakSettings,
  normalizeStudyLog,
  REMIND_EVERY_MIN,
  snooze,
  SNOOZE_MIN,
  startBreak,
  TICK_MS,
  type BreakKind,
  type BreakSource,
  type BreakStatus,
  type StudyContext,
  type StudyLog,
  type TimerMode
} from '@shared/studyTime'
import type { BreakSettings, Session } from '@shared/types'
import type { AppController } from './app'
import { createStore, type Store } from './store'

const FILE = 'study-time'
/** Screens where time counts as study. */

export interface BreakOffer {
  kind: BreakKind
  minutes: number
  source: BreakSource
  /** the tutor's reason, or the app's */
  reason: string
  idea: string | null
}

export class StudyClock {
  readonly log: Store<StudyLog> = createStore(emptyStudyLog())
  /** bumps every tick, so views showing the clock re-render */
  readonly tick: Store<number> = createStore(0)
  /** the break the learner is looking at (opened from the top bar or a tutor card), before it starts */
  readonly offer: Store<BreakOffer | null> = createStore<BreakOffer | null>(null)
  private lastTick = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  /** when the tutor was last told that a break is due (ms) */
  private toldAt = 0
  /** the tutor was told that a break is coming up */
  private soonTold = false
  /** the tutor suggested the due break (so the app does not nudge as well) */
  private suggestedAt = 0
  /** notes for the tutor that go with its next tool result (back from a break) */
  private notes: string[] = []
  private loaded = false

  constructor(private app: AppController) {}

  get settings(): BreakSettings {
    return normalizeBreakSettings(this.app.settings.get().breaks)
  }

  status(now = new Date()): BreakStatus {
    return breakStatus(this.log.get(), this.settings, now)
  }

  async init(): Promise<void> {
    this.log.set(normalizeStudyLog(await this.app.backend.readJson<StudyLog>(FILE)))
    this.loaded = true
    // a break left running when the app closed ends now
    const cur = this.log.get().clock.current
    if (cur && Date.now() - Date.parse(cur.startedAt) > (cur.plannedMin + 30) * 60_000) this.finishBreak(false)
  }

  /** Tick. Browser and Electron alike. Only Start and Pause decide whether time counts. */
  start(): void {
    if (this.timer || typeof window === 'undefined') return
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.onTick(), TICK_MS)
  }

  /** What the running timer counts toward: the tutor session on screen, else the open course. */
  private context(): StudyContext {
    const app = this.app
    const route = app.ui.get().route.name
    const sc = app.session.get()
    if ((route === 'session' || route === 'chat') && sc) {
      const s = sc.s
      return { courseId: app.courseId, session: { id: s.id, title: this.sessionTitle(s), type: s.type } }
    }
    return { courseId: app.courseId, session: null }
  }

  private sessionTitle(s: Session): string {
    const cc = this.app.chat.get()
    if (cc && cc.cards.s.id === s.id) return cc.chat.title
    if (s.type === 'learn') return this.app.graph.title(s.goalConceptId ?? '')
    if (s.type === 'practice') return s.scope.length === 1 ? `Practice: ${this.app.graph.title(s.scope[0])}` : 'Mixed practice'
    if (s.type === 'review') return 'Spaced review'
    return 'Tutor chat'
  }

  private onTick(): void {
    const t = Date.now()
    const dt = Math.min(t - this.lastTick, TICK_MS * 2)
    this.lastTick = t
    if (!this.loaded) return
    const clock = this.log.get().clock
    if (countsNow(clock.mode, !!clock.current)) {
      const ctx = this.context()
      const now = new Date(t)
      this.log.set((l) => accrue(l, ctx, dt / 1000, now, this.settings))
      this.dirty = true
      this.scheduleSave()
    }
    // a running break that the learner forgot about ends by itself well after its time
    const cur = this.log.get().clock.current
    if (cur && t - Date.parse(cur.startedAt) > (cur.plannedMin + 60) * 60_000) this.finishBreak(false)
    this.tick.set((n) => n + 1)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => void this.save(), 60_000)
  }

  async save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    if (!this.dirty || !this.loaded) return
    this.dirty = false
    await this.app.backend.writeJson(FILE, this.log.get())
  }

  private commit(fn: (l: StudyLog) => StudyLog): void {
    this.log.set(fn)
    this.dirty = true
    void this.save()
    this.tick.set((n) => n + 1)
  }

  // ------------------------------------------------------------ start / pause
  get mode(): TimerMode {
    return this.log.get().clock.mode
  }

  /** Start: every minute counts for the open course (or the tutor session on screen) until Pause, whatever you do. */
  startTimer(): void {
    this.lastTick = Date.now()
    this.commit((l) => setTimerMode(l, 'running'))
  }

  /** Pause: nothing counts until Start. */
  pauseTimer(): void {
    this.commit((l) => setTimerMode(l, 'paused'))
  }

  /** The learner chose to move on to another course: the plan's block starts there now. */
  switchBlock(courseId: string): void {
    this.commit((l) => switchBlock(l, courseId, new Date()))
  }

  // ------------------------------------------------------------ breaks
  /** The break that is due (or the next one), as an offer the learner can start. */
  defaultOffer(source: BreakSource = 'learner'): BreakOffer {
    const st = this.status()
    const worked = Math.round(st.workMin)
    return {
      kind: st.kind,
      minutes: st.minutes,
      source,
      reason: st.due ? `You have studied for ${worked} minutes without a break.` : worked >= 1 ? `${worked} minutes of study since your last break.` : 'A short pause.',
      idea: null
    }
  }

  openOffer(o: BreakOffer = this.defaultOffer()): void {
    this.offer.set(o)
  }

  closeOffer(): void {
    this.offer.set(null)
  }

  beginBreak(o: BreakOffer): void {
    this.offer.set(null)
    this.commit((l) => startBreak(l, { kind: o.kind, minutes: o.minutes, source: o.source }, new Date()))
  }

  /** End the running break (back to studying). */
  finishBreak(tell = true): void {
    const sid = this.app.session.get()?.s.id ?? null
    const out = endBreak(this.log.get(), new Date(), this.settings, sid)
    if (!out.rec) return
    this.commit(() => out.log)
    this.suggestedAt = 0
    this.toldAt = 0
    this.soonTold = false
    if (tell) this.tellTutor(backFromBreakNote(out.rec, out.minutes, false))
  }

  /** The learner puts the due break off. */
  later(minutes = SNOOZE_MIN, tellTutor = false): void {
    this.offer.set(null)
    this.commit((l) => snooze(l, minutes, new Date()))
    this.suggestedAt = 0
    if (tellTutor) this.tellTutor('[The learner skipped the break for now (it comes back in a few minutes). Carry on where you were.]')
  }

  /** The tutor called suggest_break. */
  noteSuggested(): void {
    this.suggestedAt = Date.now()
  }

  /** Whether the app should show its own break nudge: due, not put off, and the tutor did not suggest it in time. */
  shouldNudge(agent: boolean, now = new Date()): boolean {
    const st = this.status(now)
    if (!st.due || st.snoozed || st.current) return false
    if (!agent) return true
    if (this.suggestedAt && now.getTime() - this.suggestedAt < 20 * 60_000) return false
    return st.overdueMin >= 15
  }

  private tellTutor(note: string): void {
    const cc = this.app.chat.get()
    if (cc?.idleForNote()) void cc.note(note)
    else this.notes.push(note)
  }

  /** Appended to the tutor's next card result: back-from-break notes, and a due break (at most every few minutes). */
  agentNote(): string | null {
    const out = this.notes.splice(0)
    const st = this.status()
    if (!st.due && st.dueInMin > 5) this.soonTold = false
    const n = breakNote(st)
    const t = Date.now()
    const recentlySuggested = this.suggestedAt && t - this.suggestedAt < REMIND_EVERY_MIN * 60_000
    // "due soon" once; "due now" again every few minutes until the learner takes or skips the break
    if (n && !recentlySuggested && (st.due ? t - this.toldAt >= REMIND_EVERY_MIN * 60_000 : !this.soonTold)) {
      if (st.due) this.toldAt = t
      else this.soonTold = true
      out.push(n)
    }
    return out.length ? out.join('\n') : null
  }
}
