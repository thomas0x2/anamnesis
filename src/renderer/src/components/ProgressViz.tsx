// Today's pictures of progress, drawn in the Ma style: ink that brightens with mastery, hairlines,
// and one vermilion point for where you are now.
//   CourseMasteryMap  every concept of the course as a cell, one row per chapter
//   ExamPace          problem sets and mock exams done over time, against the straight line to the goal
//   ActivityBars      insight points per day over the last two weeks
import { prepProgress, workItems, workState } from '@shared/exam'
import { STATUS_ORDER } from '@shared/mastery'
import { chapterReadiness } from '@shared/stats'
import type { ConceptStatus } from '@shared/types'
import { useMemo, type ReactElement } from 'react'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct, STATUS_LABEL } from '../lib/format'
import { useNow } from '../lib/hooks'

const DAY = 86_400_000

/** One row per chapter, one cell per concept (brighter = further along); the vermilion ring is where you are. */
export function CourseMasteryMap({ here }: { here: string | null }): ReactElement {
  const app = useApp()
  const state = useStore(app.state, (s) => s)
  const now = useNow()
  const graph = app.graph
  const readiness = useMemo(() => chapterReadiness(graph, state, now), [graph, state, now])
  const rows = readiness.filter((r) => r.concepts > 0)
  const totals = STATUS_ORDER.reduce(
    (acc, s) => {
      acc[s] = rows.reduce((n, r) => n + r.counts[s], 0)
      return acc
    },
    {} as Record<ConceptStatus, number>
  )
  const all = Object.values(totals).reduce((a, b) => a + b, 0) || 1
  return (
    <div className="mastery-map">
      <div className="mm-stack" aria-label="Concepts by status across the course">
        {[...STATUS_ORDER].reverse().map((s) =>
          totals[s] ? <span key={s} style={{ flex: totals[s] / all, background: `var(--m-${s})` }} title={`${STATUS_LABEL[s]}: ${totals[s]}`} /> : null
        )}
      </div>
      <div className="mm-rows">
        {rows.map((r) => {
          const cs = graph.chapterConcepts(r.chapter).filter((c) => c.tier !== 'extra')
          return (
            <div className="mm-row" key={r.chapter}>
              <span className="n">{r.chapter || '·'}</span>
              <button className="t" title={r.title} onClick={() => app.go({ name: 'map', conceptId: cs[0]?.id })}>
                {r.title}
              </button>
              <span className="cells">
                {cs.map((c) => {
                  const st = state.learner.concepts[c.id]?.status ?? 'unseen'
                  return (
                    <button
                      key={c.id}
                      className={`cell ${st} ${c.id === here ? 'here' : ''}`}
                      title={`${c.title} · ${STATUS_LABEL[st]}`}
                      aria-label={`${c.title}: ${STATUS_LABEL[st]}`}
                      onClick={() => app.go({ name: 'map', conceptId: c.id })}
                    />
                  )
                })}
              </span>
              <span className="v">{pct(r.readiness)}</span>
            </div>
          )
        })}
      </div>
      <div className="mm-legend">
        {[...STATUS_ORDER].reverse().map((s) => (
          <span key={s}>
            <i className={`cell ${s}`} /> {STATUS_LABEL[s].toLowerCase()} <b>{totals[s]}</b>
          </span>
        ))}
        {here && (
          <span>
            <i className="cell here unseen" /> you are here
          </span>
        )}
      </div>
    </div>
  )
}

