// Renders the content blocks of a tutor card.
import { makeFn } from '@shared/mathx'
import type { Block, PlotSpec } from '@shared/types'
import { memo, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { DemoView } from '../demos'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { Chart, sample, SERIES_COLORS, type ChartSeries } from './Chart'
import { Icon } from './Icon'
import { Markdown, Tex } from './Markdown'

export function Blocks({ blocks, live = false }: { blocks: Block[]; live?: boolean }): ReactElement {
  return (
    <div className="blocks">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} live={live} />
      ))}
    </div>
  )
}

const BlockView = memo(function BlockView({ block: b, live }: { block: Block; live: boolean }): ReactElement | null {
  switch (b.type) {
    case 'text':
      return <Markdown text={b.md} />
    case 'equation':
      return (
        <div className="equation">
          <Tex latex={b.latex ?? b.md ?? ''} />
          {b.md && b.latex && <div className="block-caption">{<Markdown text={b.md} inline />}</div>}
        </div>
      )
    case 'callout':
      return (
        <div className={`callout ${b.tone ?? 'info'}`}>
          <Icon name={b.tone === 'insight' ? 'bulb' : b.tone === 'warning' ? 'alert' : b.tone === 'example' ? 'spark' : 'info'} />
          <Markdown text={b.md} />
        </div>
      )
    case 'steps':
      return <StepsBlock items={b.items ?? []} live={live} />
    case 'plot':
      return b.plot ? <PlotBlock spec={b.plot} caption={b.md} /> : null
    case 'demo':
      return b.demo ? <DemoView id={b.demo.id} params={b.demo.params ?? null} caption={b.demo.caption ?? b.md ?? null} /> : null
    case 'mermaid':
      return <MermaidBlock source={b.md ?? ''} />
    case 'sketch':
      return b.html ? <SketchBlock html={b.html} height={b.height ?? 320} /> : null
    case 'script':
      return <ScriptRef page={b.page ?? null} label={b.label ?? null} md={b.md ?? null} />
    case 'code':
      return b.code ? <CodeBlock source={b.code.source} language={b.code.language ?? 'python'} /> : null
    case 'table':
      return b.table ? <TableBlock headers={b.table.headers} rows={b.table.rows} caption={b.md ?? null} /> : null
    default:
      return b.md ? <Markdown text={b.md} /> : null
  }
})

// ------------------------------------------------------------ steps with progressive reveal
function StepsBlock({ items, live }: { items: string[]; live: boolean }): ReactElement {
  const progressive = live && items.length >= 3
  const [shown, setShown] = useState(progressive ? 1 : items.length)
  const visible = progressive ? items.slice(0, shown) : items
  return (
    <div>
      <ol className="steps-block">
        {visible.map((s, i) => (
          <li key={i}>
            <Markdown text={s} />
          </li>
        ))}
      </ol>
      {progressive && shown < items.length && (
        <div className="row steps-more">
          <button className="btn sm" onClick={() => setShown((n) => n + 1)}>
            <Icon name="chev-down" size={15} /> Next step
          </button>
          <span className="tiny muted">Try to predict it first ({items.length - shown} left)</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setShown(items.length)}>
            Show all
          </button>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------ plots
function PlotBlock({ spec, caption }: { spec: PlotSpec; caption?: string | null }): ReactElement {
  const series = useMemo<ChartSeries[]>(() => {
    const out: ChartSeries[] = []
    spec.series.slice(0, 4).forEach((s, k) => {
      const style = s.style === 'dashed' ? 'dashed' : s.style === 'points' ? 'points' : 'line'
      if (s.points?.length) {
        out.push({ label: s.label ?? null, points: s.points.filter((p) => p.length >= 2).map((p) => [Number(p[0]), Number(p[1])] as [number, number]), style, color: SERIES_COLORS[k] })
      } else if (s.expr) {
        const fn = makeFn(s.expr)
        if (fn) out.push({ label: s.label ?? s.expr, points: sample(fn, spec.xMin, spec.xMax, 500, !!spec.logX), style, color: SERIES_COLORS[k] })
      }
    })
    return out
  }, [spec])
  if (!series.length) return <div className="tex-error">This plot could not be drawn.</div>
  return (
    <figure style={{ margin: 0 }}>
      <Chart
        series={series}
        xMin={spec.xMin}
        xMax={spec.xMax}
        yMin={spec.yMin ?? null}
        yMax={spec.yMax ?? null}
        logX={!!spec.logX}
        logY={!!spec.logY}
        title={spec.title ?? null}
        xLabel={spec.xLabel ?? 'x'}
        yLabel={spec.yLabel ?? null}
        height={250}
      />
      {caption && (
        <figcaption className="block-caption">
          <Markdown text={caption} inline />
        </figcaption>
      )}
    </figure>
  )
}

// ------------------------------------------------------------ mermaid
let mermaidReady: Promise<typeof import('mermaid').default> | null = null
function loadMermaid(): Promise<typeof import('mermaid').default> {
  if (!mermaidReady)
    mermaidReady = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
        themeVariables: {
          darkMode: true,
          background: '#0b0b0b',
          primaryColor: '#1a1a1a',
          primaryTextColor: '#ffffff',
          primaryBorderColor: '#5a5a5a',
          secondaryColor: '#111111',
          secondaryTextColor: '#ffffff',
          secondaryBorderColor: '#3a3a3a',
          tertiaryColor: '#111111',
          tertiaryTextColor: '#ffffff',
          lineColor: '#8a8a8a',
          textColor: '#ffffff',
          mainBkg: '#1a1a1a',
          nodeBorder: '#5a5a5a',
          clusterBkg: '#0e0e0e',
          clusterBorder: '#333333',
          edgeLabelBackground: '#0b0b0b',
          fontSize: '14px'
        },
        flowchart: { curve: 'basis', htmlLabels: true }
      })
      return m.default
    })
  return mermaidReady
}

