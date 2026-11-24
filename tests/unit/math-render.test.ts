// Regression: tutor text with math must render through KaTeX however the model escaped its delimiters.
// Every case goes through the same pipeline as the app's Markdown component (normalizeMd, remark-math,
// GFM, KaTeX) and checks that no math source is left as plain text.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { normalizeMd } from '../../src/shared/mdtex'
import { rehypePlugins, remarkPlugins } from '../../src/renderer/src/lib/mdPipeline'

const html = (md: string): string => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins, skipHtml: true }, normalizeMd(md)))
/** The visible text, without KaTeX's hidden TeX source and without code spans. */
const visible = (h: string): string =>
  h
    .replace(/<annotation[\s\S]*?<\/annotation>/g, '')
    .replace(/<code>[\s\S]*?<\/code>/g, '')
    .replace(/<[^>]+>/g, '')
const mathCount = (h: string): number => (h.match(/class="katex"/g) ?? []).length

// The question from the bug report, with plain $…$ delimiters.
const Q =
  'A 64-bit computer can only store finitely many numbers, yet scientific computing needs everything from $10^{-100}$ to $10^{100}$. ' +
  'To cover that huge range, floating-point numbers (*Gleitkommazahlen*) trade uniform spacing for a **relative** spacing.\n\n' +
  'Consider `x = 1e16` in Python (`float64`), where machine epsilon is $\\varepsilon \\approx 2.2 \\times 10^{-16}$ and the largest `float64` is $\\approx 1.8 \\times 10^{308}$.'

/** The same text with each math span delimited by open … close. */
const withDelims = (open: string, close: string): string => Q.replace(/\$([^$]+)\$/g, (_m, x: string) => `${open}${x}${close}`)

describe('math in tutor text renders whatever the escaping', () => {
  const B = '\\'
  const cases: Record<string, string> = {
    plain: Q,
    'escaped \\$': withDelims(`${B}$`, `${B}$`),
    'escaped twice \\\\$': withDelims(`${B}${B}$`, `${B}${B}$`),
    'escaped three times': withDelims(`${B}${B}${B}$`, `${B}${B}${B}$`),
    'escaped four times': withDelims(`${B}${B}${B}${B}$`, `${B}${B}${B}${B}$`),
    'only the opening escaped': withDelims(`${B}$`, '$'),
    'only the opening escaped twice': withDelims(`${B}${B}$`, '$'),
    'only the closing escaped': withDelims('$', `${B}$`),
    'only the closing escaped twice': withDelims('$', `${B}${B}$`),
    '\\( \\)': withDelims(`${B}(`, `${B})`),
    '\\\\( \\\\)': withDelims(`${B}${B}(`, `${B}${B})`),
    'HTML entities': withDelims('&#36;', '&#36;'),
    'full-width dollars': withDelims('＄', '＄'),
    'commands escaped twice': Q.replace(/\\(varepsilon|approx|times)/g, '\\\\$1'),
    'commands escaped four times': Q.replace(/\\(varepsilon|approx|times)/g, '\\\\\\\\$1')
  }
  for (const [name, md] of Object.entries(cases)) {
    it(`renders all four formulas: ${name}`, () => {
      const h = html(md)
      expect(mathCount(h)).toBe(4)
      expect(visible(h)).not.toMatch(/\$|\\varepsilon|\\approx|\\times|\^\{/)
      // the rest of the Markdown still renders
      expect(h).toContain('<strong>relative</strong>')
      expect(h).toContain('<em>Gleitkommazahlen</em>')
      expect(h).toContain('<code>x = 1e16</code>')
    })
  }

  it('renders \\[ \\] (also with doubled backslashes) as display math', () => {
    for (const [o, c] of [['\\[', '\\]'], ['\\\\[', '\\\\]']]) {
      const h = html(`so ${o}\\varepsilon \\approx 2.2 \\times 10^{-16}${c} holds`)
      expect(h).toContain('katex-display')
      expect(visible(h)).not.toMatch(/\\varepsilon|\\\[/)
    }
  })

  it('renders a span that wraps onto the next line', () => {
    const h = html('machine epsilon is \\$\\varepsilon \\approx\n2.2 \\times 10^{-16}\\$ here')
    expect(mathCount(h)).toBe(1)
    expect(visible(h)).not.toContain('$')
  })

  it('leaves code exactly as written', () => {
    expect(normalizeMd('run `echo \\$HOME \\$PATH` now')).toBe('run `echo \\$HOME \\$PATH` now')
    expect(normalizeMd('```sh\nprintf "\\$x^2\\$"\n```')).toBe('```sh\nprintf "\\$x^2\\$"\n```')
    expect(html('use `\\(x\\)` literally')).toContain('<code>\\(x\\)</code>')
  })

  it('leaves prices alone', () => {
    expect(normalizeMd('costs \\$5 and \\$7 more')).toBe('costs \\$5 and \\$7 more')
    expect(normalizeMd('it costs \\$5 and $x^2$ more')).toBe('it costs \\$5 and $x^2$ more')
  })

  it('keeps a matrix line break with spacing inside real math', () => {
    expect(normalizeMd('$\\begin{pmatrix}a \\\\[2pt] b\\end{pmatrix}$')).toBe('$\\begin{pmatrix}a \\\\[2pt] b\\end{pmatrix}$')
    expect(mathCount(html('$$\\begin{pmatrix}a\\\\b\\end{pmatrix}$$'))).toBe(1)
  })
})
