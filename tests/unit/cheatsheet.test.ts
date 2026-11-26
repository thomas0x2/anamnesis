import { describe, expect, it } from 'vitest'
import courseJson from '../../courses/numcs/course.json'
import { agentTools, AGENT_TOOLS, buildAgentSystemPrompt, CHEATSHEET_TOOL } from '../../src/shared/agentTools'
import {
  addSuggestions,
  cheatCapacity,
  cheatKey,
  cheatsheetMarkdown,
  cheatsheetPrompt,
  emptyCheatsheet,
  normalizeCheatsheet,
  suggestResultText,
  type Cheatsheet
} from '../../src/shared/cheatsheet'
import { CourseGraph } from '../../src/shared/graph'
import type { Course } from '../../src/shared/types'

const course = courseJson as Course
const graph = new CourseGraph(course)
const now = new Date('2026-11-26T12:00:00Z')

const allowed = (patch: Partial<Cheatsheet['rules']> = {}): Cheatsheet => ({ ...emptyCheatsheet(), rules: { ...emptyCheatsheet().rules, allowed: 'yes', ...patch } })

describe('cheat sheet file', () => {
  it('loads defensively: bad rules fall back, empty and duplicate entries are dropped', () => {
    const s = normalizeCheatsheet({
      rules: { allowed: 'maybe', pages: -3, handwritten: 'yes', note: 42 },
      items: [
        { id: 'a', text: '  $x^2$ ', kind: 'nonsense', status: 'weird' },
        { id: 'a', text: 'dup id' },
        { id: 'b', text: '   ' },
        null
      ]
    })
    expect(s.rules).toEqual({ allowed: 'unknown', pages: null, handwritten: false, note: '' })
    expect(s.items).toHaveLength(1)
    expect(s.items[0]).toMatchObject({ id: 'a', text: '$x^2$', kind: 'formula', status: 'suggested', source: 'tutor' })
    expect(normalizeCheatsheet(null)).toEqual(emptyCheatsheet())
  })
})

describe('suggestions', () => {
  it('adds new entries as suggestions and skips what is on the sheet, suggested or dropped', () => {
    let sheet = allowed()
    const first = addSuggestions(sheet, [{ kind: 'condition', text: 'Newton converges quadratically if $f\'(x^*) \\ne 0$', conceptIds: ['nope'] }], new Set(['x']), now)
    expect(first.added).toHaveLength(1)
    expect(first.added[0]).toMatchObject({ status: 'suggested', kind: 'condition', conceptIds: [] })
    sheet = first.sheet
    const again = addSuggestions(sheet, [{ kind: 'condition', text: 'newton converges  quadratically if $f\'(x^*)\\ne 0$' }], null, now)
    expect(again.added).toHaveLength(0)
    expect(again.skipped[0].reason).toBe('already suggested')

    sheet = { ...sheet, items: sheet.items.map((x) => ({ ...x, status: 'dismissed' as const })) }
    expect(addSuggestions(sheet, [{ text: first.added[0].text }], null, now).skipped[0].reason).toBe('dropped before')
    sheet = { ...sheet, items: sheet.items.map((x) => ({ ...x, status: 'accepted' as const })) }
    const onSheet = addSuggestions(sheet, [{ text: first.added[0].text }, { text: '' }], null, now)
    expect(onSheet.skipped[0].reason).toBe('on the sheet')
    expect(suggestResultText(onSheet, sheet)).toContain('Not added (on the sheet)')
  })

  it('compares entries loosely', () => {
    expect(cheatKey('$a \\, b$')).toBe(cheatKey('A b'))
  })
})

describe('tutor prompt and tools', () => {
  it('offers the tool and the doctrine only when the exam allows a sheet', () => {
    expect(cheatsheetPrompt(emptyCheatsheet())).toBeNull()
    expect(cheatsheetPrompt({ ...allowed(), rules: { ...allowed().rules, allowed: 'no' } })).toBeNull()
    expect(agentTools({ cheatsheet: false })).toBe(AGENT_TOOLS)
    expect(agentTools({ cheatsheet: true }).map((t) => t.name)).toContain(CHEATSHEET_TOOL.name)
  })

  it('states the limits, what is on the sheet and what was dropped', () => {
    const sheet = normalizeCheatsheet({
      rules: { allowed: 'yes', pages: 2, handwritten: true, note: 'A4' },
      items: [
        { id: 'a', text: 'Chebyshev nodes $x_k$', status: 'accepted' },
        { id: 'b', text: 'Horner scheme', status: 'dismissed' }
      ]
    })
    const p = cheatsheetPrompt(sheet)!
    expect(p).toContain('# Cheat sheet')
    expect(p).toContain('2 page sides, handwritten, A4')
    expect(p).toContain(`roughly ${cheatCapacity(sheet.rules)} short entries fit; 1 are on it`)
    expect(p).toContain('Chebyshev nodes')
    expect(p).toContain('do not suggest again): "Horner scheme"')
    expect(p).toMatch(/Not on the sheet: the core ideas/)
    const sys = buildAgentSystemPrompt(course, graph, { profile: [], concepts: {} }, { mode: 'open', goalConceptId: null, scope: [], cheatsheet: p }, now)
    expect(sys).toContain('suggest_cheatsheet')
  })

  it('exports the accepted entries as Markdown grouped by kind', () => {
    const sheet = normalizeCheatsheet({
      rules: { allowed: 'yes' },
      items: [
        { id: 'a', kind: 'pitfall', text: 'DFT is unnormalised in numpy', status: 'accepted' },
        { id: 'b', kind: 'formula', text: '$e = mc^2$', status: 'accepted' },
        { id: 'c', kind: 'formula', text: 'not yet', status: 'suggested' }
      ]
    })
    const md = cheatsheetMarkdown(sheet, 'NumCS')
    expect(md.indexOf('## Formula')).toBeLessThan(md.indexOf('## Pitfall'))
    expect(md).toContain('- $e = mc^2$')
    expect(md).not.toContain('not yet')
  })
})
