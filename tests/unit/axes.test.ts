import { describe, expect, it } from 'vitest'
import { autoRange, fmtNum, fmtValue, logTicks, niceTicks, sample } from '../../src/renderer/src/lib/axes'

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

  it('keeps trailing zeros of whole numbers (450 is not 45)', () => {
    expect(fmtNum(450)).toBe('450')
    expect(fmtNum(100)).toBe('100')
    expect(fmtNum(-2000)).toBe('−2000')
    expect(fmtNum(10)).toBe('10')
    expect(fmtNum(20.0)).toBe('20')
  })

  it('shows answer previews exactly enough to check them', () => {
    expect(fmtValue(2482 - 2032)).toBe('450')
    expect(fmtValue(12345)).toBe('12345')
    expect(fmtValue(1 / 3)).toBe('0.3333333333')
    expect(fmtValue(0.1 + 0.2)).toBe('0.3')
    expect(fmtValue(-1500)).toBe('−1500')
    expect(fmtValue(2 ** -30)).toBe('9.313226e-10')
    expect(fmtValue(1e20)).toBe('1e20')
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
