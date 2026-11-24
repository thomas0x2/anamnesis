// A tutor-built interactive demo: the tutor writes a few lines against the widget kit (kit.js)
// and the app runs them in a sandboxed frame inside the same frame as the built-in demos.
import { useEffect, useRef, useState, type ReactElement } from 'react'
import mono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?inline'
import sans400 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2?inline'
import sans600 from '@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2?inline'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { WIDGET_ERROR_EVENT, type WidgetErrorDetail } from './events'
import kitCss from './kit.css?raw'
import kitJs from './kit.js?raw'

const face = (family: string, weight: number, src: string): string => `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(${src}) format('woff2')}`
const CSS = [face('IBM Plex Sans', 400, sans400), face('IBM Plex Sans', 600, sans600), face('IBM Plex Mono', 400, mono400), kitCss].join('\n')


export function WidgetView({ title, code, caption, height, html }: { title?: string | null; code: string; caption?: string | null; height?: number | null; html?: string | null }): ReactElement {
  const ref = useRef<HTMLIFrameElement | null>(null)
  const [h, setH] = useState(Math.max(160, Math.min(720, height ?? 340)))
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source !== ref.current?.contentWindow) return
      const d = e.data as { type?: string; height?: number; message?: string }
      if (d?.type === 'widget-ready') ref.current?.contentWindow?.postMessage({ type: 'widget', css: CSS, kit: kitJs, code, html: html ?? null }, '*')
      else if (d?.type === 'widget-size' && typeof d.height === 'number') setH(Math.max(60, Math.min(1200, Math.ceil(d.height))))
      else if (d?.type === 'widget-error') window.dispatchEvent(new CustomEvent<WidgetErrorDetail>(WIDGET_ERROR_EVENT, { detail: { title: title ?? null, message: String(d.message ?? 'error') } }))
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [code, html, title])
  return (
    <div className="demo widget">
      <div className="demo-head">
        <Icon name="zap" size={15} style={{ color: 'var(--accent-text)' }} />
        <span className="demo-name">{title || 'Interactive'}</span>
      </div>
      {caption && (
        <div className="small" style={{ color: 'var(--text-2)', marginBottom: 8 }}>
          <Markdown text={caption} inline />
        </div>
      )}
      <iframe key={code} ref={ref} className="widget-frame" src="widget.html" sandbox="allow-scripts" title={title || 'interactive demo'} style={{ height: h }} />
    </div>
  )
}
