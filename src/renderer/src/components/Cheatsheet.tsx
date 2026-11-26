// The cheat sheet: the exam's rules (allowed? how many pages? handwritten?), the entries on it, the
// tutor's suggestions waiting for a decision, and the small card a suggestion shows in the session
// stream. The learner decides every entry; the tutor only proposes.
import { CHEAT_KINDS, CHEAT_KIND_LABEL, cheatCapacity, cheatsheetMarkdown, type CheatAllowed, type CheatItem, type CheatKind } from '@shared/cheatsheet'
import { useEffect, useState, type ReactElement } from 'react'
import { useApp } from '../engine/app'
import type { ToolItem } from '../engine/chat'
import { useStore } from '../engine/store'
import { plural } from '../lib/format'
import { Toggle } from '../views/SettingsView'
import { Icon } from './Icon'
import { Markdown } from './Markdown'

const ALLOWED: { v: CheatAllowed; label: string }[] = [
  { v: 'unknown', label: 'Not known yet' },
  { v: 'yes', label: 'Allowed' },
  { v: 'no', label: 'Not allowed' }
]

// ------------------------------------------------------------ in the session stream
/** The entries one suggest_cheatsheet call proposed, each with Add, Edit and Drop. */
export function CheatSuggestCard({ it }: { it: ToolItem }): ReactElement | null {
  const app = useApp()
  const sheet = useStore(app.cheatsheet)
  const ids = Array.isArray(it.args?.itemIds) ? (it.args.itemIds as string[]) : []
  const items = ids.map((id) => sheet.items.find((x) => x.id === id)).filter((x): x is CheatItem => !!x)
  if (it.status === 'streaming' || it.status === 'running') return <div className="tool-line busy"><Icon name="list" size={14} /><span>Noting a cheat sheet idea</span></div>
  if (it.status === 'error') return null
  if (!items.length) return <div className="tool-line"><Icon name="list" size={14} /><span>Cheat sheet: nothing new to add</span></div>
  return (
    <div className="cheat-suggest" aria-label="Cheat sheet suggestion">
      <div className="eyebrow row" style={{ gap: 6 }}>
        <Icon name="list" size={13} /> For your cheat sheet?
      </div>
      {items.map((x) => (
        <CheatRow key={x.id} x={x} compact />
      ))}
    </div>
  )
}

// ------------------------------------------------------------ one entry
function CheatRow({ x, compact, first, last }: { x: CheatItem; compact?: boolean; first?: boolean; last?: boolean }): ReactElement {
  const app = useApp()
  const [editing, setEditing] = useState(false)
  if (editing) return <CheatEditor init={x} onCancel={() => setEditing(false)} onSave={(kind, text) => void app.updateCheatItem(x.id, { kind, text, ...(x.status === 'suggested' ? { status: 'accepted' as const } : {}) }).then(() => setEditing(false))} saveLabel={x.status === 'suggested' ? 'Add to sheet' : 'Save'} />
  return (
    <div className={`cheat-row ${x.status}`}>
      <span className="chip outline cheat-kind">{CHEAT_KIND_LABEL[x.kind]}</span>
      <div className="cheat-body">
        <Markdown text={x.text} />
        {x.why && <div className="tiny muted">{x.why}</div>}
      </div>
      <span className="row cheat-actions" style={{ gap: 4 }}>
        {x.status === 'suggested' ? (
          <>
            <button className="btn sm primary" onClick={() => void app.updateCheatItem(x.id, { status: 'accepted' })} title="Put it on the cheat sheet">
              <Icon name="plus" size={13} /> Add
            </button>
            <button className="btn sm icon ghost" onClick={() => setEditing(true)} title="Edit, then add" aria-label="Edit">
              <Icon name="edit" size={14} />
            </button>
            <button className="btn sm ghost" onClick={() => void app.updateCheatItem(x.id, { status: 'dismissed' })} title="Not on my sheet (the tutor will not suggest it again)">
              Not needed
            </button>
          </>
        ) : x.status === 'accepted' ? (
          compact ? (
            <span className="chip good">
              <Icon name="check" size={12} /> on the sheet
            </span>
          ) : (
            <>
              <button className="btn sm icon ghost" disabled={first} onClick={() => void app.moveCheatItem(x.id, -1)} aria-label="Move up" title="Move up">
                <Icon name="chev-up" size={14} />
              </button>
              <button className="btn sm icon ghost" disabled={last} onClick={() => void app.moveCheatItem(x.id, 1)} aria-label="Move down" title="Move down">
                <Icon name="chev-down" size={14} />
              </button>
              <button className="btn sm icon ghost" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
                <Icon name="edit" size={14} />
              </button>
              <button className="btn sm icon ghost" onClick={() => void app.updateCheatItem(x.id, { status: 'dismissed' })} aria-label="Take off the sheet" title="Take off the sheet">
                <Icon name="x" size={14} />
              </button>
            </>
          )
        ) : compact ? (
          <span className="chip outline">not needed</span>
        ) : (
          <>
            <button className="btn sm ghost" onClick={() => void app.updateCheatItem(x.id, { status: 'accepted' })}>Put back</button>
            <button className="btn sm icon ghost" onClick={() => void app.removeCheatItem(x.id)} aria-label="Delete" title="Delete">
              <Icon name="trash" size={14} />
            </button>
          </>
        )}
      </span>
    </div>
  )
}

