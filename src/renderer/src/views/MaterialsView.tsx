// A course's materials: the PDFs it is built from (script, slides, problem sets), the folder it
// watches for new ones, and what each PDF added to the course map. New files are read and mapped
// one after another, so the map grows as the semester goes on.
import { KIND_LABEL, LANGUAGES } from '@shared/courseMap'
import { MATERIAL_KINDS, type CourseMeta, type FolderFile, type Material, type MaterialKind } from '@shared/types'
import { useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct, plural, relTime } from '../lib/format'
import { Toggle } from './SettingsView'

const STATUS_TEXT: Record<Material['status'], string> = {
  queued: 'waiting',
  indexing: 'reading',
  mapping: 'mapping',
  mapped: 'mapped',
  error: 'failed',
  skipped: 'not mapped'
}

export function MaterialsView(): ReactElement {
  const app = useApp()
  const items = useStore(app.materials)
  const pending = useStore(app.pending)
  const job = useStore(app.job)
  const { course } = useStore(app.courseView)
  const [editing, setEditing] = useState(false)
  const desktop = app.backend.kind === 'electron'
  const meta = app.meta
  const sorted = [...items].sort((a, b) => MATERIAL_KINDS.indexOf(a.kind) - MATERIAL_KINDS.indexOf(b.kind) || a.fileName.localeCompare(b.fileName, undefined, { numeric: true }))
  const fromMaterials = course.concepts.filter((c) => c.material).length

  return (
    <div className="page page-narrow" style={{ maxWidth: 980 }}>
      <div className="page-head">
        <div>
          <div className="sub">
            {course.title}
            {course.term ? ` · ${course.term}` : ''}
          </div>
          <h1 style={{ marginTop: 10 }}>Materials</h1>
          <div className="sub" style={{ marginTop: 6 }}>
            {course.builtin
              ? `The course map ships with the app (${plural(course.concepts.length - fromMaterials, 'concept')}). Add slides, problem sets or exams and the map links them in.`
              : `${plural(items.length, 'file')} · ${plural(course.concepts.length, 'concept')} in the map. Each PDF you add is read and extends the map.`}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {!course.builtin && (
            <button className="btn ghost" onClick={() => setEditing(true)}>
              Course details
            </button>
          )}
          {desktop && (
            <button className="btn primary" onClick={() => void app.pickMaterials()}>
              <Icon name="plus" size={15} /> Add PDFs
            </button>
          )}
        </div>
      </div>

      <FolderPanel />

      {job && (
        <div className="panel mat-job" aria-live="polite">
          <div className="row between">
            <div className="small" style={{ fontWeight: 600 }}>
              {job.label}…
            </div>
            <span className="tiny muted">{job.phase === 'indexing' ? pct(job.progress) : 'Claude is reading the pages'}</span>
          </div>
          <div className="bar" style={{ marginTop: 8 }}>
            <span className={job.phase === 'mapping' ? 'pulse' : ''} style={{ width: job.phase === 'mapping' ? `${Math.max(8, job.progress * 100)}%` : pct(job.progress) }} />
          </div>
        </div>
      )}

      {pending.length > 0 && <PendingPanel files={pending} />}

      <div className="mat-list">
        {sorted.length === 0 ? (
          <div className="empty" style={{ marginTop: 18 }}>
            {desktop
              ? 'No materials yet. Add the script or the first slides, or choose the course folder so new PDFs are picked up as they are published.'
              : 'No materials yet. Point the course at a folder of PDFs above (the browser preview cannot open a file dialog).'}
          </div>
        ) : (
          sorted.map((m) => <MaterialRow key={m.id} m={m} busy={job?.materialId === m.id} />)
        )}
      </div>

      {editing && meta && <CourseDialog meta={meta} onClose={() => setEditing(false)} />}
    </div>
  )
}

