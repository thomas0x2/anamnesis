import { describe, expect, it } from 'vitest'
import { cliArgs, type CliConfig } from '../../src/node/claudeCli'
import { evalNumber, makeFn, normalizeExpr } from '../../src/shared/mathx'
import { fixTex, normalizeMd } from '../../src/shared/mdtex'
import { cleanPageText, findLabels, itemsToText } from '../../src/shared/pdfText'
import type { LlmRequest } from '../../src/shared/types'
import { deepMerge, shuffle, truncate } from '../../src/shared/util'

describe('Markdown and LaTeX repair', () => {
  it('un-doubles escaped commands but keeps matrix line breaks', () => {
    expect(fixTex('\\\\frac{a}{b} + \\\\alpha')).toBe('\\frac{a}{b} + \\alpha')
    expect(fixTex('\\begin{pmatrix} a \\\\ b \\end{pmatrix}')).toBe('\\begin{pmatrix} a \\\\ b \\end{pmatrix}')
    expect(fixTex('\\\\fracture')).toBe('\\\\fracture')
  })

  it('converts \\( \\) and \\[ \\] to dollar math', () => {
    expect(normalizeMd('so \\(x^2\\) holds')).toBe('so $x^2$ holds')
    expect(normalizeMd('see \\[ \\sum_k c_k \\] here')).toBe('see \n$$\n\\sum_k c_k\n$$\n here')
  })

  it('moves display math out of running text but leaves lists and tables alone', () => {
    expect(normalizeMd('We get $$a=b$$ and more')).toBe('We get\n\n$$\na=b\n$$\n\nand more')
    expect(normalizeMd('$$x$$')).toBe('\n$$\nx\n$$\n')
    expect(normalizeMd('$$ a+b $$')).toBe('\n$$\na+b\n$$\n')
    expect(normalizeMd('- item $$x$$')).toBe('- item $$x$$')
    expect(normalizeMd('| $$x$$ | y |')).toBe('| $$x$$ | y |')
    expect(normalizeMd('$$\nx\n$$')).toBe('$$\nx\n$$')
  })
})

describe('safe math evaluation', () => {
  it('evaluates the notations learners type', () => {
    expect(evalNumber('1/3')).toBeCloseTo(1 / 3)
    expect(evalNumber('2**-3')).toBe(0.125)
    expect(evalNumber('π/4')).toBeCloseTo(Math.PI / 4)
    expect(evalNumber('ln(e)')).toBeCloseTo(1)
    expect(evalNumber('√(2)')).toBeCloseTo(Math.SQRT2)
    expect(evalNumber('1,5')).toBe(1.5)
    expect(evalNumber('3 × 4')).toBe(12)
    expect(evalNumber('')).toBeNull()
    expect(evalNumber('sqrt(-1)')).toBeNull()
    expect(normalizeExpr('np.sin(x)')).toBe('sin(x)')
  })

  it('refuses the functions that could escape the sandbox', () => {
    for (const src of ['import({a: 1}, {})', 'evaluate("1+1")', 'parse("1+1")', 'createUnit("foo")', 'simplify("x+x")', 'derivative("x^2", "x")']) {
      expect(evalNumber(src), src).toBeNull()
    }
    const f = makeFn('evaluate("x")')!
    expect(Number.isNaN(f(1))).toBe(true)
  })

  it('builds plot functions that return NaN where the function is undefined', () => {
    const f = makeFn('sqrt(x)')!
    expect(f(4)).toBe(2)
    expect(Number.isNaN(f(-1))).toBe(true)
    expect(makeFn('1/(1+25x^2)')!(0)).toBe(1)
    expect(makeFn('x +* 2')).toBeNull()
  })
})

