// The tutor chat: the agent's messages, the interactive cards its tools create, a composer with
// local voice dictation, and the plan the agent is working through.
import type { AgentMode } from '@shared/agentTools'
import { normalizeBlock } from '@shared/normalize'
import type { Block } from '@shared/types'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Blocks } from '../components/Blocks'
import { CardView } from '../components/CardView'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { PlanGraph } from '../components/PlanGraph'
import { VoiceButton } from '../components/Voice'
import { useApp } from '../engine/app'
import { ChatController, type ChatItem, type ChatView as View, type ToolItem } from '../engine/chat'
import { draftKey } from '../engine/session'
import { useStore } from '../engine/store'

const MODE_LABEL: Record<AgentMode, string> = { learn: 'Learn', practice: 'Practice', review: 'Review', open: 'Chat' }

export function ChatScreen(): ReactElement {
  const app = useApp()
  const cc = useStore(app.chat, (c) => c)
  if (!cc) return <ChatStart />
  return <ChatPane key={cc.chat.id} cc={cc} />
}

// ------------------------------------------------------------ start screen
function ChatStart(): ReactElement {
  const app = useApp()
  const chats = useStore(app.chats, (c) => c)
  const [text, setText] = useState('')
  const start = (t: string): void => {
    if (t.trim()) void app.startChat('open', null, [], t.trim())
  }
  return (
    <div className="page page-narrow chat-start">
      <h1>Tutor</h1>
      <p className="muted">
        Ask for anything in the course: learn a topic, practise for the exam, untangle a proof. The tutor answers with questions, explanations, plots and
        demos you work through right here, and it keeps your mind model up to date.
      </p>
      <Composer value={text} onChange={setText} onSend={() => start(text)} placeholder="What do you want to work on? e.g. “Why are Chebyshev nodes better than equispaced ones?”" autoFocus />
      <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
        <button className="btn sm" onClick={() => void app.startReview()}>
          <Icon name="refresh" size={15} /> Spaced review
        </button>
        <button className="btn sm" onClick={() => void app.startPractice([])}>
          <Icon name="dumbbell" size={15} /> Mixed practice
        </button>
        <button className="btn sm" onClick={() => app.go({ name: 'map' })}>
          <Icon name="map" size={15} /> Pick a topic on the map
        </button>
      </div>
      {chats.length > 0 && (
        <>
          <div className="side-title" style={{ marginTop: 32 }}>
            Earlier chats
          </div>
          <div className="session-list">
            {chats.slice(0, 20).map((c) => (
              <button key={c.id} className="session-row chat-row" onClick={() => void app.openChat(c.id)}>
                <span className="chip outline">{MODE_LABEL[c.mode]}</span>
                <span className="t">
                  <Markdown text={c.title} inline />
                </span>
                <span className="tiny muted">{new Date(c.updatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------ the chat
function ChatPane({ cc }: { cc: ChatController }): ReactElement {
  const app = useApp()
  const v = useStore(cc.view, (x) => x)
  const sv = useStore(cc.cards.view, (x) => x)
  const [text, setText] = useState('')
  const log = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const c = v.chat
  const plan = c.plan

  // follow the conversation while the learner is at the bottom
  useEffect(() => {
    const el = log.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [c.items, v.agent])
  const onScroll = (): void => {
    const el = log.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  const waiting = c.items.some((it) => it.kind === 'tool' && it.status === 'running' && (it.name === 'ask' || it.name === 'explain'))
  const send = (): void => {
    const t = text.trim()
    if (!t) return
    setText('')
    stick.current = true
    void cc.send(t)
  }

  return (
    <div className="session chat-view">
      <div className="session-head">
        <button className="btn icon ghost" onClick={() => app.go({ name: 'home' })} title="Leave (the chat stays)">
          <Icon name="back" />
        </button>
        <div className="session-title">
          <div className="eyebrow">
            Tutor · {MODE_LABEL[c.mode]}
            {v.model ? ` · ${v.model}` : ''}
          </div>
          <div className="name">
            <Markdown text={c.title} inline />
          </div>
        </div>
        <span className="spacer" />
        <AgentStatus v={v} />
        <span className="session-points" title="Insight points earned in this chat">
          <Icon name="star" size={16} /> {sv.session.pointsEarned}
        </span>
        <button
          className="btn sm ghost"
          onClick={() => {
            void cc.stop()
            app.chat.set(null)
          }}
          title="Start another chat (this one stays in the list)"
        >
          <Icon name="plus" size={15} /> New chat
        </button>
      </div>
      <div className={`session-body ${plan ? '' : 'no-side'}`}>
        <div className="stream" ref={log} onScroll={onScroll}>
          <div className="stream-inner chat-stream">
            {c.items.map((it) => (
              <Item key={it.id} cc={cc} it={it} />
            ))}
            {(v.agent === 'thinking' || v.agent === 'starting') && (
              <div className="agent-typing" aria-live="polite">
                <span className="dots">
                  <i />
                  <i />
                  <i />
                </span>
                {v.agent === 'starting' ? 'Starting the tutor…' : 'Thinking…'}
              </div>
            )}
            {v.error && (
              <div className="note error">
                <Icon name="alert" size={16} />
                <span>{v.error}</span>
                <button className="btn sm" onClick={() => void cc.retry()}>
                  Retry
                </button>
              </div>
            )}
          </div>
          <div className="chat-composer">
            <div className="chat-composer-inner">
              <Composer
                value={text}
                onChange={setText}
                onSend={send}
                placeholder={waiting ? 'Answer in the card above, or ask the tutor something here…' : 'Message the tutor…'}
              />
            </div>
          </div>
        </div>
        {plan && (
          <aside className="session-side">
            <div className="side-title">Plan</div>
            <p className="small" style={{ marginTop: 0 }}>
              <Markdown text={plan.plan.goal} inline />
            </p>
            <PlanGraph plan={plan.plan} nodeState={plan.nodeState} currentId={Object.entries(plan.nodeState).find(([, s]) => s === 'active')?.[0] ?? null} />
            {plan.plan.approach && (
              <p className="tiny muted" style={{ marginTop: 10 }}>
                <Markdown text={plan.plan.approach} inline />
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function AgentStatus({ v }: { v: View }): ReactElement | null {
  const label = { off: 'Paused', starting: 'Starting', thinking: 'Thinking', writing: 'Writing', waiting: 'Your turn', idle: 'Your turn' }[v.agent]
  return (
    <span className={`agent-status ${v.agent}`} title={v.agent === 'off' ? 'The tutor resumes when you write' : undefined}>
      <span className="dot" />
      {label}
    </span>
  )
}

function Composer({ value, onChange, onSend, placeholder, autoFocus }: { value: string; onChange: (t: string) => void; onSend: () => void; placeholder: string; autoFocus?: boolean }): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(220, el.scrollHeight)}px`
  }, [value])
  return (
    <div className="composer">
      <textarea
        ref={ref}
        className="textarea"
        rows={1}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label="Message to the tutor"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            onSend()
          }
        }}
      />
      <VoiceButton onText={(t) => onChange(value ? `${value} ${t}` : t)} />
      <button className="btn primary icon" onClick={onSend} disabled={!value.trim()} title="Send (Enter)" aria-label="Send">
        <Icon name="send" size={16} />
      </button>
    </div>
  )
}

// ------------------------------------------------------------ items
function Item({ cc, it }: { cc: ChatController; it: ChatItem }): ReactElement | null {
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
      return <ToolView cc={cc} it={it} />
  }
}

function ToolView({ cc, it }: { cc: ChatController; it: ToolItem }): ReactElement | null {
  if (it.step !== null) return <ChatCard cc={cc} it={it} step={it.step} />
  if ((it.name === 'ask' || it.name === 'explain' || it.name === 'finish') && it.status === 'streaming') return <CardPreview it={it} />
  if (it.name === 'show_plan') return <ToolLine icon="tree" text={it.status === 'streaming' ? 'Drawing a plan…' : 'Made a plan (see the side panel)'} error={it.status === 'error' ? it.result : null} />
  if (it.name === 'update_plan') return null
  const a = ChatController.preview(it) ?? {}
  const text =
    it.name === 'read_script'
      ? Array.isArray(a.pages) && a.pages.length
        ? `Read the script, pages ${a.pages[0]}${a.pages[1] && a.pages[1] !== a.pages[0] ? `–${a.pages[1]}` : ''}`
        : `Searched the script${a.query ? ` for “${String(a.query)}”` : ''}`
      : it.name === 'course'
        ? 'Looked up the course map'
        : it.name === 'learner'
          ? 'Checked your mind model'
          : it.name === 'update_learner'
            ? 'Updated your mind model'
            : it.name
  return <ToolLine icon={it.name === 'read_script' ? 'book' : it.name === 'update_learner' || it.name === 'learner' ? 'mind' : 'search'} text={text} error={it.status === 'error' ? it.result : null} busy={it.status === 'streaming' || it.status === 'running'} />
}

function ToolLine({ icon, text, error, busy }: { icon: string; text: string; error?: string | null; busy?: boolean }): ReactElement {
  return (
    <div className={`tool-line ${error ? 'error' : ''} ${busy ? 'busy' : ''}`}>
      <Icon name={icon} size={14} />
      <span>{text}</span>
      {error && <span className="tiny">· {error}</span>}
    </div>
  )
}

function CardPreview({ it }: { it: ToolItem }): ReactElement {
  const a = ChatController.preview(it) ?? {}
  const blocks = useMemo(() => (Array.isArray(a.blocks) ? a.blocks.map(normalizeBlock).filter((b): b is Block => !!b) : []), [it.json]) // eslint-disable-line react-hooks/exhaustive-deps
  const prompt = (a.interaction as { prompt?: string } | undefined)?.prompt
  return (
    <div className="card past card-preview" aria-busy="true">
      <div className="card-head">
        <span className="kind">
          <Icon name="spark" size={15} /> {it.name === 'ask' ? 'Writing a question…' : 'Writing…'}
        </span>
      </div>
      {typeof a.title === 'string' && <div className="card-title">{a.title}</div>}
      {blocks.length > 0 && <Blocks blocks={blocks} live />}
      {prompt && (
        <div className="prompt">
          <Markdown text={prompt} />
        </div>
      )}
    </div>
  )
}

function ChatCard({ cc, it, step }: { cc: ChatController; it: ToolItem; step: number }): ReactElement | null {
  const sv = useStore(cc.cards.view, (x) => x)
  const rec = sv.session.steps[step]
  const card = rec?.step.cards[0]
  if (!rec || !card) return null
  const response = rec.responses[0]
  const draft = sv.drafts[draftKey(step, 0)] ?? cc.cards.draft(step, 0)
  // a card is live while the agent waits on it, or after an interruption until the learner answers it
  const open = !response && !draft.done && (it.status === 'running' || (it.status === 'interrupted' && card.interaction?.type !== 'continue'))
  return (
    <div className={`chat-card ${it.status === 'interrupted' && open ? 'interrupted' : ''}`}>
      <CardView
        sc={cc.cards}
        si={step}
        ci={0}
        stepId={rec.id}
        card={card}
        response={response}
        draft={draft}
        current={open}
        compact={false}
        target={null}
        prediction={null}
        finishing={false}
      />
    </div>
  )
}
