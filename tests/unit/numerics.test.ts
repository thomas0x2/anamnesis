import { describe, expect, it } from 'vitest'
import {
  aliasOf,
  baryEval,
  baryWeights,
  chebT,
  chebyshevNodes,
  derivative,
  dft,
  dividedDifferences,
  equispacedNodes,
  fft,
  fixedPointIterates,
  fourierCoefficients,
  gaussLegendre,
  lebesgueFunction,
  linspace,
  lstsq,
  naturalSplineMoments,
  newtonIterates,
  quadrature,
  referenceIntegral,
  rng,
  splineEval,
  svd2,
  trigInterpCoefficients,
  trigInterpEval,
  type Complex
} from '../../src/shared/numerics'

const maxOver = (xs: number[], f: (x: number) => number): number => Math.max(...xs.map(f))

describe('polynomial interpolation', () => {
  it('Chebyshev nodes are the sorted zeros of T_{n+1} inside the interval', () => {
    const x = chebyshevNodes(-1, 1, 6)
    expect(x).toHaveLength(7)
    for (let i = 1; i < x.length; i++) expect(x[i]).toBeGreaterThan(x[i - 1])
    for (const t of x) expect(Math.abs(chebT(7, t))).toBeLessThan(1e-12)
    const y = chebyshevNodes(2, 5, 3)
    expect(Math.min(...y)).toBeGreaterThan(2)
    expect(Math.max(...y)).toBeLessThan(5)
  })

  it('barycentric interpolation reproduces polynomials of degree n exactly', () => {
    const p = (t: number): number => t ** 3 - 2 * t + 0.5
    const x = chebyshevNodes(-1, 1, 3)
    const w = baryWeights(x)
    for (const t of linspace(-1, 1, 21)) expect(baryEval(x, x.map(p), w, t)).toBeCloseTo(p(t), 12)
    expect(baryEval(x, x.map(p), w, x[2])).toBe(p(x[2]))
  })

  it('divided differences give the Newton coefficients', () => {
    expect(dividedDifferences([0, 1, 2], [0, 1, 4])).toEqual([0, 1, 1])
    const c = dividedDifferences([0, 1, 2, 3], [1, 2, 9, 28])
    expect(c[3]).toBeCloseTo(1, 12)
  })

  it('the Lebesgue constant explodes for equispaced nodes but not for Chebyshev nodes', () => {
    const grid = linspace(-1, 1, 2001)
    const n = 20
    const lamEq = maxOver(grid, (t) => lebesgueFunction(equispacedNodes(-1, 1, n), t))
    const lamCh = maxOver(grid, (t) => lebesgueFunction(chebyshevNodes(-1, 1, n), t))
    expect(lamEq).toBeGreaterThan(1e4)
    // the classical bound for Chebyshev nodes: Λ_n ≤ (2/π) log(n + 1) + 1
    expect(lamCh).toBeLessThan((2 / Math.PI) * Math.log(n + 1) + 1)
    expect(lebesgueFunction(equispacedNodes(-1, 1, 6), 0)).toBeCloseTo(1, 12)
  })

  it('Runge: Chebyshev interpolation of 1/(1+25x^2) converges, equispaced does not', () => {
    const f = (t: number): number => 1 / (1 + 25 * t * t)
    const err = (x: number[]): number => {
      const w = baryWeights(x)
      const y = x.map(f)
      return maxOver(linspace(-1, 1, 1001), (t) => Math.abs(baryEval(x, y, w, t) - f(t)))
    }
    expect(err(equispacedNodes(-1, 1, 20))).toBeGreaterThan(10)
    expect(err(chebyshevNodes(-1, 1, 60))).toBeLessThan(1e-4)
  })
})

describe('Fourier', () => {
  const close = (a: Complex, b: Complex, d = 1e-10): void => {
    expect(a.re).toBeCloseTo(b.re, -Math.log10(d))
    expect(a.im).toBeCloseTo(b.im, -Math.log10(d))
  }

  it('the DFT of a constant puts everything at frequency 0 (no 1/N)', () => {
    const Y = dft([1, 1, 1, 1])
    close(Y[0], { re: 4, im: 0 })
    for (const k of [1, 2, 3]) close(Y[k], { re: 0, im: 0 })
  })

  it('the FFT agrees with the naive DFT', () => {
    const r = rng(7)
    const y: Complex[] = Array.from({ length: 16 }, () => ({ re: r() - 0.5, im: r() - 0.5 }))
    const a = dft(y)
    const b = fft(y)
    for (let k = 0; k < 16; k++) close(a[k], b[k])
    expect(fft(y.slice(0, 6))).toHaveLength(6)
  })

  it('trigonometric interpolation matches the samples, for odd and even n', () => {
    for (const n of [7, 8]) {
      const f = (t: number): number => Math.exp(Math.sin(2 * Math.PI * t))
      const y = Array.from({ length: n }, (_, j) => f(j / n))
      const c = trigInterpCoefficients(y)
      for (let j = 0; j < n; j++) expect(trigInterpEval(c, n, j / n)).toBeCloseTo(y[j], 10)
    }
  })

  it('aliases a frequency to the one it looks like on n samples', () => {
    expect(aliasOf(7, 5)).toBe(2)
    expect(aliasOf(3, 5)).toBe(-2)
    expect(aliasOf(-1, 4)).toBe(-1)
    expect(aliasOf(9, 8)).toBe(1)
    const n = 8
    const t = 3 / n
    expect(Math.cos(2 * Math.PI * 9 * t)).toBeCloseTo(Math.cos(2 * Math.PI * aliasOf(9, n) * t), 12)
  })

  it('recovers the coefficients of a trigonometric polynomial', () => {
    const c = fourierCoefficients((x) => 3 + 2 * Math.cos(2 * Math.PI * x), 2, 256)
    close(c.get(0)!, { re: 3, im: 0 })
    close(c.get(1)!, { re: 1, im: 0 })
    close(c.get(-1)!, { re: 1, im: 0 })
    close(c.get(2)!, { re: 0, im: 0 })
  })
})

