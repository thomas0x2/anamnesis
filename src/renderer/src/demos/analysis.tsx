// Demos for rounding/cancellation (ch. 1), quadrature (ch. 5) and nonlinear iterations (ch. 6).
import { derivative, EPS, fixedPointIterates, linspace, newtonIterates, quadrature, quadratureNodes, referenceIntegral, type QuadRule } from '@shared/numerics'
import { useMemo, useState, type ReactElement } from 'react'
import { Chart, sample, type ChartSeries } from '../components/Chart'
import { DemoFrame, fnParam, int, num, Seg, Slider, sci, str, type Params } from './kit'

export function CancellationDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', 'exp(x)')
  const x0 = num(p, 'x0', 1, -50, 50)
  const [scheme, setScheme] = useState<'forward' | 'central'>('forward')
  const [logh, setLogh] = useState(-8)
  const data = useMemo(() => {
    const d = derivative(f, x0)
    const d2 = derivative((x) => derivative(f, x), x0)
    const d3 = derivative((x) => derivative((y) => derivative(f, y), x), x0)
    const hs = linspace(-16, 0, 129).map((e) => 10 ** e)
    const approx = (h: number): number => (scheme === 'forward' ? (f(x0 + h) - f(x0)) / h : (f(x0 + h) - f(x0 - h)) / (2 * h))
    const err = hs.map((h) => [h, Math.max(1e-18, Math.abs(approx(h) - d))] as [number, number])
    const trunc = hs.map((h) => [h, scheme === 'forward' ? (h * Math.abs(d2)) / 2 : (h * h * Math.abs(d3)) / 6] as [number, number])
    const round = hs.map((h) => [h, ((scheme === 'forward' ? 2 : 1) * EPS * Math.abs(f(x0))) / h] as [number, number])
    const best = err.reduce((b, q) => (q[1] < b[1] ? q : b), err[0])
    return { d, err, trunc, round, best, approx }
  }, [f, x0, scheme])
  const h = 10 ** logh
  const cur = Math.abs(data.approx(h) - data.d)
  return (
    <DemoFrame
      name="Cancellation in difference quotients"
      caption={caption ?? 'Shrinking h lowers the truncation error until rounding errors, amplified by 1/h, take over.'}
      controls={
        <>
          <Seg
            value={scheme}
            onChange={setScheme}
            options={[
              { value: 'forward', label: 'forward (f(x+h)−f(x))/h' },
              { value: 'central', label: 'central' }
            ]}
          />
          <Slider label="h = 10^" value={logh} min={-16} max={0} step={0.25} onChange={setLogh} fmt={(v) => v.toFixed(2)} />
        </>
      }
      readout={
        <>
          <span>
            f = <b>{src}</b>, x₀ = {x0}
          </span>
          <span>
            error at h = {sci(h)}: <b>{sci(cur)}</b>
          </span>
          <span>
            best h ≈ <b>{sci(data.best[0])}</b> (theory {scheme === 'forward' ? '√eps ≈ 1.5e-8' : '∛eps ≈ 6e-6'})
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'actual error', points: data.err, color: 'var(--s1)' },
          { label: scheme === 'forward' ? 'truncation h|f″|/2' : 'truncation h²|f‴|/6', points: data.trunc, color: 'var(--s2)', style: 'dashed' },
          { label: 'rounding ~eps|f|/h', points: data.round, color: 'var(--s3)', style: 'dashed' }
        ]}
        xMin={1e-16}
        xMax={1}
        yMin={1e-17}
        yMax={1e2}
        logX
        logY
        height={260}
        xLabel="h"
        vlines={[{ x: h, color: 'var(--accent)' }]}
      />
    </DemoFrame>
  )
}

const RULES: QuadRule[] = ['midpoint', 'trapezoidal', 'simpson', 'gauss']
const RULE_LABEL: Record<QuadRule, string> = { midpoint: 'Midpoint', trapezoidal: 'Trapezoidal', simpson: 'Simpson', gauss: 'Gauss–Legendre' }

