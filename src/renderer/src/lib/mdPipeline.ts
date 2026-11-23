// The Markdown + KaTeX plugin set the app renders with, shared by the Markdown component and its tests.
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'

export const katexOptions = { throwOnError: false, strict: 'ignore' as const, trust: false, maxSize: 40, maxExpand: 400 }
export const remarkPlugins = [remarkMath, remarkGfm]
export const rehypePlugins: [typeof rehypeKatex, typeof katexOptions][] = [[rehypeKatex, katexOptions]]