describe('splines', () => {
  it('a natural spline reproduces straight lines and passes through the data', () => {
    const x = [0, 0.5, 1.5, 2, 3]
    const lin = x.map((t) => 2 * t - 1)
    expect(naturalSplineMoments(x, lin).every((m) => Math.abs(m) < 1e-12)).toBe(true)
    const y = [0, 1, -1, 2, 0]
    const M = naturalSplineMoments(x, y)
    expect(M[0]).toBe(0)
    expect(M[M.length - 1]).toBe(0)
    x.forEach((t, i) => expect(splineEval(x, y, M, t)).toBeCloseTo(y[i], 12))
  })

  it('has continuous slopes at the interior knots', () => {
    const x = [0, 1, 2, 3]
    const y = [0, 2, 1, 3]
    const M = naturalSplineMoments(x, y)
    const s = (t: number): number => splineEval(x, y, M, t)
    for (const k of [1, 2]) {
      const left = (s(k) - s(k - 1e-6)) / 1e-6
      const right = (s(k + 1e-6) - s(k)) / 1e-6
      expect(left).toBeCloseTo(right, 4)
    }
  })
})

describe('quadrature', () => {
  it('Gauss-Legendre has the textbook nodes and is exact up to degree 2n-1', () => {
    const g3 = gaussLegendre(3)
    expect(g3.x[0]).toBeCloseTo(-Math.sqrt(3 / 5), 14)
    expect(g3.x[1]).toBeCloseTo(0, 14)
    expect(g3.w).toEqual(expect.arrayContaining([expect.closeTo(8 / 9, 14), expect.closeTo(5 / 9, 14)]))
    for (const n of [1, 2, 5, 10]) {
      const g = gaussLegendre(n)
      expect(g.w.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 13)
      expect(quadrature((t) => t ** (2 * n - 2) + t ** (2 * n - 1), -1, 1, 'gauss', n)).toBeCloseTo(2 / (2 * n - 1), 12)
    }
  })

  it('composite rules converge at their orders (2, 2, 4)', () => {
    const f = Math.exp
    const exact = Math.E - 1
    const ratio = (rule: 'midpoint' | 'trapezoidal' | 'simpson'): number =>
      Math.abs(quadrature(f, 0, 1, rule, 8) - exact) / Math.abs(quadrature(f, 0, 1, rule, 16) - exact)
    expect(ratio('midpoint')).toBeCloseTo(4, 1)
    expect(ratio('trapezoidal')).toBeCloseTo(4, 1)
    expect(ratio('simpson')).toBeCloseTo(16, 0)
  })

  it('has an accurate reference integral', () => {
    expect(referenceIntegral(Math.exp, 0, 1)).toBeCloseTo(Math.E - 1, 13)
    expect(referenceIntegral(Math.sin, 0, Math.PI)).toBeCloseTo(2, 13)
  })
})

describe('iterations', () => {
  it('fixed-point iteration of cos converges to the Dottie number', () => {
    const xs = fixedPointIterates(Math.cos, 1, 80)
    expect(xs.at(-1)).toBeCloseTo(0.7390851332, 9)
  })

  it('Newton converges quadratically to sqrt(2)', () => {
    const steps = newtonIterates((x) => x * x - 2, 1, 6)
    const errs = steps.map((s) => Math.abs(s.x - Math.SQRT2))
    expect(errs.at(-1)).toBeLessThan(1e-14)
    expect(errs[3]).toBeLessThan(errs[2] ** 2 * 1)
  })

  it('differentiates numerically to high accuracy', () => {
    expect(derivative(Math.sin, 1)).toBeCloseTo(Math.cos(1), 10)
    expect(derivative((x) => x ** 5, 2)).toBeCloseTo(80, 8)
  })
})

describe('linear algebra', () => {
  it('svd2 reconstructs the matrix with ordered singular values', () => {
    for (const A of [
      [
        [3, 1],
        [1, 2]
      ],
      [
        [0, -2],
        [1, 0]
      ],
      [
        [1, 2],
        [2, 4]
      ]
    ]) {
      const { U, s, V } = svd2(A)
      expect(s[0]).toBeGreaterThanOrEqual(s[1])
      expect(s[1]).toBeGreaterThanOrEqual(0)
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) expect(U[i][0] * s[0] * V[j][0] + U[i][1] * s[1] * V[j][1]).toBeCloseTo(A[i][j], 12)
    }
  })

  it('lstsq solves an overdetermined system in the least-squares sense', () => {
    const xs = [0, 1, 2, 3, 4]
    const A = xs.map((x) => [1, x])
    expect(lstsq(A, xs.map((x) => 2 + 3 * x)).map((v) => +v.toFixed(12))).toEqual([2, 3])
    const noisy = lstsq(A, [1, 3, 2, 5, 4])
    // normal equations: [5 10; 10 30] c = [15; 38]
    expect(noisy[0]).toBeCloseTo(1.4, 12)
    expect(noisy[1]).toBeCloseTo(0.8, 12)
  })
})
