// Study time and breaks in the UI: the clock in the top bar, the break dialog and the break screen,
// the tutor's break card in the session stream, the app's own nudge, and the study time panel in Stats.
import {
  BREAK_AVOID,
  BREAK_IDEAS,
  breaksToday,
  daySeries,
  fmtStudy,
  fmtStudyShort,
  totalsSince,
  type BreakRec,
  type StudyLog
} from '@shared/studyTime'
import { dayKey } from '@shared/util'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useApp } from '../engine/app'
import type { ToolItem } from '../engine/chat'
import type { BreakOffer } from '../engine/studyClock'
import { useStore } from '../engine/store'
import { relTime } from '../lib/format'
import { BarChart } from './Bars'
import { Icon } from './Icon'
import { Modal } from './Modal'

/** Re-render with the study clock (every tick, and when a break starts or ends). */
function useStudy(): { log: StudyLog; now: Date } {
  const app = useApp()
  useStore(app.study.tick)
  const log = useStore(app.study.log)
  return { log, now: new Date() }
}

const mins = (m: number): string => `${Math.max(0, Math.round(m))} min`

// ------------------------------------------------------------ top bar
export function StudyPill(): ReactElement | null {
  const app = useApp()
  const { log, now } = useStudy()
  const st = app.study.status(now)
  const today = totalsSince(log, now, 1).sec
  if (st.current) {
    const left = st.leftMin ?? 0
    return (
      <button className="study-pill on-break" onClick={() => app.study.openOffer()} title="On a break">
        <Icon name="clock" size={13} /> {left > 0 ? `break · ${mins(left)} left` : 'break over'}
      </button>
    )
  }
  const due = st.due && !st.snoozed
  const mode = log.clock.mode
  const tip = [
    `Studied today: ${fmtStudy(today)}`,
    mode === 'running'
      ? 'Timer started: every minute counts for the open course until you pause it'
      : mode === 'paused'
        ? 'Paused: nothing counts until you press Start'
        : 'Counting by itself while you work in a session, the materials or exam prep',
    st.enabled ? `${fmtStudy(st.workMin * 60)} since your last break${st.due ? '' : `; next break in about ${mins(st.dueInMin)}`}` : 'Break suggestions are off (Settings → Learning)',
    'Click to take a break now'
  ].join('\n')
  return (
    <span className={`study-timer ${mode}`}>
      <button className={`study-pill ${due ? 'due' : ''}`} onClick={() => app.study.openOffer()} title={tip} aria-label={`Study time today ${fmtStudy(today)}${mode === 'paused' ? ', paused' : mode === 'running' ? ', timer running' : ''}${due ? ', a break is due' : ''}`}>
        <Icon name="clock" size={13} /> {fmtStudyShort(today)}
        {mode === 'paused' ? <span className="study-due">paused</span> : due ? <span className="study-due">break</span> : null}
      </button>
      {mode === 'running' || mode === 'auto' ? (
        <button
          className={`study-toggle ${mode === 'running' ? 'on' : ''}`}
          onClick={() => app.study.pauseTimer()}
          title={mode === 'running' ? 'Pause the timer' : 'Pause: stop counting study time until you press Start'}
          aria-label="Pause the study timer"
        >
          <Icon name="pause" size={12} />
        </button>
      ) : null}
      {mode !== 'running' && (
        <button className="study-toggle" onClick={() => app.study.startTimer()} title="Start: count every minute for the open course until you pause, also away from the screen (paper, lectures)" aria-label="Start the study timer">
          <Icon name="play" size={12} />
        </button>
      )}
    </span>
  )
}

// ------------------------------------------------------------ dialog and break screen
export function BreakLayer(): ReactElement | null {
  const app = useApp()
  const offer = useStore(app.study.offer)
  const current = useStore(app.study.log, (l) => l.clock.current)
  if (current) return <BreakScreen rec={current} />
  if (offer) return <BreakDialog offer={offer} />
  return null
}

function IdeaList({ pick }: { pick: string | null }): ReactElement {
  const list = pick ? [...BREAK_IDEAS.filter((x) => x.id === pick), ...BREAK_IDEAS.filter((x) => x.id !== pick)] : BREAK_IDEAS
  return (
    <ul className="break-ideas">
      {list.map((x) => (
        <li key={x.id} className={x.id === pick ? 'pick' : ''}>
          <b>{x.label}.</b> {x.text}
        </li>
      ))}
    </ul>
  )
}

