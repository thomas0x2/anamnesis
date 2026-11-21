// Numerical kernels behind the interactive demos. Pure functions, unit tested.

export const EPS = 2.220446049250313e-16

export function linspace(a: number, b: number, n: number): number[] {
  if (n <= 1) return [a]
  return Array.from({ length: n }, (_, i) => a + ((b - a) * i) / (n - 1))
}

// ---------------------------------------------------------------- polynomial interpolation
/** n+1 equispaced nodes on [a, b]. */
export function equispacedNodes(a: number, b: number, n: number): number[] {
  return linspace(a, b, n + 1)
}

/** n+1 Chebyshev nodes (zeros of T_{n+1}) on [a, b], in increasing order. */
export function chebyshevNodes(a: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let j = n; j >= 0; j--) out.push((a + b) / 2 + ((b - a) / 2) * Math.cos(((2 * j + 1) * Math.PI) / (2 * (n + 1))))
  return out
}

/** Barycentric weights w_j = 1 / Π_{k≠j} (x_j − x_k), scaled so that max |w_j| = 1. */
export function baryWeights(x: number[]): number[] {
  const n = x.length
  const span = (Math.max(...x) - Math.min(...x)) || 1
  const c = 4 / span // capacity scaling avoids overflow/underflow for larger n
  const w = new Array<number>(n).fill(1)
  for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) if (k !== j) w[j] /= c * (x[j] - x[k])
  const m = Math.max(...w.map(Math.abs)) || 1
  return w.map((v) => v / m)
}

/** Second (true) barycentric formula. */
export function baryEval(x: number[], y: number[], w: number[], t: number): number {
  let num = 0
  let den = 0
  for (let j = 0; j < x.length; j++) {
    const d = t - x[j]
    if (d === 0) return y[j]
    const q = w[j] / d
    num += q * y[j]
    den += q
  }
  return num / den
}

/** Lagrange basis polynomial ℓ_j(t) for nodes x. */
export function lagrangeBasis(x: number[], j: number, t: number): number {
  let p = 1
  for (let k = 0; k < x.length; k++) if (k !== j) p *= (t - x[k]) / (x[j] - x[k])
  return p
}

/** Lebesgue function λ(t) = Σ_j |ℓ_j(t)|. */
export function lebesgueFunction(x: number[], t: number): number {
  let s = 0
  for (let j = 0; j < x.length; j++) s += Math.abs(lagrangeBasis(x, j, t))
  return s
}

/** Divided differences table: returns the Newton coefficients f[x0], f[x0,x1], ... */
export function dividedDifferences(x: number[], y: number[]): number[] {
  const c = y.slice()
  const n = x.length
  for (let k = 1; k < n; k++) for (let i = n - 1; i >= k; i--) c[i] = (c[i] - c[i - 1]) / (x[i] - x[i - k])
  return c
}

/** Chebyshev polynomial T_n(t) (also outside [-1, 1]). */
export function chebT(n: number, t: number): number {
  if (Math.abs(t) <= 1) return Math.cos(n * Math.acos(t))
  const s = t > 0 ? 1 : n % 2 === 0 ? 1 : -1
  return s * Math.cosh(n * Math.acosh(Math.abs(t)))
}

// ---------------------------------------------------------------- Fourier
export interface Complex {
  re: number
  im: number
}

/** Naive DFT ĉ_k = Σ_j y_j ω^{jk}, ω = exp(−2πi/N) (the script's convention, no 1/N). */
export function dft(y: (number | Complex)[]): Complex[] {
  const N = y.length
  const out: Complex[] = []
  for (let k = 0; k < N; k++) {
    let re = 0
    let im = 0
    for (let j = 0; j < N; j++) {
      const v = y[j]
      const yr = typeof v === 'number' ? v : v.re
      const yi = typeof v === 'number' ? 0 : v.im
      const a = (-2 * Math.PI * j * k) / N
      const c = Math.cos(a)
      const s = Math.sin(a)
      re += yr * c - yi * s
      im += yr * s + yi * c
    }
    out.push({ re, im })
  }
  return out
}

/** Radix-2 FFT (length must be a power of two); same convention as dft. */
export function fft(y: Complex[]): Complex[] {
  const N = y.length
  if (N <= 1) return y.map((v) => ({ ...v }))
  if (N & (N - 1)) return dft(y)
  const even = fft(y.filter((_, i) => i % 2 === 0))
  const odd = fft(y.filter((_, i) => i % 2 === 1))
  const out = new Array<Complex>(N)
  for (let k = 0; k < N / 2; k++) {
    const a = (-2 * Math.PI * k) / N
    const c = Math.cos(a)
    const s = Math.sin(a)
    const t = { re: c * odd[k].re - s * odd[k].im, im: c * odd[k].im + s * odd[k].re }
    out[k] = { re: even[k].re + t.re, im: even[k].im + t.im }
    out[k + N / 2] = { re: even[k].re - t.re, im: even[k].im - t.im }
  }
  return out
}

