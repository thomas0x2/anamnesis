// The progress meter in the top bar: how much of the open course is done (on Today and Plan, all
// courses together), as a hairline track with a vermilion point where the learner is. It moves as
// soon as an answer, a checked solution or a logged set changes the course, shows the gain for a
// moment, and celebrates the milestones in src/shared/progress.ts once each.
import { courseProgress, milestoneLine, newMilestone, overallProgress, percent, milestoneAt, MILESTONES, type Progress } from '@shared/progress'
import type { CourseSnapshot } from '@shared/scheduler'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useApp, type AppController } from '../engine/app'
import { useStore } from '../engine/store'
import { useNow } from '../lib/hooks'

export interface TopProgress {
  /** 'all' on the cross-course screens, else the course id */
  key: string
  label: string
  pct: number | null
  title: string
  overall: boolean
}

const OVERALL_ROUTES = new Set(['home', 'plan'])
const RECORD = 'progress-milestones'

/** The share shown in the top bar for the current screen. */
export function useTopProgress(route: string): TopProgress | null {
  const app = useApp()
  const learner = useStore(app.state, (s) => s.learner)
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const { course } = useStore(app.courseView)
  const courses = useStore(app.courses)
  const overall = OVERALL_ROUTES.has(route)

  // the open course, straight from its stores, so it moves the moment something changes
  const mine = useMemo(() => courseProgress({ course, learner, materials, prep }), [course, learner, materials, prep])

  // the other courses, read from disk on the cross-course screens (they do not change while another is open)
  const now = useNow(5 * 60_000)
  const [others, setOthers] = useState<Progress[] | null>(null)
  useEffect(() => {
    if (!overall) return
    let live = true
    void app
      .planSnapshots()
      .then((snaps: CourseSnapshot[]) => live && setOthers(snaps.filter((s) => s.course.id !== course.id).map(courseProgress)))
      .catch(() => live && setOthers([]))
    return () => {
      live = false
    }
  }, [app, overall, courses, course.id, now])

  return useMemo(() => {
    if (overall) {
      if (!others) return null
      const all = overallProgress([mine, ...others])
      if (all.share === null) return null
      const pct = percent(all.share)
      return {
        key: 'all',
        label: courses.length > 1 ? 'All' : course.short,
        pct,
        overall: true,
        title: `${pct}% of the work across ${all.courses === 1 ? 'your course' : `all ${all.courses} courses`} is done: concepts, problem sets and mock exams, timed the way the plan times them. Open a course to see its own progress.`
      }
    }
    if (mine.share === null) return null
    const pct = percent(mine.share)
    const parts = [`${mine.concepts.proficient} of ${mine.concepts.total} concepts proficient`]
    if (mine.sets.total) parts.push(`${mine.sets.done} of ${mine.sets.total} problem sets`)
    if (mine.mocks.goal) parts.push(`${Math.min(mine.mocks.done, mine.mocks.goal)} of ${mine.mocks.goal} mock exams`)
    return {
      key: course.id,
      label: course.short,
      pct,
      overall: false,
      title: `${course.short}: ${pct}% of the way to the exam (${parts.join(', ')}). Started concepts count in part. Click for the plan.`
    }
  }, [overall, others, mine, course, courses.length])
}

// The best milestone celebrated per course ('all' for the overall share), kept in the data folder so a
// milestone is celebrated once, ever. Loaded once per window.
let record: Record<string, number> | null = null
let loading: Promise<Record<string, number>> | null = null
function loadRecord(app: AppController): Promise<Record<string, number>> {
  if (record) return Promise.resolve(record)
  loading ??= app.backend
    .readJson<Record<string, number>>(RECORD)
    .catch(() => null)
    .then((r) => (record = r && typeof r === 'object' ? { ...r } : {}))
  return loading
}

const CELEBRATE_MS = 2600
const GAIN_MS = 1800

export function ProgressMeter({ p }: { p: TopProgress }): ReactElement {
  const app = useApp()
  const [gain, setGain] = useState<{ n: number; id: number } | null>(null)
  const [party, setParty] = useState<number | null>(null)
  const last = useRef<{ key: string; pct: number | null } | null>(null)

  // a gain while the same thing is on screen shows for a moment ("+2%")
  useEffect(() => {
    const prev = last.current
    last.current = { key: p.key, pct: p.pct }
    if (!prev || prev.key !== p.key || prev.pct === null || p.pct === null || p.pct <= prev.pct) return
    setGain({ n: p.pct - prev.pct, id: Date.now() })
    const t = setTimeout(() => setGain(null), GAIN_MS)
    return () => clearTimeout(t)
  }, [p.key, p.pct])

  // milestones: celebrate one above the best so far, then remember it
  useEffect(() => {
    let live = true
    void loadRecord(app).then((rec) => {
      if (!live || p.pct === null) return
      const best = rec[p.key]
      const m = newMilestone(best, p.pct)
      const reached = milestoneAt(p.pct)
      if (best === undefined || reached > best) {
        rec[p.key] = Math.max(best ?? 0, reached)
        void app.backend.writeJson(RECORD, rec).catch(() => undefined)
      }
      if (m === null) return
      setParty(m)
      app.toast({ kind: 'milestone', text: milestoneLine(m, p.overall ? 'All courses' : p.label) }, 6000)
    })
    return () => {
      live = false
    }
  }, [app, p.key, p.pct, p.overall, p.label])
  useEffect(() => {
    if (party === null) return
    const t = setTimeout(() => setParty(null), CELEBRATE_MS)
    return () => clearTimeout(t)
  }, [party])

  const pct = p.pct ?? 0
  return (
    <button
      className={`progress-meter ${party !== null ? 'party' : ''} ${pct >= 100 ? 'full' : ''}`}
      onClick={() => app.go({ name: p.overall ? 'plan' : 'course' })}
      title={p.title}
      aria-label={`${p.overall ? 'Progress across all courses' : `Progress in ${p.label}`}: ${pct} percent`}
    >
      {/* the course chip already names the open course; only the overall share needs a label */}
      {p.overall && <span className="pm-label">{p.label}</span>}
      <span className="pm-track" aria-hidden="true">
        {MILESTONES.filter((m) => m < 100).map((m) => (
          <span key={m} className={`pm-tick ${pct >= m ? 'past' : ''}`} style={{ left: `${m}%` }} />
        ))}
        <span className="pm-fill" style={{ width: `${pct}%` }} />
        <span className="pm-point" style={{ left: `${pct}%` }}>
          {party !== null && (
            <span className="pm-burst" key={party}>
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} style={{ ['--a' as string]: `${i * 45 + 22}deg` }} />
              ))}
            </span>
          )}
        </span>
      </span>
      <span className="pm-pct">
        {pct}%
        {gain && (
          <span className="pm-gain" key={gain.id}>
            +{gain.n}%
          </span>
        )}
      </span>
    </button>
  )
}
