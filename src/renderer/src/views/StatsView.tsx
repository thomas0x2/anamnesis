// Stats that measure understanding honestly: retrieval accuracy by difficulty, memory, calibration of
// your confidence, independence from hints, and readiness per chapter. Every chart has a table view.
import { STATUS_ORDER } from '@shared/mastery'
import { accuracyByLevel, allEvidence, calibrationBins, chapterReadiness, CONFIDENCE_LABEL, dueForecast, hintTrend, overview } from '@shared/stats'
import { dayKey } from '@shared/util'
import { useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { BarChart } from '../components/Bars'
import { Chart } from '../components/Chart'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { LEVEL_LABEL, pct, plural, relTime, STATUS_LABEL } from '../lib/format'
import { useNow } from '../lib/hooks'
import { SegBar, StatusLegend } from './HomeView'

function ChartPanel({ title, hint, children, table, footer }: { title: string; hint?: string; children: ReactNode; table?: ReactNode; footer?: ReactNode }): ReactElement {
  const [showTable, setShowTable] = useState(false)
  return (
    <div className="panel">
      <div className="panel-title">
        <div>
          <h3>{title}</h3>
          {hint && <div className="hint">{hint}</div>}
        </div>
        {table && (
          <button className="btn sm ghost" onClick={() => setShowTable((t) => !t)} aria-pressed={showTable}>
            <Icon name={showTable ? 'stats' : 'list'} size={14} /> {showTable ? 'Chart' : 'Table'}
          </button>
        )}
      </div>
      {showTable && table ? table : children}
      {footer && <div className="small" style={{ color: 'var(--text-2)', marginTop: 10 }}>{footer}</div>}
    </div>
  )
}

// one hue, brighter = more answers (the light end clears the chart surface at 2.8:1)
const ACTIVITY_RAMP = ['var(--surface-3)', '#5c2a8a', '#7f33bd', '#a341e8', '#d6a3f7']
const ACTIVITY_BINS = [0, 1, 6, 12, 24]
const binOf = (n: number): number => (n >= 24 ? 4 : n >= 12 ? 3 : n >= 6 ? 2 : n >= 1 ? 1 : 0)

export function StatsView(): ReactElement {
  const app = useApp()
  const state = useStore(app.state, (s) => s)
  const now = useNow()
  const graph = app.graph
  const evs = useMemo(() => allEvidence(state), [state])
  const ov = useMemo(() => overview(graph, state, now), [graph, state, now])
  const bins = useMemo(() => calibrationBins(state.calibration), [state.calibration])
  const levels = useMemo(() => accuracyByLevel(evs), [evs])
  const forecast = useMemo(() => dueForecast(state, now, 7), [state, now])
  const hints = useMemo(() => hintTrend(evs, 6, now), [evs, now])
  const readiness = useMemo(() => chapterReadiness(graph, state, now), [graph, state, now])
  const total = app.course.concepts.length
  const solid = ov.counts.proficient + ov.counts.mastered

  // calendar of the last four weeks, Monday first
  const calendar = useMemo(() => {
    const byDay = new Map<string, { n: number; sum: number }>()
    for (const e of evs) {
      if (e.kind === 'predict' || e.kind === 'probe') continue
      const k = dayKey(e.at)
      const v = byDay.get(k) ?? { n: 0, sum: 0 }
      v.n++
      v.sum += e.score
      byDay.set(k, v)
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - 21)
    return Array.from({ length: 28 }, (_, i) => {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      const k = dayKey(d)
      const v = byDay.get(k)
      return { day: d, key: k, future: d > today, n: v?.n ?? 0, acc: v ? v.sum / v.n : null }
    })
  }, [evs, now])
  const [hoverDay, setHoverDay] = useState<number | null>(null)

  const calSeries = bins.filter((b) => b.observed !== null).map((b) => [b.claimed, b.observed!] as [number, number])
  const worst = bins.filter((b) => b.observed !== null && b.n >= 3).sort((a, b) => Math.abs(b.observed! - b.claimed) - Math.abs(a.observed! - a.claimed))[0]
  const biasText =
    ov.bias === null ? 'No confidence ratings yet' : Math.abs(ov.bias) < 0.05 ? 'Well calibrated' : ov.bias > 0 ? `Overconfident by ${Math.round(ov.bias * 100)} points` : `Underconfident by ${Math.round(-ov.bias * 100)} points`
  const misc = useMemo(() => {
    const all = Object.entries(state.learner.concepts).flatMap(([cid, c]) => c.misconceptions.map((m) => ({ ...m, conceptId: cid })))
    return { open: all.filter((m) => m.status === 'active'), resolved: all.filter((m) => m.status === 'resolved').sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')) }
  }, [state.learner.concepts])
  const weekday = (d: Date): string => d.toLocaleDateString('en-GB', { weekday: 'short' })

  return (
    <div className="page" style={{ maxWidth: 1240 }}>
      <div className="page-head">
        <div>
          <h1>Stats</h1>
          <div className="sub">Measured on retrieval: answers you produced, scored after hints. Time spent does not count.</div>
        </div>
      </div>

      <div className="tiles">
        <div className="tile">
          <div className="label">Proficient or mastered</div>
          <div className="value">
            {solid} <span className="small muted">of {total}</span>
          </div>
          <div className="sub">
            {ov.counts.developing} developing · {ov.counts.introduced} introduced
          </div>
        </div>
        <div className="tile">
          <div className="label">Memory now</div>
          <div className="value">{pct(ov.avgRetention)}</div>
          <div className="sub">average chance you recall a learned concept today</div>
        </div>
        <div className="tile">
          <div className="label">Accuracy, last 7 days</div>
          <div className="value">{pct(ov.accuracy7d)}</div>
          <div className="sub">{ov.items7d ? `${plural(ov.items7d, 'graded answer')}, after hints` : 'no graded answers this week'}</div>
        </div>
        <div className="tile">
          <div className="label">Confidence calibration</div>
          <div className="value" style={{ fontSize: ov.bias === null ? 20 : undefined }}>{ov.bias === null ? '–' : `${ov.bias > 0 ? '+' : ''}${Math.round(ov.bias * 100)} pts`}</div>
          <div className="sub">
            {biasText}
            {ov.brier !== null ? ` · Brier ${ov.brier.toFixed(2)}` : ''}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <ChartPanel
          title="Readiness by chapter"
          hint="status of each core concept × how well you still remember it"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>Chapter</th>
                  <th>Concepts</th>
                  <th>Started</th>
                  <th>Mastery</th>
                  <th>Memory</th>
                  <th>Readiness</th>
                </tr>
              </thead>
              <tbody>
                {readiness.map((r) => (
                  <tr key={r.chapter}>
                    <td>
                      {r.chapter ? `${r.chapter}. ` : ''}
                      {r.title}
                    </td>
                    <td>{r.concepts}</td>
                    <td>{r.seen}</td>
                    <td>{pct(r.mastery)}</td>
                    <td>{pct(r.retention)}</td>
                    <td>{pct(r.readiness)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <div className="chapter-strip">
            {readiness
              .filter((r) => r.concepts > 0)
              .map((r) => (
                <div className="chapter-row" key={r.chapter} style={{ gridTemplateColumns: '26px minmax(0, 1fr) 220px 48px' }} title={STATUS_ORDER.map((s) => `${STATUS_LABEL[s]}: ${r.counts[s]}`).join(' · ')}>
                  <span className="n">{r.chapter || '·'}</span>
                  <span className="t">{r.title}</span>
                  <SegBar counts={r.counts} />
                  <span className="v">{pct(r.readiness)}</span>
                </div>
              ))}
          </div>
          <StatusLegend />
        </ChartPanel>
      </div>

      <div className="stats-grid">
        <ChartPanel
          title="Calibration"
          hint="how often you are right at each confidence level"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>You said</th>
                  <th>Claimed</th>
                  <th>Right</th>
                  <th>Answers</th>
                </tr>
              </thead>
              <tbody>
                {bins.map((b) => (
                  <tr key={b.confidence}>
                    <td>{CONFIDENCE_LABEL[b.confidence]}</td>
                    <td>{pct(b.claimed)}</td>
                    <td>{pct(b.observed)}</td>
                    <td>{b.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer={
            worst
              ? `When you said “${CONFIDENCE_LABEL[worst.confidence]}” you were right ${pct(worst.observed)} of the time (${plural(worst.n, 'answer')}); perfect calibration would be ${pct(worst.claimed)}.`
              : 'Pick a confidence before checking an answer. Knowing what you do not know tells you what to review.'
          }
        >
          {calSeries.length ? (
            <Chart
              series={[
                { label: 'perfect calibration', points: [[0, 0], [1, 1]], style: 'dashed', color: 'var(--muted)', width: 1.4, noTip: true },
                { label: 'your answers', points: calSeries, color: 'var(--s1)' },
                { label: 'your answers', points: calSeries, style: 'points', color: 'var(--s1)', radius: 5, noLegend: true, noTip: true }
              ]}
              xMin={0}
              xMax={1}
              yMin={0}
              yMax={1}
              height={240}
              formatX={(x) => pct(x)}
              formatY={(y) => pct(y)}
              xLabel="confidence you gave"
              yLabel="answers right"
            />
          ) : (
            <div className="empty">No confidence ratings yet.</div>
          )}
        </ChartPanel>

        <ChartPanel
          title="Accuracy by difficulty"
          hint="practice and review answers, scored after hints"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>Level</th>
                  <th>Accuracy</th>
                  <th>Answers</th>
                </tr>
              </thead>
              <tbody>
                {levels.map((l) => (
                  <tr key={l.level}>
                    <td>
                      {l.level} · {LEVEL_LABEL[l.level]}
                    </td>
                    <td>{pct(l.mean)}</td>
                    <td>{l.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer="Levels climb as you succeed: recall, apply, compose two ideas, transfer to unfamiliar cues, exam style. Around 80% at your current level is the sweet spot."
        >
          <BarChart ariaLabel="Accuracy by difficulty level" data={levels.map((l) => ({ label: `${l.level} ${LEVEL_LABEL[l.level]}`, value: l.n ? l.mean : null, tip: plural(l.n, 'answer') }))} max={1} format={(v) => pct(v)} />
        </ChartPanel>

        <ChartPanel
          title="Activity"
          hint="graded answers per day, last four weeks"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Answers</th>
                  <th>Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {calendar
                  .filter((c) => c.n > 0)
                  .map((c) => (
                    <tr key={c.key}>
                      <td>{c.day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td>{c.n}</td>
                      <td>{pct(c.acc)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          }
        >
          <div style={{ maxWidth: 340 }} onMouseLeave={() => setHoverDay(null)}>
            <div className="heat" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', marginBottom: 4 }}>
              {calendar.slice(0, 7).map((c) => (
                <span key={c.key} className="tiny muted" style={{ textAlign: 'center' }}>
                  {weekday(c.day).slice(0, 2)}
                </span>
              ))}
            </div>
            <div className="heat" style={{ gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
              {calendar.map((c, i) => (
                <span
                  key={c.key}
                  className="heat-cell"
                  onMouseEnter={() => setHoverDay(i)}
                  style={{
                    background: c.future ? 'transparent' : ACTIVITY_RAMP[binOf(c.n)],
                    border: c.future ? '1px dashed var(--line-2)' : undefined,
                    outline: hoverDay === i ? '2px solid var(--text-2)' : c.key === dayKey(now) ? '1.5px solid var(--accent)' : undefined,
                    outlineOffset: 1
                  }}
                />
              ))}
            </div>
          </div>
          <div className="small" style={{ color: 'var(--text-2)', marginTop: 8, minHeight: 20 }}>
            {hoverDay !== null && calendar[hoverDay]
              ? `${calendar[hoverDay].day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}: ${calendar[hoverDay].future ? 'still ahead' : calendar[hoverDay].n ? `${plural(calendar[hoverDay].n, 'answer')}, ${pct(calendar[hoverDay].acc)} right` : 'no answers'}`
              : `${plural(calendar.filter((c) => c.n > 0).length, 'active day')} in the last four weeks. Short daily sessions beat one long one.`}
          </div>
          <div className="legend-row" style={{ marginTop: 8 }}>
            {ACTIVITY_BINS.map((b, i) => (
              <span key={b}>
                <span className="status-dot" style={{ background: ACTIVITY_RAMP[i], borderRadius: 3 }} />
                {i === 0 ? 'none' : i === ACTIVITY_BINS.length - 1 ? `${b}+` : `${b}–${ACTIVITY_BINS[i + 1] - 1}`}
              </span>
            ))}
          </div>
        </ChartPanel>

        <ChartPanel
          title="Reviews coming up"
          hint="concepts due on each of the next 7 days"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Due</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((n, i) => (
                  <tr key={i}>
                    <td>{i === 0 ? 'Today (incl. overdue)' : weekday(new Date(now.getTime() + i * 86_400_000))}</td>
                    <td>{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer="Each successful review pushes the next one further out; a lapse brings it closer."
        >
          <BarChart
            ariaLabel="Reviews due per day"
            data={forecast.map((n, i) => ({ label: i === 0 ? 'Today' : weekday(new Date(now.getTime() + i * 86_400_000)), value: n, tip: i === 0 ? 'includes overdue reviews' : undefined }))}
            max={Math.max(4, ...forecast)}
            format={(v) => String(Math.round(v))}
            color="var(--s3)"
          />
        </ChartPanel>

        <ChartPanel
          title="Help needed per item"
          hint="hints used per answer (a shown solution counts as 3), by week"
          table={
            <table className="data-table">
              <thead>
                <tr>
                  <th>Week</th>
                  <th>Hints per item</th>
                  <th>Answers</th>
                </tr>
              </thead>
              <tbody>
                {hints.map((h) => (
                  <tr key={h.week}>
                    <td>{h.week === 0 ? 'this week' : `${-h.week} weeks ago`}</td>
                    <td>{h.hintsPerItem === null ? '–' : h.hintsPerItem.toFixed(2)}</td>
                    <td>{h.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          footer="Falling means you solve more on your own. Hints still help while learning; the goal is to need fewer over time."
        >
          {hints.some((h) => h.hintsPerItem !== null) ? (
            <Chart
              series={[{ label: 'hints per item', points: hints.filter((h) => h.hintsPerItem !== null).map((h) => [h.week, h.hintsPerItem!] as [number, number]), color: 'var(--s4)' }]}
              xMin={-5}
              xMax={0}
              yMin={0}
              yMax={Math.max(1, ...hints.map((h) => h.hintsPerItem ?? 0)) * 1.15}
              height={220}
              formatX={(w) => (Math.round(w) === 0 ? 'this wk' : `${-Math.round(w)} wk ago`)}
              formatY={(v) => v.toFixed(1)}
            />
          ) : (
            <div className="empty">No answers yet.</div>
          )}
        </ChartPanel>

        <ChartPanel title="Misconceptions" hint="ideas the tutor caught that did not match the script">
          <div className="row" style={{ gap: 24, marginBottom: 12 }}>
            <div>
              <div className="value" style={{ fontSize: 28, fontWeight: 650 }}>
                {misc.resolved.length}
              </div>
              <div className="small muted">resolved</div>
            </div>
            <div>
              <div className="value" style={{ fontSize: 28, fontWeight: 650 }}>
                {misc.open.length}
              </div>
              <div className="small muted">still open</div>
            </div>
          </div>
          {misc.resolved.length || misc.open.length ? (
            <div className="stack" style={{ gap: 6 }}>
              {[...misc.open.slice(0, 3), ...misc.resolved.slice(0, 3)].map((m) => (
                <button key={m.id} className={`misc-item ${m.status}`} style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => app.go({ name: 'mind', conceptId: m.conceptId })}>
                  <Icon name={m.status === 'active' ? 'alert' : 'check'} size={15} style={{ color: m.status === 'active' ? 'var(--warn)' : 'var(--good)', flex: 'none', marginTop: 2 }} />
                  <span className="txt">
                    <Markdown text={m.text} inline />
                    <span className="tiny muted" style={{ display: 'block' }}>
                      {graph.title(m.conceptId)} · {m.status === 'active' ? `last seen ${relTime(m.lastSeen, now)}` : `fixed ${relTime(m.resolvedAt, now)}`}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty">None caught yet.</div>
          )}
        </ChartPanel>
      </div>
    </div>
  )
}