/** Sets and mocks done over time, against the even pace from your first step to the exam date. */
export function ExamPace(): ReactElement {
  const app = useApp()
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const state = useStore(app.state, (s) => s)
  const now = useNow()
  const p = prepProgress(prep, materials, now)
  const goal = p.sets.total + p.mocks.goal
  const { sets, mocks } = workItems(materials)
  const doneTimes = [...sets, ...mocks]
    .map((m) => {
      const ws = workState(prep, m.id)
      if (!ws.done) return null
      const graded = ws.submissions.filter((s) => s.status === 'graded').map((s) => Date.parse(s.at))
      const t = prep.records[m.id]?.doneAt ? Date.parse(prep.records[m.id].doneAt!) : graded.length ? Math.min(...graded) : now.getTime()
      return t
    })
    .filter((t): t is number => t !== null)
    .sort((a, b) => a - b)

  if (!prep.examDate || p.daysLeft === null || p.daysLeft < 0 || goal === 0)
    return (
      <div className="viz-empty">
        <svg viewBox="0 0 300 120" className="pace" aria-hidden>
          <line x1="20" y1="100" x2="280" y2="100" className="axis" />
          <line x1="20" y1="100" x2="280" y2="20" className="ideal" />
        </svg>
        <span>Set the exam date and the number of problem sets to see your pace.</span>
        <button className="btn sm" onClick={() => app.go({ name: 'exam' })}>
          Set the exam goal
        </button>
      </div>
    )

  const exam = Date.parse(`${prep.examDate}T12:00:00`)
  const firstSession = state.sessions.length ? Math.min(...state.sessions.map((s) => Date.parse(s.startedAt))) : now.getTime()
  const start = Math.min(firstSession, doneTimes[0] ?? now.getTime(), now.getTime() - 7 * DAY)
  const W = 320
  const H = 150
  const L = 26
  const R = 10
  const T = 12
  const B = 22
  const x = (t: number): number => L + ((t - start) / Math.max(DAY, exam - start)) * (W - L - R)
  const y = (n: number): number => H - B - (n / goal) * (H - T - B)
  const steps: string[] = [`M${x(start)},${y(0)}`]
  doneTimes.forEach((t, i) => {
    steps.push(`H${x(t)}`, `V${y(i + 1)}`)
  })
  steps.push(`H${x(now.getTime())}`)
  const done = doneTimes.length
  const expected = Math.round(((now.getTime() - start) / Math.max(DAY, exam - start)) * goal)
  const ahead = done - expected
  return (
    <div className="exam-pace">
      <svg viewBox={`0 0 ${W} ${H}`} className="pace" role="img" aria-label={`${done} of ${goal} sets and mocks done; the even pace would be ${expected} by today`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={y(goal * f)} y2={y(goal * f)} className="grid" />
            <text x={L - 6} y={y(goal * f) + 3} className="lbl" textAnchor="end">
              {Math.round(goal * f)}
            </text>
          </g>
        ))}
        <line x1={x(start)} y1={y(0)} x2={x(exam)} y2={y(goal)} className="ideal" />
        <path d={steps.join(' ')} className="actual" />
        <line x1={x(now.getTime())} x2={x(now.getTime())} y1={T} y2={H - B} className="today" />
        <circle cx={x(now.getTime())} cy={y(done)} r="4" className="here" />
        <text x={x(now.getTime())} y={H - 6} className="lbl" textAnchor="middle">
          today
        </text>
        <text x={x(exam)} y={H - 6} className="lbl" textAnchor="end">
          exam
        </text>
      </svg>
      <div className="pace-note">
        <b>
          {done} of {goal}
        </b>{' '}
        done · {ahead === 0 ? 'right on pace' : ahead > 0 ? `${ahead} ahead of an even pace` : `${-ahead} behind an even pace`}
      </div>
    </div>
  )
}

/** Insight points per day for the last 14 days; today in vermilion. */
export function ActivityBars(): ReactElement {
  const app = useApp()
  const events = useStore(app.state, (s) => s.rewards.events)
  const sessions = useStore(app.state, (s) => s.sessions)
  const now = useNow()
  const days = useMemo(() => {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    const out = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(start.getTime() - (13 - i) * DAY)
      return { d, pts: 0, sessions: 0 }
    })
    const idx = (t: number): number => Math.floor((t - out[0].d.getTime()) / DAY)
    for (const e of events) {
      const i = idx(Date.parse(e.at))
      if (i >= 0 && i < 14) out[i].pts += e.points
    }
    for (const s of sessions) {
      const i = idx(Date.parse(s.startedAt))
      if (i >= 0 && i < 14) out[i].sessions++
    }
    return out
  }, [events, sessions, now])
  const max = Math.max(10, ...days.map((d) => d.pts))
  const active = days.filter((d) => d.pts > 0 || d.sessions > 0).length
  let streak = 0
  for (let i = days.length - 1; i >= 0 && (days[i].pts > 0 || days[i].sessions > 0); i--) streak++
  return (
    <div className="activity">
      <div className="bars" role="img" aria-label={`Points per day over the last 14 days; active on ${active} days`}>
        {days.map((d, i) => (
          <span key={i} className={`day ${i === days.length - 1 ? 'today' : ''}`} title={`${d.d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.pts} points, ${d.sessions} sessions`}>
            <span className="fill" style={{ height: `${Math.max(d.pts ? 6 : 2, (d.pts / max) * 100)}%` }} />
            <span className="dl">{d.d.toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
          </span>
        ))}
      </div>
      <div className="pace-note">
        <b>{active} of 14</b> days active{streak > 1 ? ` · ${streak}-day streak` : ''}
      </div>
    </div>
  )
}
