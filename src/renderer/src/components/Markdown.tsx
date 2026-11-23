// Markdown with KaTeX math. Model output is normalized first (shared/mdtex.ts): \( \) and \[ \]
// delimiters, $$ inside running text and double-escaped commands are common and all fixed there.
import katex from 'katex'
import { memo, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import { fixTex, normalizeMd } from '@shared/mdtex'
import { katexOptions, rehypePlugins, remarkPlugins } from '../lib/mdPipeline'

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

function MarkdownImpl({ text, inline = false, className }: { text: string | null | undefined; inline?: boolean; className?: string }): ReactElement | null {
  if (!text) return null
  const body = (
    <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={inline ? inlineComponents : baseComponents} skipHtml>
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
