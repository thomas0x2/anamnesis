// Demos for chapter 3: Fourier series, roots of unity, trigonometric interpolation, aliasing.
import { aliasOf, fourierCoefficients, fourierPartialSum, linspace, periodicFn, trigInterpCoefficients, trigInterpEval } from '@shared/numerics'
import { useMemo, useState, type ReactElement } from 'react'
import { Chart } from '../components/Chart'
import { Arrow, Check, DemoFrame, fnParam, int, Seg, Slider, sci, str, type Params } from './kit'

const SHAPES = ['square', 'sawtooth', 'triangle', 'smooth'] as const
type Shape = (typeof SHAPES)[number]

export function FourierSeriesDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [shape, setShape] = useState<Shape>(str(p, 'f', 'square', SHAPES))
  const [m, setM] = useState(int(p, 'm', 10, 0, 80))
  const f = useMemo(() => periodicFn(shape), [shape])
  const coeffs = useMemo(() => fourierCoefficients(f, 80), [f])
  const data = useMemo(() => {
    const ts = linspace(-0.25, 1.25, 900)
    const fx = ts.map((t) => [t, f(t)] as [number, number])
    const sx = ts.map((t) => [t, fourierPartialSum(coeffs, m, t)] as [number, number])
    let l2 = 0
    const inner = linspace(0, 1, 400)
    for (const t of inner) l2 += (f(t) - fourierPartialSum(coeffs, m, t)) ** 2
    const mags = Array.from({ length: 41 }, (_, k) => [k, Math.hypot(coeffs.get(k)!.re, coeffs.get(k)!.im)] as [number, number])
    return { fx, sx, l2: Math.sqrt(l2 / inner.length), mags }
  }, [f, coeffs, m])
  return (
    <DemoFrame
      name="Fourier partial sums"
      caption={caption ?? 'Jumps make the coefficients decay slowly (Gibbs overshoot stays ~9%); smooth periodic functions converge fast.'}
      controls={
        <>
          <Seg value={shape} onChange={setShape} options={SHAPES.map((s) => ({ value: s, label: s === 'smooth' ? 'exp(sin 2πx)' : s }))} />
          <Slider label="terms m" value={m} min={0} max={80} onChange={setM} />
        </>
      }
      readout={
        <span>
          L² error of S<sub>{m}</sub> ≈ <b>{sci(data.l2)}</b>
        </span>
      }
    >
      <Chart
        series={[
          { label: 'f (1-periodic)', points: data.fx },
          { label: `S_${m}(x) = Σ_{|k|≤${m}} c_k e^{2πikx}`, points: data.sx }
        ]}
        xMin={-0.25}
        xMax={1.25}
        height={230}
      />
      <Chart
        title="|c_k| (log scale): the decay rate reflects smoothness"
        series={[{ label: '|c_k|', points: data.mags.map(([k, v]) => [k, Math.max(v, 1e-17)] as [number, number]), style: 'stem', color: 'var(--s3)', radius: 3 }]}
        xMin={-0.5}
        xMax={40.5}
        yMin={1e-17}
        yMax={2}
        logY
        height={150}
        formatX={(x) => String(Math.round(x))}
        vlines={[{ x: m + 0.5, color: 'var(--accent)' }]}
      />
    </DemoFrame>
  )
}

export function RootsOfUnityDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [N, setN] = useState(int(p, 'N', 8, 2, 32))
  const [k, setK] = useState(int(p, 'k', 1, 0, 64))
  const [path, setPath] = useState(true)
  const kk = Math.min(k, 2 * N)
  const pts = useMemo(() => Array.from({ length: N }, (_, j) => [Math.cos((-2 * Math.PI * j * kk) / N), Math.sin((-2 * Math.PI * j * kk) / N)] as [number, number]), [N, kk])
  const sum = pts.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0])
  const distinct = new Set(pts.map((q) => `${q[0].toFixed(6)},${q[1].toFixed(6)}`)).size
  const circle = linspace(0, 2 * Math.PI, 200).map((t) => [Math.cos(t), Math.sin(t)] as [number, number])
  return (
    <DemoFrame
      name="Roots of unity"
      caption={caption ?? 'ω = e^{−2πi/N}. The powers ω^{jk}, j = 0..N−1, sum to N when N divides k, and to 0 otherwise: this is why the DFT matrix is orthogonal.'}
      controls={
        <>
          <Slider label="N" value={N} min={2} max={32} onChange={setN} />
          <Slider label="k" value={kk} min={0} max={2 * N} onChange={setK} />
          <Check label="connect j = 0, 1, 2, …" value={path} onChange={setPath} />
        </>
      }
      readout={
        <>
          <span>
            Σ<sub>j</sub> ω<sup>jk</sup> = <b>{Math.abs(sum[0]) < 1e-9 ? '0' : sum[0].toFixed(3)}{Math.abs(sum[1]) > 1e-9 ? ` ${sum[1] < 0 ? '−' : '+'} ${Math.abs(sum[1]).toFixed(3)}i` : ''}</b>
          </span>
          <span>
            {distinct} distinct points{distinct < N ? ` (each hit ${N / distinct}×)` : ''}
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'unit circle', points: circle, color: 'var(--line-2)', width: 1, noTip: true, noLegend: true },
          { label: 'ω^{jk}', points: pts, style: 'points', color: 'var(--s1)' }
        ]}
        xMin={-1.35}
        xMax={1.35}
        yMin={-1.35}
        yMax={1.35}
        equal
        height={300}
        overlay={(s) => (
          <g>
            {path && (
              <path
                d={pts.map((q, j) => `${j ? 'L' : 'M'}${s.x(q[0])},${s.y(q[1])}`).join('')}
                fill="none"
                stroke="var(--s2)"
                strokeWidth={1.3}
                opacity={0.7}
              />
            )}
            {pts.slice(0, Math.min(N, 12)).map((q, j) => (
              <text key={j} x={s.x(q[0] * 1.16)} y={s.y(q[1] * 1.16) + 4} textAnchor="middle" fontSize={10.5} fill="var(--muted)">
                {j}
              </text>
            ))}
            {Math.hypot(sum[0], sum[1]) > 1e-9 && <Arrow s={s} x1={0} y1={0} x2={Math.max(-1.3, Math.min(1.3, sum[0] / N))} y2={sum[1] / N} color="var(--s3)" />}
          </g>
        )}
      />
    </DemoFrame>
  )
}

