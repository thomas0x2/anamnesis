// Exam preparation for the active course: the exam date, the goal (every problem set plus a few mock
// exams before the exam), what is done, and the learner's own solutions checked by the tutor. A checked
// solution updates the mind model like answered practice items do.
import { HELP_LABEL, MAX_WORK_FILE_BYTES, prepProgress, solutionFor, WORK_EXTENSIONS, workItems, workState, type WorkState } from '@shared/exam'
import type { Material, Submission, WorkHelp, WorkTask } from '@shared/types'
import { useMemo, useRef, useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { Modal } from '../components/Modal'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { useNow } from '../lib/hooks'
import { pct, plural, relTime } from '../lib/format'
import { Toggle } from './SettingsView'

const STATUS: Record<WorkState['status'], string> = { todo: 'to do', started: 'started', grading: 'checking…', done: 'done' }
const VERDICT: Record<WorkTask['verdict'], string> = { correct: 'correct', partial: 'partly right', incorrect: 'wrong', missing: 'not attempted' }
const VERDICT_TONE: Record<WorkTask['verdict'], string> = { correct: 'good', partial: 'warn', incorrect: 'bad', missing: 'outline' }

function fmtDate(d: string): string {
  const [y, m, day] = d.split('-').map(Number)
  return new Date(y, m - 1, day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

export function ExamView({ materialId }: { materialId?: string }): ReactElement {
  const app = useApp()
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const { course } = useStore(app.courseView)
  const now = useNow()
  const p = prepProgress(prep, materials, now)
  const { sets, mocks } = workItems(materials)
  const [open, setOpen] = useState<string | null>(materialId ?? null)

  return (
    <div className="page page-narrow" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <div className="sub">
            {course.title}
            {course.term ? ` · ${course.term}` : ''}
          </div>
          <h1 style={{ marginTop: 10 }}>Exam prep</h1>
          <div className="sub" style={{ marginTop: 6 }}>
            {p.daysLeft === null
              ? 'Set the exam date, then work through every problem set and a few mock exams before it. Upload your solutions to have them checked.'
              : p.daysLeft > 0
                ? `${plural(p.daysLeft, 'day')} until the exam on ${fmtDate(prep.examDate ?? '')}.`
                : p.daysLeft === 0
                  ? 'The exam is today. Good luck.'
                  : `The exam was on ${fmtDate(prep.examDate ?? '')}.`}
          </div>
        </div>
      </div>

      <GoalsPanel />

      <div className="exam-progress">
        <div className="exam-goal">
          <div className="eyebrow">problem sets</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span className="big">{p.sets.done}</span>
            <span className="muted small">of {p.sets.total || '–'} done</span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <span style={{ width: p.sets.total ? pct(p.sets.done / p.sets.total) : '0%' }} />
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {p.sets.total > p.sets.added ? `${p.sets.added} published so far` : plural(p.sets.added, 'set') + ' added'}
          </div>
        </div>
        <div className="exam-goal">
          <div className="eyebrow">mock exams</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8, marginTop: 8 }}>
            <span className="big">{p.mocks.done}</span>
            <span className="muted small">of {p.mocks.goal} written</span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            <span style={{ width: p.mocks.goal ? pct(Math.min(1, p.mocks.done / p.mocks.goal)) : '0%' }} />
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            {p.mocks.added < p.mocks.goal ? `${p.mocks.added} available: add old exams on the Materials screen` : plural(p.mocks.added, 'exam') + ' available'}
          </div>
        </div>
        <div className="exam-goal">
          <div className="eyebrow">pace</div>
          <div className="title" style={{ marginTop: 8 }}>
            {p.remaining === 0 && (p.sets.total || p.mocks.goal) ? 'Goal reached' : p.perWeek !== null ? `${p.perWeek < 1 ? p.perWeek.toFixed(1) : Math.ceil(p.perWeek * 10) / 10} a week` : '–'}
          </div>
          <div className="desc" style={{ marginTop: 4 }}>
            {p.remaining === 0
              ? 'Keep reviewing what is due so it stays fresh.'
              : p.perWeek !== null
                ? `${plural(p.remaining, 'problem set or mock exam', 'problem sets and mock exams')} left. Write the mock exams in the last weeks, under exam conditions.`
                : 'Set the exam date to see the pace you need.'}
          </div>
        </div>
      </div>

      <section style={{ marginTop: 34 }}>
        <div className="panel-title">
          <h3>Problem sets</h3>
          <span className="hint">files of kind “problem set” on the Materials screen</span>
        </div>
        {sets.length ? (
          sets.map((m) => <WorkRow key={m.id} m={m} open={open === m.id} onToggle={() => setOpen((o) => (o === m.id ? null : m.id))} />)
        ) : (
          <EmptyHint text="No problem sets yet. Add each one on the Materials screen when it is published (or let the course folder pick it up): files named like “Serie 3” or “Exercise 3” are recognised." />
        )}
      </section>

      <section style={{ marginTop: 30 }}>
        <div className="panel-title">
          <h3>Mock exams</h3>
          <span className="hint">old exams and practice exams (kind “exam”)</span>
        </div>
        {mocks.length ? (
          mocks.map((m) => <WorkRow key={m.id} m={m} open={open === m.id} onToggle={() => setOpen((o) => (o === m.id ? null : m.id))} />)
        ) : (
          <EmptyHint text="No mock exams yet. Add old exams or practice exams as PDFs; write them timed and without notes, then upload your answers." />
        )}
      </section>
    </div>
  )
}

function EmptyHint({ text }: { text: string }): ReactElement {
  const app = useApp()
  return (
    <div className="empty row between" style={{ gap: 14, textAlign: 'left' }}>
      <span>{text}</span>
      <button className="btn sm" onClick={() => app.go({ name: 'materials' })}>
        Materials <Icon name="chev-right" size={13} />
      </button>
    </div>
  )
}

function GoalsPanel(): ReactElement {
  const app = useApp()
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const added = workItems(materials).sets.length
  const [sets, setSets] = useState(prep.problemSets ? String(prep.problemSets) : '')
  const num = (v: string): number | null => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null)
  return (
    <div className="panel exam-goals">
      <label className="stack" style={{ gap: 4 }}>
        <span className="small">Exam date</span>
        <input className="input" type="date" value={prep.examDate ?? ''} onChange={(e) => void app.setExamGoals({ examDate: e.target.value || null })} aria-label="Exam date" />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="small">Problem sets in the course</span>
        <input
          className="input"
          inputMode="numeric"
          placeholder={added ? `${added} so far` : 'e.g. 13'}
          value={sets}
          onChange={(e) => setSets(e.target.value)}
          onBlur={() => void app.setExamGoals({ problemSets: num(sets) })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Number of problem sets"
        />
        <span className="tiny muted">They are published one by one; the goal counts them all.</span>
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="small">Mock exams to write</span>
        <span className="row" style={{ gap: 6 }}>
          <button className="btn sm icon ghost" onClick={() => void app.setExamGoals({ mockExams: Math.max(0, prep.mockExams - 1) })} aria-label="One fewer">
            <Icon name="minus" size={14} />
          </button>
          <span className="exam-count">{prep.mockExams}</span>
          <button className="btn sm icon ghost" onClick={() => void app.setExamGoals({ mockExams: Math.min(20, prep.mockExams + 1) })} aria-label="One more">
            <Icon name="plus" size={14} />
          </button>
        </span>
      </label>
    </div>
  )
}

function WorkRow({ m, open, onToggle }: { m: Material; open: boolean; onToggle: () => void }): ReactElement {
  const app = useApp()
  const prep = useStore(app.exam)
  const materials = useStore(app.materials)
  const ws = workState(prep, m.id)
  const [submitting, setSubmitting] = useState(false)
  const span = app.script.span(m)
  const sol = solutionFor(m, materials)
  const graded = ws.submissions.find((s) => s.status === 'graded')
  return (
    <div className={`work-row ${open ? 'open' : ''}`}>
      <div className="work-head">
        <button className="work-title" onClick={onToggle} aria-expanded={open}>
          <Icon name={open ? 'chev-down' : 'chev-right'} size={13} />
          <span>{m.title}</span>
          {sol && <span className="tiny muted">with solutions</span>}
        </button>
        <span className={`work-status ${ws.status}`}>
          {STATUS[ws.status]}
          {ws.best !== null ? ` · ${pct(ws.best)}` : ''}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {span.length > 0 && (
            <button className="btn sm ghost" onClick={() => app.go({ name: 'script', page: span[0] })} title="Open in the reader">
              <Icon name="eye" size={14} /> Open
            </button>
          )}
          {ws.status !== 'done' && ws.status !== 'grading' && (
            <button className="btn sm ghost" onClick={() => void app.setWorkStatus(m.id, ws.status === 'started' ? 'done' : 'started')} title={ws.status === 'started' ? 'Mark as done without checking a solution' : 'Mark as started'}>
              {ws.status === 'started' ? 'Mark done' : 'Started'}
            </button>
          )}
          {ws.status === 'done' && !graded && (
            <button className="btn sm ghost" onClick={() => void app.setWorkStatus(m.id, 'todo')} title="Mark as not done">
              Undo
            </button>
          )}
          <button className={`btn sm ${graded ? '' : 'primary'}`} disabled={ws.status === 'grading'} onClick={() => setSubmitting(true)}>
            <Icon name="check" size={14} /> {graded ? 'Check again' : 'Check my solution'}
          </button>
        </div>
      </div>
      {open && (
        <div className="work-body">
          {ws.submissions.length === 0 ? (
            <div className="small muted" style={{ padding: '6px 0 4px' }}>
              {m.kind === 'exam'
                ? 'Write it timed and without notes, then upload a scan or photos of your answers. Each task is graded and the concepts it tests are updated in your mind model.'
                : 'Solve it, then upload a scan or photos of your solution (handwriting is fine) or type it in. Each task is graded and the concepts it tests are updated in your mind model.'}
            </div>
          ) : (
            ws.submissions.map((s) => <SubmissionView key={s.id} s={s} m={m} />)
          )}
        </div>
      )}
      {submitting && (
        <SubmitDialog
          m={m}
          onClose={() => setSubmitting(false)}
          onSent={() => {
            setSubmitting(false)
            if (!open) onToggle()
          }}
        />
      )}
    </div>
  )
}

function SubmissionView({ s, m }: { s: Submission; m: Material }): ReactElement {
  const app = useApp()
  const now = useNow()
  const [confirm, setConfirm] = useState(false)
  const weak = useMemo(() => [...new Set(s.tasks.filter((t) => t.verdict !== 'missing' && t.score < 0.7).flatMap((t) => t.conceptIds.slice(0, 1)))].filter((id) => app.graph.get(id)), [app, s])
  const meta = [
    relTime(s.at, now),
    HELP_LABEL[s.help].toLowerCase(),
    m.kind === 'exam' && s.examConditions ? 'exam conditions' : null,
    s.minutes ? `${s.minutes} min` : null,
    s.files.length ? plural(s.files.length, 'file') : null,
    s.text ? 'typed answers' : null
  ].filter(Boolean)
  return (
    <div className="submission">
      <div className="row between" style={{ gap: 10 }}>
        <div className="tiny muted">{meta.join(' · ')}</div>
        <div className="row" style={{ gap: 6 }}>
          {s.status !== 'grading' && (
            <button className="btn sm ghost" onClick={() => void app.regradeWork(s.id)} title="Have the same files checked again">
              <Icon name="refresh" size={13} /> Re-check
            </button>
          )}
          {confirm ? (
            <button className="btn sm danger" onClick={() => void app.deleteSubmission(s.id)} onBlur={() => setConfirm(false)} autoFocus>
              Delete?
            </button>
          ) : (
            <button className="btn sm icon ghost" onClick={() => setConfirm(true)} title="Delete this submission (the mind model keeps what it learned)">
              <Icon name="trash" size={13} />
            </button>
          )}
        </div>
      </div>
      {s.status === 'grading' && (
        <div aria-live="polite" style={{ marginTop: 10 }}>
          <div className="small">Claude is reading your solution and grading each task…</div>
          <div className="bar" style={{ marginTop: 8 }}>
            <span className="pulse" style={{ width: '35%' }} />
          </div>
          <div className="tiny muted" style={{ marginTop: 6 }}>This takes a minute or two. You can keep studying; the result appears here and in your mind model.</div>
        </div>
      )}
      {s.status === 'error' && (
        <div className="small" style={{ color: 'var(--bad)', marginTop: 10 }}>
          {s.error ?? 'The check failed.'}
        </div>
      )}
      {s.status === 'graded' && (
        <>
          <div className="row" style={{ gap: 12, alignItems: 'baseline', marginTop: 10 }}>
            <span className="big">{pct(s.score)}</span>
            <span className="small muted">{plural(s.tasks.filter((t) => t.verdict === 'correct').length, 'task')} of {s.tasks.length} fully right</span>
          </div>
          {s.summary && <Markdown text={s.summary} className="small" />}
          <div className="work-tasks">
            {s.tasks.map((t, i) => (
              <div key={i} className="work-task">
                <div className="row between" style={{ gap: 10 }}>
                  <span className="small" style={{ fontWeight: 600 }}>
                    {t.label}
                  </span>
                  <span className={`chip ${VERDICT_TONE[t.verdict]}`}>
                    {VERDICT[t.verdict]}
                    {t.verdict === 'partial' ? ` · ${pct(t.score)}` : ''}
                  </span>
                </div>
                {t.feedback && <Markdown text={t.feedback} className="small" />}
                {t.errors.length > 0 && (
                  <ul className="small work-errors">
                    {t.errors.map((e, k) => (
                      <li key={k}>
                        <Markdown text={e} inline />
                      </li>
                    ))}
                  </ul>
                )}
                {t.conceptIds.length > 0 && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {t.conceptIds.map((id) => (
                      <button key={id} className="chip outline" onClick={() => app.go({ name: 'mind', conceptId: id })} title="Open in the mind model">
                        {app.graph.title(id)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {(s.strengths.length > 0 || s.next.length > 0) && (
            <div className="grid-2" style={{ gap: 18, marginTop: 14 }}>
              {s.strengths.length > 0 && (
                <div>
                  <div className="eyebrow">what went well</div>
                  <ul className="small">
                    {s.strengths.map((x, k) => (
                      <li key={k}>
                        <Markdown text={x} inline />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {s.next.length > 0 && (
                <div>
                  <div className="eyebrow">next</div>
                  <ul className="small">
                    {s.next.map((x, k) => (
                      <li key={k}>
                        <Markdown text={x} inline />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {weak.length > 0 && (
            <button className="btn primary" style={{ marginTop: 14 }} onClick={() => void app.startPractice(weak)}>
              Practise what went wrong ({weak.length}) <Icon name="chev-right" size={14} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

const ACCEPT = WORK_EXTENSIONS.map((e) => `.${e}`).join(',')

function SubmitDialog({ m, onClose, onSent }: { m: Material; onClose: () => void; onSent: () => void }): ReactElement {
  const app = useApp()
  const exam = m.kind === 'exam'
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [help, setHelp] = useState<WorkHelp>('alone')
  const [conditions, setConditions] = useState(exam)
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const add = (list: FileList | null): void => {
    if (!list) return
    const ok = [...list].filter((f) => WORK_EXTENSIONS.includes((/\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? '').toLowerCase()) && f.size <= MAX_WORK_FILE_BYTES)
    if (ok.length < list.length) app.toast({ kind: 'error', text: 'Some files were left out: use PDF, PNG, JPG or text files up to 40 MB (export iPhone photos as JPG).' })
    setFiles((xs) => [...xs, ...ok.filter((f) => !xs.some((x) => x.name === f.name && x.size === f.size))])
  }
  const send = async (): Promise<void> => {
    if (!files.length && !text.trim()) return
    setBusy(true)
    const payload = await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
    const id = await app.submitWork({ materialId: m.id, files: payload, text: text.trim() || null, help, examConditions: conditions, minutes: Number(minutes) || null })
    setBusy(false)
    if (id) onSent()
  }
  return (
    <Modal onClose={onClose} width={620} label={`Check my solution: ${m.title}`}>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <div className="row between">
          <h2>{m.title}</h2>
          <button type="button" className="btn icon sm ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Upload your {exam ? 'answers' : 'solution'}: a scan, photos of the pages or a PDF from your tablet. Handwriting is fine. Claude reads every page, grades each task against the problem statement{exam ? '' : ' (and the official solution, if the course has one)'}, and updates the concepts it tests in your mind model.
        </p>
        <div
          className={`drop ${drag ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            add(e.dataTransfer.files)
          }}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <Icon name="plus" size={16} />
          <span className="small">Drop files here or choose them</span>
          <span className="tiny muted">PDF, PNG, JPG or text · several files are fine</span>
          <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => add(e.target.files)} aria-label="Solution files" />
        </div>
        {files.length > 0 && (
          <div className="stack" style={{ gap: 2 }}>
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="row between mat-file">
                <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.name} <span className="tiny muted">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                </span>
                <button type="button" className="btn sm icon ghost" onClick={() => setFiles((xs) => xs.filter((_, k) => k !== i))} aria-label={`Remove ${f.name}`}>
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span className="small">Or type your answers</span>
          <textarea className="textarea" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Task 1: … (LaTeX works: $x^2$)" />
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="small">How did you work?</span>
          <span className="seg">
            {(Object.keys(HELP_LABEL) as WorkHelp[]).map((h) => (
              <button type="button" key={h} className={help === h ? 'on' : ''} onClick={() => setHelp(h)}>
                {HELP_LABEL[h]}
              </button>
            ))}
          </span>
          <span className="tiny muted">Work done with help counts less in your mind model, so be honest: it keeps the tutor’s picture of you accurate.</span>
        </div>
        <div className="row between" style={{ gap: 12 }}>
          {exam ? (
            <span className="row" style={{ gap: 10 }}>
              <Toggle on={conditions} onChange={setConditions} label="Under exam conditions" />
              <span className="small">Under exam conditions (timed, no notes)</span>
            </span>
          ) : (
            <span />
          )}
          <label className="row" style={{ gap: 8 }}>
            <span className="small muted">Time taken</span>
            <input className="input" style={{ width: 80 }} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))} placeholder="min" aria-label="Minutes taken" />
          </label>
        </div>
        <div className="row between" style={{ marginTop: 4 }}>
          <span />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy || (!files.length && !text.trim())}>
              {busy ? 'Uploading…' : 'Check my solution'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
