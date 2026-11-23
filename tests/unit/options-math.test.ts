// Regression: math in multiple-choice options (and code above a question) must survive the tutor's
// tool arguments, however the model formats them, and render through KaTeX.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { normalizeCard, type NormalizeContext } from '../../src/shared/normalize'
import { normalizeMd } from '../../src/shared/mdtex'
import ReactMarkdown from 'react-markdown'
import { rehypePlugins, remarkPlugins } from '../../src/renderer/src/lib/mdPipeline'

const ctx: NormalizeContext = { conceptIds: new Set(['c1']), defaultConceptId: 'c1' }
// the same pipeline as the Markdown component: normalizeMd, then remark-math, GFM and KaTeX
const html = (md: string): string => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins, skipHtml: true }, normalizeMd(md)))
const isMath = (md: string): boolean => html(md).includes('class="katex"') && !html(md).includes('10^{-16}$')

const options = [
  { id: 'a', md: '`True`', correct: false, feedback: '' },
  { id: 'b', md: '`False`, because doubles resolve differences down to about $2.2\\cdot 10^{-16}$', correct: true, feedback: '' },
  { id: 'c', md: '`False`, because 1 is an integer and integers are stored exactly', correct: false, feedback: '' }
]
const ask = (interaction: unknown, blocks: unknown): unknown => ({ kind: 'check', blocks, interaction })
const base = { type: 'mcq', prompt: 'What does this print with numpy/Python doubles (float64)?', hints: [], solution: '', confidence: true, conceptIds: ['c1'] }
const code = { type: 'code', code: { language: 'python', source: 'print(1 + 1e-16 == 1)' } }

describe('math in multiple-choice options', () => {
  it('renders an option that mixes inline code and math', () => {
    const card = normalizeCard(ask({ ...base, options }, [code]), ctx)!
    const b = card.interaction!.options!.find((o) => o.id === 'b')!
    expect(isMath(b.md)).toBe(true)
    expect(html(b.md)).toContain('<code>False</code>')
  })

  it('renders half-escaped math the model sometimes writes', () => {
    expect(isMath('about \\$2.2\\cdot 10^{-16}$')).toBe(true)
    expect(isMath('about $2.2\\cdot 10^{-16}\\$')).toBe(true)
    expect(isMath('about \\$2.2\\cdot 10^{-16}\\$')).toBe(true)
  })

  it('leaves escaped prices alone', () => {
    expect(normalizeMd('it costs \\$5 and $x^2$ more')).toBe('it costs \\$5 and $x^2$ more')
  })

  it('reads options, the interaction and blocks sent as JSON strings', () => {
    const card = normalizeCard(ask(JSON.stringify({ ...base, options: JSON.stringify(options) }), JSON.stringify([code])), ctx)!
    expect(card.interaction!.type).toBe('mcq')
    expect(card.interaction!.options).toHaveLength(3)
    expect(isMath(card.interaction!.options![1].md)).toBe(true)
    expect(card.blocks.map((b) => b.type)).toEqual(['code'])
  })
})

describe('code shown above a question', () => {
  it('keeps code given as a plain string or with source beside the type', () => {
    expect(normalizeCard(ask({ ...base, options }, [{ type: 'code', code: 'print(1)' }]), ctx)!.blocks[0].code?.source).toBe('print(1)')
    expect(normalizeCard(ask({ ...base, options }, [{ type: 'code', source: 'print(2)', language: 'python' }]), ctx)!.blocks[0].code?.source).toBe('print(2)')
  })

  it('moves code put on the interaction into a block above the prompt', () => {
    const card = normalizeCard(ask({ ...base, options, code: 'print(1 + 1e-16 == 1)' }, []), ctx)!
    expect(card.blocks).toHaveLength(1)
    expect(card.blocks[0].code?.source).toBe('print(1 + 1e-16 == 1)')
  })
})
