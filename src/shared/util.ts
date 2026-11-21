export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

export function uid(prefix = ''): string {
  const r = Math.random().toString(36).slice(2, 10)
  const t = Date.now().toString(36).slice(-5)
  return `${prefix}${t}${r}`
}

export const nowIso = (): string => new Date().toISOString()

export function dayKey(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function daysBetween(a: string | Date, b: string | Date): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000
}

export function truncate(s: string, n: number): string {
  if (!s) return ''
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

export function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
}

export function shuffle<T>(xs: T[], seed?: number): T[] {
  const a = xs.slice()
  let s = seed ?? Math.floor(Math.random() * 2 ** 31)
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2 ** 31
    return s / 2 ** 31
  }
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** Stable small hash for seeding shuffles from ids. */
export function hashString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === undefined) return base
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch as T
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return patch as T
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = deepMerge((base as Record<string, unknown>)[k], v)
  }
  return out as T
}
