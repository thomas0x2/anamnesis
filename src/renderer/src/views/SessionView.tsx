// The learning session: a stream of interactive cards, the plan tree, side questions and the results.
import { masteryMean } from '@shared/mastery'
import { waitingCards } from '../lib/waiting'
import { cardRetrievability } from '@shared/fsrs'
import type { CardResponse, PlanNodeState, Session, StepRecord } from '@shared/types'
import { Fragment, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Blocks } from '../components/Blocks'
import { CardView, type PredictionRef } from '../components/CardView'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { PlanGraph } from '../components/PlanGraph'
import { useApp } from '../engine/app'
import type { ChatController, ChatItem, ChatView, ToolItem } from '../engine/chat'
import { draftKey, type SessionController, type SessionView as View } from '../engine/session'
import { createStore, useStore, type Store } from '../engine/store'
import { clock, LEVEL_LABEL, pct, plural, STATUS_LABEL } from '../lib/format'
import { AgentStatus, CardPreview, Composer, ToolView } from './ChatView'

const NO_CHAT = createStore<ChatView | null>(null)

const TIPS = [
  '<b>Why predict first?</b> Trying to answer before you are taught, even wrongly, makes the explanation stick better (the pretesting effect).',
  '<b>Why so many questions?</b> Pulling an idea out of memory strengthens it far more than rereading it (the testing effect).',
  '<b>Why nudges instead of answers?</b> Producing the step yourself, with a small hint, builds understanding; being told builds familiarity.',
  '<b>Why the confidence buttons?</b> Knowing what you do not know is a skill of its own. Your calibration curve is in Stats.',
  '<b>Why mixed practice?</b> Interleaving topics makes you choose the method yourself, as in the exam.',
  '<b>Why spaced reviews?</b> A review is scheduled just before you would forget: that is when recalling strengthens memory most.',
  '<b>Why do problems get harder?</b> Composing demands and changing the cues makes recall work in exam surfaces, not only in the script’s.',
  '<b>Errors are useful.</b> A confident mistake that gets corrected is remembered especially well (the hypercorrection effect).'
]

export function SessionScreen(): ReactElement {
  const app = useApp()
  const sc = useStore(app.session, (s) => s)
  if (!sc) {
    return (
      <div className="page page-narrow">
        <div className="empty">
          No session is running.{' '}
          <button className="btn sm" onClick={() => app.go({ name: 'home' })}>
            Back to Today
          </button>
        </div>
      </div>
    )
  }
  return <SessionInner key={sc.s.id} sc={sc} />
}

