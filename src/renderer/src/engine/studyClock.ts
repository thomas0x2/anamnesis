// The study clock: counts active study time while the learner works in a tutor session, the course
// materials or exam prep (and did something in the window within the last few minutes), runs breaks,
// and tells the tutor when one is due. One log for all courses: study-time.json in the data folder.
import {
  onPlatform,
  accrue,
  backFromBreakNote,
  breakNote,
  breakStatus,
  countsNow,
  RUNNING_IDLE_MS,
  setTimerMode,
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
import type { AppController, Route } from './app'
import { createStore, type Store } from './store'

const FILE = 'study-time'
/** Screens where time counts as study. */
const STUDY_ROUTES = new Set<Route['name']>(['session', 'chat', 'script', 'exam'])

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
  private lastInput = 0
  /** the last focus or input in the platform window (Code Expert, GitLab…) */
  private lastPlatform: number | null = null
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

  /** Listen for activity and tick. Browser and Electron alike. */
  start(): void {
    if (this.timer || typeof window === 'undefined') return
    const mark = (): void => {
      this.lastInput = Date.now()
    }
    for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) window.addEventListener(ev, mark, { passive: true, capture: true })
    let lastMove = 0
    window.addEventListener(
      'pointermove',
      () => {
        const t = Date.now()
        if (t - lastMove > 5000) {
          lastMove = t
          mark()
        }
      },
      { passive: true }
    )
    this.app.backend.onPlatformActivity?.(() => {
      this.lastPlatform = Date.now()
      mark()
    })
    this.lastInput = Date.now()
    this.lastTick = Date.now()
    this.timer = setInterval(() => this.onTick(), TICK_MS)
  }

  /** Something counts as activity even without input (dictating, the app opening a session). */
  poke(): void {
    this.lastInput = Date.now()
  }

  private context(): StudyContext | null {
    const app = this.app
    const route = app.ui.get().route.name
    // working on a problem set in the platform window counts for the open course, wherever the main window is
    if (!STUDY_ROUTES.has(route)) return onPlatform(this.lastPlatform, Date.now()) ? { courseId: app.courseId, session: null } : null
    const sc = app.session.get()
    if ((route === 'session' || route === 'chat') && sc) {
      const s = sc.s
      return { courseId: app.courseId, session: { id: s.id, title: this.sessionTitle(s), type: s.type } }
    }
    if (route === 'session' || route === 'chat') return null
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
    const visible = typeof document === 'undefined' || document.visibilityState === 'visible' || onPlatform(this.lastPlatform, t)
    const clock = this.log.get().clock
    const auto = this.context()
    // a started timer counts for the open course wherever you are in the app
    const ctx = clock.mode === 'running' ? (auto ?? { courseId: this.app.courseId, session: null }) : auto
    const now = new Date(t)
    const idleMs = t - this.lastInput
    // a timer started and then forgotten (hours without touching the app) goes back to automatic
    if (clock.mode === 'running' && idleMs >= RUNNING_IDLE_MS) this.commit((l) => setTimerMode(l, 'auto'))
    if (ctx && countsNow(clock.mode, { studyScreen: !!auto, visible, idleMs, onBreak: !!clock.current })) {
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

  /** Start: count every minute for the open course until Pause, also off the screen. */
  startTimer(): void {
    this.lastInput = Date.now()
    this.lastTick = Date.now()
    this.commit((l) => setTimerMode(l, 'running'))
  }

  /** Pause: nothing counts until Start. */
  pauseTimer(): void {
    this.commit((l) => setTimerMode(l, 'paused'))
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
    this.lastInput = Date.now()
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
