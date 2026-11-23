// The window: top bar navigation, the routed view, toasts, the script drawer and onboarding.
import { dueConcepts } from '@shared/selection'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { BrandMark, Icon } from './components/Icon'
import { ScriptPeek } from './components/PdfPage'
import { useApp, type Route } from './engine/app'
import type { SessionController } from './engine/session'
import { useStore } from './engine/store'
import { useNow } from './lib/hooks'
import { ChatScreen } from './views/ChatView'
import { ExamView } from './views/ExamView'
import { HomeView } from './views/HomeView'
import { CourseDialog, MaterialsView } from './views/MaterialsView'
import { MapView } from './views/MapView'
import { MindView } from './views/MindView'
import { Onboarding } from './views/Onboarding'
import { ScriptView } from './views/ScriptView'
import { SessionScreen } from './views/SessionView'
import { SettingsView } from './views/SettingsView'
import { StatsView } from './views/StatsView'

export function App(): ReactElement {
  const app = useApp()
  const route = useStore(app.ui, (u) => u.route)
  const onboarding = useStore(app.ui, (u) => u.onboarding)
  const courseKey = useStore(app.ui, (u) => u.courseKey)
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    if (main.current) main.current.scrollTop = 0
  }, [route.name])

  // new PDFs in the course folder are picked up when the window comes to the front
  useEffect(() => {
    const onFocus = (): void => void app.scanFolder()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [app])

  // a map build that failed because the connection dropped goes on once the computer is back online
  useEffect(() => {
    const onOnline = (): void => app.resumeAfterReconnect()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [app])

  return (
    <div className="app">
      <div className="drag-strip" />
      <TopBar key={`top-${courseKey}`} />
      <main className="main" ref={main}>
        <RouteView key={courseKey} route={route} />
      </main>
      <ScriptPeek />
      <Toasts />
      {onboarding && <Onboarding />}
    </div>
  )
}

function RouteView({ route }: { route: Route }): ReactElement {
  switch (route.name) {
    case 'materials':
      return <MaterialsView />
    case 'exam':
      return <ExamView materialId={route.materialId} />
    case 'home':
      return <HomeView />
    case 'map':
      return <MapView conceptId={route.conceptId} />
    case 'session':
      return <SessionScreen />
    case 'chat':
      return <ChatScreen />
    case 'mind':
      return <MindView conceptId={route.conceptId} />
    case 'stats':
      return <StatsView />
    case 'script':
      return <ScriptView page={route.page} />
    case 'settings':
      return <SettingsView />
    default:
      return <HomeView />
  }
}

type NavItem = { name: Route['name']; label: string; icon: string }
// Three groups: study now, the course itself, and how you are doing.
const NAV_GROUPS: NavItem[][] = [
  [
    { name: 'home', label: 'Today', icon: 'home' },
    { name: 'chat', label: 'Tutor', icon: 'chat' }
  ],
  [
    { name: 'map', label: 'Course map', icon: 'map' },
    { name: 'materials', label: 'Materials', icon: 'book' },
    { name: 'mind', label: 'Mind model', icon: 'mind' }
  ],
  [
    { name: 'exam', label: 'Exam prep', icon: 'target' },
    { name: 'stats', label: 'Stats', icon: 'stats' }
  ]
]

function TopBar(): ReactElement {
  const app = useApp()
  const route = useStore(app.ui, (u) => u.route.name)
  const learner = useStore(app.state, (s) => s.learner)
  const rewards = useStore(app.state, (s) => s.rewards)
  const sc = useStore(app.session, (s) => s)
  const now = useNow()
  const due = useMemo(() => dueConcepts(learner, now).filter((id) => app.graph.get(id)).length, [app, learner, now])
  const week = useMemo(() => rewards.events.filter((e) => now.getTime() - Date.parse(e.at) < 7 * 86_400_000).reduce((s, e) => s + e.points, 0), [rewards, now])
  const jobRunning = useStore(app.job, (j) => !!j)
  const pending = useStore(app.pending, (p) => p.length)
  const checking = useStore(app.exam, (e) => e.submissions.filter((x) => x.status === 'grading').length)

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">anamnesis</span>
        <CourseSwitcher />
      </div>
      {sc && route !== 'session' && route !== 'home' && <ResumeCard sc={sc} />}
      <nav className="topnav" aria-label="Main">
        {NAV_GROUPS.map((group, gi) => (
          <div className="nav-group" key={gi}>
            {group.map((n) => {
              const on = route === n.name || (n.name === 'materials' && route === 'script')
              return (
                <button key={n.name} className={`nav-item ${on ? 'active' : ''}`} title={n.label} onClick={() => app.go({ name: n.name } as Route)} aria-current={on ? 'page' : undefined} aria-label={n.label}>
                  <Icon name={n.icon} size={15} />
                  <span className="nav-label">{n.label}</span>
                  {n.name === 'materials' && (jobRunning || pending > 0) && (
                    <span className={`count ${pending ? 'hot' : ''}`} title={jobRunning ? 'Reading new material' : `${pending} new files in the course folder`}>
                      {pending || '…'}
                    </span>
                  )}
                  {n.name === 'exam' && checking > 0 && (
                    <span className="count" title="Checking your solution">
                      …
                    </span>
                  )}
                  {n.name === 'home' && due > 0 && (
                    <span className="count hot" title={`${due} concepts due for review`}>
                      {due}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="topbar-end">
        <button className={`nav-item icon ${route === 'settings' ? 'active' : ''}`} onClick={() => app.go({ name: 'settings' })} aria-label="Settings" title="Settings">
          <Icon name="settings" size={16} />
        </button>
        <span className="points" title={`Points come from retrieving and understanding, not from time spent${week > 0 ? ` · +${week} this week` : ''}`}>
          {rewards.total.toLocaleString('en-US')} pts
        </span>
      </div>
    </header>
  )
}

function CourseSwitcher(): ReactElement {
  const app = useApp()
  const courses = useStore(app.courses)
  const { course } = useStore(app.courseView)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="course-switch" ref={ref}>
      <button className="brand-sub course-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} title={`${course.title}${course.term ? ` · ${course.term}` : ''}: switch course`}>
        {course.short}
        {course.term ? ` · ${course.term}` : ''}
        <Icon name="chev-down" size={12} />
      </button>
      {open && (
        <div className="course-menu" role="menu">
          {courses.map((c) => (
            <button
              key={c.id}
              role="menuitemradio"
              aria-checked={c.id === course.id}
              className={`course-item ${c.id === course.id ? 'on' : ''}`}
              onClick={() => {
                setOpen(false)
                void app.switchCourse(c.id)
              }}
            >
              <span className="dot" />
              <span className="t">{c.short}</span>
              <span className="s">{c.title}</span>
            </button>
          ))}
          <div className="course-sep" />
          <button
            role="menuitem"
            className="course-item"
            onClick={() => {
              setOpen(false)
              setCreating(true)
            }}
          >
            <Icon name="plus" size={13} />
            <span className="t">New course…</span>
          </button>
        </div>
      )}
      {creating && <CourseDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

function ResumeCard({ sc }: { sc: SessionController }): ReactElement {
  const app = useApp()
  const s = useStore(sc.view, (v) => v.session)
  const title = s.type === 'learn' ? app.graph.title(s.goalConceptId ?? '') : s.type === 'review' ? 'Review' : 'Practice'
  const phase = s.type === 'learn' ? ({ probe: 'Probe', plan: 'Plan', teach: 'Teach', wrap: 'Wrap up' } as Record<string, string>)[s.phase] ?? '' : `${s.steps.filter((r) => r.target).length} of ${s.itemsGoal}`
  return (
    <button className="resume-card" onClick={() => app.go({ name: 'session' })}>
      <span className="label">continue · {phase.toLowerCase()}</span>
      <span className="title">{title}</span>
    </button>
  )
}

function Toasts(): ReactElement {
  const app = useApp()
  const toasts = useStore(app.ui, (u) => u.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.points ? <span className="pts">+{t.points}</span> : <Icon name={t.kind === 'error' ? 'alert' : 'info'} size={17} style={{ color: t.kind === 'error' ? 'var(--bad)' : 'var(--info)' }} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
