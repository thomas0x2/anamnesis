// Today: a glance row (due, started, exam, this week), what to continue or learn next,
// review / practice / exam side by side, what is ready to learn, chapter readiness and recent sessions.
import { prepProgress, workItems, workState } from '@shared/exam'
import { statusRank, STATUS_ORDER } from '@shared/mastery'
import { dueConcepts, nextDue } from '@shared/selection'
import type { ConceptStatus } from '@shared/types'
import { useMemo, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { ActivityBars, CourseMasteryMap, ExamPace } from '../components/ProgressViz'
import { Markdown } from '../components/Markdown'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { plural, relTime, STATUS_LABEL } from '../lib/format'
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
  const here = (sc ? sc.view.get().session.goalConceptId : null) ?? frontier[0] ?? null
  const upcoming = nextDue(learner)
  const sessions = state.sessions.slice(-6).reverse()
  const hour = now.getHours()
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const first = frontier[0] ? graph.get(frontier[0]) : undefined
  const reviewFirst = due.length > 0

  const dateLabel = now.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
  const summary = due.length ? `${due.length === 1 ? 'One idea is' : `${plural(due.length, 'idea')} are`} ready to be remembered.` : first ? 'Something new is ready to learn.' : 'Everything is underway.'

  return (
    <div className="page">
      <div className="page-head today-head">
        <div>
          <div className="sub">
            {app.course.title} · {dateLabel}
          </div>
          <h1 style={{ marginTop: 10 }}>
            {greeting}. <em>{summary}</em>
          </h1>
        </div>
        <button className="btn ghost" onClick={() => app.go({ name: 'map' })}>
          Pick any topic
        </button>
      </div>

      <Glance due={due.length} learned={learned.length} />

      <CourseNotice />

      <div className="today-grid">
        {sc ? (
          <ActiveSessionBanner />
        ) : (
          <div className="today-block wide">
            <div className="grow">
              <div className="eyebrow">learn next</div>
              <div className="title" style={{ marginTop: 8 }}>
                {first ? <Markdown text={first.title} inline /> : 'Everything is underway'}
              </div>
              <div className="desc" style={{ marginTop: 4 }}>
                {first ? <Markdown text={first.why} inline /> : 'Every concept has been started. Practice and review keep it alive.'}
              </div>
            </div>
            <button className={`btn go ${!reviewFirst && first ? 'primary' : ''}`} disabled={!first} onClick={() => first && void app.startLearn(first.id)}>
              Start with a probe <Icon name="chev-right" size={14} />
            </button>
          </div>
        )}

        <div className="today-block third">
          <div className="eyebrow">review</div>
          {due.length ? (
            <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
              <span className="big">{due.length}</span>
              <span className="muted small">due · about {Math.max(3, Math.round(Math.min(due.length, 10) * 1.5))} min</span>
            </div>
          ) : (
            <div className="title">All caught up</div>
          )}
          <div className="desc">
            {due.length
              ? 'Recall what is starting to fade, just before you would forget it.'
              : upcoming
                ? `Your next review is ${relTime(upcoming, now)}. Spacing works best when you wait for it.`
                : 'Reviews appear here after your first session.'}
          </div>
          <button className={`btn go ${reviewFirst ? 'primary' : ''}`} disabled={!due.length} onClick={() => void app.startReview()}>
            Start review
          </button>
        </div>

        <div className="today-block third">
          <div className="eyebrow">practice</div>
          <div className="title">{learned.length ? plural(learned.length, 'concept') : 'Nothing yet'}</div>
          <div className="desc">Mixed problems that get harder as you succeed: composed demands, unfamiliar cues, exam-style surfaces.</div>
          <button className="btn go" disabled={!learned.length} onClick={() => void app.startPractice(learned)}>
            Practice a mix
          </button>
        </div>

        <ExamNotice />

        <div className="today-block wide progress-block">
          <div className="row between">
            <div className="eyebrow">where you are</div>
            <span className="eyebrow">one square per concept · brighter is further along</span>
          </div>
          <CourseMasteryMap here={here} />
        </div>

        <div className="today-block half">
          <div className="row between">
            <div className="eyebrow">exam pace</div>
            <span className="eyebrow">sets and mocks done</span>
          </div>
          <ExamPace />
        </div>

        <div className="today-block half">
          <div className="row between">
            <div className="eyebrow">last two weeks</div>
            <span className="eyebrow">insight points per day</span>
          </div>
          <ActivityBars />
        </div>

        <div className="today-block half">
          <div className="row between">
            <div className="eyebrow">ready to learn</div>
            <span className="eyebrow">prerequisites in place</span>
          </div>
          {frontier.length ? (
            <div className="next-list" style={{ gap: 0 }}>
              {frontier.map((id) => {
                const c = graph.get(id)!
                return (
                  <div className="next-item" key={id}>
                    <div className="body">
                      <div className="t">
                        <Markdown text={c.title} inline />
                      </div>
                      <div className="s">
                        {c.chapter ? `Ch ${c.chapter} · ` : 'Refresher · '}
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

        <div className="today-block half">
          <div className="row between">
            <div className="eyebrow">recent sessions</div>
            <button className="btn sm ghost" onClick={() => app.go({ name: 'stats' })}>
              All stats <Icon name="chev-right" size={14} />
            </button>
          </div>
          {sessions.length ? (
            <div className="session-list">
              {sessions.map((s) => (
                <div className="session-row" key={s.id}>
                  <span className="row" style={{ minWidth: 0 }}>
                    <span className="chip">{s.type}</span>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      <Markdown text={s.title} inline />
                    </span>
                  </span>
                  <span className="muted small">{s.items ? `${s.correct} of ${plural(s.items, 'item')} right` : 'no graded items'}</span>
                  <span className="small muted">+{s.points}</span>
                  <span className="muted small">{relTime(s.endedAt ?? s.startedAt, now)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">Your sessions will be listed here.</div>
          )}
        </div>
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
    <div className="today-block wide">
      <div className="grow">
        <div className="eyebrow" style={{ color: 'var(--brand)' }}>
          continue
        </div>
        <div className="title" style={{ marginTop: 8 }}>
          <Markdown text={title} inline />
        </div>
        <div className="desc" style={{ marginTop: 4 }}>
          Saved as you go. Pick it up where you left off.
        </div>
      </div>
      <button className="btn ghost go" onClick={() => app.closeSession()}>
        Close it
      </button>
      <button className="btn primary go" onClick={() => app.go({ name: 'session' })}>
        Continue <Icon name="chev-right" size={14} />
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

/** What the course's materials are doing: an empty course, files waiting in the folder, a PDF being mapped, concepts new this week. */
/** The exam goal at a glance: days left, problem sets and mock exams done, and the newest set still open. */
function ExamNotice(): ReactElement {
  const app = useApp()
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const now = useNow()
  const p = prepProgress(prep, materials, now)
  const { sets } = workItems(materials)
  const open = [...sets].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).find((m) => !workState(prep, m.id).done)
  const over = p.daysLeft !== null && p.daysLeft < 0
  return (
    <div className="today-block third exam-notice">
      <div className="eyebrow">exam prep</div>
      <div className="title">{p.daysLeft === null || over ? 'No exam date yet' : p.daysLeft === 0 ? 'The exam is today' : `Exam in ${plural(p.daysLeft, 'day')}`}</div>
      <div className="meters">
        <Meter label="problem sets" done={p.sets.done} total={p.sets.total} />
        <Meter label="mock exams" done={p.mocks.done} total={p.mocks.goal} />
      </div>
      <div className="desc">
        {open
          ? `Next: ${open.title}.`
          : p.daysLeft === null || over
            ? 'Set the date to pace problem sets and mock exams.'
            : p.perWeek !== null
              ? `About ${p.perWeek < 1 ? p.perWeek.toFixed(1) : Math.ceil(p.perWeek * 10) / 10} a week to finish in time.`
              : 'Every problem set that is out is done.'}
      </div>
      <button className="btn go" onClick={() => app.go({ name: 'exam', materialId: open?.id })}>
        {p.daysLeft === null || over ? 'Set the exam date' : 'Exam prep'}
      </button>
    </div>
  )
}

function Meter({ label, done, total }: { label: string; done: number; total: number }): ReactElement {
  return (
    <div className="meter">
      <span className="k">{label}</span>
      <span className="bar">
        <span
          style={{
            width: total ? `${Math.min(100, (done / total) * 100)}%` : 0
          }}
        />
      </span>
      <span className="v">
        {done}/{total || '–'}
      </span>
    </div>
  )
}

/** The whole picture in one row: what is due, how much is learned, the exam, and this week. */
function Glance({ due, learned }: { due: number; learned: number }): ReactElement {
  const app = useApp()
  const state = useStore(app.state, (s) => s)
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const now = useNow()
  const total = app.course.concepts.length
  const p = prepProgress(prep, materials, now)
  const weekAgo = now.getTime() - 7 * 86_400_000
  const weekPts = state.rewards.events.filter((e) => Date.parse(e.at) >= weekAgo).reduce((s, e) => s + e.points, 0)
  const weekSessions = state.sessions.filter((s) => Date.parse(s.startedAt) >= weekAgo).length
  const exam = p.daysLeft === null || p.daysLeft < 0 ? '–' : String(p.daysLeft)
  const cells: {
    k: string
    v: string
    s: string
    hot?: boolean
    go: () => void
  }[] = [
    {
      k: 'due for review',
      v: String(due),
      s: due ? 'fading, worth recalling now' : 'all caught up',
      hot: due > 0,
      go: () => (due ? void app.startReview() : app.go({ name: 'mind' }))
    },
    {
      k: 'concepts started',
      v: `${learned}`,
      s: `of ${total} in ${app.course.short}`,
      go: () => app.go({ name: 'map' })
    },
    {
      k: 'days to the exam',
      v: exam,
      s: p.sets.total || p.mocks.goal ? `${p.sets.done + p.mocks.done} of ${p.sets.total + p.mocks.goal} sets and mocks done` : 'no date set',
      go: () => app.go({ name: 'exam' })
    },
    {
      k: 'this week',
      v: `+${weekPts}`,
      s: `${plural(weekSessions, 'session')}`,
      go: () => app.go({ name: 'stats' })
    }
  ]
  return (
    <div className="glance" role="list">
      {cells.map((c) => (
        <button key={c.k} className="glance-cell" role="listitem" onClick={c.go}>
          <span className="k">{c.k}</span>
          <span className={`v ${c.hot ? 'hot' : ''}`}>{c.v}</span>
          <span className="s">{c.s}</span>
        </button>
      ))}
    </div>
  )
}

function CourseNotice(): ReactElement | null {
  const app = useApp()
  const { course } = useStore(app.courseView)
  const pending = useStore(app.pending)
  const job = useStore(app.job)
  const fresh = course.concepts.filter((c) => c.addedAt && Date.now() - Date.parse(c.addedAt) < 7 * 86_400_000)
  if (!course.concepts.length)
    return (
      <div className="today-block wide course-notice">
        <div className="grow">
          <div className="eyebrow">{job ? 'building the map' : 'a new course'}</div>
          <div className="title" style={{ marginTop: 8 }}>
            {job ? `${job.label}…` : `${course.short} has no concepts yet`}
          </div>
          <div className="desc" style={{ marginTop: 4 }}>
            {job
              ? 'Concepts appear on the map as each part is read. You can start learning as soon as the first ones are there.'
              : 'Add the script, this week’s slides or a problem set. Each PDF is read on this computer and turned into concepts with their prerequisites.'}
          </div>
        </div>
        {!job && (
          <button className="btn primary go" onClick={() => app.go({ name: 'materials' })}>
            Add materials <Icon name="chev-right" size={14} />
          </button>
        )}
      </div>
    )
  if (!pending.length && !job && !fresh.length) return null
  return (
    <div className="today-block wide course-notice">
      <div className="grow">
        <div className="eyebrow">{pending.length ? 'new in the course folder' : job ? 'reading new material' : 'new this week'}</div>
        <div className="title" style={{ marginTop: 8 }}>
          {pending.length ? plural(pending.length, 'new PDF') : job ? `${job.label}…` : `${plural(fresh.length, 'new concept')} on the map`}
        </div>
        <div className="desc" style={{ marginTop: 4 }}>
          {pending.length
            ? pending
                .slice(0, 3)
                .map((f) => f.name)
                .join(', ') + (pending.length > 3 ? ', …' : '')
            : job
              ? 'The course map grows as it is read.'
              : fresh
                  .slice(0, 4)
                  .map((c) => c.title)
                  .join(' · ')}
        </div>
      </div>
      {pending.length > 0 ? (
        <>
          <button className="btn ghost go" onClick={() => app.go({ name: 'materials' })}>
            Review
          </button>
          <button className="btn primary go" onClick={() => void app.addFiles(pending)}>
            Add {pending.length === 1 ? 'it' : 'all'}
          </button>
        </>
      ) : (
        !job && (
          <button className="btn ghost go" onClick={() => app.go({ name: 'map', conceptId: fresh[0]?.id })}>
            Show on the map <Icon name="chev-right" size={14} />
          </button>
        )
      )}
    </div>
  )
}
