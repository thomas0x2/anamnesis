// Long model calls (building a course map from a PDF) over a connection that can drop: a watchdog
// that notices when a call stops making progress, and the policy for retrying it.
import type { Backend, LlmErrorKind, LlmEvent, LlmRequest, LlmResult } from './types'

/** No sign of life from the model for this long means the call is stuck (the CLI's own retries do not count). */
export const STALL_MS = 4 * 60_000

/** Attempts per part of a material before it is marked as failed (it can still be resumed by hand). */
export const MAX_ATTEMPTS = 4

/** Failures worth retrying: a dropped connection, a stall, a busy API, garbled output. Login problems and a missing CLI are not. */
export function retryable(kind: LlmErrorKind | undefined): boolean {
  return kind === undefined || kind === 'timeout' || kind === 'rate_limit' || kind === 'other' || kind === 'invalid'
}

/** Wait before attempt `n` (2, 3, …): 15 s, 45 s, 2 min, then 5 min. */
export function backoffMs(n: number): number {
  return [15_000, 45_000, 120_000][n - 2] ?? 300_000
}

export interface WatchedResult extends LlmResult {
  /** cancelled by the watchdog because nothing arrived for `stallMs` */
  stalled?: boolean
}

/**
 * Run a model call and cancel it when it stops making progress. Every streamed event counts as
 * progress except the CLI reporting that it is retrying a failed API request.
 */
export async function generateWatched(
  backend: Pick<Backend, 'generate' | 'cancel'>,
  req: LlmRequest,
  opts: { stallMs?: number; onEvent?: (e: LlmEvent) => void; now?: () => number } = {}
): Promise<WatchedResult> {
  const stallMs = opts.stallMs ?? STALL_MS
  const now = opts.now ?? Date.now
  let last = now()
  let stalled = false
  const timer = setInterval(
    () => {
      if (stalled || now() - last < stallMs) return
      stalled = true
      void backend.cancel(req.id)
    },
    Math.max(50, Math.min(5000, stallMs / 4))
  )
  try {
    const r = await backend.generate(req, (e) => {
      if (!(e.type === 'status' && e.status === 'retrying')) last = now()
      opts.onEvent?.(e)
    })
    if (stalled && !r.ok) {
      const min = Math.max(1, Math.round(stallMs / 60_000))
      return { ...r, ok: false, stalled: true, errorKind: 'timeout', error: `No answer for ${min} minute${min === 1 ? '' : 's'}: the connection may have dropped.` }
    }
    return r
  } finally {
    clearInterval(timer)
  }
}

export interface RetryHooks {
  /** false once the learner stopped the job or switched course: no further attempts */
  alive: () => boolean
  /** false while the computer is offline: the next attempt waits until it is back */
  online?: () => boolean
  /** called before each attempt is sent, with its request id (so it can be cancelled) */
  onRequest?: (id: string) => void
  /** called while waiting for the next attempt */
  onWait?: (w: { next: number; of: number; secondsLeft: number; offline: boolean; error: string }) => void
  onEvent?: (e: LlmEvent) => void
  sleep?: (ms: number) => Promise<void>
  stallMs?: number
  maxAttempts?: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms))

/**
 * Run a model call under the watchdog and try it again (with a new request) after a retryable
 * failure, waiting out the backoff and any time offline. Gives up after `maxAttempts`.
 */
export async function generateWithRetry(
  backend: Pick<Backend, 'generate' | 'cancel'>,
  makeReq: () => LlmRequest,
  hooks: RetryHooks
): Promise<WatchedResult & { attempts: number }> {
  const max = Math.max(1, hooks.maxAttempts ?? MAX_ATTEMPTS)
  const sleep = hooks.sleep ?? defaultSleep
  const online = hooks.online ?? (() => true)
  for (let attempt = 1; ; attempt++) {
    const req = makeReq()
    hooks.onRequest?.(req.id)
    const r = await generateWatched(backend, req, { stallMs: hooks.stallMs, onEvent: hooks.onEvent })
    if (r.ok || !hooks.alive() || !retryable(r.errorKind) || attempt >= max) return { ...r, attempts: attempt }
    const error = r.error ?? 'The call failed.'
    // back off, then wait for the connection; check every second whether the job was stopped
    for (let left = backoffMs(attempt + 1); left > 0; left -= 1000) {
      hooks.onWait?.({ next: attempt + 1, of: max, secondsLeft: Math.ceil(left / 1000), offline: false, error })
      await sleep(Math.min(1000, left))
      if (!hooks.alive()) return { ...r, attempts: attempt }
    }
    while (!online()) {
      hooks.onWait?.({ next: attempt + 1, of: max, secondsLeft: 0, offline: true, error })
      await sleep(1000)
      if (!hooks.alive()) return { ...r, attempts: attempt }
    }
  }
}