describe('Claude Code CLI arguments', () => {
  const cfg: CliConfig = { path: null, model: '', effort: 'medium', fallbackModel: null, timeoutSec: 60, workDir: '/tmp/x' }
  const req: LlmRequest = { id: 'r', kind: 'step', system: 's', prompt: 'p', schema: { type: 'object' } }
  const valueOf = (args: string[], flag: string): string | undefined => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined)

  it('runs print mode with structured output and no tools', () => {
    const a = cliArgs(req, cfg, '/tmp/sys.txt')
    expect(a[0]).toBe('-p')
    expect(valueOf(a, '--output-format')).toBe('stream-json')
    expect(valueOf(a, '--json-schema')).toBe('{"type":"object"}')
    expect(valueOf(a, '--system-prompt-file')).toBe('/tmp/sys.txt')
    expect(valueOf(a, '--tools')).toBe('')
    expect(a).toContain('--no-session-persistence')
    expect(a).toContain('--strict-mcp-config')
  })

  it('leaves the model to the learner’s Claude Code default unless one is set', () => {
    expect(cliArgs(req, cfg, 'f')).not.toContain('--model')
    expect(valueOf(cliArgs(req, { ...cfg, model: 'my-model' }, 'f'), '--model')).toBe('my-model')
    expect(valueOf(cliArgs({ ...req, model: 'per-request' }, { ...cfg, model: 'my-model' }, 'f'), '--model')).toBe('per-request')
  })

  it('passes a fallback model only when it differs from the main one', () => {
    expect(valueOf(cliArgs(req, { ...cfg, model: 'a', fallbackModel: 'b' }, 'f'), '--fallback-model')).toBe('b')
    expect(cliArgs(req, { ...cfg, model: 'a', fallbackModel: 'a' }, 'f')).not.toContain('--fallback-model')
  })

  it('uses the request effort before the configured one', () => {
    expect(valueOf(cliArgs(req, cfg, 'f'), '--effort')).toBe('medium')
    expect(valueOf(cliArgs({ ...req, effort: 'high' }, cfg, 'f'), '--effort')).toBe('high')
  })
})

describe('script text helpers', () => {
  it('joins text items into lines and repairs hyphenation', () => {
    const items = [
      { str: 'Lagrange', transform: [1, 0, 0, 1, 10, 700] },
      { str: 'basis', transform: [1, 0, 0, 1, 60, 700] },
      { str: 'Satz 2.2.3', transform: [1, 0, 0, 1, 10, 680], hasEOL: true }
    ]
    expect(itemsToText(items)).toBe('Lagrange basis\nSatz 2.2.3')
    expect(cleanPageText('Inter-\npolation   und\n\n\n\nmehr')).toBe('Interpolation und\n\nmehr')
  })

  it('finds numbered labels like Satz 2.2.3 at the start of a line', () => {
    const hits = findLabels(57, 'Definition 2.2.1 (Lagrange-Polynome)\nSatz 2.2.3 Die Interpolation ist eindeutig.\nwie in Satz 2.2.3 gezeigt')
    expect(hits.map((h) => [h.kind, h.label])).toEqual([
      ['Definition', '2.2.1'],
      ['Satz', '2.2.3']
    ])
    expect(hits.every((h) => h.page === 57)).toBe(true)
  })
})

describe('small utilities', () => {
  it('truncates on whitespace-normalized text', () => {
    expect(truncate('a   b\n c', 10)).toBe('a b c')
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })

  it('shuffles deterministically with a seed and keeps every element', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(shuffle(xs, 42)).toEqual(shuffle(xs, 42))
    expect([...shuffle(xs, 42)].sort()).toEqual(xs)
  })

  it('deep-merges settings patches without touching arrays', () => {
    const base = { cli: { model: '', effort: 'medium' }, list: [1, 2], x: 1 }
    expect(deepMerge(base, { cli: { effort: 'high' }, list: [3] })).toEqual({ cli: { model: '', effort: 'high' }, list: [3], x: 1 })
    expect(deepMerge(base, undefined)).toBe(base)
  })
})