function BreakDialog({ offer }: { offer: BreakOffer }): ReactElement {
  const app = useApp()
  const { log, now } = useStudy()
  const st = app.study.status(now)
  const [minutes, setMinutes] = useState(offer.minutes)
  const today = totalsSince(log, now, 1).sec
  const taken = breaksToday(log, now).filter((b) => b.source !== 'away').length
  const close = (): void => app.study.closeOffer()
  return (
    <Modal onClose={close} width={480} label="Take a break">
      <div className="break-dialog">
        <div className="eyebrow">{st.due ? 'break due' : 'break'}</div>
        <h2>{minutes}-minute {offer.kind === 'long' ? 'long ' : ''}break</h2>
        <p className="muted">{offer.reason}</p>
        <div className="break-facts small">
          <span>today {fmtStudy(today)}</span>
          <span>since the last break {fmtStudy(st.workMin * 60)}</span>
          <span>{taken === 1 ? '1 break' : `${taken} breaks`} today</span>
        </div>
        <div className="row" style={{ gap: 6, margin: '12px 0 4px' }}>
          <button className="btn sm icon ghost" onClick={() => setMinutes((m) => Math.max(3, m - (m > 10 ? 5 : 1)))} aria-label="Shorter">
            <Icon name="minus" size={14} />
          </button>
          <span className="break-len">{minutes} min</span>
          <button className="btn sm icon ghost" onClick={() => setMinutes((m) => Math.min(45, m + (m >= 10 ? 5 : 1)))} aria-label="Longer">
            <Icon name="plus" size={14} />
          </button>
        </div>
        <IdeaList pick={offer.idea} />
        <p className="small muted">{BREAK_AVOID}</p>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn ghost" onClick={() => (st.due ? app.study.later(undefined, true) : close())}>
            {st.due ? 'Not now' : 'Cancel'}
          </button>
          <button className="btn primary" onClick={() => app.study.beginBreak({ ...offer, minutes })}>
            Start break
          </button>
        </div>
      </div>
    </Modal>
  )
}

