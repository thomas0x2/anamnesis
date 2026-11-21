import type { Backend } from '@shared/types'
import { createDemoBackend } from './demo'
import { createHttpBackend } from './http'

/** Electron preload if present; else ?backend=demo (in-browser fake) or the dev server over HTTP. */
export async function pickBackend(): Promise<Backend> {
  if (window.anamnesis) return window.anamnesis
  const mode = new URLSearchParams(location.search).get('backend')
  if (mode === 'demo') return createDemoBackend()
  const http = createHttpBackend('')
  try {
    await http.info()
    return http
  } catch {
    return createDemoBackend()
  }
}