export function QuadratureDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', 'exp(x)')
  const a0 = num(p, 'a', 0, -50, 50)
  const b0 = num(p, 'b', 1, -50, 50)
  const [a, b] = a0 < b0 ? [a0, b0] : [0, 1]
  const [rule, setRule] = useState<QuadRule>(str(p, 'rule', 'trapezoidal', RULES))
  const [N, setN] = useState(int(p, 'N', 4, 1, 64))
  const exact = useMemo(() => referenceIntegral(f, a, b), [f, a, b])
  const Q = quadrature(f, a, b, rule, N)
  const nodes = quadratureNodes(a, b, rule, N)
  const shape = useMemo(() => {
    // the approximating function each composite rule integrates exactly
    const h = (b - a) / N
    const g = (x: number): number => {
      const i = Math.min(N - 1, Math.max(0, Math.floor((x - a) / h)))
      const l = a + i * h
      const r = l + h
      if (rule === 'midpoint') return f(l + h / 2)
      if (rule === 'trapezoidal') return f(l) + ((f(r) - f(l)) * (x - l)) / h
      if (rule === 'simpson') {
        const m = l + h / 2
        return (f(l) * (x - m) * (x - r)) / ((l - m) * (l - r)) + (f(m) * (x - l) * (x - r)) / ((m - l) * (m - r)) + (f(r) * (x - l) * (x - m)) / ((r - l) * (r - m))
      }
      return NaN
    }
    return rule === 'gauss' ? null : sample(g, a, b, 600)
  }, [f, a, b, N, rule])
  const conv = useMemo(() => {
    const Ns = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64]
    return RULES.map((r) => ({ r, points: Ns.map((n) => [n, Math.max(1e-16, Math.abs(quadrature(f, a, b, r, n) - exact))] as [number, number]) }))
  }, [f, a, b, exact])
  const main: ChartSeries[] = [{ label: `f(x) = ${src}`, points: sample(f, a, b, 400), color: 'var(--s1)' }]
  if (shape) main.push({ label: `${RULE_LABEL[rule]} approximant`, points: shape, color: 'var(--s2)', style: 'area' })
  main.push({ label: 'nodes', points: nodes.map((x) => [x, f(x)]), style: 'points', color: 'var(--s2)', noLegend: true })
  const err = Math.abs(Q - exact)
  const half = Math.abs(quadrature(f, a, b, rule, Math.max(1, Math.floor(N / 2))) - exact)
  const order = N >= 2 && err > 1e-15 && half > 1e-15 ? Math.log2(half / err) / Math.log2(N / Math.max(1, Math.floor(N / 2))) : null
  return (
    <DemoFrame
      name="Quadrature"
      caption={caption ?? 'Composite rules converge algebraically (straight lines in log-log); Gauss–Legendre converges exponentially for smooth f.'}
      controls={
        <>
          <Seg value={rule} onChange={setRule} options={RULES.map((r) => ({ value: r, label: RULE_LABEL[r] }))} />
          <Slider label={rule === 'gauss' ? 'points n' : 'panels N'} value={N} min={1} max={rule === 'gauss' ? 24 : 64} onChange={setN} />
        </>
      }
      readout={
        <>
          <span>
            Q = <b>{Q.toPrecision(12)}</b>
          </span>
          <span>
            error <b>{sci(err)}</b>
          </span>
          {order !== null && rule !== 'gauss' && (
            <span>
              observed order ≈ <b>{order.toFixed(2)}</b>
            </span>
          )}
        </>
      }
    >
      <Chart series={main} xMin={a} xMax={b} height={220} />
      <Chart
        title="Error vs number of panels / points (log–log)"
        series={conv.map((c, k) => ({ label: RULE_LABEL[c.r], points: c.points, color: ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'][k], width: c.r === rule ? 3 : 1.5 }))}
        xMin={1}
        xMax={64}
        yMin={1e-16}
        logX
        logY
        height={200}
        vlines={[{ x: N, color: 'var(--accent)' }]}
      />
    </DemoFrame>
  )
}

export function CobwebDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f: phi } = fnParam(p, 'phi', 'cos(x)')
  const lo0 = num(p, 'xMin', 0, -100, 100)
  const hi0 = num(p, 'xMax', 1.6, -100, 100)
  const [lo, hi] = lo0 < hi0 ? [lo0, hi0] : [0, 1.6]
  const [x0, setX0] = useState(num(p, 'x0', 1, lo, hi))
  const [steps, setSteps] = useState(int(p, 'steps', 10, 1, 60))
  const xs = useMemo(() => fixedPointIterates(phi, x0, steps), [phi, x0, steps])
  const web: [number, number][] = []
  web.push([xs[0], lo])
  for (let k = 0; k < xs.length - 1; k++) {
    web.push([xs[k], xs[k + 1]])
    web.push([xs[k + 1], xs[k + 1]])
  }
  const last = xs[xs.length - 1]
  const slope = Number.isFinite(last) ? derivative(phi, last) : NaN
  return (
    <DemoFrame
      name="Fixed-point iteration"
      caption={caption ?? 'x_{k+1} = φ(x_k): it converges where the graph of φ is flatter than the diagonal, |φ′(x*)| < 1.'}
      controls={
        <>
          <Slider label="x₀" value={x0} min={lo} max={hi} step={(hi - lo) / 200} onChange={setX0} fmt={(v) => v.toFixed(3)} />
          <Slider label="steps" value={steps} min={1} max={60} onChange={setSteps} />
        </>
      }
      readout={
        <>
          <span>
            φ(x) = <b>{src}</b>
          </span>
          <span>
            x<sub>{xs.length - 1}</sub> = <b>{Number.isFinite(last) ? last.toPrecision(10) : 'diverged'}</b>
          </span>
          <span>
            |φ′| there ≈ <b>{Number.isFinite(slope) ? Math.abs(slope).toFixed(3) : '–'}</b> {Number.isFinite(slope) ? (Math.abs(slope) < 1 ? '(contraction: linear rate)' : '(not a contraction)') : ''}
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'y = φ(x)', points: sample(phi, lo, hi, 400), color: 'var(--s1)' },
          { label: 'y = x', points: [[lo, lo], [hi, hi]], color: 'var(--muted)', style: 'dashed', width: 1.2 },
          { label: 'iterates', points: web, color: 'var(--s2)', width: 1.4, noTip: true },
          { label: 'x_k', points: xs.slice(0, 30).map((x) => [x, x]), style: 'points', color: 'var(--s3)', radius: 3.5, noLegend: true }
        ]}
        xMin={lo}
        xMax={hi}
        yMin={lo}
        yMax={hi}
        height={290}
      />
    </DemoFrame>
  )
}

