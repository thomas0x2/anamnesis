import { describe, expect, it } from 'vitest'
import courseJson from '../../courses/numcs/course.json'
import { agentTools, AGENT_TOOLS, BREAK_TOOL, buildAgentSystemPrompt } from '../../src/shared/agentTools'
import { CourseGraph } from '../../src/shared/graph'
import {
  accrue,
  countsNow,
  setTimerMode,
  backFromBreakNote,
  breakNote,
  breaksPrompt,
  breakStatus,
  daySeries,
  emptyStudyLog,
  endBreak,
  fmtStudy,
  fmtStudyShort,
  normalizeBreakSettings,
  normalizeStudyLog,
  startBreak,
  totalsSince,
  trackBlock,
  liveBlock,
  switchBlock,
  DETOUR_MIN,
  BLOCK_GAP_MIN,
  type StudyContext,
  type StudyLog
} from '../../src/shared/studyTime'
import { DEFAULT_BREAKS, type Course } from '../../src/shared/types'

const s = DEFAULT_BREAKS
const t0 = new Date('2026-11-26T09:00:00')
const at = (min: number): Date => new Date(t0.getTime() + min * 60_000)
const tutor: StudyContext = { courseId: 'numcs', session: { id: 's1', title: 'Barycentric formula', type: 'learn' } }
const other: StudyContext = { courseId: 'spca', session: null }

/** Study `minutes` without pause, starting at minute `from`, in 15 s ticks. */
function study(log: StudyLog, ctx: StudyContext, from: number, minutes: number): StudyLog {
  for (let i = 1; i <= minutes * 4; i++) log = accrue(log, ctx, 15, at(from + i / 4), s)
  return log
}