export type PeriodicName = 'square' | 'sawtooth' | 'triangle' | 'smooth'

/** Standard 1-periodic test functions. */
export function periodicFn(name: string): (x: number) => number {
  const frac = (x: number): number => x - Math.floor(x)
  switch (name) {
    case 'square':
      return (x) => (frac(x) < 0.5 ? 1 : -1)
    case 'sawtooth':
      return (x) => 2 * frac(x + 0.5) - 1
    case 'triangle':
      return (x) => 1 - 4 * Math.abs(frac(x + 0.25) - 0.5)
    default:
      return (x) => Math.exp(Math.sin(2 * Math.PI * x))
  }
}

/** Fourier coefficients c_k = ∫_0^1 f(x) e^{−2πikx} dx for |k| ≤ m, by a fine Riemann sum (exact for trig polys). */
export function fourierCoefficients(f: (x: number) => number, m: number, samples = 2048): Map<number, Complex> {
  const ys = Array.from({ length: samples }, (_, j) => f((j + 0.5) / samples))
  const out = new Map<number, Complex>()
  for (let k = -m; k <= m; k++) {
    let re = 0
    let im = 0
    for (let j = 0; j < samples; j++) {
      const a = (-2 * Math.PI * k * (j + 0.5)) / samples
      re += ys[j] * Math.cos(a)
      im += ys[j] * Math.sin(a)
    }
    out.set(k, { re: re / samples, im: im / samples })
  }
  return out
}

export function fourierPartialSum(c: Map<number, Complex>, m: number, x: number): number {
  let s = 0
  for (let k = -m; k <= m; k++) {
    const ck = c.get(k)
    if (!ck) continue
    const a = 2 * Math.PI * k * x
    s += ck.re * Math.cos(a) - ck.im * Math.sin(a)
  }
  return s
}

/** Coefficients of the trigonometric interpolant of n equispaced samples y_j = f(j/n), indexed −⌊n/2⌋..⌈n/2⌉−1. */
export function trigInterpCoefficients(y: number[]): { k: number; c: Complex }[] {
  const n = y.length
  const Y = dft(y)
  const out: { k: number; c: Complex }[] = []
  const lo = -Math.floor(n / 2)
  for (let k = lo; k < lo + n; k++) {
    const v = Y[((k % n) + n) % n]
    out.push({ k, c: { re: v.re / n, im: v.im / n } })
  }
  return out
}

/** Evaluate the (real) trigonometric interpolant; for even n the Nyquist term is split symmetrically. */
export function trigInterpEval(coeffs: { k: number; c: Complex }[], n: number, t: number): number {
  let s = 0
  for (const { k, c } of coeffs) {
    const a = 2 * Math.PI * k * t
    if (n % 2 === 0 && Math.abs(k) === n / 2) s += c.re * Math.cos(a)
    else s += c.re * Math.cos(a) - c.im * Math.sin(a)
  }
  return s
}

/** The frequency in −n/2..n/2 that frequency k looks like when sampled at n equispaced points. */
export function aliasOf(k: number, n: number): number {
  const r = ((k % n) + n) % n
  return r > n / 2 ? r - n : r
}

// ---------------------------------------------------------------- splines
/** Second derivatives M_i of the natural cubic spline through (x_i, y_i). */
export function naturalSplineMoments(x: number[], y: number[]): number[] {
  const n = x.length - 1
  if (n < 2) return new Array(x.length).fill(0)
  const h = Array.from({ length: n }, (_, i) => x[i + 1] - x[i])
  // tridiagonal system for M_1..M_{n-1}
  const a: number[] = []
  const b: number[] = []
  const c: number[] = []
  const d: number[] = []
  for (let i = 1; i < n; i++) {
    a.push(h[i - 1])
    b.push(2 * (h[i - 1] + h[i]))
    c.push(h[i])
    d.push(6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1]))
  }
  const m = b.length
  for (let i = 1; i < m; i++) {
    const w = a[i] / b[i - 1]
    b[i] -= w * c[i - 1]
    d[i] -= w * d[i - 1]
  }
  const M = new Array<number>(m)
  M[m - 1] = d[m - 1] / b[m - 1]
  for (let i = m - 2; i >= 0; i--) M[i] = (d[i] - c[i] * M[i + 1]) / b[i]
  return [0, ...M, 0]
}

