// Demos for chapters 7-8: the SVD of a 2×2 matrix and polynomial least squares.
import { gaussianNoise, linspace, lstsq, rng, svd2 } from '@shared/numerics'
import { useMemo, useState, type ReactElement } from 'react'
import { Chart, sample } from '../components/Chart'
import { Arrow, DemoFrame, fnParam, int, num, Slider, sci, type Params } from './kit'

function matrixParam(p: Params): number[][] {
  const A = p.A
  if (Array.isArray(A) && A.length === 2 && A.every((r) => Array.isArray(r) && r.length === 2 && r.every((v) => Number.isFinite(Number(v))))) return (A as unknown[][]).map((r) => r.map((v) => Math.max(-5, Math.min(5, Number(v)))))
  return [
    [2, 1],
    [1, 3]
  ]
}

export function SvdDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const [A, setA] = useState(matrixParam(p))
  const d = useMemo(() => svd2(A), [A])
  const circle = linspace(0, 2 * Math.PI, 240).map((t) => [Math.cos(t), Math.sin(t)] as [number, number])
  const ellipse = circle.map(([x, y]) => [A[0][0] * x + A[0][1] * y, A[1][0] * x + A[1][1] * y] as [number, number])
  const R = Math.max(1.3, d.s[0] * 1.15)
  const set = (i: number, j: number, v: number): void => setA((M) => M.map((r, a) => r.map((x, b) => (a === i && b === j ? v : x))))
  const cond = d.s[1] > 1e-12 ? d.s[0] / d.s[1] : Infinity
  return (
    <DemoFrame
      name="SVD: circle to ellipse"
      caption={caption ?? 'A maps the unit circle to an ellipse. The right singular vectors v_i go to the semi-axes σ_i u_i.'}
      controls={
        <>
          {[0, 1].map((i) =>
            [0, 1].map((j) => (
              <Slider key={`${i}${j}`} label={`a${i + 1}${j + 1}`} value={A[i][j]} min={-3} max={3} step={0.1} onChange={(v) => set(i, j, v)} fmt={(v) => v.toFixed(1)} />
            ))
          )}
        </>
      }
      readout={
        <>
          <span>
            σ₁ = <b>{d.s[0].toFixed(3)}</b>
          </span>
          <span>
            σ₂ = <b>{d.s[1].toFixed(3)}</b>
          </span>
          <span>
            cond₂(A) = σ₁/σ₂ = <b>{Number.isFinite(cond) ? cond.toFixed(2) : '∞ (singular)'}</b>
          </span>
          <span>
            rank <b>{d.s[1] > 1e-9 ? 2 : d.s[0] > 1e-9 ? 1 : 0}</b>
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: 'unit circle', points: circle, color: 'var(--line-2)', style: 'dashed', width: 1.2, noTip: true },
          { label: 'A · circle', points: ellipse, color: 'var(--s1)', noTip: true }
        ]}
        xMin={-R}
        xMax={R}
        yMin={-R}
        yMax={R}
        equal
        height={300}
        tooltip={false}
        overlay={(s) => (
          <g>
            <Arrow s={s} x1={0} y1={0} x2={d.V[0][0]} y2={d.V[1][0]} color="var(--s2)" />
            <Arrow s={s} x1={0} y1={0} x2={d.V[0][1]} y2={d.V[1][1]} color="var(--s3)" />
            <Arrow s={s} x1={0} y1={0} x2={d.s[0] * d.U[0][0]} y2={d.s[0] * d.U[1][0]} color="var(--s2)" width={3} />
            <Arrow s={s} x1={0} y1={0} x2={d.s[1] * d.U[0][1]} y2={d.s[1] * d.U[1][1]} color="var(--s3)" width={3} />
            <text x={s.x(d.V[0][0] * 1.12)} y={s.y(d.V[1][0] * 1.12)} fill="var(--text-2)" fontSize={11} textAnchor="middle">
              v₁
            </text>
            <text x={s.x(d.V[0][1] * 1.12)} y={s.y(d.V[1][1] * 1.12)} fill="var(--text-2)" fontSize={11} textAnchor="middle">
              v₂
            </text>
            <text x={s.x(d.s[0] * d.U[0][0] * 1.08)} y={s.y(d.s[0] * d.U[1][0] * 1.08)} fill="var(--text)" fontSize={11} textAnchor="middle">
              σ₁u₁
            </text>
            <text x={s.x(d.s[1] * d.U[0][1] * 1.15)} y={s.y(d.s[1] * d.U[1][1] * 1.15)} fill="var(--text)" fontSize={11} textAnchor="middle">
              σ₂u₂
            </text>
          </g>
        )}
      />
    </DemoFrame>
  )
}