function CheatEditor({ init, onSave, onCancel, saveLabel }: { init?: Pick<CheatItem, 'kind' | 'text'>; onSave: (kind: CheatKind, text: string) => void; onCancel?: () => void; saveLabel: string }): ReactElement {
  const [kind, setKind] = useState<CheatKind>(init?.kind ?? 'formula')
  const [text, setText] = useState(init?.text ?? '')
  useEffect(() => setText(init?.text ?? ''), [init?.text])
  const save = (): void => {
    if (!text.trim()) return
    onSave(kind, text.trim())
    if (!init) setText('')
  }
  return (
    <div className="cheat-editor">
      <div className="row" style={{ gap: 8 }}>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value as CheatKind)} aria-label="Kind of entry">
          {CHEAT_KINDS.map((k) => (
            <option key={k} value={k}>
              {CHEAT_KIND_LABEL[k]}
            </option>
          ))}
        </select>
        <span className="tiny muted">Markdown and LaTeX ($x^2$) work.</span>
      </div>
      <textarea
        className="textarea"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
          if (e.key === 'Escape' && onCancel) onCancel()
        }}
        placeholder="e.g. Chebyshev nodes: $x_k = \cos\frac{(2k+1)\pi}{2(n+1)}$, $k = 0,\dots,n$"
        aria-label="Entry"
      />
      {text.trim() && (
        <div className="cheat-preview">
          <Markdown text={text} />
        </div>
      )}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button className="btn sm ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="btn sm primary" onClick={save} disabled={!text.trim()}>
          {saveLabel}
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------ on the exam prep screen
export function CheatsheetSection(): ReactElement {
  const app = useApp()
  const sheet = useStore(app.cheatsheet)
  const { course } = useStore(app.courseView)
  const { rules } = sheet
  const [pages, setPages] = useState(rules.pages ? String(rules.pages) : '')
  const [note, setNote] = useState(rules.note)
  const [adding, setAdding] = useState(false)
  const [showDropped, setShowDropped] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => setPages(rules.pages ? String(rules.pages) : ''), [rules.pages])
  useEffect(() => setNote(rules.note), [rules.note])
  const suggested = sheet.items.filter((x) => x.status === 'suggested')
  const accepted = sheet.items.filter((x) => x.status === 'accepted')
  const dropped = sheet.items.filter((x) => x.status === 'dismissed')
  const cap = cheatCapacity(rules)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cheatsheetMarkdown(sheet, course.title))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      app.toast({ kind: 'error', text: 'Could not copy to the clipboard.' })
    }
  }

  return (
    <section style={{ marginTop: 30 }} aria-label="Cheat sheet">
      <div className="panel-title">
        <h3>Cheat sheet</h3>
        <span className="hint">the tutor suggests entries while you learn; you decide</span>
      </div>
      <div className="panel cheat-rules">
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">Does the exam allow one?</span>
          <span className="seg" role="group" aria-label="Cheat sheet allowed">
            {ALLOWED.map((a) => (
              <button type="button" key={a.v} className={rules.allowed === a.v ? 'on' : ''} onClick={() => void app.setCheatRules({ allowed: a.v })}>
                {a.label}
              </button>
            ))}
          </span>
        </div>
        {rules.allowed === 'yes' && (
          <>
            <label className="stack" style={{ gap: 4 }}>
              <span className="small">Page sides</span>
              <input
                className="input"
                inputMode="numeric"
                style={{ width: 110 }}
                placeholder="e.g. 2"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
                onBlur={() => void app.setCheatRules({ pages: /^\d+$/.test(pages.trim()) && Number(pages) > 0 ? Number(pages) : null })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Page sides allowed"
              />
              <span className="tiny muted">One A4 sheet, both sides: 2</span>
            </label>
            <div className="stack" style={{ gap: 6 }}>
              <span className="small">Handwritten</span>
              <Toggle on={rules.handwritten} onChange={(v) => void app.setCheatRules({ handwritten: v })} label="Handwritten" />
            </div>
            <label className="stack" style={{ gap: 4, flex: 1, minWidth: 200 }}>
              <span className="small">Other rules</span>
              <input
                className="input"
                placeholder="e.g. A4, no printed solutions"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => void app.setCheatRules({ note })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                aria-label="Other cheat sheet rules"
              />
            </label>
          </>
        )}
      </div>

      {rules.allowed !== 'yes' ? (
        <div className="empty" style={{ textAlign: 'left' }}>
          {rules.allowed === 'no'
            ? 'No cheat sheet in this exam: everything has to be in your head, so the tutor keeps it all in spaced review.'
            : 'Check the course page or the exam rules. When a cheat sheet is allowed, the tutor suggests what is worth putting on it (exact formulas, conditions, pitfalls) and what you should understand instead.'}
        </div>
      ) : (
        <>
          {suggested.length > 0 && (
            <div className="cheat-group">
              <div className="eyebrow">suggested by the tutor · {suggested.length}</div>
              {suggested.map((x) => (
                <CheatRow key={x.id} x={x} />
              ))}
            </div>
          )}
          <div className="cheat-group">
            <div className="row between">
              <div className="eyebrow">
                on the sheet · {accepted.length}
                {cap ? ` of about ${cap}` : ''}
              </div>
              <span className="row" style={{ gap: 6 }}>
                <button className="btn sm ghost" onClick={() => setAdding((a) => !a)}>
                  <Icon name="plus" size={13} /> Entry
                </button>
                <button className="btn sm ghost" onClick={() => void copy()} disabled={!accepted.length} title="Copy the sheet as Markdown (with LaTeX)">
                  <Icon name={copied ? 'check' : 'copy'} size={13} /> {copied ? 'Copied' : 'Copy'}
                </button>
              </span>
            </div>
            {cap !== null && accepted.length > cap && <div className="tiny" style={{ color: 'var(--warn)' }}>Probably more than fits: drop what you know cold.</div>}
            {adding && <CheatEditor saveLabel="Add to sheet" onCancel={() => setAdding(false)} onSave={(kind, text) => void app.addCheatItem({ kind, text })} />}
            {accepted.length ? (
              CHEAT_KINDS.map((k) => {
                const xs = accepted.filter((x) => x.kind === k)
                return xs.map((x, i) => <CheatRow key={x.id} x={x} first={i === 0} last={i === xs.length - 1} />)
              })
            ) : (
              <div className="empty" style={{ textAlign: 'left' }}>Nothing on it yet. Start a learning or practice session: the tutor suggests entries as you go, or add your own.</div>
            )}
          </div>
          {dropped.length > 0 && (
            <div className="cheat-group">
              <button className="btn sm ghost" onClick={() => setShowDropped((s) => !s)}>
                <Icon name={showDropped ? 'chev-up' : 'chev-down'} size={13} /> {plural(dropped.length, 'entry', 'entries')} not needed
              </button>
              {showDropped && dropped.map((x) => <CheatRow key={x.id} x={x} />)}
            </div>
          )}
        </>
      )}
    </section>
  )
}
