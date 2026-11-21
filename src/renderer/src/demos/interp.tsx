// Demos for chapter 2: polynomial interpolation, Lebesgue constants, Chebyshev polynomials, splines.
import {
  baryEval,
  baryWeights,
  chebT,
  chebyshevNodes,
  equispacedNodes,
  lagrangeBasis,
  lebesgueFunction,
  linspace,
  naturalSplineMoments,
  piecewiseLinear,
  splineEval
} from '@shared/numerics'
import { useMemo, useState, type ReactElement } from 'react'
import { Chart, type ChartSeries } from '../components/Chart'
import { bool, Check, DemoFrame, fnParam, int, num, Seg, Slider, sci, str, type Params } from './kit'

type NodeKind = 'equispaced' | 'chebyshev'
const nodesFor = (kind: NodeKind, a: number, b: number, n: number): number[] => (kind === 'chebyshev' ? chebyshevNodes(a, b, n) : equispacedNodes(a, b, n))

export function InterpolationDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', '1/(1+25*x^2)')
  const a0 = num(p, 'a', -1, -50, 50)
  const b0 = num(p, 'b', 1, -50, 50)
  const [a, b] = a0 < b0 ? [a0, b0] : [-1, 1]
  const [n, setN] = useState(int(p, 'n', 10, 1, 40))
  const [kind, setKind] = useState<NodeKind>(str(p, 'nodes', 'equispaced', ['equispaced', 'chebyshev'] as const))
  const [basis, setBasis] = useState(bool(p, 'showBasis', false))
  const [showErr, setShowErr] = useState(bool(p, 'showError', true))
  const [j, setJ] = useState(0)
  const data = useMemo(() => {
    const x = nodesFor(kind, a, b, n)
    const y = x.map(f)
    const w = baryWeights(x)
    const ts = linspace(a, b, 600)
    const fx = ts.map((t) => [t, f(t)] as [number, number])
    const px = ts.map((t) => [t, baryEval(x, y, w, t)] as [number, number])
    const err = ts.map((t, i) => [t, Math.abs(fx[i][1] - px[i][1])] as [number, number])
    const maxErr = Math.max(...err.map((e) => (Number.isFinite(e[1]) ? e[1] : 0)))
    const lam = Math.max(...ts.map((t) => lebesgueFunction(x, t)))
    return { x, y, fx, px, err, maxErr, lam, ts }
  }, [f, a, b, n, kind])
  const jj = Math.min(j, n)
  const main: ChartSeries[] = [
    { label: `f(x) = ${src}`, points: data.fx },
    { label: `p_${n}(x), ${n + 1} ${kind} nodes`, points: data.px },
    { label: 'nodes', points: data.x.map((x, i) => [x, data.y[i]]), style: 'points', color: 'var(--s2)', noLegend: true }
  ]
  const fy = data.fx.map((q) => q[1]).filter(Number.isFinite)
  const lo = Math.min(...fy)
  const hi = Math.max(...fy)
  const pad = (hi - lo || 1) * 0.6
  return (
    <DemoFrame
      name="Polynomial interpolation"
      caption={caption}
      controls={
        <>
          <Slider label="degree n" value={n} min={1} max={40} onChange={setN} />
          <Seg
            value={kind}
            onChange={setKind}
            options={[
              { value: 'equispaced', label: 'Equispaced' },
              { value: 'chebyshev', label: 'Chebyshev' }
            ]}
          />
          <Check label="error" value={showErr} onChange={setShowErr} />
          <Check label="Lagrange basis" value={basis} onChange={setBasis} />
        </>
      }
      readout={
        <>
          <span>
            max error <b>{sci(data.maxErr)}</b>
          </span>
          <span>
            Lebesgue constant Λ<sub>{n}</sub> ≈ <b>{sci(data.lam)}</b>
          </span>
        </>
      }
    >
      <Chart series={main} xMin={a} xMax={b} yMin={lo - pad} yMax={hi + pad} height={250} />
      {showErr && <Chart series={[{ label: '|f − p|', points: data.err, color: 'var(--s3)', style: 'area' }]} xMin={a} xMax={b} logY height={150} title="Pointwise error |f(x) − p(x)| (log scale)" />}
      {basis && (
        <>
          <Chart
            title={`Lagrange basis: ℓ_${jj} is 1 at node ${jj} and 0 at the other nodes`}
            series={[
              ...data.x.map((_, k) => ({ points: data.ts.map((t) => [t, lagrangeBasis(data.x, k, t)] as [number, number]), color: 'var(--line-2)', width: 1, noTip: true, noLegend: true })),
              { label: `ℓ_${jj}(x)`, points: data.ts.map((t) => [t, lagrangeBasis(data.x, jj, t)] as [number, number]), color: 'var(--s1)' },
              { label: 'nodes', points: data.x.map((x, k) => [x, k === jj ? 1 : 0]), style: 'points', color: 'var(--s2)', noLegend: true }
            ]}
            xMin={a}
            xMax={b}
            yMin={-1.5}
            yMax={2}
            height={170}
          />
          <div className="demo-controls">
            <Slider label="basis j" value={jj} min={0} max={n} onChange={setJ} />
          </div>
        </>
      )}
    </DemoFrame>
  )
}

