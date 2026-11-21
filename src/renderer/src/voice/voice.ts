// Voice I/O: microphone capture, the Whisper worker, and speech synthesis for card read-outs.
import { uid } from '@shared/util'
import { createStore } from '../engine/store'

// ------------------------------------------------------------ speech to text
export interface SttStatus {
  state: 'idle' | 'loading' | 'ready' | 'error'
  loaded: number
  total: number
  device: string | null
  message: string | null
}

class Transcriber {
  readonly status = createStore<SttStatus>({ state: 'idle', loaded: 0, total: 0, device: null, message: null })
  private worker: Worker | null = null
  private pending = new Map<string, { resolve: (t: string) => void; reject: (e: Error) => void }>()

  private base(): string {
    return new URL('./', location.href).href
  }

  private ensure(): Worker {
    if (this.worker) return this.worker
    const w = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; id?: string | null; text?: string; message?: string; loaded?: number; total?: number; device?: string }
      if (m.type === 'progress') this.status.set((s) => ({ ...s, state: 'loading', loaded: m.loaded ?? 0, total: m.total ?? 0 }))
      else if (m.type === 'ready') this.status.set((s) => ({ ...s, state: 'ready', device: m.device ?? null, message: null }))
      else if (m.type === 'result' && m.id) {
        this.pending.get(m.id)?.resolve(m.text ?? '')
        this.pending.delete(m.id)
      } else if (m.type === 'error') {
        this.status.set((s) => ({ ...s, state: 'error', message: m.message ?? 'speech model failed' }))
        if (m.id) {
          this.pending.get(m.id)?.reject(new Error(m.message ?? 'transcription failed'))
          this.pending.delete(m.id)
        }
      }
    }
    w.onerror = (e) => this.status.set((s) => ({ ...s, state: 'error', message: e.message || 'speech worker crashed' }))
    this.worker = w
    return w
  }

  preload(model: string): void {
    if (this.status.get().state === 'ready' || this.status.get().state === 'loading') return
    this.status.set((s) => ({ ...s, state: 'loading', message: null }))
    this.ensure().postMessage({ type: 'load', model, base: this.base() })
  }

  transcribe(audio: Float32Array, model: string, language: string): Promise<string> {
    const id = uid('stt_')
    const w = this.ensure()
    if (this.status.get().state !== 'ready') this.status.set((s) => ({ ...s, state: 'loading', message: null }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      w.postMessage({ type: 'transcribe', id, audio, language, model, base: this.base() }, [audio.buffer])
    })
  }
}

export const transcriber = new Transcriber()

export class Recorder {
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } })
    this.chunks = []
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data)
    }
    this.rec.start()
  }

  /** Stop and return mono 16 kHz samples (Whisper's input format). */
  async stop(): Promise<Float32Array> {
    const rec = this.rec
    if (!rec) return new Float32Array(0)
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve()
      rec.stop()
    })
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
    const blob = new Blob(this.chunks, { type: rec.mimeType || 'audio/webm' })
    const ac = new AudioContext({ sampleRate: 16000 })
    try {
      const buf = await ac.decodeAudioData(await blob.arrayBuffer())
      if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice()
      const out = new Float32Array(buf.length)
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const d = buf.getChannelData(c)
        for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels
      }
      return out
    } finally {
      void ac.close()
    }
  }

  cancel(): void {
    try {
      this.rec?.stop()
    } catch {
      /* already stopped */
    }
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
  }
}

// ------------------------------------------------------------ text to speech
export const speaking = createStore<string | null>(null)

export function voices(): SpeechSynthesisVoice[] {
  return typeof speechSynthesis === 'undefined' ? [] : speechSynthesis.getVoices()
}

function pickVoice(name: string | null): SpeechSynthesisVoice | null {
  const all = voices()
  if (name) {
    const v = all.find((x) => x.name === name)
    if (v) return v
  }
  const en = all.filter((v) => v.lang.toLowerCase().startsWith('en'))
  const pref = ['Samantha', 'Ava', 'Allison', 'Daniel', 'Google US English', 'Microsoft Aria', 'Karen', 'Serena']
  for (const p of pref) {
    const v = en.find((x) => x.name.includes(p))
    if (v) return v
  }
  return en.find((v) => v.localService) ?? en[0] ?? all[0] ?? null
}

export function speak(key: string, text: string, opts: { voice: string | null; rate: number }): void {
  if (typeof speechSynthesis === 'undefined' || !text.trim()) return
  speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  const v = pickVoice(opts.voice)
  if (v) {
    u.voice = v
    u.lang = v.lang
  }
  u.rate = opts.rate
  u.onend = () => {
    if (speaking.get() === key) speaking.set(null)
  }
  u.onerror = u.onend
  speaking.set(key)
  speechSynthesis.speak(u)
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
  speaking.set(null)
}
