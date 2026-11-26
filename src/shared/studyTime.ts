// Study time and breaks. The app counts the time you actively study (a tutor session on screen, the
// course materials, exam prep) while you do something in the window, per day and course and per tutor
// session. From the same clock it knows how long you have worked since your last break and tells the
// tutor when a break is due, so it can suggest one at a natural pause.
//
// The defaults follow the evidence on breaks (see docs/LEARNING_SCIENCE.md, "Breaks"): short breaks of
// 10 minutes or less reliably reduce fatigue (Albulescu et al., 2022, meta-analysis); attention on
// demanding work tends to fade after roughly 50-90 minutes, so about 50 minutes of work then a
// 10-minute break, and a longer break of 20-30 minutes every 2-3 hours. Breaks away from the screen
// (moving, going outside, quiet rest) restore more than scrolling, and a few minutes of quiet rest
// right after learning help it stick (Dewar et al., 2012). Every interval is a setting.
import type { BreakSettings, SessionType } from './types'
import { DEFAULT_BREAKS } from './types'
import { clamp, dayKey, uid } from './util'

/** Time counts while the learner did something in the window within this span (reading a card, working on paper). */
export const IDLE_MS = 8 * 60_000
/** How often the clock ticks. */
export const TICK_MS = 15_000
/** A break the learner put off comes back after this many minutes. */
export const SNOOZE_MIN = 10
/** Remind the tutor of a due break at most this often. */
export const REMIND_EVERY_MIN = 10
/** The app shows its own nudge when the tutor has not suggested the due break after this many minutes. */
export const NUDGE_AFTER_MIN = 15

export type BreakKind = 'short' | 'long'
export type BreakSource = 'tutor' | 'app' | 'learner' | 'away'

export interface DayTotals {
  /** seconds in tutor sessions */
  tutor: number
  /** seconds elsewhere in the course (materials, exam prep) */
  other: number
}

export interface StudySessionRec {
  /** the tutor session's id */
  id: string
  courseId: string
  title: string
  type: SessionType
  startedAt: string
  lastAt: string
  activeSec: number
  breaks: number
}

export interface BreakRec {
  id: string
  kind: BreakKind
  source: BreakSource
  plannedMin: number
  startedAt: string
  endedAt: string | null
  /** long enough to count as a break (the work clock restarted) */
  counted: boolean
}

export interface BreakClock {
  /** seconds studied since the last break */
  workSec: number
  /** seconds studied since the last long break */
  sinceLongSec: number
  /** the last moment that counted as study */
  lastActiveAt: string | null
  /** the learner put the break off until then */
  snoozedUntil: string | null
  /** the break running now */
  current: BreakRec | null
}

export interface StudyLog {
  version: 1
  /** day (local, YYYY-MM-DD) → course id → seconds */
  days: Record<string, Record<string, DayTotals>>
  sessions: StudySessionRec[]
  breaks: BreakRec[]
  clock: BreakClock
}

export interface StudyContext {
  courseId: string
  /** the tutor session on screen, if any */
  session: { id: string; title: string; type: SessionType } | null
}

export const MAX_SESSIONS = 400
export const MAX_BREAKS = 400

export function emptyClock(): BreakClock {
  return { workSec: 0, sinceLongSec: 0, lastActiveAt: null, snoozedUntil: null, current: null }
}

export function emptyStudyLog(): StudyLog {
  return { version: 1, days: {}, sessions: [], breaks: [], clock: emptyClock() }
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0)
const iso = (x: unknown): string | null => (typeof x === 'string' && !Number.isNaN(Date.parse(x)) ? x : null)
const KINDS: SessionType[] = ['learn', 'practice', 'review', 'chat']

function normalizeBreak(raw: unknown): BreakRec | null {
  const r = (raw ?? {}) as Partial<BreakRec>
  const startedAt = iso(r.startedAt)
  if (!startedAt) return null
  return {
    id: typeof r.id === 'string' ? r.id : uid('br_'),
    kind: r.kind === 'long' ? 'long' : 'short',
    source: r.source === 'tutor' || r.source === 'learner' || r.source === 'away' ? r.source : 'app',
    plannedMin: clamp(Math.round(num(r.plannedMin)) || 10, 1, 120),
    startedAt,
    endedAt: iso(r.endedAt),
    counted: r.counted === true
  }
}

