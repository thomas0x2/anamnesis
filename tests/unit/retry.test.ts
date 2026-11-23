import { describe, expect, it } from 'vitest'
import { applyMapDelta, emptyExtension, markParts, partsDone, removeMaterial } from '../../src/shared/courseMap'
import { backoffMs, generateWatched, generateWithRetry, retryable } from '../../src/shared/retry'
import type { LlmEvent, LlmRequest, LlmResult } from '../../src/shared/types'
import { course as numcs } from './helpers'

const req = (id = 'r1'): LlmRequest => ({ id, kind: 'map', system: 's', prompt: 'p', schema: {} })

/** A backend whose calls hang until cancelled, or answer with the next scripted result. */
function scripted(results: (Partial<LlmResult> | 'hang')[]) {
  const pending = new Map<string, (r: LlmResult) => void>()
  const calls: string[] = []
  const cancelled: string[] = []
  return {
    calls,
    cancelled,
    generate: (r: LlmRequest, onEvent?: (e: LlmEvent) => void): Promise<LlmResult> => {
      calls.push(r.id)
      const next = results.shift() ?? { ok: true }
      if (next === 'hang') {
        // the CLI keeps reporting that it retries the API: that is not progress
        const t = setInterval(() => onEvent?.({ id: r.id, type: 'status', status: 'retrying' }), 5)
        return new Promise((res) => pending.set(r.id, (x) => (clearInterval(t), res(x))))
      }
      return Promise.resolve({ id: r.id, ok: false, ...next } as LlmResult)
    },
    cancel: async (id: string): Promise<void> => {
      cancelled.push(id)
      pending.get(id)?.({ id, ok: false, errorKind: 'cancelled', error: 'Cancelled' })
    }
  }
}

describe('stalled model calls', () => {
  it('cancels a call that stops making progress and reports it as a timeout', async () => {
    const b = scripted(['hang'])
    const r = await generateWatched(b, req(), { stallMs: 60 })
    expect(b.cancelled).toEqual(['r1'])
    expect(r).toMatchObject({ ok: false, stalled: true, errorKind: 'timeout' })
    expect(r.error).toMatch(/connection may have dropped/)
    expect(retryable(r.errorKind)).toBe(true)
  })

  it('leaves a call alone that answers', async () => {
    const b = scripted([{ ok: true, data: { x: 1 } }])
    const r = await generateWatched(b, req(), { stallMs: 60 })
    expect(r.ok).toBe(true)
    expect(b.cancelled).toEqual([])
  })

  it('retries what is worth retrying, with new requests, and gives up in the end', async () => {
    expect(backoffMs(2)).toBe(15_000)
    expect(backoffMs(9)).toBe(300_000)
    expect(retryable('auth')).toBe(false)
    expect(retryable('cancelled')).toBe(false)
    let n = 0
    const waits: boolean[] = []
    const b = scripted(['hang', { errorKind: 'rate_limit', error: 'Busy' }, { ok: true, data: 1 }])
    const sleep = async (): Promise<void> => {}
    const r = await generateWithRetry(b, () => req(`r${++n}`), { alive: () => true, sleep, stallMs: 60, onWait: (w) => waits.push(w.offline) })
    expect(r.ok).toBe(true)
    expect(r.attempts).toBe(3)
    expect(b.calls).toEqual(['r1', 'r2', 'r3'])
    expect(waits.length).toBeGreaterThan(0)

    const failing = scripted([{ errorKind: 'other' }, { errorKind: 'other' }, { errorKind: 'other' }])
    const r2 = await generateWithRetry(failing, () => req(`f${++n}`), { alive: () => true, sleep, maxAttempts: 3 })
    expect(r2.ok).toBe(false)
    expect(r2.attempts).toBe(3)

    const login = scripted([{ errorKind: 'auth' }])
    expect((await generateWithRetry(login, () => req('a'), { alive: () => true, sleep })).attempts).toBe(1)
  })

  it('waits while offline and stops when the job is stopped', async () => {
    let online = false
    let slept = 0
    const b = scripted([{ errorKind: 'timeout' }, { ok: true }])
    const sleep = async (): Promise<void> => {
      slept++
      if (slept === 100) online = true
    }
    const offline: number[] = []
    const r = await generateWithRetry(b, () => req(`o${slept}`), { alive: () => true, online: () => online, sleep, onWait: (w) => w.offline && offline.push(1) })
    expect(r.ok).toBe(true)
    expect(offline.length).toBeGreaterThan(0)

    let alive = true
    const s = scripted([{ errorKind: 'timeout' }, { ok: true }])
    const r2 = await generateWithRetry(s, () => req('s'), { alive: () => alive, sleep: async () => void (alive = false) })
    expect(r2.ok).toBe(false)
    expect(s.calls).toHaveLength(1)
  })
})

describe('resuming a map build', () => {
  it('stores the parts done in the map itself, and forgets them with the material', () => {
    const m = { id: 'm1', chunksDone: 1 }
    let ext = markParts(emptyExtension(), 'm1', 3)
    expect(partsDone(ext, m)).toBe(3)
    expect(partsDone(emptyExtension(), m)).toBe(1)
    // merging another part keeps the record
    ext = applyMapDelta(ext, numcs, { chapters: [], concepts: [], links: [], exercises: [] } as never).ext
    expect(ext.done).toEqual({ m1: 3 })
    ext = markParts(ext, 'm2', 1)
    expect(removeMaterial(ext, 'm1', () => false).done).toEqual({ m2: 1 })
    expect(removeMaterial(markParts(emptyExtension(), 'm1', 1), 'm1', () => false).done).toBeUndefined()
  })
})
