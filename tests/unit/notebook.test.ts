import { describe, expect, it } from 'vitest'
import { isSolutionNotebook, notebookForCheck, notebookKind, notebookText, notebookTitle, parseNotebook } from '../../src/shared/notebook'
import { normalizeExercises } from '../../src/shared/gitlab'

const nb = JSON.stringify({
  cells: [
    { cell_type: 'markdown', source: ['# Sheet 3: Newton\n', 'Implement Newton for $f(x)=x^2-2$.'] },
    { cell_type: 'code', source: 'def newton(x):\n    return x - (x*x-2)/(2*x)\n', outputs: [] },
    { cell_type: 'code', source: ['print(newton(1.0))'], outputs: [{ output_type: 'stream', text: ['1.5\n'] }, { output_type: 'display_data', data: { 'image/png': 'AAA' } }] },
    { cell_type: 'code', source: '1/0', outputs: [{ output_type: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero' }] }
  ],
  nbformat: 4
})

describe('Jupyter notebooks as problem sets', () => {
  it('reads the cells and their outputs', () => {
    const cells = parseNotebook(nb)
    expect(cells?.map((c) => c.type)).toEqual(['markdown', 'code', 'code', 'code'])
    expect(cells?.[2].output).toBe('1.5\n\n[figure]')
    expect(cells?.[3].output).toBe('ZeroDivisionError: division by zero')
    expect(parseNotebook('not json')).toBeNull()
    expect(parseNotebook('{"a":1}')).toBeNull()
  })

  it('gives the statement without outputs and the check with them', () => {
    const cells = parseNotebook(nb) ?? []
    const st = notebookText(cells, { outputs: false })
    expect(st).toContain('# Sheet 3: Newton')
    expect(st).toContain('```python\ndef newton(x):')
    expect(st).not.toContain('1.5')
    const check = notebookForCheck('sheet3.ipynb', cells)
    expect(check).toContain('Output:\n```\n1.5\n\n[figure]\n```')
    expect(check).toContain('ZeroDivisionError')
  })

  it('names notebooks and leaves solutions out', () => {
    const cells = parseNotebook(nb)
    expect(notebookTitle('sheet_03.ipynb', cells)).toBe('sheet 03: Sheet 3: Newton')
    expect(notebookTitle('Sheet 3 Newton.ipynb', null)).toBe('Sheet 3 Newton')
    expect(isSolutionNotebook('sheet3_solution.ipynb')).toBe(true)
    expect(isSolutionNotebook('Serie3_Lösung.ipynb')).toBe(true)
    expect(isSolutionNotebook('sheet3.ipynb')).toBe(false)
    expect(notebookKind('mock_exam_2025.ipynb')).toBe('exam')
    expect(notebookKind('Exercises/sheet3.ipynb')).toBe('exercises')
  })

  it('uses a notebook as the statement of a GitLab exercise without a README', () => {
    const [ex] = normalizeExercises([{ key: 'p1', projectId: 1, name: 'ex3', readme: null, notebook: nb }])
    expect(ex.readme).toContain('# Sheet 3: Newton')
  })
})