export function TrigInterpDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', 'exp(sin(2*pi*x))')
  const [n, setN] = useState(int(p, 'n', 8, 2, 64))
  const [N, setNN] = useState(int(p, 'N', 64, 4, 512))
  const NN = Math.max(N, n)
  const data = useMemo(() => {
    const xs = Array.from({ length: n }, (_, j) => j / n)
    const ys = xs.map(f)
    const c = trigInterpCoefficients(ys)
    const fine = Array.from({ length: NN }, (_, j) => j / NN)
    const ts = linspace(0, 1, 600)
    return {
      samples: xs.map((x, j) => [x, ys[j]] as [number, number]),
      fx: ts.map((t) => [t, f(t)] as [number, number]),
      px: ts.map((t) => [t, trigInterpEval(c, n, t)] as [number, number]),
      fineVals: fine.map((t) => [t, trigInterpEval(c, n, t)] as [number, number]),
      coeffs: c.map(({ k, c: z }) => [k, Math.hypot(z.re, z.im)] as [number, number]),
      maxErr: Math.max(...ts.map((t) => Math.abs(f(t) - trigInterpEval(c, n, t))))
    }
  }, [f, n, NN])
  return (
    <DemoFrame
      name="Trigonometric interpolation"
      caption={caption ?? `n samples give n coefficients c_k (k = −n/2..n/2−1). Evaluating the interpolant on a fine grid of N points (zero padding) gives N values: two different grids.`}
      controls={
        <>
          <Slider label="samples n" value={n} min={2} max={64} onChange={setN} />
          <Slider label="evaluation points N" value={NN} min={4} max={512} onChange={setNN} />
        </>
      }
      readout={
        <>
          <span>
            f = <b>{src}</b>
          </span>
          <span>
            {n} values → {n} coefficients → {NN} values
          </span>
          <span>
            max error <b>{sci(data.maxErr)}</b>
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'f', points: data.fx, color: 'var(--line-2)', width: 1.5 },
          { label: 'interpolant p', points: data.px, color: 'var(--s1)' },
          { label: `p on the fine grid (N = ${NN})`, points: data.fineVals, style: 'points', color: 'var(--s3)', radius: NN > 128 ? 1.6 : 2.6 },
          { label: `samples (n = ${n})`, points: data.samples, style: 'points', color: 'var(--s2)', radius: 5 }
        ]}
        xMin={0}
        xMax={1}
        height={250}
      />
      <Chart
        title="Coefficients |c_k|: what the DFT of the n samples gives you (divided by n)"
        series={[{ label: '|c_k|', points: data.coeffs.map(([k, v]) => [k, Math.max(v, 1e-17)] as [number, number]), style: 'stem', color: 'var(--s4)', radius: 3 }]}
        xMin={-n / 2 - 1}
        xMax={n / 2 + 1}
        yMin={1e-17}
        yMax={3}
        logY
        height={140}
        formatX={(x) => String(Math.round(x))}
      />
    </DemoFrame>
  )
}

export function AliasingDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [k, setK] = useState(int(p, 'k', 7, 0, 40))
  const [n, setN] = useState(int(p, 'n', 8, 2, 40))
  const alias = aliasOf(k, n)
  const ts = linspace(0, 1, 800)
  return (
    <DemoFrame
      name="Aliasing"
      caption={caption ?? 'On n equispaced samples, frequency k is indistinguishable from k − mn for any integer m.'}
      controls={
        <>
          <Slider label="frequency k" value={k} min={0} max={40} onChange={setK} />
          <Slider label="samples n" value={n} min={2} max={40} onChange={setN} />
        </>
      }
      readout={
        <span>
          k = {k} sampled at n = {n} looks like <b>k′ = {alias}</b>
          {Math.abs(alias) === k ? ' (no aliasing: |k| < n/2)' : ''}
        </span>
      }
    >
      <Chart
        series={[
          { label: `cos(2π·${k}x)`, points: ts.map((t) => [t, Math.cos(2 * Math.PI * k * t)] as [number, number]), color: 'var(--s1)', width: 1.5 },
          { label: `alias cos(2π·${alias}x)`, points: ts.map((t) => [t, Math.cos(2 * Math.PI * alias * t)] as [number, number]), color: 'var(--s2)', style: 'dashed' },
          { label: 'samples', points: Array.from({ length: n }, (_, j) => [j / n, Math.cos((2 * Math.PI * k * j) / n)] as [number, number]), style: 'points', color: 'var(--s3)', radius: 5 }
        ]}
        xMin={0}
        xMax={1}
        yMin={-1.25}
        yMax={1.25}
        height={240}
      />
    </DemoFrame>
  )
}
