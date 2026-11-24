// Normalizing model-written Markdown and LaTeX before rendering. Pure string functions, unit tested.
// Common model habits fixed here: \( \) and \[ \] delimiters, $$ inside running text, and
// double-escaped commands ("\\frac" written for "\frac").

const COMMANDS =
  'frac|dfrac|tfrac|sum|prod|int|oint|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|lambda|mu|nu|sigma|omega|pi|theta|vartheta|phi|varphi|psi|chi|rho|tau|kappa|xi|eta|zeta|ell|cdot|cdots|ldots|dots|vdots|ddots|le|ge|leq|geq|neq|approx|equiv|sim|infty|mathbb|mathcal|mathrm|mathbf|mathit|boldsymbol|text|textbf|operatorname|left|right|big|Big|bigg|partial|nabla|hat|bar|tilde|vec|widehat|overline|underline|overbrace|underbrace|max|min|log|ln|exp|sin|cos|tan|arccos|arcsin|in|notin|subset|subseteq|cup|cap|to|mapsto|rightarrow|Rightarrow|leftarrow|iff|implies|quad|qquad|times|binom|displaystyle|lim|sup|inf|det|top|Delta|Omega|Lambda|Phi|Sigma|Gamma|Theta|Pi|Psi|Xi|forall|exists|pm|mp|circ|ast|star|langle|rangle|lfloor|rfloor|lceil|rceil|mid|lVert|rVert|Vert|colon|bmod|pmod|mathscr|mathfrak|prime|emptyset|varnothing|odot|otimes|oplus|dagger|perp|parallel|angle|boxed|underset|overset|stackrel|limits|rank|dim|ker|Re|Im|arg|deg|gcd|hbar'
const DOUBLE_ESCAPED = new RegExp(`(?<!\\\\)(?:\\\\\\\\\\\\\\\\|\\\\\\\\)(${COMMANDS})(?![a-zA-Z])`, 'g')

/** Fix double-escaped commands (\\frac, or \\\\frac after two rounds of JSON) without touching genuine line breaks (\\) in matrices. */
export function fixTex(s: string): string {
  return s.replace(DOUBLE_ESCAPED, '\\$1')
}

/** Clearly TeX: a command, ^, _ or braces. Used to tell math from prices. */
const texish = (x: string): boolean => /\\[a-zA-Z]|[\^_{}]/.test(x)
/** "5 and " between two escaped dollars is two prices, not math. */
const priceLike = (x: string): boolean => !texish(x) && /^\s*\d[\d.,']*\s/.test(x)

// The inside of an inline math span: anything but $, across single line breaks but not blank lines.
const IN = String.raw`((?:[^$\n]|\n(?![ \t]*\n))+?)`
// One to four backslashes: models escape the dollar for Markdown, and some escape that backslash again (JSON).
const ESC = String.raw`\\{1,4}`
const BOTH = new RegExp(String.raw`${ESC}\$${IN}${ESC}\$`, 'g')
const LEFT = new RegExp(String.raw`(^|[^\\])${ESC}\$${IN}(?<!\\)\$`, 'g')
const RIGHT = new RegExp(String.raw`(^|[^\\$])\$${IN}${ESC}\$`, 'g')
const BRACKET = new RegExp(String.raw`${ESC}\[([\s\S]+?)${ESC}\]`, 'g')
const PAREN = new RegExp(String.raw`${ESC}\(([\s\S]+?)${ESC}\)`, 'g')

/** Repair math delimiters in prose (never inside code). */
function fixDelimiters(prose: string): string {
  let s = prose
  // Dollar signs that look right but are not "$" to the parser: HTML entities, full-width and small dollar signs.
  s = s.replace(/&#0*36;|&#x0*24;|&dollar;/gi, '$').replace(/[＄﹩]/g, '$')
  // Escaped delimiters (\$x\$, \\$x\\$) would render literally. A span closed by another escaped $ is math,
  // unless it reads like two prices; a lone \$5 stays.
  s = s.replace(BOTH, (m, x: string) => (priceLike(x) ? m : `$${x}$`))
  // Half-escaped spans (\$x^2$ or $x^2\$) render as literal text too: repaired only when the inside is clearly TeX.
  s = s.replace(LEFT, (m, pre: string, x: string) => (texish(x) ? `${pre}$${x}$` : m))
  s = s.replace(RIGHT, (m, pre: string, x: string) => (texish(x) ? `${pre}$${x}$` : m))
  // \[ \] and \( \) (also with doubled backslashes) are not math to the Markdown parser.
  s = s.replace(BRACKET, (_m, x: string) => `\n$$\n${x.trim()}\n$$\n`)
  s = s.replace(PAREN, (_m, x: string) => `$${x.trim()}$`)
  return s
}

/** Apply fn to the prose only: fenced code blocks and inline code spans are left exactly as written. */
function outsideCode(src: string, fn: (prose: string) => string): string {
  const parts = src.split(/(^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?^[ \t]*(?:```|~~~)[ \t]*$|`+[^`\n]*?`+)/m)
  // split keeps the code segments at the odd indexes
  return parts.map((p, i) => (i % 2 ? p : fn(p))).join('')
}

export function normalizeMd(src: string): string {
  let s = outsideCode(fixTex(String(src ?? '')), fixDelimiters)
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
