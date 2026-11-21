// The lecture notes themselves: page viewer with search, chapter jumps and the concepts on each page.
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
  const course = app.course
  const offset = course.script.printedPageOffset
  const [p, setP] = useState(page ?? course.chapters.find((c) => c.number === 1)?.pages[0] ?? 1)
  const [q, setQ] = useState('')
  const [zoom, setZoom] = useState(1)
  const [dark, setDark] = useState(true)
  const [pageInput, setPageInput] = useState(String(p + offset))
  const stage = useRef<HTMLDivElement>(null)
  const [stageW, setStageW] = useState(760)
  const n = status.numPages || 1

  useEffect(() => {
    if (page) setP(page)
  }, [page])
  useEffect(() => setPageInput(String(p + offset)), [p, offset])

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
      if (e.key === 'ArrowRight' || e.key === 'PageDown') setP((x) => Math.min(n, x + 1))
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') setP((x) => Math.max(1, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app, n])

  useEffect(() => {
    if (stage.current) stage.current.scrollTop = 0
  }, [p])

  const results = useMemo(() => (status.state === 'ready' && q.trim() ? app.script.search(q, 40) : []), [app, q, status.state])
  const onPage = useMemo(() => course.concepts.filter((c) => c.pages.length >= 2 && c.pages[0] <= p && p <= c.pages[1]), [course, p])
  const chapter = course.chapters.find((c) => c.pages.length >= 2 && c.pages[0] <= p && p <= c.pages[1])

  if (status.state !== 'ready') return <ScriptMissing />

  return (
    <div className="page" style={{ maxWidth: 1400, paddingBottom: 24 }}>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <h1>Script</h1>
          <div className="sub">
            {course.script.title}
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
                      {r.title} <span className="muted tiny">· page {r.page + offset}</span>
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
                <div className="sidebar-section" style={{ marginTop: 0 }}>
                  Chapters
                </div>
                {course.chapters
                  .filter((c) => c.pages.length >= 2)
                  .map((c) => (
                    <button key={c.number} className="script-hit" onClick={() => setP(c.pages[0])} style={chapter?.number === c.number ? { background: 'var(--surface-2)', color: 'var(--text)' } : undefined}>
                      <div className="h">
                        {c.number}. {c.title}
                      </div>
                      <div className="s">
                        {c.de} · pages {c.pages[0] + offset}–{c.pages[1] + offset}
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
            <button className="btn icon sm" onClick={() => setP((x) => Math.max(1, x - 1))} disabled={p <= 1} title="Previous page (←)">
              <Icon name="chev-right" size={15} style={{ transform: 'rotate(180deg)' }} />
            </button>
            <form
              className="row"
              style={{ gap: 6 }}
              onSubmit={(e) => {
                e.preventDefault()
                const v = Number(pageInput)
                if (Number.isFinite(v)) setP(Math.min(n, Math.max(1, Math.round(v) - offset)))
              }}
            >
              <span className="small muted">Page</span>
              <input className="input" style={{ width: 64, height: 28, padding: '0 8px' }} value={pageInput} onChange={(e) => setPageInput(e.target.value)} aria-label="Printed page number" />
              <span className="small muted">
                PDF {p} of {n}
              </span>
            </form>
            <button className="btn icon sm" onClick={() => setP((x) => Math.min(n, x + 1))} disabled={p >= n} title="Next page (→)">
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
        {status.state === 'indexing' && (
          <div className="stack" style={{ gap: 8 }}>
            <div>Reading the lecture notes once so the tutor can quote the right pages… {pct(status.progress)}</div>
            <div className="bar">
              <span style={{ width: pct(status.progress) }} />
            </div>
          </div>
        )}
        {(status.state === 'none' || status.state === 'error') && (
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
