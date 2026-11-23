// The learner's Anthropic API key, encrypted with the system keychain (Electron safeStorage).
// It lives in a .bin file the renderer's store calls cannot reach (they only read .json), is only
// decrypted in the main process for a CLI call, and is never written to settings or logs.
import { safeStorage } from 'electron'
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { looksLikeApiKey } from '../shared/usage'
import type { ApiKeyStatus } from '../shared/types'

export class ApiKeyVault {
  private cached: string | null | undefined
  constructor(private readonly dataDir: () => string) {}

  private get file(): string {
    return join(this.dataDir(), 'secrets', 'anthropic-api-key.bin')
  }

  private canStore(): boolean {
    try {
      // on Linux without a keyring Electron falls back to a fixed password: that is not safe storage
      if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend?.() === 'basic_text') return false
      return safeStorage.isEncryptionAvailable()
    } catch {
      return false
    }
  }

  /** The decrypted key, or null. */
  get(): string | null {
    if (this.cached !== undefined) return this.cached
    let key: string | null = null
    try {
      if (existsSync(this.file) && this.canStore()) key = safeStorage.decryptString(readFileSync(this.file))
    } catch {
      key = null
    }
    this.cached = key && looksLikeApiKey(key) ? key : null
    return this.cached
  }

  status(error?: string): ApiKeyStatus {
    const key = this.get()
    return { saved: !!key, hint: key ? `…${key.slice(-4)}` : null, canStore: this.canStore(), ...(error ? { error } : {}) }
  }

  set(key: string | null): ApiKeyStatus {
    if (key === null) {
      try {
        if (existsSync(this.file)) unlinkSync(this.file)
      } catch {
        return this.status('The saved key could not be removed.')
      }
      this.cached = null
      return this.status()
    }
    const k = String(key).trim()
    if (!looksLikeApiKey(k)) return this.status('That does not look like an Anthropic API key (it starts with sk-ant-).')
    if (!this.canStore()) return this.status('This system offers no encrypted storage, so the key cannot be saved safely.')
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, safeStorage.encryptString(k), { mode: 0o600 })
      chmodSync(this.file, 0o600)
    } catch {
      return this.status('The key could not be saved.')
    }
    this.cached = k
    return this.status()
  }
}
