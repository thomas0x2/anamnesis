import { describe, expect, it } from 'vitest'
import { captureCode, captureForTutor, CAPTURE_SCRIPT, fakeCapture, findScore, guessPlatform, mergeCaptures, testLines } from '../../src/shared/platform'
import { editReported, emptyPrep, newOnlineTask, reportedSubmission } from '../../src/shared/exam'

const now = new Date('2026-11-26T20:00:00Z')

describe('reading platform pages (Code Expert, GitLab…)', () => {
  it('merges the frames of a page, dropping duplicates and anything that is not a web page', () => {
    const c = mergeCaptures(
      [
        { url: 'https://expert.ethz.ch/ide/123', title: 'Ex 4', text: 'Statement', code: [{ name: 'list.c', value: 'int x;' }] },
        null,
        { url: 'https://expert.ethz.ch/frame', text: 'Statement', code: [{ name: 'other', value: 'int x;' }, { name: 'main.c', value: 'int main() {}' }, { value: '  ' }] }
      ],
      now
    )
    expect(c?.title).toBe('Ex 4')
    expect(c?.text).toBe('Statement')
    expect(c?.code.map((x) => x.name)).toEqual(['list.c', 'main.c'])
    expect(mergeCaptures([], now)).toBeNull()
    expect(mergeCaptures([{ url: 'file:///etc/passwd', text: 'x' }], now)).toBeNull()
  })

  it('names the platform behind a link', () => {
    expect(guessPlatform('https://expert.ethz.ch/ide2/abc')).toBe('Code Expert')
    expect(guessPlatform('https://gitlab.ethz.ch/me/repo')).toBe('GitLab')
    expect(guessPlatform('https://github.com/x')).toBe('GitHub')
    expect(guessPlatform('https://moodle-app2.let.ethz.ch/course')).toBe('Moodle')
    expect(guessPlatform('https://www.example.org/a')).toBe('example.org')
    expect(guessPlatform(null)).toBe('')
  })

  it('finds a test result on the page, and only an unambiguous one', () => {
    expect(findScore('Results\n7/8 tests passed')).toEqual({ points: 7, max: 8 })
    expect(findScore('Passed: 3 of 4')).toEqual({ points: 3, max: 4 })
    expect(findScore('Punkte: 2,5 / 4 Punkte')).toEqual({ points: 2.5, max: 4 })
    expect(findScore('Score 10/10. Total 10/10 points')).toEqual({ points: 10, max: 10 })
    expect(findScore('3/4 tests passed, 5/6 tests passed')).toBeNull()
    expect(findScore('Exercise 3/4 due 12/11')).toBeNull()
    expect(findScore('9/8 tests')).toBeNull()
  })

  it('formats the page for the check and for the tutor', () => {
    const c = fakeCapture('https://expert.ethz.ch/ide/1', now)
    expect(captureCode(c)).toContain('list.c:\n```c\nstruct node')
    expect(testLines(c.text)).toEqual(['Test results', '7/8 tests passed', 'Failed: reverse of an empty list'])
    const t = captureForTutor(c)
    expect(t).toContain('URL: https://expert.ethz.ch/ide/1')
    expect(t).toContain("# Code in the page's editors")
    expect(t).toContain('# Page text')
    expect(captureForTutor({ ...c, text: 'x'.repeat(50_000) }, 1000).length).toBeLessThanOrEqual(1000)
  })

  it('reads the editors of a page in its own script', () => {
    // the script is evaluated in the page; here it must at least be a valid expression
    expect(() => new Function(`return ${CAPTURE_SCRIPT}`)).not.toThrow()
    expect(CAPTURE_SCRIPT).toContain('monaco')
    expect(CAPTURE_SCRIPT).toContain('ace')
    expect(CAPTURE_SCRIPT).toContain('CodeMirror')
  })
})

describe('editing a logged result', () => {
  it('changes score, note and help but keeps id, time and concepts', () => {
    const t = newOnlineTask({ kind: 'exercises', title: 'Ex 4', conceptIds: ['lists'] }, now)!
    const s = { ...reportedSubmission({ materialId: t.id, points: 5, max: 8, note: 'first', help: 'alone', minutes: 30, examConditions: false }, t.conceptIds, now)!, applied: true }
    const later = new Date('2026-11-27T09:00:00Z')
    const e = editReported(s, { points: 7, max: 8, note: 'all but one', help: 'notes', minutes: 45, examConditions: false }, later)!
    expect(e.id).toBe(s.id)
    expect(e.at).toBe(s.at)
    expect(e.applied).toBe(true)
    expect(e.score).toBe(0.88)
    expect(e.tasks[0].conceptIds).toEqual(['lists'])
    expect(e.reported).toEqual({ points: 7, max: 8, note: 'all but one' })
    expect(e.help).toBe('notes')
    expect(editReported(s, { points: 9, max: 8, note: null, help: 'alone', minutes: null, examConditions: false }, later)).toBeNull()
    expect(editReported({ ...s, source: 'checked' }, { points: 1, max: 2, note: null, help: 'alone', minutes: null, examConditions: false }, later)).toBeNull()
    expect(emptyPrep().online).toEqual([])
  })
})
