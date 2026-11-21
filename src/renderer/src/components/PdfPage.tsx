// One page of the lecture notes, rendered with pdf.js onto a canvas; and the side drawer that peeks at a page.
import { clamp } from '@shared/util'
import type { RenderTask } from 'pdfjs-dist'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { Icon } from './Icon'

const DARK_PAGE = { background: '#111111', foreground: '#e6e6e6' }

export function PdfPage({ page, width, scale, dark = false }: { page: number; width?: number; scale?: number; dark?: boolean }): ReactElement {
  const app = useApp()
  const st = useStore(app.script.status, (s) => s.state)
  const ref = useRef<HTMLCanvasElement>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const doc = app.script.document()
    const canvas = ref.current
    if (!doc || !canvas) return
    let cancelled = false
    let task: RenderTask | null = null
    setErr(null)
    void (async () => {
      try {
        const p = await doc.getPage(clamp(Math.round(page), 1, doc.numPages))
        if (cancelled) return
        const base = p.getViewport({ scale: 1 })
        const s = scale ?? (width ? width / base.width : 1.3)
        const vp = p.getViewport({ scale: s })
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.floor(vp.width * dpr)
        canvas.height = Math.floor(vp.height * dpr)
        canvas.style.width = `${Math.floor(vp.width)}px`
        canvas.style.height = `${Math.floor(vp.height)}px`
        task = p.render({
          canvas,
          viewport: vp,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          ...(dark ? { pageColors: DARK_PAGE } : {})
        })
        await task.promise
      } catch (e) {
        const msg = String((e as Error)?.message ?? e)
        if (!cancelled && !/cancel/i.test(msg)) setErr(msg)
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [app, page, width, scale, dark, st])

  if (st !== 'ready' && !app.script.document()) return <div className="empty">The lecture notes are not loaded.</div>
  return (
    <div>
      <canvas ref={ref} className="pdf-page" aria-label={`Script page ${page}`} />
      {err && <div className="tex-error">Could not render this page: {err}</div>}
    </div>
  )
}

/** Drawer on the right that shows the page a tutor card points to, without leaving the session. */
export function ScriptPeek(): ReactElement | null {
  const app = useApp()
  const peek = useStore(app.ui, (u) => u.scriptPeek)
  const status = useStore(app.script.status)
  const [page, setPage] = useState(peek?.page ?? 1)
  const [dark, setDark] = useState(true)
  const stage = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(560)

  const close = (): void => app.ui.set((u) => ({ ...u, scriptPeek: null }))

  useEffect(() => {
    if (peek) setPage(peek.page)
  }, [peek])

  useEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(280, el.clientWidth - 36)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [peek])

  useEffect(() => {
    if (!peek) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'ArrowRight') setPage((p) => Math.min(status.numPages || p + 1, p + 1))
      if (e.key === 'ArrowLeft') setPage((p) => Math.max(1, p - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!peek) return null
  const printed = page + app.course.script.printedPageOffset
  return (
    <div className="peek" role="dialog" aria-label="Lecture notes">
      <div className="peek-head">
        <Icon name="book" size={16} style={{ color: 'var(--accent-text)' }} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="small" style={{ fontWeight: 600 }}>
            {peek.label ? `${peek.label} · ` : ''}page {printed}
          </div>
          <div className="tiny muted">PDF page {page} of {status.numPages || '…'}</div>
        </div>
        <button className="btn icon sm ghost" onClick={() => setPage((p) => Math.max(1, p - 1))} title="Previous page (←)">
          <Icon name="chev-right" size={15} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <button className="btn icon sm ghost" onClick={() => setPage((p) => Math.min(status.numPages || p + 1, p + 1))} title="Next page (→)">
          <Icon name="chev-right" size={15} />
        </button>
        <button className={`btn sm ghost ${dark ? 'speak on' : ''}`} onClick={() => setDark((d) => !d)} title="Dark pages">
          <Icon name="eye" size={15} />
        </button>
        <button
          className="btn sm"
          onClick={() => {
            close()
            app.go({ name: 'script', page })
          }}
        >
          Open in Script
        </button>
        <button className="btn icon sm ghost" onClick={close} title="Close (Esc)">
          <Icon name="x" size={16} />
        </button>
      </div>
      <div className="pdf-stage" ref={stage}>
        <PdfPage page={page} width={w} dark={dark} />
      </div>
    </div>
  )
}
