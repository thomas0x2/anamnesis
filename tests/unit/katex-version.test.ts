// Regression: the Markdown math renderer must be the KaTeX whose stylesheet the app loads.
// rehype-katex once brought its own older KaTeX, whose class names (.base, .strut, .sizing) the loaded
// KaTeX 0.19 stylesheet no longer styles; inline math then wrapped anywhere, splitting 10 from its exponent.
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import { describe, expect, it } from 'vitest'
import { rehypePlugins, remarkPlugins } from '../../src/renderer/src/lib/mdPipeline'

const require = createRequire(import.meta.url)
const version = (from: string): string => require(createRequire(from).resolve('katex/package.json')).version

describe('KaTeX used for Markdown math', () => {
  it('is the same version as the stylesheet the app imports', () => {
    expect(version(require.resolve('rehype-katex'))).toBe(version(import.meta.url))
  })

  it('renders inline powers as one unbreakable group the stylesheet knows', () => {
    const md = 'so $\\varepsilon \\approx 2.22 \\times 10^{-16}$ holds'
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins, rehypePlugins }, md))
    const css = require('fs').readFileSync(require.resolve('katex/dist/katex.min.css'), 'utf8') as string
    const baseClass = /class="(katex-base|base)"/.exec(html)![1]
    expect(css).toMatch(new RegExp(`\\.katex \\.${baseClass}\\{[^}]*white-space:nowrap`))
  })
})
