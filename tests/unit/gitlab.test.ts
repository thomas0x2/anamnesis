import { afterEach, describe, expect, it } from 'vitest'
import { checkGlOp, fakeGitLab, glCode, glScript, GL_NOTE, normalizeExercises, normalizeResolved, parseGitLabUrl, planGitLab, type GlResult } from '../../src/shared/gitlab'
import { emptyPrep, normalizePrep } from '../../src/shared/exam'

const now = new Date('2026-11-26T20:00:00Z')
const origin = 'https://gitlab.example.org'
const fixture = (): ReturnType<typeof normalizeExercises> => {
  const r = fakeGitLab({ op: 'sync', origin, kind: 'group', id: 7 })
  return normalizeExercises(r.ok ? r.data : null)
}

describe('GitLab links and answers', () => {
  it('reads a group or repository from a pasted link', () => {
    expect(parseGitLabUrl('https://gitlab.ethz.ch/spca-hs26/students/tbo')).toEqual({ origin: 'https://gitlab.ethz.ch', path: 'spca-hs26/students/tbo' })
    expect(parseGitLabUrl('gitlab.inf.ethz.ch/course/repo/-/tree/main/ex1')).toEqual({ origin: 'https://gitlab.inf.ethz.ch', path: 'course/repo' })
    expect(parseGitLabUrl('https://gitlab.com/groups/course')).toEqual({ origin: 'https://gitlab.com', path: 'course' })
    expect(parseGitLabUrl('https://gitlab.com/me/repo.git')?.path).toBe('me/repo')
    expect(parseGitLabUrl('https://gitlab.com/')).toBeNull()
    expect(parseGitLabUrl('javascript:alert(1)')).toBeNull()
  })

  it('accepts only well-formed operations', () => {
    expect(checkGlOp({ op: 'sync', origin: 'https://gitlab.ethz.ch/x', kind: 'project', id: 4 })).toEqual({ op: 'sync', origin: 'https://gitlab.ethz.ch', kind: 'project', id: 4 })
    expect(checkGlOp({ op: 'code', origin, projectId: 3, path: 'ex1', ref: 'main' })).toMatchObject({ path: 'ex1' })
    expect(checkGlOp({ op: 'code', origin, projectId: 3, path: '../etc', ref: 'main' })).toBeNull()
    expect(checkGlOp({ op: 'sync', origin: 'file:///x', kind: 'group', id: 1 })).toBeNull()
    expect(checkGlOp(null)).toBeNull()
    expect(normalizeResolved({ kind: 'project', id: 5, path: 'a/b', name: 'A / B' }, origin)).toEqual({ origin, kind: 'project', id: 5, path: 'a/b', name: 'A / B', syncedAt: null })
    expect(normalizeResolved({ kind: 'user', id: 5 }, origin)).toBeNull()
  })

  it('sorts exercises naturally and checks their fields', () => {
    const ex = fixture()
    expect(ex.map((e) => e.name)).toEqual(['ex01-pointers', 'ex02-queues', 'ex10-caches'])
    expect(ex[1].tests).toEqual({ passed: 5, total: 8 })
    expect(normalizeExercises([{ key: 'p1', projectId: 1, tests: { passed: 9, total: 3 } }])[0].tests).toBeNull()
  })

  it('makes one task per exercise, logs tests only where the learner committed, and matches them on the next sync', () => {
    const plan = planGitLab(emptyPrep(), fixture(), now)
    expect(plan.added).toHaveLength(3)
    const [ex1, ex2, ex10] = plan.online
    expect(ex2).toMatchObject({ title: 'ex02-queues', platform: 'GitLab', statement: '# Exercise 2\nImplement a ring-buffer queue.' })
    expect(plan.results).toEqual([{ taskId: ex2.id, points: 5, max: 8, note: `${GL_NOTE} 5/8 tests passed (pipeline failed)` }])
    expect(plan.started).toEqual([ex1.id])
    expect(plan.results.some((r) => r.taskId === ex10.id)).toBe(false)

    const stored = normalizePrep(JSON.parse(JSON.stringify({ ...emptyPrep(), online: plan.online, gitlab: { origin, kind: 'group', id: 7, path: 'c', name: 'C', syncedAt: null } })))
    expect(stored.gitlab?.id).toBe(7)
    expect(stored.online[1].gitlab?.tests).toEqual({ passed: 5, total: 8 })
    const again = planGitLab(stored, fixture(), now)
    expect(again.added).toEqual([])
    expect(again.updated).toBe(0)
  })

  it('puts the code with the CI result for the check', () => {
    const plan = planGitLab(emptyPrep(), fixture(), now)
    const md = glCode(plan.online[1], [{ path: 'src/queue.c', content: 'int x;\n\n' }])
    expect(md).toContain('CI on GitLab: 5/8 tests passed')
    expect(md).toContain('src/queue.c:\n```c\nint x;\n```')
  })
})