describe('study time', () => {
  it('adds active time per day, course and tutor session', () => {
    let log = study(emptyStudyLog(), tutor, 0, 30)
    log = study(log, other, 30, 10)
    const day = log.days['2026-11-26']
    expect(day.numcs.tutor).toBe(30 * 60)
    expect(day.spca.other).toBe(10 * 60)
    expect(log.sessions).toHaveLength(1)
    expect(log.sessions[0]).toMatchObject({ id: 's1', courseId: 'numcs', activeSec: 1800, title: 'Barycentric formula' })
    expect(totalsSince(log, at(40), 1)).toEqual({ sec: 2400, byCourse: { numcs: 1800, spca: 600 } })
    const series = daySeries(log, at(40), 7, 'numcs')
    expect(series).toHaveLength(7)
    expect(series[6]).toMatchObject({ key: '2026-11-26', sec: 2400, courseSec: 1800 })
    expect(series[0].sec).toBe(0)
  })

  it('makes a break due after the work interval, and a long one after the long interval', () => {
    let log = study(emptyStudyLog(), tutor, 0, 40)
    let st = breakStatus(log, s, at(40))
    expect(st.due).toBe(false)
    expect(st.kind).toBe('short')
    expect(Math.round(st.dueInMin)).toBe(10)
    log = study(log, tutor, 40, 12)
    st = breakStatus(log, s, at(52))
    expect(st.due).toBe(true)
    expect(st.minutes).toBe(10)
    expect(Math.round(st.overdueMin)).toBe(2)
    // two more blocks with real breaks: the third break is the long one
    log = startBreak(log, { kind: 'short', minutes: 10, source: 'tutor' }, at(52))
    log = endBreak(log, at(62), s).log
    expect(log.clock.workSec).toBe(0)
    log = study(log, tutor, 62, 50)
    log = startBreak(log, { kind: 'short', minutes: 10, source: 'tutor' }, at(112))
    log = endBreak(log, at(122), s).log
    log = study(log, tutor, 122, 45)
    st = breakStatus(log, s, at(167))
    expect(st.kind).toBe('long')
    expect(st.minutes).toBe(25)
  })

  it('counts a break only when it lasted at least half of what was planned', () => {
    let log = study(emptyStudyLog(), tutor, 0, 55)
    log = startBreak(log, { kind: 'short', minutes: 10, source: 'tutor' }, at(55))
    // time during a break never counts as study
    expect(accrue(log, tutor, 15, at(56), s)).toBe(log)
    const early = endBreak(log, at(57), s, 's1')
    expect(early.rec?.counted).toBe(false)
    expect(early.log.clock.workSec).toBe(55 * 60)
    expect(breakStatus(early.log, s, at(58)).snoozed).toBe(true)
    const real = endBreak(log, at(62), s, 's1')
    expect(real.rec?.counted).toBe(true)
    expect(real.log.clock.workSec).toBe(0)
    expect(real.log.sessions[0].breaks).toBe(1)
    expect(real.log.breaks).toHaveLength(1)
  })

  it('treats time away as a break when it is long enough', () => {
    let log = study(emptyStudyLog(), tutor, 0, 45)
    // 5 minutes away: not a break
    log = study(log, tutor, 50, 1)
    expect(log.clock.workSec).toBe(46 * 60)
    // 15 minutes away: a short break, the work clock restarts
    log = study(log, tutor, 66, 1)
    expect(log.clock.workSec).toBe(60)
    expect(log.clock.sinceLongSec).toBe(47 * 60)
    expect(log.breaks.at(-1)).toMatchObject({ source: 'away', counted: true, kind: 'short' })
    // 40 minutes away: a long break
    log = study(log, tutor, 107, 1)
    expect(log.clock.sinceLongSec).toBe(60)
  })

  it('loads defensively and keeps settings in range', () => {
    expect(normalizeStudyLog(null)).toEqual(emptyStudyLog())
    const log = normalizeStudyLog({ days: { bad: {}, '2026-11-26': { numcs: { tutor: 60, other: -5 }, x: { tutor: 'a' } } }, sessions: [{ id: 's', courseId: 'c', startedAt: 'nope' }], clock: { workSec: 'x' } })
    expect(log.days).toEqual({ '2026-11-26': { numcs: { tutor: 60, other: 0 } } })
    expect(log.sessions).toEqual([])
    expect(log.clock.workSec).toBe(0)
    expect(normalizeBreakSettings({ workMin: 1000, shortMin: -1, longEveryMin: 10 })).toMatchObject({ enabled: true, workMin: 180, shortMin: 1, longEveryMin: 30 })
    expect(normalizeBreakSettings({ longEveryMin: 0 }).longEveryMin).toBe(0)
    expect(normalizeBreakSettings(undefined)).toEqual(DEFAULT_BREAKS)
  })

  it('formats durations', () => {
    expect(fmtStudy(0)).toBe('0 min')
    expect(fmtStudy(20)).toBe('under a minute')
    expect(fmtStudy(42 * 60)).toBe('42 min')
    expect(fmtStudy(65 * 60)).toBe('1 h 05 min')
    expect(fmtStudyShort(65 * 60)).toBe('1:05 h')
  })
})

describe('the tutor and breaks', () => {
  const course = courseJson as Course
  const graph = new CourseGraph(course)

  it('offers suggest_break only when breaks are on, and explains the rhythm in the prompt', () => {
    expect(agentTools({ cheatsheet: false, breaks: false })).toBe(AGENT_TOOLS)
    expect(agentTools({ cheatsheet: false, breaks: true }).map((t) => t.name)).toContain(BREAK_TOOL.name)
    expect(breaksPrompt({ ...s, enabled: false })).toBeNull()
    const p = breaksPrompt(s)!
    expect(p).toContain('50 minutes of study, then a 10-minute break')
    expect(p).toContain('25-minute break after about 2.5 hours')
    const sys = buildAgentSystemPrompt(course, graph, { profile: [], concepts: {} }, { mode: 'learn', goalConceptId: course.concepts[0].id, scope: [], breaks: p }, t0)
    expect(sys).toContain('# Breaks')
    expect(sys).toContain('suggest_break')
  })

  it('tells the tutor when a break is coming up and when it is due', () => {
    let log = study(emptyStudyLog(), tutor, 0, 40)
    expect(breakNote(breakStatus(log, s, at(40)))).toBeNull()
    log = study(log, tutor, 40, 6)
    expect(breakNote(breakStatus(log, s, at(46)))).toMatch(/due in about 4 minutes/)
    log = study(log, tutor, 46, 6)
    expect(breakNote(breakStatus(log, s, at(52)))).toMatch(/10-minute break is due: call suggest_break/)
    expect(breakNote(breakStatus(log, { ...s, enabled: false }, at(52)))).toBeNull()
    const b = startBreak(log, { kind: 'short', minutes: 10, source: 'tutor' }, at(52))
    const back = endBreak(b, at(63), s)
    expect(backFromBreakNote(back.rec!, back.minutes, false)).toMatch(/back from a 11-minute break/)
  })
})