export function NewtonDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', 'x^2-2')
  const lo0 = num(p, 'xMin', 0, -100, 100)
  const hi0 = num(p, 'xMax', 3, -100, 100)
  const [lo, hi] = lo0 < hi0 ? [lo0, hi0] : [0, 3]
  const [x0, setX0] = useState(num(p, 'x0', 2, lo, hi))
  const [steps, setSteps] = useState(int(p, 'steps', 6, 1, 30))
  const its = useMemo(() => newtonIterates(f, x0, steps), [f, x0, steps])
  const root = its[its.length - 1]?.x ?? NaN
  const tangents: [number, number][] = []
  for (let k = 0; k < its.length - 1; k++) {
    tangents.push([its[k].x, its[k].fx], [its[k + 1].x, 0], [NaN, NaN], [its[k + 1].x, 0], [its[k + 1].x, its[k + 1].fx], [NaN, NaN])
  }
  const errs = its.map((s) => Math.abs(s.x - root))
  return (
    <DemoFrame
      name="Newton's method"
      caption={caption ?? 'Each step follows the tangent to its zero. Near a simple root the number of correct digits roughly doubles per step.'}
      controls={
        <>
          <Slider label="x₀" value={x0} min={lo} max={hi} step={(hi - lo) / 200} onChange={setX0} fmt={(v) => v.toFixed(3)} />
          <Slider label="steps" value={steps} min={1} max={30} onChange={setSteps} />
        </>
      }
      readout={
        <>
          <span>
            f(x) = <b>{src}</b>
          </span>
          <span>
            x* ≈ <b>{Number.isFinite(root) ? root.toPrecision(14) : 'diverged'}</b>
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'f(x)', points: sample(f, lo, hi, 500), color: 'var(--s1)' },
          { label: 'tangent steps', points: tangents, color: 'var(--s2)', width: 1.3, noTip: true },
          { label: 'x_k', points: its.map((s) => [s.x, 0]), style: 'points', color: 'var(--s3)', radius: 4, noLegend: true }
        ]}
        xMin={lo}
        xMax={hi}
        height={250}
      />
      <table className="data-table" style={{ marginTop: 8, fontSize: 13 }}>
        <thead>
          <tr>
            <th>k</th>
            <th>x_k</th>
            <th>|f(x_k)|</th>
            <th>|x_k − x*|</th>
            <th>e_k / e_(k−1)²</th>
          </tr>
        </thead>
        <tbody>
          {its.slice(0, 8).map((s, k) => (
            <tr key={k}>
              <td>{k}</td>
              <td>{Number.isFinite(s.x) ? s.x.toPrecision(12) : '–'}</td>
              <td>{sci(Math.abs(s.fx))}</td>
              <td>{k === its.length - 1 ? '–' : sci(errs[k])}</td>
              <td>{k > 0 && k < its.length - 1 && errs[k - 1] > 1e-15 && errs[k] > 0 ? (errs[k] / errs[k - 1] ** 2).toFixed(3) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DemoFrame>
  )
}