// ---------------------------------------------------------------- the in-page client against a scripted GitLab API
type Route = (url: URL) => unknown
function installApi(routes: Record<string, Route>, signedIn = true): string[] {
  const seen: string[] = []
  ;(globalThis as any).fetch = async (p: string) => {
    const url = new URL(p, origin)
    seen.push(url.pathname + url.search)
    const json = (status: number, body: unknown) => ({ status, ok: status < 400, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
    if (!signedIn) return json(401, { message: '401 Unauthorized' })
    const path = decodeURIComponent(url.pathname.replace(/^\/api\/v4/, ''))
    for (const [k, f] of Object.entries(routes)) if (new RegExp(`^${k}$`).test(path)) return json(200, f(url))
    return json(404, { message: '404 Not found' })
  }
  return seen
}

describe('the in-page GitLab client', () => {
  afterEach(() => {
    delete (globalThis as any).fetch
  })
  const run = (op: Parameters<typeof glScript>[0]): Promise<GlResult<any>> => (0, eval)(glScript(op))
  const me = { id: 1, username: 'tbo', name: 'T B', email: 'tbo@student.ethz.ch' }

  it('resolves a repository and syncs it folder by folder', async () => {
    installApi({
      '/user': () => me,
      '/projects/spca/students/tbo': () => ({ id: 42, path_with_namespace: 'spca/students/tbo', name_with_namespace: 'SPCA / tbo', web_url: `${origin}/spca/students/tbo` }),
      '/projects/42': () => ({ id: 42, default_branch: 'main', name: 'tbo', web_url: `${origin}/spca/students/tbo` }),
      '/projects/42/repository/tree': (u) =>
        u.searchParams.get('recursive')
          ? [{ type: 'blob', name: 'main.c', path: 'lab2/main.c' }, { type: 'blob', name: 'notes.pdf', path: 'lab2/notes.pdf' }]
          : u.searchParams.get('path') === 'lab2'
            ? [{ type: 'blob', name: 'README.md', path: 'lab2/README.md' }]
            : u.searchParams.get('path')
              ? []
              : [{ type: 'tree', name: 'lab1', path: 'lab1' }, { type: 'tree', name: 'lab2', path: 'lab2' }, { type: 'tree', name: 'docs', path: 'docs' }, { type: 'blob', name: 'README.md', path: 'README.md' }],
      '/projects/42/repository/files/lab2/README.md/raw': () => '# Lab 2: caches',
      '/projects/42/repository/files/lab2/main.c/raw': () => 'int main() {}',
      '/projects/42/repository/commits': (u) => (u.searchParams.get('path') === 'lab2' ? [{ author_email: 'TBO@student.ethz.ch', committed_date: '2026-11-20T10:00:00Z' }] : [{ author_email: 'ta@ethz.ch', author_name: 'TA' }]),
      '/projects/42/pipelines': () => [{ id: 9, status: 'failed' }],
      '/projects/42/pipelines/9/test_report': () => ({ test_suites: [{ name: 'lab2-tests', success_count: 3, total_count: 4 }, { name: 'lab1', success_count: 0, total_count: 2 }] })
    })
    const res = await run({ op: 'resolve', origin, path: 'spca/students/tbo' })
    expect(res.ok && normalizeResolved(res.data, origin)).toMatchObject({ kind: 'project', id: 42, name: 'SPCA / tbo' })

    const sync = await run({ op: 'sync', origin, kind: 'project', id: 42 })
    const ex = normalizeExercises(sync.ok ? sync.data : null)
    expect(ex.map((e) => e.name)).toEqual(['lab1', 'lab2'])
    expect(ex[1]).toMatchObject({ key: 'p42:lab2', path: 'lab2', readme: '# Lab 2: caches', mine: true, tests: { passed: 3, total: 4 }, pipeline: 'failed' })
    expect(ex[0]).toMatchObject({ mine: false, tests: { passed: 0, total: 2 } })

    const code = await run({ op: 'code', origin, projectId: 42, path: 'lab2', ref: 'main' })
    expect(code.ok && code.data).toEqual([{ path: 'lab2/main.c', content: 'int main() {}' }])
  })

  it('syncs a group as one exercise per repository', async () => {
    installApi({
      '/user': () => me,
      '/groups/7/projects': () => [{ id: 11, name: 'ex1', default_branch: 'main', web_url: `${origin}/c/ex1` }],
      '/projects/11/repository/tree': () => [],
      '/projects/11/repository/commits': () => [{ author_name: 'T B' }],
      '/projects/11/pipelines': () => []
    })
    const sync = await run({ op: 'sync', origin, kind: 'group', id: 7 })
    expect(normalizeExercises(sync.ok ? sync.data : null)[0]).toMatchObject({ key: 'p11', mine: true, tests: null, pipeline: null })
  })

  it('says so when the learner is not signed in', async () => {
    installApi({}, false)
    expect(await run({ op: 'resolve', origin, path: 'a/b' })).toEqual({ ok: false, signedIn: false, error: 'not signed in' })
  })
})
