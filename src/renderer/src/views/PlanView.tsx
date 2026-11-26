// The study plan across courses: which course to work on first today, about how long each day keeps
// every course on track for its exam, and the next steps in each (reviews, the problem sets whose
// topics are covered, what to learn to unlock the next set, mock exams near the end). See
// src/shared/scheduler.ts for the model.
import { fmtDuration, fmtParts, studyPlan, type CoursePlan, type CourseSnapshot, type PaceStatus, type PlanStep, type SetPlan, type StudyPlan } from '@shared/scheduler'
import { useEffect, useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { useApp, type AppController } from '../engine/app'
import { useStore } from '../engine/store'
import { useNow } from '../lib/hooks'
import { pct, plural } from '../lib/format'

/** The plan, recomputed when the active course changes (answers, checked solutions, goals) and every few minutes. */
export function usePlan(): StudyPlan | null {
  return usePlanData()?.plan ?? null
}

/** The plan with the course snapshots it was computed from (Today lists deadlines from them). */
export function usePlanData(): { plan: StudyPlan; snaps: CourseSnapshot[] } | null {
  const app = useApp()
  const learner = useStore(app.state, (s) => s.learner)
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const courses = useStore(app.courses)
  const now = useNow(5 * 60_000)
  const [plan, setPlan] = useState<{ plan: StudyPlan; snaps: CourseSnapshot[] } | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      void Promise.all([app.planSnapshots(), app.readStudyLog()])
        .then(([snaps, log]) => live && setPlan({ plan: studyPlan(snaps, new Date(), log), snaps }))
        .catch(() => live && setPlan(null))
    }, 150)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [app, learner, prep, materials, courses, now])
  return plan
}

export const PACE: Record<PaceStatus, { label: string; tone: string; help: string }> = {
  'no-date': { label: 'no exam date', tone: 'outline', help: 'Set the exam date in Exam prep to schedule this course.' },
  over: { label: 'exam passed', tone: 'outline', help: 'The exam date has passed.' },
  done: { label: 'all done', tone: 'good', help: 'Everything in the plan is done. Reviews keep it fresh.' },
  'on-track': { label: 'on track', tone: 'good', help: 'Your study time on this course over the last week keeps up with what it needs.' },
  behind: { label: 'behind', tone: 'warn', help: 'Your study time on this course over the last week is below what it needs a day.' },
  unknown: { label: 'pace unknown', tone: 'outline', help: 'Your study time is not logged yet, so the plan cannot compare your pace.' }
}

export function PlanView(): ReactElement {
  const plan = usePlan()
  const now = useNow()
  const dateLabel = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
  const scheduled = plan?.courses.filter((c) => c.perDay !== null && c.pace !== 'done') ?? []
  const first = scheduled.find((c) => c.todayLeft >= 5) ?? null
  const unscheduled = plan?.courses.filter((c) => c.perDay === null || c.pace === 'done') ?? []

  return (
    <div className="page plan-page">
      <div className="page-head">
        <div>
          <div className="sub">All courses · {dateLabel}</div>
          <h1 style={{ marginTop: 10 }}>
            {!plan ? (
              'Working out the plan…'
            ) : !scheduled.length ? (
              'Set your exam dates to get a plan.'
            ) : (
              <>
                About {fmtDuration(plan.perDay)} a day keeps every course on track. <em>{first ? `Start with ${first.short}.` : 'Today’s share is done.'}</em>
              </>
            )}
          </h1>
        </div>
      </div>

      {plan && scheduled.length > 0 && <PlanGlance plan={plan} />}

      {plan && scheduled.length > 0 && (
        <section className="plan-list" aria-label="Courses in order">
          {scheduled.map((c, i) => (
            <CourseRow key={c.id} c={c} index={i + 1} />
          ))}
        </section>
      )}

      {plan && unscheduled.length > 0 && (
        <section className="plan-list plan-rest" aria-label="Courses without a schedule">
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            not scheduled
          </div>
          {unscheduled.map((c) => (
            <CourseRow key={c.id} c={c} index={null} />
          ))}
        </section>
      )}

      <HowItWorks />
    </div>
  )
}

