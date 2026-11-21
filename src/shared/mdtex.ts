// Normalizing model-written Markdown and LaTeX before rendering. Pure string functions, unit tested.
// Common model habits fixed here: \( \) and \[ \] delimiters, $$ inside running text, and
// double-escaped commands ("\\frac" written for "\frac").

const COMMANDS =
  'frac|dfrac|tfrac|sum|prod|int|oint|sqrt|alpha|beta|gamma|delta|epsilon|varepsilon|lambda|mu|nu|sigma|omega|pi|theta|vartheta|phi|varphi|psi|chi|rho|tau|kappa|xi|eta|zeta|ell|cdot|cdots|ldots|dots|vdots|ddots|le|ge|leq|geq|neq|approx|equiv|sim|infty|mathbb|mathcal|mathrm|mathbf|mathit|boldsymbol|text|textbf|operatorname|left|right|big|Big|bigg|partial|nabla|hat|bar|tilde|vec|widehat|overline|underline|overbrace|underbrace|max|min|log|ln|exp|sin|cos|tan|arccos|arcsin|in|notin|subset|subseteq|cup|cap|to|mapsto|rightarrow|Rightarrow|leftarrow|iff|implies|quad|qquad|times|binom|displaystyle|lim|sup|inf|det|top|Delta|Omega|Lambda|Phi|Sigma|Gamma|Theta|Pi|Psi|Xi|forall|exists|pm|mp|circ|ast|star|langle|rangle|lfloor|rfloor|lceil|rceil|mid|lVert|rVert|Vert|colon|bmod|pmod|mathscr|mathfrak|prime|emptyset|varnothing|odot|otimes|oplus|dagger|perp|parallel|angle|boxed|underset|overset|stackrel|limits|rank|dim|ker|Re|Im|arg|deg|gcd|hbar'
const DOUBLE_ESCAPED = new RegExp(`(?<!\\\\)\\\\\\\\(${COMMANDS})(?![a-zA-Z])`, 'g')

/** Fix double-escaped commands without touching genuine line breaks (\\) in matrices. */
export function fixTex(s: string): string {
  return s.replace(DOUBLE_ESCAPED, '\\$1')
}

export function normalizeMd(src: string): string {
  let s = fixTex(String(src ?? ''))
  // Markdown-escaped math delimiters (\$x\$) would render literally. A span closed by another \$ is math; a lone \$5 stays.
  s = s.replace(/\\\$([^$\n]+?)\\\$/g, (_m, x: string) => `$${x}$`)
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