export function splineEval(x: number[], y: number[], M: number[], t: number): number {
  const n = x.length - 1
  let i = 0
  while (i < n - 1 && t > x[i + 1]) i++
  const h = x[i + 1] - x[i]
  const A = (x[i + 1] - t) / h
  const B = (t - x[i]) / h
  return A * y[i] + B * y[i + 1] + (((A ** 3 - A) * M[i] + (B ** 3 - B) * M[i + 1]) * h * h) / 6
}

export function piecewiseLinear(x: number[], y: number[], t: number): number {
  const n = x.length - 1
  let i = 0
  while (i < n - 1 && t > x[i + 1]) i++
  const s = (t - x[i]) / (x[i + 1] - x[i])
  return y[i] + s * (y[i + 1] - y[i])
}

// ---------------------------------------------------------------- quadrature
export type QuadRule = 'midpoint' | 'trapezoidal' | 'simpson' | 'gauss'

/** Gauss–Legendre nodes and weights on [−1, 1] (Newton on P_n). */
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const x = new Array<number>(n)
  const w = new Array<number>(n)
  for (let i = 0; i < Math.ceil(n / 2); i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5))
    let dp = 1
    for (let it = 0; it < 100; it++) {
      let p0 = 1
      let p1 = z
      for (let k = 2; k <= n; k++) {
        const p2 = ((2 * k - 1) * z * p1 - (k - 1) * p0) / k
        p0 = p1
        p1 = p2
      }
      const pn = n === 1 ? z : p1
      const pm = n === 1 ? 1 : p0
      dp = (n * (z * pn - pm)) / (z * z - 1)
      const dz = pn / dp
      z -= dz
      if (Math.abs(dz) < 1e-15) break
    }
    x[i] = -z
    x[n - 1 - i] = z
    w[i] = 2 / ((1 - z * z) * dp * dp)
    w[n - 1 - i] = w[i]
  }
  if (n === 1) return { x: [0], w: [2] }
  return { x, w }
}

/** Composite rule with N panels, or N-point Gauss–Legendre on the whole interval. */
export function quadrature(f: (x: number) => number, a: number, b: number, rule: QuadRule, N: number): number {
  const h = (b - a) / N
  let s = 0
  switch (rule) {
    case 'midpoint':
      for (let i = 0; i < N; i++) s += f(a + (i + 0.5) * h)
      return s * h
    case 'trapezoidal':
      s = (f(a) + f(b)) / 2
      for (let i = 1; i < N; i++) s += f(a + i * h)
      return s * h
    case 'simpson':
      for (let i = 0; i < N; i++) {
        const l = a + i * h
        s += f(l) + 4 * f(l + h / 2) + f(l + h)
      }
      return (s * h) / 6
    case 'gauss': {
      const g = gaussLegendre(N)
      for (let i = 0; i < N; i++) s += g.w[i] * f((a + b) / 2 + ((b - a) / 2) * g.x[i])
      return (s * (b - a)) / 2
    }
  }
}

/** Quadrature nodes of a rule (to draw them). */
export function quadratureNodes(a: number, b: number, rule: QuadRule, N: number): number[] {
  const h = (b - a) / N
  switch (rule) {
    case 'midpoint':
      return Array.from({ length: N }, (_, i) => a + (i + 0.5) * h)
    case 'trapezoidal':
      return Array.from({ length: N + 1 }, (_, i) => a + i * h)
    case 'simpson':
      return Array.from({ length: 2 * N + 1 }, (_, i) => a + (i * h) / 2)
    case 'gauss':
      return gaussLegendre(N).x.map((x) => (a + b) / 2 + ((b - a) / 2) * x)
  }
}

/** A reference value for ∫_a^b f, accurate to ~1e-13 for smooth integrands. */
export function referenceIntegral(f: (x: number) => number, a: number, b: number): number {
  let s = 0
  const panels = 16
  const g = gaussLegendre(20)
  const h = (b - a) / panels
  for (let p = 0; p < panels; p++) {
    const l = a + p * h
    for (let i = 0; i < 20; i++) s += g.w[i] * f(l + (h / 2) * (g.x[i] + 1))
  }
  return (s * h) / 2
}

// ---------------------------------------------------------------- iterations
export function fixedPointIterates(phi: (x: number) => number, x0: number, steps: number): number[] {
  const xs = [x0]
  for (let k = 0; k < steps; k++) {
    const v = phi(xs[k])
    if (!Number.isFinite(v)) break
    xs.push(v)
  }
  return xs
}

