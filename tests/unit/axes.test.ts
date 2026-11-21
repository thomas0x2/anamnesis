import { describe, expect, it } from 'vitest'
import { autoRange, fmtNum, logTicks, niceTicks, sample } from '../../src/renderer/src/lib/axes'

describe('axis ticks', () => {
  it('puts ticks on round numbers and hits zero exactly', () => {
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1])
    const t = niceTicks(-1, 1, 10)
    expect(t).toContain(0)
    expect(t.every((v) => v === 0 || Math.abs(v) >= 0.1)).toBe(true)
    expect(niceTicks(-1.07, 1.07, 4)).toEqual([-1, -0.5, 0, 0.5, 1])
    expect(niceTicks(3, 3)).toEqual([3])
  })

  it('uses powers of ten on log axes', () => {
    expect(logTicks(1e-4, 1)).toEqual([1e-4, 1e-3, 1e-2, 1e-1, 1])
    expect(logTicks(2, 5)).toEqual([2, 5])
  })
})

describe('number formatting', () => {
  it('formats plain, small and large numbers compactly with a real minus sign', () => {
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(1.5)).toBe('1.5')
    expect(fmtNum(-2)).toBe('−2')
    expect(fmtNum(123.4)).toBe('123')
    expect(fmtNum(0.125)).toBe('0.125')
    expect(fmtNum(1e-4)).toBe('1e-4')
    expect(fmtNum(-2.5e6)).toBe('−2.5e6')
    expect(fmtNum(9.96e-4)).toBe('1e-3')
    expect(fmtNum(Infinity)).toBe('Infinity')
  })
})

describe('ranges and sampling', () => {
  it('pads the data range and ignores a pole', () => {
    const [lo, hi] = autoRange([0, 1])
    expect(lo).toBeLessThan(0)
    expect(hi).toBeGreaterThan(1)
    const ys = sample((x) => 1 / x, -1, 1, 400).map(([, y]) => y)
    const [a, b] = autoRange(ys)
    expect(b - a).toBeLessThan(1e3)
    expect(autoRange([])).toEqual([-1, 1])
  })

  it('samples evenly, or evenly in log space', () => {
    expect(sample((x) => x, 0, 1, 4).map(([x]) => x)).toEqual([0, 0.25, 0.5, 0.75, 1])
    const xs = sample((x) => x, 1, 100, 2, true).map(([x]) => x)
    expect(xs[1]).toBeCloseTo(10, 12)
  })
})
