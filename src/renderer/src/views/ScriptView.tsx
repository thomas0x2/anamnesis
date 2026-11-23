// The course materials themselves: page viewer with search, jumps to chapters and materials, and the
// concepts on each page. Pages carry app page numbers (see MaterialLibrary); the learner sees each
// material's own printed numbers.
import { conceptRanges, KIND_LABEL } from '@shared/courseMap'
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { PdfPage } from '../components/PdfPage'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct } from '../lib/format'

export function ScriptView({ page }: { page?: number }): ReactElement {
  const app = useApp()
  const status = useStore(app.script.status, (s) => s)
  const items = useStore(app.materials)
  const course = app.course
  const lib = app.script
  const [p, setP] = useState(page ?? (course.builtin ? course.chapters.find((c) => c.number === 1)?.pages[0] : undefined) ?? lib.firstPage())
  const at = status.state === 'ready' ? lib.locate(p) : null
  const offset = at ? at.material.printedOffset : course.script.printedPageOffset
  const local = at ? at.local : p
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(1)
  const [dark, setDark] = useState(true)
  const [pageInput, setPageInput] = useState(String(local + offset))
  const stage = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(760)
  const n = at?.material.numPages || 1
  const placed = items.filter((m) => m.offset !== null && m.numPages > 0)

  useEffect(() => {
    if (page) setP(page)
  }, [page])
  useEffect(() => {
    if (status.state === 'ready' && !lib.locate(p)) setP(lib.firstPage())
  }, [status.state, lib, p])
  useEffect(() => setPageInput(String(local + offset)), [local, offset])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setStageW(Math.max(320, el.clientWidth - 36)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [status.state])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (app.ui.get().scriptPeek) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setP((x) => lib.step(x, 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setP((x) => lib.step(x, -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, lib])

  useEffect(() => {
    if (stage.current) stage.current.scrollTop = 0
  }, [p])

  const results = useMemo(() => (status.state === 'ready' && q.trim() ? app.script.search(q, 40) : []), [app, q, status.state])
  const onPage = useMemo(() => course.concepts.filter((c) => conceptRanges(c).some((r) => r[0] <= p && p <= r[1])), [course, p])
  const chapter = course.chapters.find((c) => c.pages.length >= 2 && c.pages[0] <= p && p <= c.pages[1])
  const chapterJumps = course.chapters.filter((c) => c.pages.length >= 2)

  if (status.state !== 'ready') return <ScriptMissing />

  return (
    <div className="page" style={{ maxWidth: 1400, paddingBottom: 24 }}>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <h1>{placed.length > 1 ? 'Reader' : 'Script'}</h1>
          <div className="sub">
            {at?.material.title ?? course.script.title}
            {chapter ? ` · Chapter ${chapter.number}: ${chapter.title}` : ''}
          </div>
        </div>
      </div>
      <div className="script-layout">
        <div className="script-side">
          <div style={{ position: 'relative' }}>
            <input className="input" placeholder="Search: a word, or a number like 2.3.5" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
            <Icon name="search" size={16} style={{ position: 'absolute', left: 11, top: 11, color: 'var(--muted)' }} />
          </div>
          <div className="script-results">
            {q.trim() ? (
              results.length ? (
                results.map((r, i) => (
                  <button key={`${r.page}-${i}`} className="script-hit" onClick={() => setP(r.page)}>
                    <div className="h">
                      {r.title}
                      {placed.length <= 1 && <span className="muted tiny"> · page {lib.label(r.page).replace(/^p\. /, '')}</span>}
                    </div>
                    <div className="s">{r.snippet}</div>
                  </button>
                ))
              ) : (
                <div className="small muted" style={{ padding: 8 }}>
                  Nothing found{q.trim().length < 3 && !/\d/.test(q) ? ' (type at least 3 letters)' : ''}.
                </div>
              )
            ) : (
              <>
                {placed.length > 1 && (
                  <>
                    <div className="sidebar-section" style={{ marginTop: 0 }}>
                      Materials
                    </div>
                    {placed.map((m) => (
                      <button key={m.id} className="script-hit" onClick={() => setP(lib.span(m)[0])} style={at?.material.id === m.id ? { background: 'var(--surface-2)', color: 'var(--text)' } : undefined}>
                        <div className="h">{m.title}</div>
                        <div className="s">
                          {KIND_LABEL[m.kind]} · {m.numPages} pages
                        </div>
                      </button>
                    ))}
                  </>
                )}
                {chapterJumps.length > 0 && (
                  <div className="sidebar-section" style={{ marginTop: placed.length > 1 ? 14 : 0 }}>
                    Chapters
                  </div>
                )}
                {chapterJumps
                  .map((c) => (
                    <button key={c.number} className="script-hit" onClick={() => setP(c.pages[0])} style={chapter?.number === c.number ? { background: 'var(--surface-2)', color: 'var(--text)' } : undefined}>
                      <div className="h">
                        {c.number}. {c.title}
                      </div>
                      <div className="s">
                        {c.de} · pages {c.pages[0] + course.script.printedPageOffset}–{c.pages[1] + course.script.printedPageOffset}
                      </div>
                    </button>
                  ))}
              </>
            )}
          </div>
          {onPage.length > 0 && (
            <div className="panel" style={{ padding: '12px 14px' }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                On this page
              </div>
              <div className="stack" style={{ gap: 6 }}>
                {onPage.slice(0, 4).map((c) => {
                  const st = app.state.get().learner.concepts[c.id]?.status ?? 'unseen'
                  return (
                    <div key={c.id} className="row" style={{ gap: 8 }}>
                      <span className={`status-dot ${st}`} />
                      <button className="btn ghost sm" style={{ flex: 1, justifyContent: 'flex-start', padding: '0 4px', minWidth: 0, overflow: 'hidden' }} onClick={() => app.go({ name: 'map', conceptId: c.id })}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          <Markdown text={c.title} inline />
                        </span>
                      </button>
                      <button className="btn sm" onClick={() => void app.startLearn(c.id)}>
                        Learn
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
          <div className="row">
            <button className="btn icon sm" onClick={() => setP((x) => lib.step(x, -1))} disabled={lib.step(p, -1) === p} title="Previous page (←)">
              <Icon name="chev-right" size={15} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault()
                const v = Number(pageInput)
                if (Number.isFinite(v)) setP((at?.material.offset ?? 0) + Math.min(n, Math.max(1, Math.round(v) - offset)))
              }}
            >
              <span className="small muted">Page</span>
              <input className="input" style={{ width: 64, height: 28, padding: '0 8px' }} value={pageInput} onChange={(e) => setPageInput(e.target.value)} aria-label="Printed page number" />
              <span className="small muted">
                PDF {local} of {n}
              </span>
            </form>
            <button className="btn icon sm" onClick={() => setP((x) => lib.step(x, 1))} disabled={lib.step(p, 1) === p} title="Next page (→)">
              <Icon name="chev-right" size={15} />
            </button>
            <div className="spacer" />
            <button className="btn icon sm ghost" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))} title="Zoom out">
              <Icon name="minus" size={15} />
            </button>
            <span className="small muted" style={{ width: 44, textAlign: 'center' }}>
              {pct(zoom)}
            </span>
            <button className="btn icon sm ghost" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))} title="Zoom in">
              <Icon name="plus" size={15} />
            </button>
            <button className={`btn sm ${dark ? '' : 'ghost'}`} onClick={() => setDark((d) => !d)} aria-pressed={dark} title="Render pages dark">
              <Icon name="eye" size={15} /> Dark pages
            </button>
          </div>
          <div className="pdf-stage" ref={stage} style={{ flex: 1, alignItems: 'flex-start' }}>
            <PdfPage page={p} width={Math.round(Math.min(stageW, 980) * zoom)} dark={dark} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ScriptMissing(): ReactElement {
  const app = useApp()
  const status = useStore(app.script.status, (s) => s)
  const canChoose = app.backend.kind === 'electron'
  const job = useStore(app.job)
  if (!app.course.builtin && status.state !== 'loading' && status.state !== 'indexing')
    return (
      <div className="page page-narrow">
        <div className="page-head">
          <div>
            <h1>Reader</h1>
            <div className="sub">{app.course.title}</div>
          </div>
        </div>
        <div className="empty">
          No course materials have been read yet.{' '}
          <button className="btn sm" onClick={() => app.go({ name: 'materials' })}>
            Add materials
          </button>
        </div>
      </div>
    )
  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Script</h1>
          <div className="sub">{app.course.script.title}</div>
        </div>
      </div>
      <div className="panel stack">
        {status.state === 'loading' && <div>Opening the PDF…</div>}
        {job?.phase === 'indexing' && (
          <div className="stack" style={{ gap: 8 }}>
            <div>Reading the lecture notes once so the tutor can quote the right pages… {pct(job.progress)}</div>
            <div className="bar">
              <span style={{ width: pct(job.progress) }} />
            </div>
          </div>
        )}
        {!job && (status.state === 'none' || status.state === 'error') && (
          <>
            {status.state === 'error' && <div className="tex-error">{status.message}</div>}
            <p style={{ margin: 0 }}>
              Point Anamnesis at your copy of <code>{app.course.script.fileName}</code>. The tutor then grounds every explanation in the script’s own definitions, notation and numbering, and you can open the exact page from any card.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              The PDF stays on this computer. Only the pages relevant to a step are sent to Claude as context for your own session.
            </p>
            <div>
              {canChoose ? (
                <button className="btn primary" onClick={() => void app.chooseScript()}>
                  <Icon name="book" size={16} /> Choose the PDF
                </button>
              ) : (
                <span className="small muted">In the browser preview, start the dev server with ANAMNESIS_SCRIPT=/path/to/{app.course.script.fileName}.</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
