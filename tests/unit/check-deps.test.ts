import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain .mjs script without types
import { staleDeps } from '../../scripts/check-deps.mjs'

const project = (installed: Record<string, string | null>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'deps-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { 'remark-math': '6.0.0' }, devDependencies: { 'rehype-katex': '7.0.1' } }))
  writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: { 'node_modules/remark-math': { version: '6.0.0' }, 'node_modules/rehype-katex': { version: '7.0.1' } } }))
  for (const [name, v] of Object.entries(installed)) {
    if (!v) continue
    mkdirSync(join(dir, 'node_modules', name), { recursive: true })
    writeFileSync(join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ version: v }))
  }
  return dir
}

describe('installed packages against the lockfile', () => {
  it('passes when node_modules matches', () => {
    expect(staleDeps(project({ 'remark-math': '6.0.0', 'rehype-katex': '7.0.1' }))).toEqual([])
  })

  it('names old and missing packages (the stale install that left math raw)', () => {
    expect(staleDeps(project({ 'remark-math': '3.0.1', 'rehype-katex': null }))).toEqual(['remark-math 3.0.1 → 6.0.0', 'rehype-katex missing → 7.0.1'])
  })

  it('matches this repository', () => {
    expect(staleDeps()).toEqual([])
  })
})
