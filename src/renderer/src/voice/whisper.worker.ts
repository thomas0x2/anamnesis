// Local speech-to-text: Whisper through transformers.js (WebGPU when available, else WASM).
// The model is downloaded once from Hugging Face and cached by the browser; audio never leaves the machine.
import { env, pipeline } from '@huggingface/transformers'

type Inbound = { type: 'load'; model: string; base: string } | { type: 'transcribe'; id: string; audio: Float32Array; language: string; model: string; base: string }

const ctx = self as unknown as { postMessage(m: unknown): void; onmessage: ((e: MessageEvent<Inbound>) => void) | null }

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string } | { text: string }[]>
let asr: Asr | null = null
let loaded = ''
let loading: Promise<Asr> | null = null

function configure(base: string): void {
  env.allowLocalModels = false
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; numThreads?: number } }
  if (onnx.wasm) {
    onnx.wasm.wasmPaths = { mjs: `${base}ort/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${base}ort/ort-wasm-simd-threaded.asyncify.wasm` }
    onnx.wasm.numThreads = 1
  }
}

async function load(model: string, base: string): Promise<Asr> {
  if (asr && loaded === model) return asr
  if (loading && loaded === model) return loading
  configure(base)
  loaded = model
  const files = new Map<string, { loaded: number; total: number }>()
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }): void => {
    if (p.status === 'progress' && p.file) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 })
      let l = 0
      let t = 0
      for (const f of files.values()) {
        l += f.loaded
        t += f.total
      }
      ctx.postMessage({ type: 'progress', loaded: l, total: t })
    }
  }
  const hasGpu = typeof (navigator as Navigator & { gpu?: unknown }).gpu !== 'undefined'
  loading = (async () => {
    const attempts: Record<string, unknown>[] = hasGpu
      ? [
          { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
          { device: 'wasm', dtype: 'q8' }
        ]
      : [{ device: 'wasm', dtype: 'q8' }]
    let lastErr: unknown = null
    for (const opts of attempts) {
      try {
        const p = (await pipeline('automatic-speech-recognition', model, { ...opts, progress_callback } as never)) as unknown as Asr
        asr = p
        ctx.postMessage({ type: 'ready', device: opts.device })
        return p
      } catch (e) {
        lastErr = e
      }
    }
    loading = null
    loaded = ''
    throw lastErr
  })()
  return loading
}

ctx.onmessage = async (e) => {
  const m = e.data
  try {
    if (m.type === 'load') {
      await load(m.model, m.base)
      return
    }
    const p = await load(m.model, m.base)
    const opts: Record<string, unknown> = { task: 'transcribe', chunk_length_s: 30, stride_length_s: 5, return_timestamps: false }
    if (m.language && m.language !== 'auto' && !m.model.endsWith('.en')) opts.language = m.language
    const out = await p(m.audio, opts)
    const text = Array.isArray(out) ? out.map((x) => x.text).join(' ') : out.text
    ctx.postMessage({ type: 'result', id: m.id, text: text.trim() })
  } catch (err) {
    ctx.postMessage({ type: 'error', id: m.type === 'transcribe' ? m.id : null, message: String((err as Error)?.message ?? err) })
  }
}
