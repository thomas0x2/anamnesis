// JSON files in the app's data folder, written atomically (temp file + rename) with one backup.
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { DEFAULT_SETTINGS, type DeepPartial, type Settings } from '../shared/types'
import { deepMerge } from '../shared/util'

let seq = 0

export class JsonStore {
  /** writes to one file are serialized, so two quick saves can not race on the rename */
  private chains = new Map<string, Promise<void>>()
  constructor(readonly dir: string) {}

  private file(name: string): string {
    const clean = name.replace(/\\/g, '/').replace(/\.json$/i, '')
    if (!/^[\w][\w./-]*$/.test(clean) || clean.includes('..')) throw new Error(`invalid store name: ${name}`)
    const full = resolve(this.dir, `${clean}.json`)
    if (relative(this.dir, full).startsWith('..')) throw new Error(`invalid store name: ${name}`)
    return full
  }

  async read<T = unknown>(name: string): Promise<T | null> {
    const f = this.file(name)
    for (const candidate of [f, `${f}.bak`]) {
      try {
        return JSON.parse(await readFile(candidate, 'utf8')) as T
      } catch {
        /* missing or corrupt: try the backup */
      }
    }
    return null
  }

  write(name: string, data: unknown): Promise<void> {
    const f = this.file(name)
    const json = JSON.stringify(data)
    const next = (this.chains.get(f) ?? Promise.resolve()).catch(() => {}).then(() => this.writeNow(f, json))
    this.chains.set(f, next)
    void next.finally(() => {
      if (this.chains.get(f) === next) this.chains.delete(f)
    }).catch(() => {})
    return next
  }

  private async writeNow(f: string, json: string): Promise<void> {
    await mkdir(dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.${Date.now()}.${++seq}.tmp`
    await writeFile(tmp, json, 'utf8')
    if (existsSync(f)) await copyFile(f, `${f}.bak`).catch(() => {})
    await rename(tmp, f)
  }

  async list(prefix: string): Promise<string[]> {
    const base = prefix.replace(/\/+$/, '')
    const dir = join(this.dir, base)
    try {
      const files = await readdir(dir)
      return files.filter((x) => x.endsWith('.json')).map((x) => `${base}/${x.replace(/\.json$/, '')}`)
    } catch {
      return []
    }
  }
}

export async function loadSettings(store: JsonStore): Promise<Settings> {
  const s = await store.read<DeepPartial<Settings>>('settings')
  return deepMerge(DEFAULT_SETTINGS, s ?? {})
}

export async function saveSettings(store: JsonStore, patch: DeepPartial<Settings>): Promise<Settings> {
  const next = deepMerge(await loadSettings(store), patch)
  await store.write('settings', next)
  return next
}
