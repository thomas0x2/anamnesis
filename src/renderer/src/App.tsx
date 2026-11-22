// The window: top bar navigation, the routed view, toasts, the script drawer and onboarding.
import { dueConcepts } from '@shared/selection'
import { useEffect, useMemo, useRef, type ReactElement } from 'react'
import { BrandMark, Icon } from './components/Icon'
import { ScriptPeek } from './components/PdfPage'
import { useApp, type Route } from './engine/app'
import type { SessionController } from './engine/session'
import { useStore } from './engine/store'
import { useNow } from './lib/hooks'
import { ChatScreen } from './views/ChatView'
import { HomeView } from './views/HomeView'
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
  const main = useRef<HTMLElement>(null)

  useEffect(() => {
    if (main.current) main.current.scrollTop = 0
  }, [route.name])

  return (
    <div className="app">
      <div className="drag-strip" />
      <TopBar />
      <main className="main" ref={main}>
        <RouteView route={route} />
      </main>
      <ScriptPeek />
      <Toasts />
      {onboarding && <Onboarding />}
    </div>
  )
}

function RouteView({ route }: { route: Route }): ReactElement {
  switch (route.name) {
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
  }
}

const NAV: { name: Route['name']; label: string; icon: string }[] = [
  { name: 'home', label: 'Today', icon: 'home' },
  { name: 'chat', label: 'Tutor', icon: 'chat' },
  { name: 'map', label: 'Course map', icon: 'map' },
  { name: 'mind', label: 'Mind model', icon: 'mind' },
  { name: 'stats', label: 'Stats', icon: 'stats' },
  { name: 'script', label: 'Script', icon: 'book' }
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
  const course = app.course

  return (
    <header className="topbar">
      <div className="brand" title={`${course.title} · ${course.term}`}>
        <BrandMark />
        <span className="brand-name">anamnesis</span>
        <span className="brand-sub">
          {course.short} · {course.term}
        </span>
      </div>
      {sc && route !== 'session' && <ResumeCard sc={sc} />}
      <nav className="topnav" aria-label="Main">
        {NAV.map((n) => (
          <button key={n.name} className={`nav-item ${route === n.name ? 'active' : ''}`} onClick={() => app.go({ name: n.name } as Route)} aria-current={route === n.name ? 'page' : undefined} aria-label={n.label}>
            {n.label}
            {n.name === 'home' && due > 0 && (
              <span className="count hot" title={`${due} concepts due for review`}>
                {due}
              </span>
            )}
          </button>
        ))}
        <button className={`nav-item icon ${route === 'settings' ? 'active' : ''}`} onClick={() => app.go({ name: 'settings' })} aria-label="Settings" title="Settings">
          <Icon name="settings" size={16} />
        </button>
        <span className="points" title={`Points come from retrieving and understanding, not from time spent${week > 0 ? ` · +${week} this week` : ''}`}>
          {rewards.total.toLocaleString('en-US')} pts
        </span>
      </nav>
    </header>
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