export function derivative(f: (x: number) => number, x: number): number {
  // Ridders-style Richardson extrapolation of central differences
  let h = 0.1 * Math.max(1, Math.abs(x))
  const T: number[][] = []
  let best = NaN
  let err = Infinity
  for (let i = 0; i < 8; i++) {
    T[i] = [(f(x + h) - f(x - h)) / (2 * h)]
    for (let j = 1; j <= i; j++) {
      const fac = 4 ** j
      T[i][j] = (fac * T[i][j - 1] - T[i - 1][j - 1]) / (fac - 1)
      const e = Math.max(Math.abs(T[i][j] - T[i][j - 1]), Math.abs(T[i][j] - T[i - 1][j - 1]))
      if (e < err) {
        err = e
        best = T[i][j]
      }
    }
    if (i > 1 && Math.abs(T[i][i] - T[i - 1][i - 1]) > 2 * err) break
    h /= 2
  }
  return Number.isFinite(best) ? best : T[0][0]
}

export interface NewtonStep {
  x: number
  fx: number
  dfx: number
}

export function newtonIterates(f: (x: number) => number, x0: number, steps: number): NewtonStep[] {
  const out: NewtonStep[] = []
  let x = x0
  for (let k = 0; k <= steps; k++) {
    const fx = f(x)
    const dfx = derivative(f, x)
    out.push({ x, fx, dfx })
    if (!Number.isFinite(fx) || !Number.isFinite(dfx) || dfx === 0 || Math.abs(fx) < 1e-300) break
    const nx = x - fx / dfx
    if (!Number.isFinite(nx)) break
    x = nx
  }
  return out
}

// ---------------------------------------------------------------- linear algebra
export interface Svd2 {
  U: [[number, number], [number, number]]
  s: [number, number]
  V: [[number, number], [number, number]]
}

/** SVD of a real 2×2 matrix A = U diag(s) Vᵀ, s₁ ≥ s₂ ≥ 0; columns of U and V are the singular vectors. */
export function svd2(A: number[][]): Svd2 {
  const [[a, b], [c, d]] = A
  const p = a * a + c * c
  const q = a * b + c * d
  const r = b * b + d * d
  const theta = 0.5 * Math.atan2(2 * q, p - r)
  const v1: [number, number] = [Math.cos(theta), Math.sin(theta)]
  const v2: [number, number] = [-Math.sin(theta), Math.cos(theta)]
  const Av1: [number, number] = [a * v1[0] + b * v1[1], c * v1[0] + d * v1[1]]
  const Av2: [number, number] = [a * v2[0] + b * v2[1], c * v2[0] + d * v2[1]]
  let s1 = Math.hypot(...Av1)
  let s2 = Math.hypot(...Av2)
  let V: [[number, number], [number, number]] = [
    [v1[0], v2[0]],
    [v1[1], v2[1]]
  ]
  let u1: [number, number] = s1 > 1e-14 ? [Av1[0] / s1, Av1[1] / s1] : [1, 0]
  let u2: [number, number] = s2 > 1e-14 ? [Av2[0] / s2, Av2[1] / s2] : [-u1[1], u1[0]]
  if (s2 > s1) {
    ;[s1, s2] = [s2, s1]
    ;[u1, u2] = [u2, u1]
    V = [
      [V[0][1], V[0][0]],
      [V[1][1], V[1][0]]
    ]
  }
  return {
    U: [
      [u1[0], u2[0]],
      [u1[1], u2[1]]
    ],
    s: [s1, s2],
    V
  }
}

/** Least squares via Householder QR: min ‖Ax − b‖₂ (A is m×n, m ≥ n, full rank). */
export function lstsq(A: number[][], b: number[]): number[] {
  const m = A.length
  const n = A[0]?.length ?? 0
  const R = A.map((row) => row.slice())
  const y = b.slice()
  for (let k = 0; k < n; k++) {
    let norm = 0
    for (let i = k; i < m; i++) norm += R[i][k] ** 2
    norm = Math.sqrt(norm)
    if (norm === 0) continue
    const alpha = R[k][k] > 0 ? -norm : norm
    const v = new Array<number>(m).fill(0)
    for (let i = k; i < m; i++) v[i] = R[i][k]
    v[k] -= alpha
    let vv = 0
    for (let i = k; i < m; i++) vv += v[i] ** 2
    if (vv === 0) continue
    for (let j = k; j < n; j++) {
      let s = 0
      for (let i = k; i < m; i++) s += v[i] * R[i][j]
      const f = (2 * s) / vv
      for (let i = k; i < m; i++) R[i][j] -= f * v[i]
    }
    let s = 0
    for (let i = k; i < m; i++) s += v[i] * y[i]
    const f = (2 * s) / vv
    for (let i = k; i < m; i++) y[i] -= f * v[i]
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]
    for (let j = i + 1; j < n; j++) s -= R[i][j] * x[j]
    x[i] = R[i][i] !== 0 ? s / R[i][i] : 0
  }
  return x
}

/** Deterministic pseudo-random numbers (mulberry32) so a demo looks the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal samples via Box–Muller. */
export function gaussianNoise(r: () => number): number {
  const u = Math.max(1e-12, r())
  const v = r()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
