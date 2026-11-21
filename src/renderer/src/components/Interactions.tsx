// Answer inputs for the interaction types. Each reports its current answer (or null) upward.
import { blankMatches } from '@shared/grading'
import { evalNumber } from '@shared/mathx'
import type { Interaction } from '@shared/types'
import { hashString, shuffle } from '@shared/util'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { AnswerPayload } from '../engine/session'
import { fmtNum } from './Chart'
import { Icon } from './Icon'
import { Markdown } from './Markdown'
import { VoiceButton } from './Voice'

export interface InputProps {
  it: Interaction
  disabled: boolean
  /** final state reached: show correctness marks */
  final: boolean
  onChange: (p: AnswerPayload | null) => void
  onSubmit?: () => void
  initial?: unknown
}

// ------------------------------------------------------------ multiple choice
export function McqInput({ it, disabled, final, onChange, tried, initial }: InputProps & { tried: string[] }): ReactElement {
  const init = (initial as { kind?: string; selected?: string[] } | undefined)?.kind === 'mcq' ? ((initial as { selected: string[] }).selected ?? []) : []
  const [sel, setSel] = useState<string[]>(init)
  const opts = it.options ?? []
  useEffect(() => onChange(sel.length ? { kind: 'mcq', selected: sel } : null), [sel]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string): void => {
    if (disabled) return
    setSel((s) => (it.multi ? (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]) : [id]))
  }
  // keyboard: a, b, c ... pick an option
  useEffect(() => {
    if (disabled) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      const o = opts.find((x) => x.id.toLowerCase() === k)
      if (o) {
        e.preventDefault()
        toggle(o.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  return (
    <div className="options" role={it.multi ? 'group' : 'radiogroup'}>
      {it.multi && <div className="tiny muted">(M) Select all that apply.</div>}
      {opts.map((o) => {
        const selected = sel.includes(o.id)
        const wasTried = tried.includes(o.id)
        let cls = ''
        if (final) cls = o.correct ? 'correct' : selected ? 'wrong' : 'dim'
        else if (wasTried && !selected) cls = 'wrong dim'
        else if (selected) cls = 'selected'
        const showFb = final ? (selected || o.correct) && !!o.feedback : wasTried && !!o.feedback && !selected
        return (
          <button
            key={o.id}
            className={`option ${it.multi ? 'multi' : ''} ${cls}`}
            disabled={disabled}
            onClick={() => toggle(o.id)}
            role={it.multi ? 'checkbox' : 'radio'}
            aria-checked={selected}
          >
            <span className="letter">{final && o.correct ? <Icon name="check" size={14} /> : final && selected ? <Icon name="x" size={14} /> : o.id.toUpperCase()}</span>
            <span className="option-body">
              <Markdown text={o.md} />
              {showFb && (
                <div className="option-feedback">
                  <Markdown text={o.feedback} />
                </div>
              )}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ------------------------------------------------------------ numeric
export function NumericInput({ it, disabled, final, onChange, onSubmit, initial }: InputProps): ReactElement {
  const init = (initial as { kind?: string; value?: string } | undefined)?.kind === 'numeric' ? ((initial as { value: string }).value ?? '') : ''
  const [v, setV] = useState(init)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!disabled && !final) ref.current?.focus({ preventScroll: true })
  }, [disabled, final])
  const val = v.trim() ? evalNumber(v) : null
  useEffect(() => onChange(v.trim() ? { kind: 'numeric', value: v.trim() } : null), [v]) // eslint-disable-line react-hooks/exhaustive-deps
  const expected = final && it.answer ? evalNumber(it.answer.value) : null
  return (
    <div>
      <div className="answer-row">
        <input
          ref={ref}
          className="input numeric-input"
          value={v}
          disabled={disabled}
          placeholder="number or expression, e.g. 1/3 or 2^-10"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSubmit?.()
            }
          }}
          spellCheck={false}
          aria-label="your answer"
        />
        {v.trim() && !final && <span className="numeric-preview">{val === null ? 'not a number yet' : v.trim() === String(val) ? '' : `= ${fmtNum(val)}`}</span>}
        {final && expected !== null && <span className="numeric-preview">answer: {it.answer!.value}{String(expected) !== it.answer!.value ? ` = ${fmtNum(expected)}` : ''}</span>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ free text (with voice)
export function FreeInput({ it, disabled, onChange, onSubmit, initial, placeholder }: InputProps & { placeholder?: string }): ReactElement {
  const init = (initial as { kind?: string; text?: string } | undefined)?.kind === 'free' ? ((initial as { text: string }).text ?? '') : ''
  const [text, setText] = useState(init)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  useEffect(() => onChange(text.trim() ? { kind: 'free', text } : null), [text]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!disabled) ref.current?.focus({ preventScroll: true })
  }, [disabled])
  return (
    <div className="free-wrap">
      <textarea
        ref={ref}
        className="textarea"
        value={text}
        disabled={disabled}
        placeholder={placeholder ?? 'Type your answer, or press the mic and say it.'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            onSubmit?.()
          }
        }}
        rows={it.allowVoice ? 4 : 3}
      />
      {!disabled && (
        <div className="mic-slot">
          <VoiceButton onText={(t) => setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t))} />
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ ordering
export function OrderInput({ it, disabled, final, onChange, initial }: InputProps): ReactElement {
  const correct = it.items ?? []
  const start = useMemo(() => {
    const init = (initial as { kind?: string; order?: string[] } | undefined)?.kind === 'order' ? (initial as { order: string[] }).order : null
    if (init && init.length === correct.length) return init
    let s = shuffle(correct, hashString(it.prompt))
    if (s.every((x, i) => x === correct[i]) && s.length > 1) s = [...s.slice(1), s[0]]
    return s
  }, [it.prompt]) // eslint-disable-line react-hooks/exhaustive-deps
  const [order, setOrder] = useState<string[]>(start)
  const [dragI, setDragI] = useState<number | null>(null)
  const [overI, setOverI] = useState<number | null>(null)
  useEffect(() => onChange({ kind: 'order', order }), [order]) // eslint-disable-line react-hooks/exhaustive-deps
  const move = (from: number, to: number): void => {
    if (disabled || to < 0 || to >= order.length || from === to) return
    setOrder((o) => {
      const n = o.slice()
      const [x] = n.splice(from, 1)
      n.splice(to, 0, x)
      return n
    })
  }
  return (
    <div>
      <div className="tiny muted" style={{ marginBottom: 6 }}>
        Drag to reorder, or use the arrows.
      </div>
      <ol className="order-list">
        {order.map((item, i) => (
          <li
            key={item}
            className={`order-item ${dragI === i ? 'dragging' : ''} ${overI === i && dragI !== i ? 'over' : ''} ${final ? (correct[i] === item ? 'correct' : 'wrong') : ''}`}
            draggable={!disabled}
            onDragStart={(e) => {
              setDragI(i)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setOverI(i)
            }}
            onDragEnd={() => {
              setDragI(null)
              setOverI(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragI !== null) move(dragI, i)
              setDragI(null)
              setOverI(null)
            }}
          >
            <span className="grip">
              <Icon name="grip" size={16} />
            </span>
            <span className="pos">{i + 1}</span>
            <Markdown text={item} />
            {!disabled && (
              <span className="row" style={{ gap: 2 }}>
                <button className="btn icon sm ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="move up">
                  <Icon name="chev-up" size={15} />
                </button>
                <button className="btn icon sm ghost" onClick={() => move(i, i + 1)} disabled={i === order.length - 1} aria-label="move down">
                  <Icon name="chev-down" size={15} />
                </button>
              </span>
            )}
            {final && <Icon name={correct[i] === item ? 'check' : 'x'} size={16} style={{ color: correct[i] === item ? 'var(--good)' : 'var(--bad)' }} />}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ------------------------------------------------------------ fill in the blanks
export function FillInput({ it, disabled, final, onChange, onSubmit, initial }: InputProps): ReactElement {
  const template = it.template ?? ''
  const blanks = it.blanks ?? []
  const init = (initial as { kind?: string; values?: Record<string, string> } | undefined)?.kind === 'fill' ? (initial as { values: Record<string, string> }).values : {}
  const [vals, setVals] = useState<Record<string, string>>(init ?? {})
  useEffect(() => onChange(Object.values(vals).some((v) => v.trim()) ? { kind: 'fill', values: vals } : null), [vals]) // eslint-disable-line react-hooks/exhaustive-deps
  const parts = template.split(/\[\[([^\]]+)\]\]/g)
  const isCode = /\n/.test(template) && /(=|\(|def |import |np\.|return|for )/.test(template)
  const width = (id: string): string => {
    const b = blanks.find((x) => x.id === id)
    const len = Math.max(4, ...(b?.accepted ?? []).map((a) => a.length))
    return `${Math.min(28, len + 3)}ch`
  }
  const first = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (!disabled && !final) first.current?.focus({ preventScroll: true })
  }, [disabled, final])
  let seenFirst = false
  return (
    <div className={`fill-template ${isCode ? 'code' : ''}`}>
      {parts.map((p, i) => {
        if (i % 2 === 0) return isCode ? <span key={i}>{p}</span> : <Markdown key={i} text={p} inline />
        const id = p.trim()
        const b = blanks.find((x) => x.id === id)
        const ok = final && b ? blankMatches(b.accepted, vals[id] ?? '') : null
        const isFirst = !seenFirst
        seenFirst = true
        return (
          <span key={i} style={{ whiteSpace: 'nowrap' }}>
            <input
              ref={isFirst ? first : undefined}
              className={`blank ${ok === true ? 'correct' : ok === false ? 'wrong' : ''}`}
              style={{ width: width(id) }}
              value={vals[id] ?? ''}
              disabled={disabled}
              aria-label={`blank ${id}`}
              spellCheck={false}
              onChange={(e) => setVals((v) => ({ ...v, [id]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSubmit?.()
                }
              }}
            />
            {final && ok === false && b && <span className="tiny" style={{ color: 'var(--good)', marginRight: 4 }}>{b.accepted[0]}</span>}
          </span>
        )
      })}
    </div>
  )
}