function PlanGlance({ plan }: { plan: StudyPlan }): ReactElement {
  const cells: { k: string; v: string; s: string }[] = [
    { k: 'a day, all courses', v: fmtDuration(plan.perDay), s: fmtParts(plan.perDayParts) || 'to be ready for every exam' },
    { k: 'left today', v: plan.todayLeft >= 5 ? fmtDuration(plan.todayLeft) : 'done', s: plan.hasLog ? `${fmtDuration(plan.studiedToday)} studied so far` : 'study time is not logged yet' },
    {
      k: 'your recent pace',
      v: plan.recentPerDay === null ? '–' : fmtDuration(plan.recentPerDay),
      s: plan.recentPerDay === null ? 'appears once study time is logged' : plan.recentPerDay >= plan.perDay * 0.85 ? 'a day over two weeks · enough' : `a day over two weeks · ${fmtDuration(plan.perDay - plan.recentPerDay)} short`
    }
  ]
  return (
    <div className="glance plan-glance">
      {cells.map((c) => (
        <div key={c.k} className="glance-cell">
          <span className="k">{c.k}</span>
          <span className="v">{c.v}</span>
          <span className="s">{c.s}</span>
        </div>
      ))}
    </div>
  )
}

function CourseRow({ c, index }: { c: CoursePlan; index: number | null }): ReactElement {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const pace = PACE[c.pace]
  const exam = c.daysLeft === null ? 'no exam date' : c.daysLeft < 0 ? 'exam passed' : c.daysLeft === 0 ? 'exam today' : `exam in ${plural(c.daysLeft, 'day')}`
  const work = c.sets_
  const solvable = work.filter((s) => s.readiness === 'solvable').length
  return (
    <div className={`plan-course ${index === 1 ? 'first' : ''}`}>
      <div className="plan-head">
        <span className="plan-rank">{index ?? '–'}</span>
        <div className="grow">
          <div className="plan-title">{c.title}</div>
          <div className="tiny muted">
            {exam}
            {c.perDay !== null && c.pace !== 'done' ? ` · needs ${fmtDuration(c.perDay)} a day${c.perDayParts && fmtParts(c.perDayParts) ? ` (${fmtParts(c.perDayParts)})` : ''} · ${fmtDuration(c.left.total)} of work left` : ''}
          </div>
        </div>
        <span className={`chip ${pace.tone}`} title={pace.help}>
          {pace.label}
        </span>
        {c.perDay !== null && c.pace !== 'done' && (
          <div className="plan-today" title="Still to do today for this course">
            <span className="v">{c.todayLeft >= 5 ? fmtDuration(c.todayLeft) : 'done'}</span>
            <span className="tiny muted">today</span>
          </div>
        )}
      </div>

      <div className="plan-meters">
        <PlanMeter label="concepts" done={c.concepts.covered} total={c.concepts.total} />
        <PlanMeter label="problem sets" done={c.sets.done} total={c.sets.total} />
        <PlanMeter label="mock exams" done={c.mocks.done} total={c.mocks.goal} />
      </div>

      {c.steps.length > 0 && (
        <ol className="plan-steps">
          {c.steps.map((s, i) => (
            <Step key={i} c={c} s={s} />
          ))}
        </ol>
      )}

      {work.length > 0 && (
        <div className="plan-sets">
          <div className="eyebrow">
            {solvable ? `you can fully solve ${solvable} of ${plural(work.length, 'problem set')} still to do` : 'problem sets still to do'}
          </div>
          <div className="plan-set-list">
            {work.slice(0, open ? undefined : 6).map((s) => (
              <SetRow key={s.material.id} s={s} onOpen={() => void app.openIn(c.id, { name: 'exam', materialId: s.material.id })} />
            ))}
          </div>
          {work.length > 6 && (
            <button className="btn ghost small" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Icon name={open ? 'chev-up' : 'chev-down'} size={13} /> {open ? 'Fewer' : `All ${work.length}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** Do a step of the plan: open its course and start the review or the learning, or go to Exam prep. */
export async function runStep(app: AppController, courseId: string, s: PlanStep): Promise<void> {
  if (s.kind === 'review') {
    await app.openIn(courseId, { name: 'course' })
    await app.startReview()
  } else if (s.kind === 'learn' && s.conceptId) {
    await app.openIn(courseId, { name: 'course' })
    await app.startLearn(s.conceptId)
  } else await app.openIn(courseId, { name: 'exam' })
}

export const stepLabel = (s: PlanStep): string => (s.kind === 'review' ? 'Review' : s.kind === 'learn' ? 'Learn' : 'Set date')

function Step({ c, s }: { c: CoursePlan; s: PlanStep }): ReactElement {
  const app = useApp()
  const go = (): Promise<void> => runStep(app, c.id, s)
  const label = stepLabel(s)
  return (
    <li className="plan-step">
      <span className={`plan-kind ${s.kind}`}>{s.kind}</span>
      <div className="grow">
        <div className="plan-step-title">
          <Markdown text={s.title} inline />
        </div>
        <div className="tiny muted">
          <Markdown text={s.why} inline />
        </div>
      </div>
      {s.minutes ? <span className="tiny muted plan-min">~{fmtDuration(s.minutes)}</span> : <span />}
      <button className="btn small" onClick={() => void go()}>
        {label}
      </button>
    </li>
  )
}

function SetRow({ s, onOpen }: { s: SetPlan; onOpen: () => void }): ReactElement {
  const label = s.readiness === 'solvable' ? 'can solve' : s.readiness === 'partial' ? `${s.missing.length} to learn` : 'not linked'
  const missing = s.missingTitles.slice(0, 3).join(', ') + (s.missing.length > 3 ? ` +${s.missing.length - 3}` : '')
  return (
    <div className={`plan-set ${s.readiness}`}>
      <span className="plan-mark" aria-hidden>
        {s.readiness === 'solvable' ? <Icon name="check" size={13} /> : null}
      </span>
      <button className="work-title" onClick={onOpen}>
        <span>{s.material.title}</span>
        {s.kind === 'exam' && <span className="tiny muted">mock</span>}
      </button>
      <span className="bar plan-bar" title={s.covered === null ? 'Not linked to concepts' : `${pct(s.covered)} of its topics covered`}>
        <span style={{ width: s.covered === null ? 0 : pct(s.covered) }} />
      </span>
      <span className={`plan-ready ${s.readiness}`}>{label}</span>
      <span className="tiny muted plan-missing" title={s.missingTitles.join(', ')}>
        {s.readiness === 'partial' ? `missing: ${missing}` : s.readiness === 'solvable' ? 'every topic it practises is covered' : 'the map does not say what it practises'}
      </span>
    </div>
  )
}

function PlanMeter({ label, done, total }: { label: string; done: number; total: number }): ReactElement {
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

function HowItWorks(): ReactElement {
  return (
    <details className="plan-how">
      <summary className="eyebrow">how the plan works</summary>
      <div className="small muted">
        <p>
          The daily time is a guess at everything still to do before each exam, spread over the days left. It adds up learning in the app (about 30 minutes for each new core concept of the course map, less for one you have started or for support material, plus the reviews
          due) and the problem sets and mock exams still to do against your goals in Exam prep. Those are timed from the minutes you log with your results; until you have logged some, a problem set counts as 2 hours and a mock exam as 3.
        </p>
        <p>The work should be done a week before each exam, so the last week stays free for revision. The courses are summed, so the number at the top is what all exams together need a day.</p>
        <p>
          The course with the most of today’s share still open comes first; being behind your recent pace or a close exam moves a course up. Your pace and what you studied today come from the study time the app logs.
        </p>
        <p>
          A problem set is marked as one you can fully solve when you have covered every topic it practises (started it in the app, or marked it known). For the others the plan names the missing topics, and suggests learning the one that brings a set closest to
          solvable.
        </p>
        <p>The plan only knows what is in the app: lectures that are not out yet add to it once their materials are added.</p>
      </div>
    </details>
  )
}