export function LebesgueDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [n, setN] = useState(int(p, 'n', 10, 1, 40))
  const data = useMemo(() => {
    const ts = linspace(-1, 1, 700)
    const xe = equispacedNodes(-1, 1, n)
    const xc = chebyshevNodes(-1, 1, n)
    const le = ts.map((t) => [t, lebesgueFunction(xe, t)] as [number, number])
    const lc = ts.map((t) => [t, lebesgueFunction(xc, t)] as [number, number])
    return { le, lc, Le: Math.max(...le.map((q) => q[1])), Lc: Math.max(...lc.map((q) => q[1])) }
  }, [n])
  return (
    <DemoFrame
      name="Lebesgue function"
      caption={caption}
      controls={<Slider label="degree n" value={n} min={1} max={40} onChange={setN} />}
      readout={
        <>
          <span>
            Λ equispaced <b>{sci(data.Le)}</b> (grows like 2ⁿ)
          </span>
          <span>
            Λ Chebyshev <b>{sci(data.Lc)}</b> (grows like log n)
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'equispaced nodes', points: data.le },
          { label: 'Chebyshev nodes', points: data.lc }
        ]}
        xMin={-1}
        xMax={1}
        yMin={0.8}
        logY
        height={260}
        yLabel="λ(x) = Σ|ℓⱼ(x)|"
      />
    </DemoFrame>
  )
}

export function ChebyshevDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [n, setN] = useState(int(p, 'n', 5, 1, 24))
  const data = useMemo(() => {
    const ts = linspace(-1, 1, 600)
    const T = ts.map((t) => [t, chebT(n, t)] as [number, number])
    const zeros = Array.from({ length: n }, (_, k) => ((2 * k + 1) * Math.PI) / (2 * n))
    const extrema = Array.from({ length: n + 1 }, (_, k) => (k * Math.PI) / n)
    return { T, zeros, extrema }
  }, [n])
  return (
    <DemoFrame
      name="Chebyshev polynomial"
      caption={caption ?? `T_n(cos θ) = cos(nθ): equally spaced angles on the circle project to nodes that cluster at ±1.`}
      controls={<Slider label="n" value={n} min={1} max={24} onChange={setN} />}
      readout={
        <span>
          {n} zeros x<sub>k</sub> = cos((2k+1)π/(2n)), {n + 1} extrema where |T<sub>n</sub>| = 1
        </span>
      }
    >
      <Chart
        series={[
          { label: `T_${n}(x)`, points: data.T },
          { label: 'zeros', points: data.zeros.map((th) => [Math.cos(th), 0]), style: 'points', color: 'var(--s2)' },
          { label: 'extrema', points: data.extrema.map((th) => [Math.cos(th), chebT(n, Math.cos(th))]), style: 'points', color: 'var(--s3)' }
        ]}
        xMin={-1.1}
        xMax={1.1}
        yMin={-1.15}
        yMax={1.15}
        height={270}
        equal
        overlay={(s) => (
          <g>
            <path
              d={linspace(0, Math.PI, 120)
                .map((th, i) => `${i ? 'L' : 'M'}${s.x(Math.cos(th))},${s.y(Math.sin(th))}`)
                .join('')}
              fill="none"
              stroke="var(--line-2)"
              strokeWidth={1.2}
            />
            {data.zeros.map((th, k) => (
              <g key={k}>
                <line x1={s.x(Math.cos(th))} y1={s.y(Math.sin(th))} x2={s.x(Math.cos(th))} y2={s.y(0)} stroke="var(--s2)" strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />
                <circle cx={s.x(Math.cos(th))} cy={s.y(Math.sin(th))} r={3.5} fill="var(--s2)" stroke="var(--surface)" strokeWidth={1.5} />
              </g>
            ))}
          </g>
        )}
      />
    </DemoFrame>
  )
}