/** Load the log defensively: a damaged file never stops the app. */
export function normalizeStudyLog(raw: unknown): StudyLog {
  const r = (raw ?? {}) as Partial<StudyLog>
  if (!raw || typeof raw !== 'object') return emptyStudyLog()
  const days: StudyLog['days'] = {}
  for (const [k, v] of Object.entries(r.days ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue
    const per: Record<string, DayTotals> = {}
    for (const [cid, t] of Object.entries(v as Record<string, Partial<DayTotals>>)) {
      const tutor = num(t?.tutor)
      const other = num(t?.other)
      if (tutor || other) per[cid] = { tutor, other }
    }
    if (Object.keys(per).length) days[k] = per
  }
  const sessions = (Array.isArray(r.sessions) ? r.sessions : [])
    .map((x): StudySessionRec | null => {
      const s = (x ?? {}) as Partial<StudySessionRec>
      const startedAt = iso(s.startedAt)
      if (typeof s.id !== 'string' || typeof s.courseId !== 'string' || !startedAt) return null
      return {
        id: s.id,
        courseId: s.courseId,
        title: typeof s.title === 'string' ? s.title : 'Session',
        type: KINDS.includes(s.type as SessionType) ? (s.type as SessionType) : 'chat',
        startedAt,
        lastAt: iso(s.lastAt) ?? startedAt,
        activeSec: num(s.activeSec),
        breaks: Math.round(num(s.breaks))
      }
    })
    .filter((x): x is StudySessionRec => !!x)
    .slice(-MAX_SESSIONS)
  const breaks = (Array.isArray(r.breaks) ? r.breaks : []).map(normalizeBreak).filter((x): x is BreakRec => !!x).slice(-MAX_BREAKS)
  const c = (r.clock ?? {}) as Partial<BreakClock>
  const clock: BreakClock = {
    workSec: num(c.workSec),
    sinceLongSec: num(c.sinceLongSec),
    lastActiveAt: iso(c.lastActiveAt),
    snoozedUntil: iso(c.snoozedUntil),
    current: c.current ? normalizeBreak(c.current) : null
  }
  return { version: 1, days, sessions, breaks, clock }
}

/** Settings from the file or the UI, kept in sensible ranges. */
export function normalizeBreakSettings(raw: Partial<BreakSettings> | null | undefined): BreakSettings {
  const r = { ...DEFAULT_BREAKS, ...(raw ?? {}) }
  const n = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  const longEvery = Math.round(n(r.longEveryMin, DEFAULT_BREAKS.longEveryMin))
  return {
    enabled: r.enabled !== false,
    workMin: clamp(Math.round(n(r.workMin, DEFAULT_BREAKS.workMin)), 1, 180),
    shortMin: clamp(Math.round(n(r.shortMin, DEFAULT_BREAKS.shortMin)), 1, 30),
    longEveryMin: longEvery <= 0 ? 0 : clamp(longEvery, 30, 480),
    longMin: clamp(Math.round(n(r.longMin, DEFAULT_BREAKS.longMin)), 5, 90)
  }
}

/** Ready-made rhythms the settings offer. */
export const BREAK_PRESETS: { id: string; label: string; desc: string; s: Omit<BreakSettings, 'enabled'> }[] = [
  { id: 'default', label: '50 / 10', desc: '50 minutes of work, 10 off; 25 minutes off every 2.5 hours (the default)', s: { workMin: 50, shortMin: 10, longEveryMin: 150, longMin: 25 } },
  { id: 'short', label: '25 / 5', desc: 'Pomodoro: 25 minutes of work, 5 off; 20 minutes off every 2 hours', s: { workMin: 25, shortMin: 5, longEveryMin: 120, longMin: 20 } },
  { id: 'long', label: '90 / 15', desc: 'long focus blocks: 90 minutes of work, 15 off; 30 minutes off every 3 hours', s: { workMin: 90, shortMin: 15, longEveryMin: 180, longMin: 30 } }
]

// ------------------------------------------------------------ the clock

/** The learner was away (no study) for `gapSec`: a long enough gap is a break of its own. */
function applyGap(log: StudyLog, gapSec: number, s: BreakSettings, now: Date): StudyLog {
  if (gapSec < s.shortMin * 60) return log
  const clock = { ...log.clock, workSec: 0, snoozedUntil: null }
  const long = s.longEveryMin > 0 && gapSec >= s.longMin * 60
  if (long || s.longEveryMin === 0) clock.sinceLongSec = 0
  const startedAt = log.clock.lastActiveAt ?? new Date(now.getTime() - gapSec * 1000).toISOString()
  const rec: BreakRec = { id: uid('br_'), kind: long ? 'long' : 'short', source: 'away', plannedMin: Math.round(gapSec / 60), startedAt, endedAt: now.toISOString(), counted: true }
  // only gaps within a study day are breaks worth listing; a night away just restarts the clock
  const listed = gapSec < 4 * 3600
  return { ...log, clock, breaks: listed ? [...log.breaks, rec].slice(-MAX_BREAKS) : log.breaks }
}

/** Credit `sec` seconds of study that ended at `now`. */
export function accrue(log: StudyLog, ctx: StudyContext, sec: number, now: Date, s: BreakSettings): StudyLog {
  if (sec <= 0 || log.clock.current) return log
  const last = log.clock.lastActiveAt ? Date.parse(log.clock.lastActiveAt) : null
  if (last !== null) log = applyGap(log, Math.max(0, (now.getTime() - last) / 1000 - sec), s, now)
  const day = dayKey(now)
  const per = { ...(log.days[day] ?? {}) }
  const t = per[ctx.courseId] ?? { tutor: 0, other: 0 }
  per[ctx.courseId] = ctx.session ? { ...t, tutor: t.tutor + sec } : { ...t, other: t.other + sec }
  let sessions = log.sessions
  if (ctx.session) {
    const at = now.toISOString()
    const i = sessions.findIndex((x) => x.id === ctx.session!.id)
    if (i >= 0) sessions = sessions.map((x, j) => (j === i ? { ...x, title: ctx.session!.title || x.title, lastAt: at, activeSec: x.activeSec + sec } : x))
    else
      sessions = [
        ...sessions,
        { id: ctx.session.id, courseId: ctx.courseId, title: ctx.session.title, type: ctx.session.type, startedAt: new Date(now.getTime() - sec * 1000).toISOString(), lastAt: at, activeSec: sec, breaks: 0 }
      ].slice(-MAX_SESSIONS)
  }
  return {
    ...log,
    days: { ...log.days, [day]: per },
    sessions,
    clock: { ...log.clock, workSec: log.clock.workSec + sec, sinceLongSec: log.clock.sinceLongSec + sec, lastActiveAt: now.toISOString() }
  }
}

export interface BreakStatus {
  enabled: boolean
  /** minutes studied since the last break */
  workMin: number
  /** the next break: long when the long-break interval is reached by then */
  kind: BreakKind
  /** its suggested length */
  minutes: number
  /** minutes until it is due (0 or less: due now) */
  dueInMin: number
  due: boolean
  /** due, but the learner put it off */
  snoozed: boolean
  /** minutes since it became due */
  overdueMin: number
  current: BreakRec | null
  /** minutes left of the running break (negative: running over) */
  leftMin: number | null
}

export function breakStatus(log: StudyLog, s: BreakSettings, now: Date): BreakStatus {
  const c = log.clock
  const work = c.workSec / 60
  const toShort = s.workMin - work
  // the next break is a long one when, by the time it is due, the long interval is (nearly) reached
  const long = s.longEveryMin > 0 && c.sinceLongSec / 60 + Math.max(0, toShort) >= s.longEveryMin - 5
  const dueInMin = long ? Math.min(toShort, s.longEveryMin - c.sinceLongSec / 60) : toShort
  const due = s.enabled && dueInMin <= 0
  const snoozed = due && !!c.snoozedUntil && Date.parse(c.snoozedUntil) > now.getTime()
  const cur = c.current
  return {
    enabled: s.enabled,
    workMin: work,
    kind: long ? 'long' : 'short',
    minutes: long ? s.longMin : s.shortMin,
    dueInMin,
    due,
    snoozed,
    overdueMin: due ? -dueInMin : 0,
    current: cur,
    leftMin: cur ? cur.plannedMin - (now.getTime() - Date.parse(cur.startedAt)) / 60_000 : null
  }
}

export function startBreak(log: StudyLog, b: { kind: BreakKind; minutes: number; source: BreakSource }, now: Date): StudyLog {
  if (log.clock.current) return log
  const rec: BreakRec = { id: uid('br_'), kind: b.kind, source: b.source, plannedMin: clamp(Math.round(b.minutes), 1, 120), startedAt: now.toISOString(), endedAt: null, counted: false }
  return { ...log, clock: { ...log.clock, current: rec } }
}

/**
 * End the running break. It counts (the work clock starts again) when it lasted at least half of what was
 * planned; a break cut very short counts as putting it off for a few minutes.
 */
export function endBreak(log: StudyLog, now: Date, s: BreakSettings, sessionId: string | null = null): { log: StudyLog; rec: BreakRec | null; minutes: number } {
  const cur = log.clock.current
  if (!cur) return { log, rec: null, minutes: 0 }
  const minutes = Math.max(0, (now.getTime() - Date.parse(cur.startedAt)) / 60_000)
  const counted = minutes >= cur.plannedMin / 2
  const rec: BreakRec = { ...cur, endedAt: now.toISOString(), counted }
  const clock: BreakClock = { ...log.clock, current: null, lastActiveAt: now.toISOString() }
  if (counted) {
    clock.workSec = 0
    clock.snoozedUntil = null
    if (cur.kind === 'long' || minutes >= s.longMin * 0.8 || s.longEveryMin === 0) clock.sinceLongSec = 0
  } else clock.snoozedUntil = new Date(now.getTime() + SNOOZE_MIN * 60_000).toISOString()
  const sessions = counted && sessionId ? log.sessions.map((x) => (x.id === sessionId ? { ...x, breaks: x.breaks + 1 } : x)) : log.sessions
  return { log: { ...log, clock, sessions, breaks: [...log.breaks, rec].slice(-MAX_BREAKS) }, rec, minutes }
}

export function snooze(log: StudyLog, minutes: number, now: Date): StudyLog {
  return { ...log, clock: { ...log.clock, snoozedUntil: new Date(now.getTime() + minutes * 60_000).toISOString() } }
}

// ------------------------------------------------------------ summaries

export const dayTotal = (t: Record<string, DayTotals> | undefined, courseId?: string): number =>
  Object.entries(t ?? {}).reduce((a, [cid, v]) => (courseId && cid !== courseId ? a : a + v.tutor + v.other), 0)

export interface DaySeries {
  key: string
  date: Date
  sec: number
  /** this course's share */
  courseSec: number
  byCourse: Record<string, number>
}

/** The last `n` days up to today, oldest first. */
export function daySeries(log: StudyLog, now: Date, n: number, courseId?: string): DaySeries[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (n - 1 - i))
    const key = dayKey(date)
    const per = log.days[key] ?? {}
    const byCourse = Object.fromEntries(Object.entries(per).map(([cid, v]) => [cid, v.tutor + v.other]))
    return { key, date, sec: dayTotal(per), courseSec: courseId ? dayTotal(per, courseId) : dayTotal(per), byCourse }
  })
}