let mermaidSeq = 0
function repairMermaid(src: string): string {
  // quote bare labels that contain characters mermaid chokes on
  return src.replace(/(\w+)\s*([[({]{1,2})([^"\])}]+?)([\])}]{1,2})/g, (m, id: string, open: string, label: string, close: string) => (/[(){}[\]<>:;,=+*/^$\\|]/.test(label) ? `${id}${open}"${label.replace(/"/g, "'")}"${close}` : m))
}

function MermaidBlock({ source }: { source: string }): ReactElement {
  const [svg, setSvg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const src = source.replace(/^```(mermaid)?\s*|```\s*$/g, '').trim()
    void loadMermaid().then(async (mermaid) => {
      for (const attempt of [src, repairMermaid(src)]) {
        try {
          const { svg } = await mermaid.render(`mmd${++mermaidSeq}`, attempt)
          if (alive) setSvg(svg)
          return
        } catch (e) {
          if (alive) setErr(String((e as Error).message ?? e).split('\n')[0])
        }
      }
    })
    return () => {
      alive = false
    }
  }, [source])
  if (svg) return <div className="mermaid-box" dangerouslySetInnerHTML={{ __html: svg }} />
  if (err)
    return (
      <div>
        <div className="tex-error">Diagram could not be drawn: {err}</div>
        <pre className="code-block">{source}</pre>
      </div>
    )
  return <div className="mermaid-box muted small">Drawing diagram…</div>
}

// ------------------------------------------------------------ sketch (sandboxed model-written widget)
function SketchBlock({ html, height }: { html: string; height: number }): ReactElement {
  const ref = useRef<HTMLIFrameElement | null>(null)
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.source === ref.current?.contentWindow && (e.data as { type?: string })?.type === 'sketch-ready') ref.current?.contentWindow?.postMessage({ type: 'sketch', html }, '*')
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [html])
  return <iframe ref={ref} className="sketch-frame" src="sketch.html" sandbox="allow-scripts" title="interactive sketch" style={{ height: Math.max(120, Math.min(640, height)) }} />
}

// ------------------------------------------------------------ script reference
export function ScriptRef({ page, label, md }: { page: number | null; label: string | null; md: string | null }): ReactElement {
  const app = useApp()
  const status = useStore(app.script.status, (s) => s.state)
  const at = page !== null && status === 'ready' ? app.script.locate(page) : null
  const printed = at ? at.local + at.material.printedOffset : page !== null ? page + app.course.script.printedPageOffset : null
  const multi = app.script.materials().filter((m) => m.offset !== null).length > 1
  return (
    <div className="script-ref">
      <div className="page-badge" title={at ? `${at.material.title}, PDF page ${at.local}` : undefined}>
        {printed !== null ? (
          <span>
            p.
            <br />
            {printed}
          </span>
        ) : (
          <Icon name="book" />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="small" style={{ fontWeight: 600 }}>
          {label ? `${label} · ` : ''}
          {at && multi ? at.material.title : 'Script'}
          {printed !== null ? `, page ${printed}` : ''}
        </div>
        {md && (
          <div className="small muted">
            <Markdown text={md} inline />
          </div>
        )}
      </div>
      {page !== null &&
        (status === 'ready' ? (
          <button className="btn sm" onClick={() => app.peekScript(page, label)}>
            <Icon name="eye" size={15} /> Open
          </button>
        ) : (
          <button className="btn sm ghost" onClick={() => app.go({ name: 'settings' })} title="Choose your PDF in Settings">
            Add PDF
          </button>
        ))}
    </div>
  )
}

// ------------------------------------------------------------ code
const PY_KW = new Set(
  'and as assert break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')
)

export function highlightPython(src: string): ReactElement[] {
  const out: ReactElement[] = []
  const re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')|(\b\d+(?:\.\d*)?(?:e[-+]?\d+)?j?\b)|([A-Za-z_][A-Za-z0-9_]*)(\s*\()?|([\s\S])/g
  let m: RegExpExecArray | null
  let k = 0
  let plain = ''
  const flush = (): void => {
    if (plain) out.push(<span key={k++}>{plain}</span>)
    plain = ''
  }
  while ((m = re.exec(src))) {
    if (m[1]) {
      flush()
      out.push(
        <span key={k++} className="tok-com">
          {m[1]}
        </span>
      )
    } else if (m[2]) {
      flush()
      out.push(
        <span key={k++} className="tok-str">
          {m[2]}
        </span>
      )
    } else if (m[3]) {
      flush()
      out.push(
        <span key={k++} className="tok-num">
          {m[3]}
        </span>
      )
    } else if (m[4]) {
      flush()
      const cls = PY_KW.has(m[4]) ? 'tok-kw' : m[5] ? 'tok-fn' : undefined
      out.push(
        <span key={k++} className={cls}>
          {m[4]}
        </span>
      )
      if (m[5]) plain += m[5]
    } else plain += m[6]
  }
  flush()
  return out
}

export function CodeBlock({ source, language }: { source: string; language: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <pre className="code-block">
      <button
        className="btn sm ghost icon copy"
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(source).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          })
        }}
      >
        <Icon name={copied ? 'check' : 'copy'} size={14} />
      </button>
      <code>{language.toLowerCase().startsWith('py') ? highlightPython(source) : source}</code>
    </pre>
  )
}

function TableBlock({ headers, rows, caption }: { headers: string[]; rows: string[][]; caption: string | null }): ReactElement {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>
                <Markdown text={h} inline />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j}>
                  <Markdown text={c} inline />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {caption && <div className="block-caption">{caption}</div>}
    </div>
  )
}