export function SplinesDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { f } = fnParam(p, 'f', '1/(1+25*x^2)')
  const n0 = int(p, 'n', 9, 3, 25)
  const [n, setN] = useState(n0)
  const [ys, setYs] = useState<number[] | null>(null)
  const [show, setShow] = useState({ linear: true, spline: true, poly: true })
  const x = useMemo(() => equispacedNodes(-1, 1, n - 1), [n])
  const y = ys && ys.length === n ? ys : x.map(f)
  const data = useMemo(() => {
    const ts = linspace(-1, 1, 500)
    const M = naturalSplineMoments(x, y)
    const w = baryWeights(x)
    return {
      lin: ts.map((t) => [t, piecewiseLinear(x, y, t)] as [number, number]),
      spl: ts.map((t) => [t, splineEval(x, y, M, t)] as [number, number]),
      pol: ts.map((t) => [t, baryEval(x, y, w, t)] as [number, number])
    }
  }, [x, y])
  const series: ChartSeries[] = []
  if (show.linear) series.push({ label: 'piecewise linear', points: data.lin, color: 'var(--s3)' })
  if (show.spline) series.push({ label: 'natural cubic spline', points: data.spl, color: 'var(--s1)' })
  if (show.poly) series.push({ label: `global polynomial (deg ${n - 1})`, points: data.pol, color: 'var(--s2)', style: 'dashed' })
  series.push({ label: 'data (drag me)', points: x.map((xi, i) => [xi, y[i]]), style: 'points', color: 'var(--text)', draggable: true, noLegend: true })
  return (
    <DemoFrame
      name="Splines vs one polynomial"
      caption={caption ?? 'Drag a data point: the spline changes mostly nearby, the global polynomial changes everywhere.'}
      controls={
        <>
          <Slider
            label="points"
            value={n}
            min={3}
            max={25}
            onChange={(v) => {
              setN(v)
              setYs(null)
            }}
          />
          <Check label="linear" value={show.linear} onChange={(v) => setShow((s) => ({ ...s, linear: v }))} />
          <Check label="cubic spline" value={show.spline} onChange={(v) => setShow((s) => ({ ...s, spline: v }))} />
          <Check label="polynomial" value={show.poly} onChange={(v) => setShow((s) => ({ ...s, poly: v }))} />
          <button className="btn sm ghost" onClick={() => setYs(null)}>
            Reset
          </button>
        </>
      }
    >
      <Chart
        series={series}
        xMin={-1.05}
        xMax={1.05}
        yMin={-1}
        yMax={2}
        height={270}
        onDrag={(sIdx, i, _x, yy) => {
          if (sIdx !== series.length - 1) return
          const next = y.slice()
          next[i] = Math.max(-0.9, Math.min(1.9, yy))
          setYs(next)
        }}
      />
    </DemoFrame>
  )
}