export function totalsSince(log: StudyLog, now: Date, days: number): { sec: number; byCourse: Record<string, number> } {
  const byCourse: Record<string, number> = {}
  let sec = 0
  for (const d of daySeries(log, now, days)) {
    sec += d.sec
    for (const [cid, v] of Object.entries(d.byCourse)) byCourse[cid] = (byCourse[cid] ?? 0) + v
  }
  return { sec, byCourse }
}

/** Breaks taken today (counted ones). */
export function breaksToday(log: StudyLog, now: Date): BreakRec[] {
  const k = dayKey(now)
  return log.breaks.filter((b) => b.counted && dayKey(b.startedAt) === k)
}

/** "1 h 05 min", "42 min", "under a minute". */
export function fmtStudy(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 1) return sec > 0 ? 'under a minute' : '0 min'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}

/** Compact: "1:05 h", "42 min". */
export function fmtStudyShort(sec: number): string {
  const m = Math.floor(sec / 60)
  if (m < 1 && sec > 0) return '<1 min'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} h`
}

// ------------------------------------------------------------ what to do in a break

export const BREAK_IDEAS: { id: string; label: string; text: string }[] = [
  { id: 'move', label: 'Move', text: 'Stand up and move: walk around, stretch, climb some stairs.' },
  { id: 'outside', label: 'Go outside', text: 'Step outside or look out of the window into the distance; daylight and green help attention recover.' },
  { id: 'rest', label: 'Quiet rest', text: 'Sit or lie down with your eyes closed for a few minutes. Quiet rest right after learning helps it stick.' },
  { id: 'water', label: 'Water or a snack', text: 'Get a glass of water or a small snack.' }
]

export const BREAK_AVOID = 'Leave the phone and other screens alone if you can: scrolling feels like rest but restores less.'

// ------------------------------------------------------------ the tutor

export const BREAK_TOOL_NAME = 'suggest_break'

/** The system prompt section on breaks (only when breaks are on). */
export function breaksPrompt(s: BreakSettings): string | null {
  if (!s.enabled) return null
  return [
    '# Breaks',
    `The app counts the learner's study time and tells you, in brackets at the end of a tool result, when a break is due. The learner's rhythm: ${s.workMin} minutes of study, then a ${s.shortMin}-minute break${s.longEveryMin > 0 ? `; a ${s.longMin}-minute break after about ${Math.round((s.longEveryMin / 60) * 10) / 10} hours of study` : ''}.`,
    '- When a break is due, call suggest_break at the next natural pause: after a check or a practice item, when a plan node is done, before a new topic. Never in the middle of a question or an explanation, and within about 10 minutes.',
    '- Give the length the app names. Pick one idea that fits: away from the screen (move, go outside, water); right after something new was learned, prefer quiet rest with eyes closed, which helps consolidation. One short sentence of reason, no lecture.',
    '- If the learner asks for a break, call suggest_break right away. Do not suggest breaks more often than the rhythm asks for.',
    '- After suggest_break, end your turn without a new card: the app tells you when the learner is back (or skipped it). When they are back, welcome them in one sentence and restart with a quick recall of what came just before the break.'
  ].join('\n')
}

/** What the tutor is told about study time at the end of a tool result, or null. */
export function breakNote(st: BreakStatus): string | null {
  if (!st.enabled || st.current || st.snoozed) return null
  const worked = Math.round(st.workMin)
  if (st.due) return `[Study time: the learner has studied ${worked} minutes without a break. A ${st.minutes}-minute ${st.kind === 'long' ? 'long ' : ''}break is due: call suggest_break at the next natural pause.]`
  if (st.dueInMin <= 5) return `[Study time: ${worked} minutes without a break; a ${st.minutes}-minute break is due in about ${Math.max(1, Math.round(st.dueInMin))} minutes. Plan to pause at the next natural point.]`
  return null
}

export function backFromBreakNote(rec: BreakRec, minutes: number, skipped: boolean): string {
  if (skipped) return '[The learner skipped the break for now (it comes back in a few minutes). Carry on where you were.]'
  if (!rec.counted) return `[The learner came back after ${Math.max(1, Math.round(minutes))} of the planned ${rec.plannedMin} minutes, so the break did not really count. Carry on; the app reminds you again later.]`
  return `[The learner is back from a ${Math.max(1, Math.round(minutes))}-minute break. Welcome them back in one sentence and restart with a quick recall of what came just before the break, then carry on.]`
}