function SessionInner({ sc }: { sc: SessionController }): ReactElement {
  const app = useApp()
  const v = useStore(sc.view, (x) => x)
  const chatCtl = useStore(app.chat, (c) => c)
  const cc = chatCtl && chatCtl.cards === sc ? chatCtl : null
  const [chat, setChat] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const s = v.session
  const cur = s.steps[v.cursor.step]
  const pastEnd = !cur || (v.cursor.card >= cur.step.cards.length && !cur.pending)
  const finished = s.phase === 'done' && pastEnd && !v.status
  const showSide = s.type === 'learn' || s.type === 'chat' ? !!s.plan : true
  const streamRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const steps = s.steps.length
  const items = useStore((cc?.view ?? NO_CHAT) as Store<ChatView | null>, (x) => x?.chat.items.length ?? 0)

  // agent sessions grow at the bottom: follow while the learner is near it
  useEffect(() => {
    const el = streamRef.current
    if (cc && el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [cc, steps, items, v.cursor.step, v.cursor.card, v.planReview])
  const onScroll = (): void => {
    const el = streamRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160
  }

  // Enter = continue / next when not typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter' || e.metaKey || e.ctrlKey || e.shiftKey) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, button, [contenteditable="true"], .chat')) return
      const btn = document.querySelector('.card.current .actions .btn.primary') as HTMLButtonElement | null
      if (btn && !btn.disabled && /Continue|Next|Finish|See results/.test(btn.textContent ?? '')) {
        e.preventDefault()
        btn.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className={`session ${cc ? 'agent-session' : ''}`}>
      <SessionHeader sc={sc} v={v} cc={cc} onChat={() => setChat((c) => !c)} />
      <div className={`session-body ${showSide ? '' : 'no-side'}`}>
        <div className="stream" ref={streamRef} onScroll={onScroll}>
          <div className="stream-inner">
            {finished && !cc ? (
              <DoneScreen sc={sc} />
            ) : (
              <Stream
                sc={sc}
                v={v}
                cc={cc}
                expanded={expanded}
                toggle={(k) =>
                  setExpanded((x) => {
                    const n = new Set(x)
                    if (n.has(k)) n.delete(k)
                    else n.add(k)
                    return n
                  })
                }
              />
            )}
            {finished && cc && s.type !== 'chat' && <DoneScreen sc={sc} />}
          </div>
          {cc && <AgentComposer cc={cc} onSend={() => (stick.current = true)} />}
        </div>
        {showSide && (
          <aside className="session-side">
            <SidePanel sc={sc} v={v} />
          </aside>
        )}
      </div>
      {chat && !cc && <ChatDrawer sc={sc} v={v} onClose={() => setChat(false)} />}
    </div>
  )
}

// ------------------------------------------------------------ agent sessions
function AgentStatusOf({ cc }: { cc: ChatController }): ReactElement | null {
  const v = useStore(cc.view, (x) => x)
  return <AgentStatus v={v} />
}

function AgentComposer({ cc, onSend }: { cc: ChatController; onSend: () => void }): ReactElement {
  const [text, setText] = useState('')
  const waiting = useStore(cc.view, (v) => v.chat.items.some((it) => it.kind === 'tool' && it.status === 'running' && (it.name === 'ask' || it.name === 'explain' || it.name === 'show_plan')))
  const send = (): void => {
    const t = text.trim()
    if (!t) return
    setText('')
    onSend()
    void cc.send(t)
  }
  return (
    <div className="chat-composer">
      <div className="chat-composer-inner">
        <Composer value={text} onChange={setText} onSend={send} placeholder={waiting ? 'Answer in the card, or ask the tutor anything here…' : 'Message the tutor…'} />
      </div>
    </div>
  )
}

function StreamItem({ it }: { it: ChatItem }): ReactElement | null {
  switch (it.kind) {
    case 'user':
      return (
        <div className="bubble user">
          <Markdown text={it.text} />
        </div>
      )
    case 'assistant':
      return it.text.trim() ? (
        <div className="assistant-msg">
          <Markdown text={it.text} />
        </div>
      ) : null
    case 'note':
      return (
        <div className={`note ${it.tone}`}>
          <Icon name={it.tone === 'error' ? 'alert' : 'info'} size={16} />
          <span>{it.text}</span>
        </div>
      )
    case 'tool':
      if (it.name === 'ask' || it.name === 'explain' || it.name === 'finish' || it.name === 'show_plan' || it.name === 'update_plan') return null
      return <ToolView it={it} />
  }
}

// ------------------------------------------------------------ header
function SessionHeader({ sc, v, cc, onChat }: { sc: SessionController; v: View; cc: ChatController | null; onChat: () => void }): ReactElement {
  const app = useApp()
  const s = v.session
  const title =
    s.type === 'learn'
      ? app.graph.title(s.goalConceptId ?? '')
      : s.type === 'chat'
        ? (cc?.chat.title ?? 'Tutor')
        : s.type === 'practice'
          ? s.scope.length === 1
            ? `Practice: ${app.graph.title(s.scope[0])}`
            : 'Mixed practice'
          : 'Spaced review'
  const eyebrow = s.type === 'learn' ? `Learn · Chapter ${app.graph.get(s.goalConceptId ?? '')?.chapter ?? ''}` : s.type === 'chat' ? 'Tutor' : s.type === 'practice' ? 'Practice' : 'Review'
  const items = s.steps.filter((r) => r.target).length
  return (
    <div className="session-head">
      <button className="btn icon ghost" onClick={() => app.go({ name: 'home' })} title="Leave (the session stays open)">
        <Icon name="back" />
      </button>
      <div className="session-title">
        <div className="eyebrow">{eyebrow}</div>
        <div className="name">
          <Markdown text={title} inline />
        </div>
      </div>
      {s.type === 'learn' ? (
        <div className="phases">
          {(['probe', 'plan', 'teach', 'wrap'] as const).map((ph, i) => {
            const order = ['probe', 'plan', 'teach', 'wrap', 'done']
            const curIdx = order.indexOf(s.phase)
            const state = i < curIdx ? 'done' : i === curIdx ? 'current' : ''
            return (
              <Fragment key={ph}>
                {i > 0 && <span className="phase-sep" />}
                <span className={`phase ${state}`}>
                  <span className="num">{state === 'done' ? '✓' : i + 1}</span>
                  {ph === 'probe' ? 'Probe' : ph === 'plan' ? 'Plan' : ph === 'teach' ? 'Teach' : 'Wrap up'}
                </span>
              </Fragment>
            )
          })}
        </div>
      ) : s.type === 'chat' ? (
        <span className="spacer" />
      ) : (
        <div className="phases">
          <span className="phase current">
            <span className="num">{Math.min(items, s.itemsGoal) || 1}</span>
            Item {Math.max(1, Math.min(items, s.itemsGoal))} of {s.itemsGoal}
          </span>
        </div>
      )}
      <span className="session-points" title="Insight points earned in this session">
        <Icon name="star" size={16} /> {s.pointsEarned}
      </span>
      {cc ? (
        <AgentStatusOf cc={cc} />
      ) : (
        <button className="btn sm" onClick={onChat} title="Ask a side question">
          <Icon name="chat" size={15} /> Ask
        </button>
      )}
      {s.phase !== 'done' && s.type !== 'chat' && (
        <button className="btn sm ghost" onClick={() => void sc.finish()} title="End the session now and see the results">
          End
        </button>
      )}
    </div>
  )
}

// ------------------------------------------------------------ card stream
function stepLabel(app: ReturnType<typeof useApp>, s: Session, rec: StepRecord, si: number, agent: boolean): string {
  switch (rec.phase) {
    case 'probe':
      return agent ? 'Probe' : `Probe${s.steps.filter((r, i) => r.phase === 'probe' && i <= si).length > 1 ? ' · round 2' : ''}`
    case 'plan':
      return 'Your plan'
    case 'teach': {
      const n = s.plan?.plan.nodes.find((x) => x.id === rec.nodeId)
      const attempt = s.steps.filter((r, i) => r.phase === 'teach' && r.nodeId === rec.nodeId && i <= si).length
      if (!n) return agent ? 'Teaching' : ''
      return `${n.kind === 'goal' ? 'Goal' : 'Step'}: ${n.title}${attempt > 1 && !agent ? ' · another angle' : ''}`
    }
    case 'wrap':
      return 'Wrap up'
    case 'chat':
      return ''
    default: {
      if (agent && !rec.target) return ''
      const idx = s.steps.filter((r, i) => r.target && i <= si).length
      const t = rec.target
      return `Item ${idx}${t ? ` · ${app.graph.title(t.conceptId)} · L${t.level} ${LEVEL_LABEL[t.level]}${t.mode === 'relearn' ? ' · relearn' : ''}` : ''}`
    }
  }
}

function Stream({ sc, v, cc, expanded, toggle }: { sc: SessionController; v: View; cc: ChatController | null; expanded: Set<string>; toggle: (k: string) => void }): ReactElement {
  const app = useApp()
  const cv = useStore((cc?.view ?? NO_CHAT) as Store<ChatView | null>, (x) => x)
  const s = v.session
  const chatItems: ChatItem[] = cv?.chat.items ?? []
  let nextItem = 0
  let lastLabel = ''
  const { cursor } = v
  const out: ReactElement[] = []
  const cur = s.steps[cursor.step]
  const pastEnd = !cur || (cursor.card >= cur.step.cards.length && !cur.pending)
  const finishing = s.phase === 'done'

  // agent sessions: the tutor's notes, the learner's messages and look-ups sit between the cards
  const flushItems = (upto: number): void => {
    while (nextItem < chatItems.length && (chatItems[nextItem].pos ?? 0) <= upto) {
      const it = chatItems[nextItem++]
      const el = <StreamItem key={it.id} it={it} />
      out.push(el)
    }
  }

  // agent sessions: cards the tutor posted while the learner is still on an earlier one wait their turn.
  // A placeholder holds their place in the conversation, so the tutor's lead-in ("here is the picture:")
  // doesn't end in nothing and the card doesn't later pop in above newer messages.
  const waiting = cc && !v.planReview ? waitingCards(s.steps, cursor) : 0
  let placeholder = false
  const holdPlace = (): void => {
    if (!waiting || placeholder) return
    placeholder = true
    out.push(<WaitingCards key="waiting" n={waiting} />)
  }

  s.steps.forEach((rec, si) => {
    if (cc) flushItems(si)
    if (si > cursor.step) return holdPlace()
    if (v.planReview && rec.phase === 'teach' && !s.plan?.confirmed) return
    const visible = si < cursor.step ? rec.step.cards.length : Math.min(cursor.card + 1, rec.step.cards.length)
    if (!visible) return
    const label = stepLabel(app, s, rec, si, !!cc)
    if (label && (!cc || label !== lastLabel))
      out.push(
        <div className="step-divider" key={`d${rec.id}`}>
          <Markdown text={label} inline />
        </div>
      )
    lastLabel = label
    for (let ci = 0; ci < visible; ci++) {
      const card = rec.step.cards[ci]
      const key = draftKey(si, ci)
      const isCurrent = si === cursor.step && ci === cursor.card && !v.planReview
      const compact = si < cursor.step && !expanded.has(key)
      let prediction: PredictionRef | null = null
      if (card.kind === 'explain') {
        for (let k = ci - 1; k >= 0; k--) {
          const c = rec.step.cards[k]
          const r: CardResponse | undefined = rec.responses[k]
          if (c.kind === 'predict' && c.interaction?.type === 'free' && r && r.verdict === 'seen' && r.answerText) {
            prediction = { text: r.answerText, si, ci: k, selfCheck: r.selfCheck ?? null }
            break
          }
          if (c.kind !== 'predict') continue
          break
        }
      }
      const lastCard = si === s.steps.length - 1 && ci === rec.step.cards.length - 1
      out.push(
        <CardView
          key={`${rec.id}:${ci}`}
          sc={sc}
          si={si}
          ci={ci}
          stepId={rec.id}
          card={card}
          response={rec.responses[ci]}
          draft={v.drafts[key] ?? sc.draft(si, ci)}
          current={isCurrent}
          compact={compact}
          onToggle={si < cursor.step ? () => toggle(key) : undefined}
          target={rec.target}
          prediction={prediction}
          finishing={finishing && lastCard}
        />
      )
    }
    if (si === cursor.step && visible < rec.step.cards.length) holdPlace()
  })

  if (cc) {
    flushItems(Number.MAX_SAFE_INTEGER)
    const streaming = chatItems.find((it): it is ToolItem => it.kind === 'tool' && it.status === 'streaming' && (it.name === 'ask' || it.name === 'explain'))
    if (v.planReview && s.plan) out.push(<PlanReview key="plan-review" sc={sc} v={v} agent />)
    else if (v.error) out.push(<ErrorCard key="err" sc={sc} v={v} />)
    else if (streaming && pastEnd) out.push(<CardPreview key={`pv${streaming.id}`} it={streaming} />)
    else if (v.status && pastEnd) out.push(<Thinking key="thinking" sc={sc} v={v} />)
    return <>{out}</>
  }
  if (v.planReview && s.plan) out.push(<PlanReview key="plan-review" sc={sc} v={v} />)
  else if (v.error) out.push(<ErrorCard key="err" sc={sc} v={v} />)
  else if ((cur && cur.pending && cursor.card >= cur.step.cards.length) || (pastEnd && s.phase !== 'done') || (pastEnd && v.status)) out.push(<Thinking key="thinking" sc={sc} v={v} />)
  return <>{out}</>
}

function WaitingCards({ n }: { n: number }): ReactElement {
  return (
    <div className="card-waiting" role="status">
      <span className="dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span style={{ flex: 1 }}>
        {n === 1 ? 'The tutor’s next card is ready.' : `The tutor has ${n} cards ready.`} It appears here once you finish the card above.
      </span>
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => document.querySelector('.session .card.current')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
      >
        Go to that card
      </button>
    </div>
  )
}

function Thinking({ sc, v }: { sc: SessionController; v: View }): ReactElement {
  const [now, setNow] = useState(Date.now())
  const [tip] = useState(() => Math.floor(Math.random() * TIPS.length))
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const st = v.status
  const elapsed = st ? now - st.startedAt : 0
  const cur = v.session.steps[v.cursor.step]
  const midStep = cur?.pending && cur.step.cards.length > 0
  return (
    <div className="card thinking">
      <div className="thinking-orb" />
      <div style={{ flex: 1 }}>
        <div className="label">{midStep ? 'Writing the next card…' : (st?.label ?? 'Preparing the next step…')}</div>
        <div className="meta">
          {st ? clock(elapsed) : ''}
          {st && st.tokens ? ` · ${st.tokens} thinking tokens` : ''}
        </div>
        <div className="tip" dangerouslySetInnerHTML={{ __html: TIPS[(tip + Math.floor(elapsed / 12000)) % TIPS.length] }} />
        {!st && !sc.agentDriven && (
          <button className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => void sc.retry()}>
            <Icon name="refresh" size={14} /> Nothing happening? Continue
          </button>
        )}
      </div>
    </div>
  )
}

function ErrorCard({ sc, v }: { sc: SessionController; v: View }): ReactElement {
  const app = useApp()
  const e = v.error!
  return (
    <div className="card error-card">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Icon name="alert" style={{ color: 'var(--bad)', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>{e.kind === 'empty' ? 'Nothing to do here' : 'The tutor ran into a problem'}</div>
          <div className="small" style={{ marginTop: 2 }}>
            <Markdown text={e.message} />
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {e.canRetry && (
              <button className="btn primary sm" onClick={() => void sc.retry()}>
                <Icon name="refresh" size={14} /> Retry
              </button>
            )}
            {(e.kind === 'not_found' || e.kind === 'auth') && (
              <button className="btn sm" onClick={() => app.go({ name: 'settings' })}>
                Open Settings
              </button>
            )}
            <button className="btn sm ghost" onClick={() => app.closeSession()}>
              Close session
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ plan review
function PlanReview({ sc, v, agent }: { sc: SessionController; v: View; agent?: boolean }): ReactElement {
  const app = useApp()
  const p = v.session.plan!
  const [ov, setOv] = useState<Record<string, 'known' | 'teach'>>({})
  const stateOf = (id: string): PlanNodeState => (ov[id] === 'known' ? 'known' : ov[id] === 'teach' ? 'pending' : (p.nodeState[id] ?? 'pending'))
  const toggle = (id: string): void => setOv((o) => ({ ...o, [id]: stateOf(id) === 'known' ? 'teach' : 'known' }))
  const toTeach = p.plan.nodes.filter((n) => stateOf(n.id) !== 'known').length
  const last = v.session.steps[v.session.steps.length - 1]
  const ready = last?.phase === 'teach' && last.step.cards.length > 0
  return (
    <div className="card current plan-review">
      <div className="card-head">
        <span className="kind">
          <Icon name="tree" size={15} /> Plan
        </span>
        <span className="spacer" />
        <span className="chip accent">
          {plural(toTeach, 'step')} to the goal
        </span>
      </div>
      <h3 className="card-title" style={{ marginBottom: 6 }}>
        <Markdown text={`Your path to ${p.plan.goal || app.graph.title(v.session.goalConceptId ?? '')}`} inline />
      </h3>
      {p.plan.approach && (
        <div className="muted small" style={{ marginBottom: 10 }}>
          <Markdown text={p.plan.approach} inline />
        </div>
      )}
      <PlanGraph plan={p.plan} nodeState={p.nodeState} overrides={ov} onNodeClick={toggle} size="full" />
      <div className="plan-list">
        {p.plan.nodes.map((n, i) => {
          const st = stateOf(n.id)
          return (
            <div key={n.id} className={`plan-item ${st === 'known' ? 'known' : ''}`}>
              <span className="idx">{st === 'known' ? '✓' : n.kind === 'goal' ? '★' : i + 1}</span>
              <div className="body">
                <div className="title">
                  <Markdown text={n.title} inline />
                </div>
                <div className="detail">
                  <Markdown text={n.detail} inline />
                </div>
              </div>
              {n.kind !== 'goal' && (
                <span className="seg">
                  <button className={st === 'known' ? 'on' : ''} onClick={() => setOv((o) => ({ ...o, [n.id]: 'known' }))}>
                    I know this
                  </button>
                  <button className={st !== 'known' ? 'on' : ''} onClick={() => setOv((o) => ({ ...o, [n.id]: 'teach' }))}>
                    {n.kind === 'shaky' ? 'Refresh' : 'Teach me'}
                  </button>
                </span>
              )}
            </div>
          )
        })}
      </div>
      <div className="actions">
        <span className="small muted">
          {agent ? 'Mark what you already know; the tutor starts with the first step you leave.' : ready ? 'The first lesson is ready.' : 'Writing the first lesson while you look…'}
        </span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => void sc.confirmPlan(ov)}>
          Start walking the tree <Icon name="arrow" size={16} />
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ side panel
function SidePanel({ sc, v }: { sc: SessionController; v: View }): ReactElement {
  const app = useApp()
  const s = v.session
  const state = useStore(app.state, (x) => x.learner.concepts)
  const conceptId =
    s.type === 'learn'
      ? (s.plan?.plan.nodes.find((n) => n.id === s.currentNodeId)?.conceptId ?? s.goalConceptId)
      : (s.steps[v.cursor.step]?.target?.conceptId ?? s.queue[0]?.conceptId ?? null)
  const cs = conceptId ? state[conceptId] : undefined
  return (
    <>
      {s.plan && (s.type === 'learn' || s.type === 'chat') && (
        <>
          <div className="side-title">Dependency tree</div>
          <PlanGraph plan={s.plan.plan} nodeState={s.plan.nodeState} currentId={s.phase === 'teach' ? s.currentNodeId : null} />
          <div className="legend-row" style={{ marginTop: 10 }}>
            <span>
              <span className="plan-node known" style={{ width: 12, height: 12, padding: 0, borderRadius: 4 }} /> known
            </span>
            <span>
              <span className="plan-node active" style={{ width: 12, height: 12, padding: 0, borderRadius: 4, animation: 'none' }} /> now
            </span>
            <span>
              <span className="plan-node done" style={{ width: 12, height: 12, padding: 0, borderRadius: 4 }} /> learned
            </span>
            {Object.values(s.plan.nodeState).includes('shaky') && (
              <span>
                <span className="plan-node shaky" style={{ width: 12, height: 12, padding: 0, borderRadius: 4 }} /> shaky: comes back in practice
              </span>
            )}
          </div>
        </>
      )}
      {(s.type === 'practice' || s.type === 'review') && (
        <>
          <div className="side-title">Items</div>
          <div className="queue">
            {s.queue.slice(0, s.itemsGoal).map((q, i) => {
              const rec = s.steps.filter((r) => r.target)[i]
              const r = rec ? rec.responses[rec.step.cards.length - 1] : undefined
              const current = rec && s.steps.indexOf(rec) === v.cursor.step
              const res = !r ? (rec ? '…' : '') : (r.score ?? 0) >= 0.8 && !r.revealed ? '✓' : (r.score ?? 0) >= 0.5 ? '~' : '✗'
              return (
                <div key={i} className={`queue-item ${current ? 'current' : ''}`}>
                  <span className="lvl">L{rec?.target?.level ?? q.level}</span>
                  <span className="t">
                    <Markdown text={app.graph.title(q.conceptId)} inline />
                  </span>
                  <span className="res" style={{ color: res === '✓' ? 'var(--good)' : res === '✗' ? 'var(--bad)' : res === '~' ? 'var(--warn)' : 'var(--muted)' }}>
                    {res}
                  </span>
                </div>
              )
            })}
          </div>
          <p className="tiny muted" style={{ marginTop: 10 }}>
            Difficulty adapts per concept: three clean answers in a row raise the level, a miss lowers it. Topics are interleaved on purpose.
          </p>
        </>
      )}
      {conceptId && (
        <div className="panel" style={{ marginTop: 18, padding: '12px 14px' }}>
          <div className="side-title" style={{ marginBottom: 6 }}>
            Your model
          </div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>
            <Markdown text={app.graph.title(conceptId)} inline />
          </div>
          <div className="row" style={{ marginTop: 6, gap: 8 }}>
            <span className={`status-dot ${cs?.status ?? 'unseen'}`} />
            <span className="small">{STATUS_LABEL[cs?.status ?? 'unseen']}</span>
            <span className="spacer" />
            <span className="tiny muted">mastery {cs && cs.evidence.length ? pct(masteryMean(cs)) : '–'}</span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}>
            <span style={{ width: `${cs && cs.evidence.length ? masteryMean(cs) * 100 : 0}%` }} />
          </div>
          {cs?.fsrs && <div className="tiny muted" style={{ marginTop: 6 }}>memory now {pct(cardRetrievability(cs.fsrs, new Date()))} · level {cs.level}</div>}
          {cs?.tutorNote && (
            <div className="tiny" style={{ marginTop: 8, color: 'var(--text-2)' }}>
              <Markdown text={cs.tutorNote} inline />
            </div>
          )}
          <button className="btn sm ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => app.go({ name: 'mind', conceptId })}>
            Open in mind model <Icon name="chev-right" size={14} />
          </button>
        </div>
      )}
    </>
  )
}

// ------------------------------------------------------------ chat
function ChatDrawer({ sc, v, onClose }: { sc: SessionController; v: View; onClose: () => void }): ReactElement {
  const [q, setQ] = useState('')
  const send = (): void => {
    if (!q.trim()) return
    void sc.ask(q)
    setQ('')
  }
  return (
    <div className="chat">
      <div className="chat-head">
        <Icon name="chat" />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>Side question</div>
          <div className="tiny muted">Ask anything; it will not give away the card you are on.</div>
        </div>
        <button className="btn icon sm ghost" onClick={onClose} aria-label="close">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="chat-log">
        {v.session.chat.length === 0 && <div className="muted small">For example: “Why does the barycentric formula need weights at all?”</div>}
        {v.session.chat.map((t, i) => (
          <div key={i} className={`bubble ${t.role}`}>
            {t.role === 'tutor' && t.blocks ? <Blocks blocks={t.blocks} /> : <Markdown text={t.text} />}
          </div>
        ))}
        {v.chatBusy && <div className="bubble tutor muted">Thinking…</div>}
      </div>
      <div className="chat-input">
        <textarea
          className="textarea"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Your question…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <span className="tiny muted">Enter to send · Shift+Enter for a new line</span>
          <span className="spacer" />
          <button className="btn primary sm" disabled={!q.trim() || v.chatBusy} onClick={send}>
            <Icon name="send" size={14} /> Ask
          </button>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ results
function DoneScreen({ sc }: { sc: SessionController }): ReactElement {
  const app = useApp()
  const s = useStore(sc.view, (x) => x.session)
  const concepts = useStore(app.state, (x) => x.learner.concepts)
  const sum = s.summary
  const ids = useMemo(() => {
    const set = new Set<string>(sum?.conceptIds ?? [])
    if (s.goalConceptId) set.add(s.goalConceptId)
    return [...set].filter((id) => app.graph.get(id))
  }, [sum, s.goalConceptId, app.graph])
  const next = app.graph.frontier(app.state.get().learner).filter((id) => !ids.includes(id))[0]
  const acc = sum && sum.items ? sum.correct / sum.items : null
  return (
    <>
      <div className="card done-hero">
        <div className="tiny muted" style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 650 }}>
          Session complete
        </div>
        <div className="pts" style={{ marginTop: 6 }}>
          +{s.pointsEarned}
        </div>
        <div className="muted">insight points</div>
        <div className="done-stats">
          <div>
            <b>{sum?.items ?? 0}</b>graded answers
          </div>
          <div>
            <b>{acc === null ? '–' : pct(acc)}</b>correct
          </div>
          <div>
            <b>{clock((new Date(sum?.endedAt ?? Date.now()).getTime() - new Date(s.startedAt).getTime()) || 0)}</b>time
          </div>
        </div>
      </div>
      {ids.length > 0 && (
        <div className="panel">
          <div className="panel-title">
            <h3>Where you stand now</h3>
            <span className="hint">from this session’s evidence</span>
          </div>
          <div className="change-list">
            {ids.slice(0, 10).map((id) => {
              const cs = concepts[id]
              return (
                <div className="change" key={id}>
                  <span className={`status-dot ${cs?.status ?? 'unseen'}`} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <Markdown text={app.graph.title(id)} inline />
                  </span>
                  <span className="small muted">{STATUS_LABEL[cs?.status ?? 'unseen']}</span>
                  <span className="bar" style={{ width: 90 }}>
                    <span style={{ width: `${cs && cs.evidence.length ? masteryMean(cs) * 100 : 0}%` }} />
                  </span>
                  <span className="tiny muted" style={{ width: 92, textAlign: 'right' }}>
                    {cs?.fsrs?.due ? `review ${new Date(cs.fsrs.due).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
      <div className="row wrap">
        {ids.length > 0 && (
          <button className="btn primary" onClick={() => void app.startPractice(ids)}>
            <Icon name="dumbbell" size={16} /> Practice these now
          </button>
        )}
        {next && (
          <button className="btn" onClick={() => void app.startLearn(next)}>
            <Icon name="bulb" size={16} /> Learn next: <Markdown text={app.graph.title(next)} inline />
          </button>
        )}
        <span className="spacer" />
        <button className="btn ghost" onClick={() => app.closeSession()}>
          Back to Today
        </button>
      </div>
      <p className="tiny muted">
        Retrieval right after learning feels easy; the real test is tomorrow. Reviews are scheduled for the moment you are about to forget.
      </p>
    </>
  )
}