function FolderPanel(): ReactElement {
  const app = useApp()
  useStore(app.folderVersion)
  const meta = app.folder
  const desktop = app.backend.kind === 'electron'
  const [path, setPath] = useState(meta.folder ?? '')
  const [checking, setChecking] = useState(false)
  const check = async (): Promise<void> => {
    setChecking(true)
    const n = await app.scanFolder(true)
    setChecking(false)
    if (!n) app.toast({ kind: 'info', text: 'No new PDFs in the course folder.' })
  }
  return (
    <div className="panel mat-folder">
      <div className="row between" style={{ gap: 14, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="eyebrow">course folder</div>
          {desktop ? (
            <div className="small" style={{ marginTop: 6, wordBreak: 'break-all' }}>
              {meta.folder ?? <span className="muted">None. Choose the folder where you save this course’s PDFs, and new ones are picked up as they appear.</span>}
            </div>
          ) : (
            <form
              className="row"
              style={{ marginTop: 6, gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault()
                void app.setFolder({ folder: path.trim() || null })
              }}
            >
              <input className="input" placeholder="/path/to/the/course/folder" value={path} onChange={(e) => setPath(e.target.value)} aria-label="Course folder" />
              <button className="btn sm" type="submit">
                Use folder
              </button>
            </form>
          )}
        </div>
        <div className="row" style={{ gap: 8 }}>
          {desktop && (
            <button
              className="btn sm"
              onClick={async () => {
                const f = await app.backend.pickFolder()
                if (f) await app.setFolder({ folder: f })
              }}
            >
              {meta.folder ? 'Change' : 'Choose folder'}
            </button>
          )}
          {meta.folder && (
            <button className="btn sm ghost" disabled={checking} onClick={() => void check()}>
              <Icon name="refresh" size={14} /> Check now
            </button>
          )}
        </div>
      </div>
      {meta.folder && (
        <div className="row between" style={{ marginTop: 12 }}>
          <span className="small muted">Add new PDFs from this folder automatically (checked when the app opens or comes to the front)</span>
          <Toggle on={meta.autoAdd} onChange={(v) => void app.setFolder({ autoAdd: v })} label="Add new PDFs automatically" />
        </div>
      )}
    </div>
  )
}

function PendingPanel({ files }: { files: FolderFile[] }): ReactElement {
  const app = useApp()
  return (
    <div className="panel mat-pending">
      <div className="row between">
        <div className="small" style={{ fontWeight: 600 }}>
          {plural(files.length, 'new file')} in the course folder
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn sm ghost" onClick={() => void app.ignoreFiles(files.map((f) => f.path))}>
            Ignore all
          </button>
          <button className="btn sm primary" onClick={() => void app.addFiles(files)}>
            Add all
          </button>
        </div>
      </div>
      <div className="stack" style={{ gap: 2, marginTop: 8 }}>
        {files.slice(0, 30).map((f) => (
          <div key={f.path} className="row between mat-file">
            <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {f.rel}
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm ghost" onClick={() => void app.ignoreFiles([f.path])}>
                Ignore
              </button>
              <button className="btn sm" onClick={() => void app.addFiles([f])}>
                Add
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MaterialRow({ m, busy }: { m: Material; busy: boolean }): ReactElement {
  const app = useApp()
  const [title, setTitle] = useState(m.title)
  const [confirm, setConfirm] = useState(false)
  const builtinScript = app.course.builtin && m.id === 'script'
  const span = app.script.span(m)
  const ready = m.numPages > 0 && m.offset !== null
  const st = m.status === 'skipped' && builtinScript ? 'built in' : STATUS_TEXT[m.status]
  return (
    <div className={`mat-row ${busy ? 'busy' : ''}`}>
      <div className="mat-main">
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <select className="select mat-kind" value={m.kind} disabled={builtinScript} onChange={(e) => app.updateMaterial(m.id, { kind: e.target.value as MaterialKind })} aria-label="Kind of material">
            {MATERIAL_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            className="mat-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== m.title && app.updateMaterial(m.id, { title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            aria-label="Title"
          />
        </div>
        <div className="tiny muted mat-meta">
          {m.fileName}
          {m.numPages ? ` · ${m.numPages} pages` : ''}
          {m.added.length ? ` · ${plural(m.added.length, 'new concept')}` : ''}
          {m.linked.length ? ` · ${m.linked.length} linked` : ''}
          {m.mappedAt ? ` · mapped ${relTime(m.mappedAt, new Date())}` : ''}
          {m.status === 'mapping' && m.chunksTotal > 1 ? ` · part ${Math.min(m.chunksTotal, m.chunksDone + 1)} of ${m.chunksTotal}` : ''}
        </div>
        {m.error && <div className="tiny" style={{ color: 'var(--bad)', marginTop: 4 }}>{m.error}</div>}
      </div>
      <span className={`mat-status ${m.status}`}>{st}</span>
      <div className="row" style={{ gap: 6 }}>
        {ready && (
          <button className="btn sm ghost" onClick={() => app.go({ name: 'script', page: span[0] })} title="Open in the reader">
            <Icon name="eye" size={14} /> Open
          </button>
        )}
        {!builtinScript && (m.status === 'mapped' || m.status === 'error' || m.status === 'skipped') && (
          <button className="btn sm ghost" onClick={() => void app.remapMaterial(m.id)} title="Read and map this file again">
            <Icon name="refresh" size={14} /> {m.status === 'mapped' ? 'Map again' : 'Map'}
          </button>
        )}
        {(m.status === 'queued' || busy) && (
          <button className="btn sm ghost" onClick={() => app.cancelMaterial(m.id)}>
            Stop
          </button>
        )}
        {!builtinScript &&
          (confirm ? (
            <button className="btn sm danger" onClick={() => void app.deleteMaterial(m.id)} onBlur={() => setConfirm(false)} autoFocus>
              Remove?
            </button>
          ) : (
            <button className="btn sm icon ghost" onClick={() => setConfirm(true)} title="Remove (concepts you already worked on stay)">
              <Icon name="x" size={14} />
            </button>
          ))}
      </div>
    </div>
  )
}

const EMPTY_META: Partial<CourseMeta> & { title: string } = { title: '', short: '', term: '', lecturer: '', courseNumber: '', institution: '', language: 'en', examFormat: '', codeLanguage: '', folder: null, autoAdd: true }

/** Create a course, or edit the details of the active one. */
export function CourseDialog({ meta, onClose }: { meta?: CourseMeta; onClose: () => void }): ReactElement {
  const app = useApp()
  const [v, setV] = useState<Partial<CourseMeta> & { title: string }>(meta ?? EMPTY_META)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const desktop = app.backend.kind === 'electron'
  const set = (k: keyof CourseMeta, x: unknown): void => setV((o) => ({ ...o, [k]: x }))
  const save = async (): Promise<void> => {
    if (!v.title.trim()) return
    onClose()
    if (meta) await app.updateCourse(v)
    else await app.createCourse(v)
  }
  const field = (k: keyof CourseMeta, label: string, placeholder: string, hint?: string): ReactElement => (
    <label className="stack" style={{ gap: 4 }}>
      <span className="small">{label}</span>
      <input className="input" value={String(v[k] ?? '')} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} />
      {hint && <span className="tiny muted">{hint}</span>}
    </label>
  )
  return (
    <Modal onClose={onClose} width={620} label={meta ? 'Course details' : 'New course'}>
      <form
        className="stack"
        style={{ gap: 14 }}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <div className="row between">
          <h2>{meta ? 'Course details' : 'New course'}</h2>
          <button type="button" className="btn icon sm ghost" onClick={onClose} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </div>
        {!meta && <p className="small muted" style={{ margin: 0 }}>The course starts empty. Add its PDFs next: each one is read and turned into concepts with prerequisites, and problem sets are linked to the concepts they practise.</p>}
        <div className="grid-2" style={{ gap: 12 }}>
          {field('title', 'Title', 'Systems Programming and Computer Architecture')}
          {field('short', 'Short name', 'SPCA')}
          {field('term', 'Term', 'HS26')}
          {field('lecturer', 'Lecturer', 'optional')}
          {field('courseNumber', 'Course number', 'optional')}
          <label className="stack" style={{ gap: 4 }}>
            <span className="small">Language of the materials</span>
            <select className="select" value={v.language ?? 'en'} onChange={(e) => set('language', e.target.value)}>
              {Object.entries(LANGUAGES).map(([k, name]) => (
                <option key={k} value={k}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {field('examFormat', 'Exam format', 'e.g. 120 min written exam: short questions, C code reading and writing, cache and VM exercises', 'The tutor shapes harder practice items like the exam.')}
        {field('codeLanguage', 'Code in the course', 'e.g. C and x86-64 assembly (leave empty if none)')}
        {!meta && desktop && (
          <div className="row between">
            <div className="small" style={{ minWidth: 0, wordBreak: 'break-all' }}>
              <div>Course folder</div>
              <div className="tiny muted">{v.folder ?? 'Optional: where you save this course’s PDFs. New files there are picked up automatically.'}</div>
            </div>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                const f = await app.backend.pickFolder()
                if (f) set('folder', f)
              }}
            >
              {v.folder ? 'Change' : 'Choose folder'}
            </button>
          </div>
        )}
        {!meta && !desktop && field('folder', 'Course folder', '/path/to/the/course/folder (optional)')}
        <div className="row between" style={{ marginTop: 4 }}>
          {meta ? (
            confirmRemove ? (
              <button type="button" className="btn sm danger" onClick={() => void app.removeCourse(meta.id).then(onClose)}>
                Remove {meta.short} from the list?
              </button>
            ) : (
              <button type="button" className="btn sm ghost" onClick={() => setConfirmRemove(true)}>
                Remove course
              </button>
            )
          ) : (
            <span />
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!v.title.trim()}>
              {meta ? 'Save' : 'Create course'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
