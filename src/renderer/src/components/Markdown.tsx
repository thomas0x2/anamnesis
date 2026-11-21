// Markdown with KaTeX math. Model output is normalized first: \( \) and \[ \] delimiters, $$ inside
// running text, and double-escaped commands ("\\frac") are all common and all fixed here.
import katex from 'katex'
import { memo, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

const COMMANDS =
  'frac|dfrac|tfrac|sum|prod|int|oint|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|lambda|mu|nu|sigma|omega|pi|theta|vartheta|phi|varphi|psi|chi|rho|tau|kappa|xi|eta|zeta|ell|cdot|cdots|ldots|dots|vdots|ddots|le|ge|leq|geq|neq|approx|equiv|sim|infty|mathbb|mathcal|mathrm|mathbf|mathit|boldsymbol|text|textbf|operatorname|left|right|big|Big|bigg|partial|nabla|hat|bar|tilde|vec|widehat|overline|underline|overbrace|underbrace|max|min|log|ln|exp|sin|cos|tan|arccos|arcsin|in|notin|subset|subseteq|cup|cap|to|mapsto|rightarrow|Rightarrow|leftarrow|iff|implies|quad|qquad|times|binom|displaystyle|lim|sup|inf|det|top|Delta|Omega|Lambda|Phi|Sigma|Gamma|Theta|Pi|Psi|Xi|forall|exists|pm|mp|circ|ast|star|langle|rangle|lfloor|rfloor|lceil|rceil|mid|lVert|rVert|Vert|colon|bmod|pmod|mathscr|mathfrak|prime|emptyset|varnothing|odot|otimes|oplus|dagger|perp|parallel|angle|boxed|underset|overset|stackrel|limits|rank|dim|ker|Re|Im|arg|deg|gcd|hbar'
const DOUBLE_ESCAPED = new RegExp(`(?<!\\\\)\\\\\\\\(${COMMANDS})(?![a-zA-Z])`, 'g')

/** Fix double-escaped commands without touching genuine line breaks (\\) in matrices. */
export function fixTex(s: string): string {
  return s.replace(DOUBLE_ESCAPED, '\\$1')
}

export function normalizeMd(src: string): string {
  let s = fixTex(String(src ?? ''))
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_m, x: string) => `\n$$\n${x.trim()}\n$$\n`)
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_m, x: string) => `$${x.trim()}$`)
  // $$...$$ inside a running line (not a list item or table row) becomes its own display block
  s = s
    .split('\n')
    .map((line) => {
      if (!line.includes('$$') || /^\s*([-*+]|\d+\.)\s/.test(line) || line.trim().startsWith('|')) return line
      const t = line.trim()
      if (t === '$$') return line
      if (/^\$\$[\s\S]*\$\$$/.test(t) && t.length > 4) return `\n$$\n${t.slice(2, -2).trim()}\n$$\n`
      return line.replace(/\s*\$\$([^$]+?)\$\$\s*/g, (_m, x: string) => `\n\n$$\n${x.trim()}\n$$\n\n`)
    })
    .join('\n')
  return s
}

let openLink: (href: string) => void = (href) => void window.open(href, '_blank')
export function setLinkHandler(fn: (href: string) => void): void {
  openLink = fn
}

const baseComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        if (href && /^https?:/i.test(href)) openLink(href)
      }}
    >
      {children}
    </a>
  ),
  img: () => null
}

const inlineComponents: Components = {
  ...baseComponents,
  p: ({ children }) => <>{children}</>
}

const katexOptions = { throwOnError: false, strict: 'ignore' as const, trust: false, maxSize: 40, maxExpand: 400 }

function MarkdownImpl({ text, inline = false, className }: { text: string | null | undefined; inline?: boolean; className?: string }): ReactElement | null {
  if (!text) return null
  const body = (
    <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[[rehypeKatex, katexOptions]]} components={inline ? inlineComponents : baseComponents} skipHtml>
      {normalizeMd(text)}
    </ReactMarkdown>
  )
  return inline ? <span className={`md ${className ?? ''}`}>{body}</span> : <div className={`md ${className ?? ''}`}>{body}</div>
}

export const Markdown = memo(MarkdownImpl)

function TexImpl({ latex, display = true }: { latex: string; display?: boolean }): ReactElement {
  let html: string
  try {
    html = katex.renderToString(fixTex(latex).replace(/^\s*\$+|\$+\s*$/g, ''), { ...katexOptions, displayMode: display })
  } catch (e) {
    return <span className="tex-error">{String((e as Error).message ?? e)}</span>
  }
  return display ? <div className="tex-block" dangerouslySetInnerHTML={{ __html: html }} /> : <span dangerouslySetInnerHTML={{ __html: html }} />
}

export const Tex = memo(TexImpl)
