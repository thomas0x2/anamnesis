// Today: the one best next step (review what is fading, learn what is ready, or practice a mix),
// chapter readiness and recent sessions.
import { statusRank, STATUS_ORDER } from '@shared/mastery'
import { dueConcepts, nextDue } from '@shared/selection'
import { chapterReadiness } from '@shared/stats'
import type { ConceptStatus } from '@shared/types'
import { useMemo, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct, plural, relTime, STATUS_LABEL } from '../lib/format'
import { useNow } from '../lib/hooks'

export function HomeView(): ReactElement {
  const app = useApp()
  const state = useStore(app.state, (s) => s)
  const sc = useStore(app.session, (s) => s)
  const now = useNow()
  const learner = state.learner
  const graph = app.graph

  const due = useMemo(() => dueConcepts(learner, now).filter((id) => graph.get(id)), [learner, now, graph])
  const frontier = useMemo(() => graph.frontier(learner).slice(0, 5), [learner, graph])
  const learned = useMemo(() => app.course.concepts.filter((c) => statusRank(learner.concepts[c.id]?.status ?? 'unseen') >= 1).map((c) => c.id), [learner, app])
  const readiness = useMemo(() => chapterReadiness(graph, state, now), [graph, state, now])
  const upcoming = nextDue(learner)
  const sessions = state.sessions.slice(-6).reverse()
  const hour = now.getHours()
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = frontier[0] ? graph.get(frontier[0]) : undefined
  const reviewFirst = due.length > 0

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greeting}</h1>
          <div className="sub">
            {app.course.title} · {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>
        <button className="btn ghost" onClick={() => app.go({ name: 'map' })}>
          <Icon name="map" size={16} /> Pick any topic
        </button>
      </div>

      {sc && <ActiveSessionBanner />}

      <div className="hero-actions">
        <div className={`action-card ${reviewFirst ? 'primary' : ''}`}>
          <div className="eyebrow">Review</div>
          <div className="value">{due.length ? `${due.length} due` : 'All caught up'}</div>
          <div className="desc">
            {due.length
              ? `Recall what is starting to fade, just before you would forget it. About ${Math.max(3, Math.round(Math.min(due.length, 10) * 1.5))} minutes.`
              : upcoming
                ? `Your next review is ${relTime(upcoming, now)}. Spacing works best when you wait for it.`
                : 'Reviews appear here after your first session.'}
          </div>
          <div>
            <button className={`btn ${reviewFirst ? 'primary' : ''}`} disabled={!due.length} onClick={() => void app.startReview()}>
              <Icon name="refresh" size={16} /> Start review
            </button>
          </div>
        </div>

        <div className={`action-card ${!reviewFirst && first ? 'primary' : ''}`}>
          <div className="eyebrow">Learn next</div>
          <div className="value" style={{ fontSize: 19, lineHeight: 1.3 }}>
            {first ? <Markdown text={first.title} inline /> : 'Everything is underway'}
          </div>
          <div className="desc">{first ? <Markdown text={first.why} inline /> : 'Every concept has been started. Practice and review keep it alive.'}</div>
          <div>
            <button className={`btn ${!reviewFirst && first ? 'primary' : ''}`} disabled={!first} onClick={() => first && void app.startLearn(first.id)}>
              <Icon name="probe" size={16} /> Start with a probe
            </button>
          </div>
        </div>

        <div className="action-card">
          <div className="eyebrow">Practice</div>
          <div className="value">{learned.length ? plural(learned.length, 'concept') : 'Nothing yet'}</div>
          <div className="desc">Mixed problems that get harder as you succeed: composed demands, unfamiliar cues, exam-style surfaces.</div>
          <div>
            <button className="btn" disabled={!learned.length} onClick={() => void app.startPractice(learned)}>
              <Icon name="dumbbell" size={16} /> Practice a mix
            </button>
          </div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="panel">
          <div className="panel-title">
            <h3>Ready to learn</h3>
            <span className="hint">prerequisites in place</span>
          </div>
          {frontier.length ? (
            <div className="next-list">
              {frontier.map((id) => {
                const c = graph.get(id)!
                return (
                  <div className="next-item" key={id}>
                    <span className="chip outline">{c.chapter ? `Ch ${c.chapter}` : 'Refresher'}</span>
                    <div className="body">
                      <div className="t">
                        <Markdown text={c.title} inline />
                      </div>
                      <div className="s">
                        <Markdown text={c.summary} inline />
                      </div>
                    </div>
                    <button className="btn sm ghost icon" title="Show on the map" onClick={() => app.go({ name: 'map', conceptId: id })}>
                      <Icon name="map" size={15} />
                    </button>
                    <button className="btn sm" onClick={() => void app.startLearn(id)}>
                      Learn
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="empty">Nothing is waiting: everything has been started.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Chapter readiness</h3>
            <span className="hint">how far along × how well remembered</span>
          </div>
          <div className="chapter-strip">
            {readiness
              .filter((r) => r.concepts > 0)
              .map((r) => (
                <button
                  key={r.chapter}
                  className="chapter-row"
                  style={{ background: 'none', border: 0, padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer', textAlign: 'left' }}
                  onClick={() => {
                    const firstInCh = graph.chapterConcepts(r.chapter)[0]
                    app.go({ name: 'map', conceptId: firstInCh?.id })
                  }}
                  title={STATUS_ORDER.map((s) => `${STATUS_LABEL[s]}: ${r.counts[s]}`).join(' · ')}
                >
                  <span className="n">{r.chapter || '·'}</span>
                  <span className="t">{r.title}</span>
                  <SegBar counts={r.counts} />
                  <span className="v">{pct(r.readiness)}</span>
                </button>
              ))}
          </div>
          <StatusLegend />
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>Recent sessions</h3>
          <button className="btn sm ghost" onClick={() => app.go({ name: 'stats' })}>
            All stats <Icon name="chev-right" size={14} />
          </button>
        </div>
        {sessions.length ? (
          <div className="session-list">
            {sessions.map((s) => (
              <div className="session-row" key={s.id}>
                <span className="row" style={{ minWidth: 0 }}>
                  <span className={`chip ${s.type === 'learn' ? 'accent' : s.type === 'review' ? 'info' : 'outline'}`}>{s.type}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <Markdown text={s.title} inline />
                  </span>
                </span>
                <span className="muted small">{s.items ? `${s.correct} of ${plural(s.items, 'item')} right` : 'no graded items'}</span>
                <span className="small" style={{ color: 'var(--warn)' }}>
                  +{s.points}
                </span>
                <span className="muted small">{relTime(s.endedAt ?? s.startedAt, now)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">Your sessions will be listed here.</div>
        )}
      </div>
    </div>
  )
}

function ActiveSessionBanner(): ReactElement | null {
  const app = useApp()
  const sc = useStore(app.session, (s) => s)
  if (!sc) return null
  const s = sc.view.get().session
  const title = s.type === 'learn' ? app.graph.title(s.goalConceptId ?? '') : s.type === 'review' ? 'Review' : 'Practice'
  return (
    <div className="panel row" style={{ marginBottom: 16, borderColor: 'var(--accent-line)' }}>
      <Icon name="play" size={18} style={{ color: 'var(--accent-text)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>
          Session in progress: <Markdown text={title} inline />
        </div>
        <div className="small muted">It is saved as you go. Pick it up where you left off.</div>
      </div>
      <button className="btn ghost sm" onClick={() => app.closeSession()}>
        Close it
      </button>
      <button className="btn primary" onClick={() => app.go({ name: 'session' })}>
        Continue
      </button>
    </div>
  )
}

export function SegBar({ counts }: { counts: Record<ConceptStatus, number> }): ReactElement {
  const total = STATUS_ORDER.reduce((s, k) => s + counts[k], 0) || 1
  return (
    <span className="seg-bar" aria-hidden>
      {[...STATUS_ORDER]
        .reverse()
        .filter((k) => counts[k] > 0)
        .map((k) => (
          <span key={k} style={{ flex: counts[k] / total, background: `var(--m-${k})` }} />
        ))}
    </span>
  )
}

export function StatusLegend(): ReactElement {
  return (
    <div className="legend-row" style={{ marginTop: 14 }}>
      {[...STATUS_ORDER].reverse().map((s) => (
        <span key={s}>
          <span className={`status-dot ${s}`} /> {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  )
}