export function LeastSquaresDemo({ p, caption }: { p: Params; caption?: string | null }): ReactElement {
  const { src, f } = fnParam(p, 'f', 'sin(2*x)')
  const [deg, setDeg] = useState(int(p, 'degree', 2, 0, 15))
  const [n, setN] = useState(int(p, 'n', 20, 3, 80))
  const [noise, setNoise] = useState(num(p, 'noise', 0.2, 0, 2))
  const data = useMemo(() => {
    const r = rng(17)
    const xs = linspace(-1.5, 1.5, n)
    const eps = xs.map(() => gaussianNoise(r))
    const ys = xs.map((x, i) => f(x) + noise * eps[i])
    const d = Math.min(deg, n - 1)
    // scaled monomials on [-1, 1] keep the least-squares matrix well conditioned
    const A = xs.map((x) => Array.from({ length: d + 1 }, (_, k) => (x / 1.5) ** k))
    const c = lstsq(A, ys)
    const fit = (x: number): number => c.reduce((s, ck, k) => s + ck * (x / 1.5) ** k, 0)
    const res = xs.map((x, i) => ys[i] - fit(x))
    return { xs, ys, fit, res, rnorm: Math.sqrt(res.reduce((s, v) => s + v * v, 0)), d, trueErr: Math.max(...linspace(-1.5, 1.5, 300).map((x) => Math.abs(fit(x) - f(x)))) }
  }, [f, deg, n, noise])
  return (
    <DemoFrame
      name="Least squares fit"
      caption={caption ?? 'More parameters always shrink the residual, but past a point the fit chases the noise.'}
      controls={
        <>
          <Slider label="degree" value={deg} min={0} max={15} onChange={setDeg} />
          <Slider label="samples" value={n} min={3} max={80} onChange={setN} />
          <Slider label="noise" value={noise} min={0} max={1} step={0.02} onChange={setNoise} fmt={(v) => v.toFixed(2)} />
        </>
      }
      readout={
        <>
          <span>
            ‖r‖₂ = <b>{sci(data.rnorm)}</b>
          </span>
          <span>
            max |fit − f| = <b>{sci(data.trueErr)}</b>
          </span>
          <span>
            {n} equations, {data.d + 1} unknowns
          </span>
        </>
      }
    >
      <Chart
        series={[
          { label: `true f = ${src}`, points: sample(f, -1.5, 1.5, 300), color: 'var(--muted)', style: 'dashed', width: 1.4 },
          { label: `degree-${data.d} fit`, points: sample(data.fit, -1.5, 1.5, 400), color: 'var(--s1)' },
          { label: 'data', points: data.xs.map((x, i) => [x, data.ys[i]]), style: 'points', color: 'var(--s2)', radius: 3.5 }
        ]}
        xMin={-1.5}
        xMax={1.5}
        height={260}
        overlay={(s) => (
          <g>
            {data.xs.map((x, i) => (
              <line key={i} x1={s.x(x)} x2={s.x(x)} y1={s.y(data.ys[i])} y2={s.y(data.fit(x))} stroke="var(--s2)" strokeWidth={1} opacity={0.6} />
            ))}
          </g>
        )}
      />
    </DemoFrame>
  )
}
