// Today: the overview across every course, the same whichever course is open. The day's study target and
// the course to start with (from the plan), what is due soon (deadlines, exams, reviews), each course's
// status in plan order, and study time over the last two weeks by course. Each course's own dashboard
// is the Course screen (CourseView).
import { dueSoon, overviewTotals, whenLabel, type DueItem } from '@shared/overview'
import { firstCourse, fmtDuration, fmtParts, scheduledCourses, type CoursePlan, type StudyPlan } from '@shared/scheduler'
import { daySeries, fmtStudy, fmtStudyShort, totalsSince } from '@shared/studyTime'
import { dayKey } from '@shared/util'
import { useMemo, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { plural } from '../lib/format'
import { useNow } from '../lib/hooks'
import { focusText, PACE, runStep, stepLabel, SwitchButton, usePlanData } from './PlanView'

/** One colour per course, in the order of the course menu. */
export const COURSE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)']

export function HomeView(): ReactElement {
  const data = usePlanData()
  const now = useNow()
  const plan = data?.plan ?? null
  const hour = now.getHours()
  const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const scheduled = plan ? scheduledCourses(plan.courses) : []
  const first = plan ? firstCourse(plan) : null
  const totals = plan ? overviewTotals(plan.courses) : null
  const due = useMemo(() => (data ? dueSoon(data.snaps, data.plan.courses, now) : []), [data, now])

  const summary = !plan
    ? 'Working out the day…'
    : first
      ? plan.focus && plan.focus.state !== 'switch' && plan.focus.courseId === first.id
        ? `Stay with ${first.short} for now.`
        : `Start with ${first.short}: about ${fmtDuration(first.todayLeft)} today.`
      : scheduled.length
        ? 'Today’s share is done for every course.'
        : totals?.due
          ? `${plural(totals.due, 'review')} ${totals.due === 1 ? 'is' : 'are'} due.`
          : 'Set your exam dates to get a daily plan.'

  return (
    <div className="page today-page">
      <div className="page-head today-head">
        <div>
          <div className="sub">All courses · {dateLabel}</div>
          <h1 style={{ marginTop: 10 }}>
            {greeting}. <em>{summary}</em>
          </h1>
        </div>
      </div>

      {plan && totals && <OverviewGlance plan={plan} totals={totals} />}

      <div className="today-grid">
        <ActiveSession />

        {plan && <StartHere plan={plan} first={first} />}

        <div className="today-block half due-block" aria-label="Due soon">
          <div className="row between">
            <div className="eyebrow">due soon</div>
            <span className="eyebrow">deadlines · exams · reviews</span>
          </div>
          {!plan ? <div className="empty">…</div> : due.length ? <DueList items={due} /> : <div className="empty">Nothing is due in the next two weeks.</div>}
        </div>

        <div className="today-block half">
          <div className="row between">
            <div className="eyebrow">study time</div>
            <span className="eyebrow">last two weeks · by course</span>
          </div>
          <StudyBars />
        </div>

        {plan && plan.courses.length > 0 && (
          <section className="today-block wide course-cards-block" aria-label="Your courses">
            <div className="row between">
              <div className="eyebrow">your courses</div>
              <span className="eyebrow">in the plan’s order · open one for its dashboard</span>
            </div>
            <div className="course-cards">
              {[...scheduled, ...plan.courses.filter((c) => !scheduled.includes(c))].map((c) => (
                <CourseCard key={c.id} c={c} rank={scheduled.indexOf(c) + 1 || null} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

/** The day across courses in one row: what is left today, reviews due, the next exam, study time. */
function OverviewGlance({ plan, totals }: { plan: StudyPlan; totals: ReturnType<typeof overviewTotals> }): ReactElement {
  const app = useApp()
  const log = useStore(app.study.log)
  const now = useNow()
  const week = totalsSince(log, now, 7).sec
  const today = totalsSince(log, now, 1).sec
  const hasPlan = plan.courses.some((c) => c.perDay !== null)
  const cells: { k: string; v: string; s: string; hot?: boolean; go: () => void }[] = [
    {
      k: 'left today',
      v: !hasPlan ? '–' : plan.todayLeft >= 5 ? fmtDuration(plan.todayLeft) : 'done',
      s: hasPlan ? `of about ${fmtDuration(plan.perDay)} a day${fmtParts(plan.perDayParts) ? ` · ${fmtParts(plan.perDayParts)}` : ''}` : 'set exam dates for a daily target',
      go: () => app.go({ name: 'plan' })
    },
    {
      k: 'due for review',
      v: String(totals.due),
      s: totals.due ? `across ${plural(plan.courses.filter((c) => c.due > 0).length, 'course')}` : 'all caught up',
      hot: totals.due > 0,
      go: () => {
        const c = [...plan.courses].sort((a, b) => b.due - a.due)[0]
        if (c && c.due > 0) void app.openIn(c.id, { name: 'course' })
      }
    },
    {
      k: 'next exam',
      v: totals.nextExam ? String(totals.nextExam.days) : '–',
      s: totals.nextExam ? `days · ${totals.nextExam.short}` : 'no exam date set',
      go: () => (totals.nextExam ? void app.openIn(totals.nextExam.id, { name: 'exam' }) : app.go({ name: 'plan' }))
    },
    {
      k: 'studied today',
      v: fmtStudyShort(today),
      s: `${fmtStudyShort(week)} this week${totals.behind.length ? ` · behind in ${totals.behind.join(', ')}` : ''}`,
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

/** The course to start with and its first step, straight from the plan. */
function StartHere({ plan, first }: { plan: StudyPlan; first: CoursePlan | null }): ReactElement | null {
  const app = useApp()
  const open = scheduledCourses(plan.courses)
  if (!open.length) return null
  const then = open.filter((c) => c.todayLeft >= 5 && c !== first).slice(0, 2)
  const step = first?.steps[0]
  const f = plan.focus
  const block = f ? focusText(plan, f) : null
  return (
    <div className="today-block wide plan-notice">
      <div className="grow">
        <div className="eyebrow" style={{ color: first ? 'var(--brand)' : undefined }}>
          start here
        </div>
        <div className="title" style={{ marginTop: 8 }}>
          {first ? (
            step ? (
              <>
                {first.short}: <Markdown text={step.title} inline />
              </>
            ) : (
              `${first.short}: about ${fmtDuration(first.todayLeft)} today`
            )
          ) : (
            'Today’s share is done for every course'
          )}
        </div>
        <div className="desc" style={{ marginTop: 4 }}>
          {step ? <Markdown text={step.why} inline /> : null}
          {then.length ? ` Then ${then.map((c) => `${c.short} (${fmtDuration(c.todayLeft)})`).join(', ')}.` : ''}
        </div>
        {block && f && (
          <div className="tiny muted plan-block-line" style={{ marginTop: 6 }}>
            <span style={{ color: f.state === 'switch' ? 'var(--brand)' : undefined }}>{block.title}.</span> {block.desc}
          </div>
        )}
      </div>
      {block && f && f.state !== 'switch' && block.next && <SwitchButton to={block.next} primary={false} app={app} />}
      <button className="btn ghost go" onClick={() => app.go({ name: 'plan' })}>
        See the plan
      </button>
      {first && step && (
        <button className="btn primary go" onClick={() => void runStep(app, first.id, step)}>
          {stepLabel(step)} <Icon name="chev-right" size={14} />
        </button>
      )}
    </div>
  )
}

function ActiveSession(): ReactElement | null {
  const app = useApp()
  const sc = useStore(app.session, (s) => s)
  if (!sc) return null
  const s = sc.view.get().session
  const title = s.type === 'learn' ? app.graph.title(s.goalConceptId ?? '') : s.type === 'review' ? 'Review' : 'Practice'
  return (
    <div className="today-block wide">
      <div className="grow">
        <div className="eyebrow" style={{ color: 'var(--brand)' }}>
          continue · {app.course.short}
        </div>
        <div className="title" style={{ marginTop: 8 }}>
          <Markdown text={title} inline />
        </div>
        <div className="desc" style={{ marginTop: 4 }}>
          Saved as you go. Pick it up where you left off.
        </div>
      </div>
      <button className="btn primary go" onClick={() => app.go({ name: 'session' })}>
        Continue <Icon name="chev-right" size={14} />
      </button>
    </div>
  )
}

const DUE_LABEL: Record<DueItem['kind'], string> = { deadline: 'due', exam: 'exam', review: 'review' }

function DueList({ items }: { items: DueItem[] }): ReactElement {
  const app = useApp()
  const go = (d: DueItem): void => {
    if (d.kind === 'deadline') void app.openIn(d.courseId, { name: 'exam', materialId: d.materialId })
    else if (d.kind === 'exam') void app.openIn(d.courseId, { name: 'exam' })
    else
      void app.openIn(d.courseId, { name: 'course' }).then(() => void app.startReview())
  }
  return (
    <div className="due-list">
      {items.slice(0, 8).map((d, i) => (
        <div className={`due-row ${d.kind} ${d.days < 0 ? 'late' : ''}`} key={`${d.kind}-${d.courseId}-${d.materialId ?? i}`}>
          <span className={`plan-kind ${d.kind}`}>{DUE_LABEL[d.kind]}</span>
          <span className="due-title">
            <span className="chip outline">{d.short}</span> {d.kind === 'review' ? `${plural(d.count ?? 0, 'concept')} fading` : d.title}
          </span>
          <span className={`due-when ${d.days <= 1 ? 'soon' : ''}`}>{d.kind === 'review' ? 'now' : whenLabel(d.days)}</span>
          <button className="btn sm" onClick={() => go(d)}>
            {d.kind === 'review' ? 'Review' : 'Open'}
          </button>
        </div>
      ))}
      {items.length > 8 && <div className="tiny muted">+{items.length - 8} more in the plan</div>}
    </div>
  )
}

/** Minutes per day for the last 14 days, stacked by course in each course's colour. */
function StudyBars(): ReactElement {
  const app = useApp()
  const log = useStore(app.study.log)
  const courses = useStore(app.courses)
  const now = useNow()
  const days = useMemo(() => daySeries(log, now, 14), [log, now])
  const color = (id: string): string => COURSE_COLORS[Math.max(0, courses.findIndex((c) => c.id === id)) % COURSE_COLORS.length]
  const name = (id: string): string => courses.find((c) => c.id === id)?.short ?? id
  const max = Math.max(30 * 60, ...days.map((d) => d.sec))
  const seen = courses.filter((c) => days.some((d) => (d.byCourse[c.id] ?? 0) > 0))
  const total = days.reduce((s, d) => s + d.sec, 0)
  const active = days.filter((d) => d.sec >= 60).length
  return (
    <div className="activity study-bars">
      <div className="bars" role="img" aria-label={`Study time per day over the last 14 days: ${fmtStudy(total)} in all, on ${active} days`}>
        {days.map((d) => (
          <span
            key={d.key}
            className={`day ${d.key === dayKey(now) ? 'today' : ''}`}
            title={`${d.date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${fmtStudy(d.sec)}${
              Object.keys(d.byCourse).length ? ` (${Object.entries(d.byCourse).map(([c, s]) => `${name(c)} ${fmtStudyShort(s)}`).join(', ')})` : ''
            }`}
          >
            <span className="stack" style={{ height: `${d.sec ? Math.max(4, (d.sec / max) * 100) : 2}%` }}>
              {d.sec ? (
                Object.entries(d.byCourse)
                  .filter(([, s]) => s > 0)
                  .map(([c, s]) => <span key={c} style={{ flex: s, background: color(c) }} />)
              ) : (
                <span style={{ flex: 1, background: 'var(--surface-3)' }} />
              )}
            </span>
            <span className="dl">{d.date.toLocaleDateString('en-GB', { weekday: 'narrow' })}</span>
          </span>
        ))}
      </div>
      <div className="pace-note">
        <b>{fmtStudy(total)}</b> in two weeks · {active} of 14 days
        {seen.length > 0 && (
          <span className="course-legend">
            {seen.map((c) => (
              <span key={c.id}>
                <i style={{ background: color(c.id) }} /> {c.short}
              </span>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

function CourseCard({ c, rank }: { c: CoursePlan; rank: number | null }): ReactElement {
  const app = useApp()
  const courses = useStore(app.courses)
  const pace = PACE[c.pace]
  const color = COURSE_COLORS[Math.max(0, courses.findIndex((x) => x.id === c.id)) % COURSE_COLORS.length]
  const exam = c.daysLeft === null ? 'no exam date' : c.daysLeft < 0 ? 'exam passed' : c.daysLeft === 0 ? 'exam today' : `exam in ${plural(c.daysLeft, 'day')}`
  const scheduled = c.perDay !== null && c.pace !== 'done'
  return (
    <div className={`course-card ${rank === 1 ? 'first' : ''} ${c.id === app.courseId ? 'open' : ''}`}>
      <div className="cc-head">
        <i className="cc-dot" style={{ background: color }} />
        <button className="cc-title" onClick={() => void app.openIn(c.id, { name: 'course' })} title={`Open the ${c.short} dashboard`}>
          <span className="t">{c.short}</span>
          <span className="s">{c.title}</span>
        </button>
        {c.pace !== 'no-date' && (
          <span className={`chip ${pace.tone}`} title={pace.help}>
            {pace.label}
          </span>
        )}
      </div>
      <div className="cc-facts">
        <span>{exam}</span>
        {scheduled && <span>{c.todayLeft >= 5 ? `${fmtDuration(c.todayLeft)} left today` : 'today’s share done'}</span>}
        {c.due > 0 && <span className="hot">{plural(c.due, 'review')} due</span>}
      </div>
      <div className="meters">
        <CardMeter label="concepts" done={c.concepts.covered} total={c.concepts.total} />
        <CardMeter label="problem sets" done={c.sets.done} total={c.sets.total} />
        <CardMeter label="mock exams" done={c.mocks.done} total={c.mocks.goal} />
      </div>
      <div className="cc-foot">
        <button className="btn sm ghost" onClick={() => void app.openIn(c.id, { name: 'course' })}>
          Dashboard <Icon name="chev-right" size={13} />
        </button>
        {c.steps[0] && (
          <button className="btn sm" title={c.steps[0].why} onClick={() => void runStep(app, c.id, c.steps[0])}>
            {stepLabel(c.steps[0])}
          </button>
        )}
      </div>
    </div>
  )
}

function CardMeter({ label, done, total }: { label: string; done: number; total: number }): ReactElement {
  return (
    <div className="meter">
      <span className="k">{label}</span>
      <span className="bar">
        <span style={{ width: total ? `${Math.min(100, (done / total) * 100)}%` : 0 }} />
      </span>
      <span className="v">
        {done}/{total || '–'}
      </span>
    </div>
  )
}