describe('start and pause', () => {
  it('counts only while started, never paused or on a break', () => {
    expect(countsNow('running', false)).toBe(true)
    expect(countsNow('running', true)).toBe(false)
    expect(countsNow('paused', false)).toBe(false)
  })
  it('keeps the mode in the log; a new or old log starts paused', () => {
    const log = setTimerMode(emptyStudyLog(), 'running')
    expect(normalizeStudyLog(JSON.parse(JSON.stringify(log))).clock.mode).toBe('running')
    expect(emptyStudyLog().clock.mode).toBe('paused')
    expect(normalizeStudyLog({ days: {}, clock: { workSec: 5 } }).clock.mode).toBe('paused')
    expect(normalizeStudyLog({ days: {}, clock: { mode: 'auto' } }).clock.mode).toBe('paused')
  })
})

describe('the block on one course', () => {
  const T0 = new Date('2026-11-20T10:00:00')
  const plus = (min: number): Date => new Date(T0.getTime() + min * 60_000)

  it('grows while you stay, survives a short detour and moves after about ten minutes elsewhere', () => {
    let b = trackBlock(null, 'a', 60, plus(1))
    for (let m = 2; m <= 30; m++) b = trackBlock(b, 'a', 60, plus(m))
    expect(b).toMatchObject({ courseId: 'a', sec: 30 * 60, detour: null })
    for (let m = 31; m <= 35; m++) b = trackBlock(b, 'b', 60, plus(m))
    expect(b.courseId).toBe('a')
    expect(b.detour).toEqual({ courseId: 'b', sec: 300 })
    b = trackBlock(b, 'a', 60, plus(36))
    expect(b).toMatchObject({ courseId: 'a', sec: 31 * 60, detour: null })
    for (let m = 37; m <= 46; m++) b = trackBlock(b, 'b', 60, plus(m))
    expect(b).toMatchObject({ courseId: 'b', sec: DETOUR_MIN * 60, detour: null })
  })

  it('starts again after a long pause', () => {
    const b = trackBlock(trackBlock(null, 'a', 60, plus(1)), 'a', 60, plus(1 + BLOCK_GAP_MIN + 5))
    expect(b.sec).toBe(60)
    expect(liveBlock(b, plus(1 + BLOCK_GAP_MIN + 5 + BLOCK_GAP_MIN + 1))).toBeNull()
  })

  it('is kept by accrue and the log, and the learner can switch', () => {
    let log = setTimerMode(emptyStudyLog(), 'running')
    log = accrue(log, { courseId: 'a', session: null }, 60, plus(1), DEFAULT_BREAKS)
    expect(log.block?.courseId).toBe('a')
    const back = normalizeStudyLog(JSON.parse(JSON.stringify(log)))
    expect(back.block).toEqual(log.block)
    expect(normalizeStudyLog({ ...log, block: { courseId: 3 } }).block).toBeNull()
    expect(switchBlock(log, 'b', plus(2)).block).toMatchObject({ courseId: 'b', sec: 0 })
  })

  it('keeps the block length setting in range', () => {
    expect(normalizeBreakSettings({}).blockMin).toBe(90)
    expect(normalizeBreakSettings({ blockMin: 0 }).blockMin).toBe(0)
    expect(normalizeBreakSettings({ blockMin: 10 }).blockMin).toBe(30)
    expect(normalizeBreakSettings({ blockMin: 999 }).blockMin).toBe(240)
  })
})