function BreakScreen({ rec }: { rec: BreakRec }): ReactElement {
  const app = useApp()
  const [t, setT] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const leftSec = Math.round(rec.plannedMin * 60 - (t - Date.parse(rec.startedAt)) / 1000)
  const over = leftSec <= 0
  const mm = Math.floor(Math.abs(leftSec) / 60)
  const ss = String(Math.abs(leftSec) % 60).padStart(2, '0')
  const tooEarly = (t - Date.parse(rec.startedAt)) / 60_000 < rec.plannedMin / 2
  return (
    <div className="break-screen" role="dialog" aria-modal="true" aria-label="Break">
      <div className="break-inner">
        <div className="eyebrow">{over ? 'break over' : `${rec.plannedMin}-minute break`}</div>
        <div className={`break-timer ${over ? 'over' : ''}`} aria-live="off">
          {over ? '+' : ''}
          {mm}:{ss}
        </div>
        <p className="break-lead">{over ? 'Welcome back. The tutor picks up where you left off.' : 'Step away from the screen. This page waits for you.'}</p>
        {!over && <IdeaList pick={rec.kind === 'long' ? 'outside' : null} />}
        <button className={`btn ${over ? 'primary' : 'ghost'}`} onClick={() => app.study.finishBreak()} title={tooEarly && !over ? 'Back before half the break: it will not count as a break' : undefined}>
          {over ? 'Back to studying' : "I'm back early"}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ in the session
/** The tutor's suggest_break card in the stream. */
export function BreakSuggestCard({ it }: { it: ToolItem }): ReactElement {
  const app = useApp()
  const { log } = useStudy()
  const a = (it.args ?? {}) as { minutes?: number; kind?: 'short' | 'long'; reason?: string; idea?: string | null }
  if (it.status === 'streaming') return <div className="tool-line busy"><Icon name="clock" size={14} /><span>Suggesting a break</span></div>
  if (it.status === 'error') return <div className="tool-line"><Icon name="clock" size={14} /><span>Break suggestions are off</span></div>
  const minutes = Number(a.minutes) || app.study.settings.shortMin
  const idea = BREAK_IDEAS.find((x) => x.id === a.idea) ?? null
  // what became of it: a break that started after the card, while the card is the latest suggestion
  const after = [...log.breaks, ...(log.clock.current ? [log.clock.current] : [])].find((b) => b.source === 'tutor' && b.startedAt >= it.at)
  const offer: BreakOffer = { kind: a.kind === 'long' ? 'long' : 'short', minutes, source: 'tutor', reason: a.reason ?? '', idea: idea?.id ?? null }
  return (
    <div className="break-suggest" aria-label="Break suggestion">
      <div className="eyebrow">
        <Icon name="clock" size={13} /> Time for a break · {minutes} min
      </div>
      {a.reason && <div className="break-reason">{a.reason}</div>}
      {idea && (
        <div className="small muted">
          <b>{idea.label}.</b> {idea.text}
        </div>
      )}
      {after ? (
        <div className="small muted" style={{ marginTop: 6 }}>
          {after.endedAt ? (after.counted ? `Break taken (${mins((Date.parse(after.endedAt) - Date.parse(after.startedAt)) / 60_000)}).` : 'Back early: not counted as a break.') : 'On a break.'}
        </div>
      ) : (
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn sm primary" onClick={() => app.study.beginBreak(offer)}>
            Start {minutes}-min break
          </button>
          <button className="btn sm ghost" onClick={() => app.study.openOffer(offer)}>
            Change
          </button>
          <button className="btn sm ghost" onClick={() => app.study.later(undefined, true)} title="The break comes back in about 10 minutes">
            Not now
          </button>
        </div>
      )}
    </div>
  )
}

/** The app's own reminder: in guided sessions, or when the tutor did not suggest the due break. */
export function BreakNudge({ agent }: { agent: boolean }): ReactElement | null {
  const app = useApp()
  const { now } = useStudy()
  if (!app.study.shouldNudge(agent, now)) return null
  const st = app.study.status(now)
  return (
    <div className="break-nudge" role="status">
      <Icon name="clock" size={14} />
      <span>
        {Math.round(st.workMin)} minutes without a break. Time for a {st.minutes}-minute {st.kind === 'long' ? 'long ' : ''}break.
      </span>
      <button className="btn sm primary" onClick={() => app.study.openOffer(app.study.defaultOffer('app'))}>
        Take it
      </button>
      <button className="btn sm ghost" onClick={() => app.study.later()}>
        In 10 min
      </button>
    </div>
  )
}

// ------------------------------------------------------------ stats
export function StudyTimePanel(): ReactElement {
  const app = useApp()
  const { log, now } = useStudy()
  const courses = useStore(app.courses)
  const [table, setTable] = useState(false)
  const name = (id: string): string => courses.find((c) => c.id === id)?.short ?? id
  const days = useMemo(() => daySeries(log, now, 14), [log, now])
  const today = totalsSince(log, now, 1)
  const week = totalsSince(log, now, 7)
  const sessions = log.sessions.slice(-8).reverse()
  const breaks = breaksToday(log, now)
  const weekday = (d: Date): string => d.toLocaleDateString('en-GB', { weekday: 'short' })
  const byCourse = Object.entries(week.byCourse).sort((a, b) => b[1] - a[1])
  return (
    <div className="panel" aria-label="Study time">
      <div className="panel-title">
        <div>
          <h3>Study time</h3>
          <div className="hint">active time in tutor sessions, the materials and exam prep, all courses</div>
        </div>
        <button className="btn sm ghost" onClick={() => setTable((t) => !t)} aria-pressed={table}>
          <Icon name={table ? 'stats' : 'list'} size={14} /> {table ? 'Chart' : 'Table'}
        </button>
      </div>
      <div className="study-tiles">
        <div>
          <div className="label">today</div>
          <div className="value">{fmtStudy(today.sec)}</div>
          <div className="sub">{breaks.length === 1 ? '1 break' : `${breaks.length} breaks`}</div>
        </div>
        <div>
          <div className="label">last 7 days</div>
          <div className="value">{fmtStudy(week.sec)}</div>
          <div className="sub">{byCourse.length ? byCourse.map(([c, s]) => `${name(c)} ${fmtStudyShort(s)}`).join(' · ') : 'nothing yet'}</div>
        </div>
        <div>
          <div className="label">{app.course.short}, 7 days</div>
          <div className="value">{fmtStudy(week.byCourse[app.courseId] ?? 0)}</div>
          <div className="sub">daily average {fmtStudy((week.byCourse[app.courseId] ?? 0) / 7)}</div>
        </div>
      </div>
      {table ? (
        <table className="data-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>All courses</th>
              <th>{app.course.short}</th>
              <th>By course</th>
            </tr>
          </thead>
          <tbody>
            {[...days].reverse().map((d) => (
              <tr key={d.key}>
                <td>
                  {weekday(d.date)} {d.date.getDate()}.{d.date.getMonth() + 1}.
                </td>
                <td>{fmtStudy(d.sec)}</td>
                <td>{fmtStudy(d.byCourse[app.courseId] ?? 0)}</td>
                <td>
                  {Object.entries(d.byCourse)
                    .map(([c, s]) => `${name(c)} ${fmtStudyShort(s)}`)
                    .join(' · ') || '–'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <BarChart
          ariaLabel="Minutes studied per day, last 14 days"
          height={180}
          format={(v) => (v < 5 && v % 1 ? v.toFixed(1) : `${Math.round(v)}`)}
          data={days.map((d) => ({
            label: d.key === dayKey(now) ? 'today' : `${weekday(d.date).slice(0, 2)} ${d.date.getDate()}`,
            value: d.sec / 60,
            tip: `${weekday(d.date)} ${d.date.getDate()}.${d.date.getMonth() + 1}.: ${fmtStudy(d.sec)}${Object.keys(d.byCourse).length > 1 ? ` (${Object.entries(d.byCourse).map(([c, s]) => `${name(c)} ${fmtStudyShort(s)}`).join(', ')})` : ''}`
          }))}
        />
      )}
      <div className="eyebrow" style={{ marginTop: 14 }}>
        recent tutor sessions
      </div>
      {sessions.length ? (
        <div className="session-list study-sessions">
          {sessions.map((s) => (
            <div className="session-row" key={s.id}>
              <span className="row" style={{ minWidth: 0 }}>
                <span className="chip">{s.type}</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
              </span>
              <span className="muted small">{name(s.courseId)}</span>
              <span className="small">{fmtStudy(s.activeSec)}</span>
              <span className="muted small">{s.breaks ? (s.breaks === 1 ? '1 break' : `${s.breaks} breaks`) : 'no break'}</span>
              <span className="muted small">{relTime(s.lastAt, now)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty">Time in tutor sessions shows up here.</div>
      )}
    </div>
  )
}
