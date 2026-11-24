// The Tutor page (start an open chat, reopen earlier sessions) and the pieces the session screen uses
// for agent sessions: the composer with local voice dictation, the agent status and look-up lines.
import type { AgentMode } from '@shared/agentTools'
import { normalizeBlock } from '@shared/normalize'
import type { Block } from '@shared/types'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Blocks } from '../components/Blocks'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { VoiceButton } from '../components/Voice'
import { useApp } from '../engine/app'
import { ChatController, type ChatView as View, type ToolItem } from '../engine/chat'
import { useStore } from '../engine/store'

const MODE_LABEL: Record<AgentMode, string> = { learn: 'Learn', practice: 'Practice', review: 'Review', open: 'Chat' }

export function ChatScreen(): ReactElement {
  return <ChatStart />
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

// ------------------------------------------------------------ pieces of an agent session
export function AgentStatus({ v }: { v: View }): ReactElement | null {
  const label = { off: 'Paused', starting: 'Starting', thinking: 'Thinking', writing: 'Writing', waiting: 'Your turn', idle: 'Your turn' }[v.agent]
  return (
    <span className={`agent-status ${v.agent}`} title={v.agent === 'off' ? 'The tutor resumes when you write' : undefined}>
      <span className="dot" />
      {label}
    </span>
  )
}

export function Composer({ value, onChange, onSend, placeholder, autoFocus }: { value: string; onChange: (t: string) => void; onSend: () => void; placeholder: string; autoFocus?: boolean }): ReactElement {
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

/** A look-up the agent made (script, course map, mind model): one quiet line in the stream. */
export function ToolView({ it }: { it: ToolItem }): ReactElement | null {
  if (it.step !== null) return null
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

export function CardPreview({ it }: { it: ToolItem }): ReactElement {
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
      {typeof a.title === 'string' && <div className="card-title"><Markdown text={a.title} inline /></div>}
      {blocks.length > 0 && <Blocks blocks={blocks} live />}
      {prompt && (
        <div className="prompt">
          <Markdown text={prompt} />
        </div>
      )}
    </div>
  )
}
