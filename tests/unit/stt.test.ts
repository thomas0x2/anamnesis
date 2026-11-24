import { describe, expect, it } from 'vitest'
import { transcribeGemini } from '../../src/node/gemini'
import { Providers } from '../../src/node/providers'
import { encodeWav, sttContext, sttPrompt, toBase64 } from '../../src/shared/stt'
import { DEFAULT_SETTINGS, type Settings } from '../../src/shared/types'

describe('speech to text with Gemini', () => {
  it('encodes 16 kHz mono PCM WAV', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2]))
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.subarray(8, 12))).toBe('WAVE')
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(40, true)).toBe(10)
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + 2 * i, true))).toEqual([0, 32767, -32768, 16383, 32767])
    expect(wav.length).toBe(54)
    expect(toBase64(new Uint8Array([82, 73, 70, 70]))).toBe('UklGRg==')
  })

  it('asks for a verbatim transcript with the course terms and math in LaTeX', () => {
    const ctx = sttContext({ title: 'Numerical Methods for CSE', short: 'NumCS' }, ['Chebyshev nodes', 'Lagrange basis', 'Chebyshev nodes', ' '])
    expect(ctx).toBe('Numerical Methods for CSE (NumCS). Topics: Chebyshev nodes; Lagrange basis')
    const p = sttPrompt(ctx, 'german')
    expect(p).toContain('The speaker speaks German.')
    expect(p).toContain('do not translate')
    expect(p).toContain('$x_k$')
    expect(p).toContain('Course context: Numerical Methods for CSE (NumCS)')
    expect(sttPrompt('', 'auto')).not.toContain('Course context')
  })

  it('sends the recording inline and returns the text', async () => {
    const calls: { url: string; body: any; key: string }[] = []
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), key: (init.headers as Record<string, string>)['x-goog-api-key'] })
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: ' The weights $\\lambda_j$ depend only on the nodes. ' }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await transcribeGemini({ audio: 'UklGRg==', context: 'NumCS', language: 'english' }, { apiKey: 'key', model: 'gemini-4-hydrogen', effort: 'low', timeoutSec: 60, fetch: f })
    expect(r).toEqual({ ok: true, text: 'The weights $\\lambda_j$ depend only on the nodes.', model: 'gemini-4-hydrogen' })
    expect(calls[0].url).toContain('/models/gemini-4-hydrogen:generateContent')
    expect(calls[0].key).toBe('key')
    const parts = calls[0].body.contents[0].parts
    expect(parts[1]).toEqual({ inlineData: { mimeType: 'audio/wav', data: 'UklGRg==' } })
    expect(parts[0].text).toContain('Course context: NumCS')
    expect(calls[0].body.generationConfig.thinkingConfig.thinkingLevel).toBe('low')
  })

  it('reports errors so the app can fall back to the local model', async () => {
    const f = (async () => new Response(JSON.stringify({ error: { message: 'API key not valid', status: 'INVALID_ARGUMENT' } }), { status: 400 })) as unknown as typeof fetch
    const r = await transcribeGemini({ audio: 'x', context: '', language: 'english' }, { apiKey: 'bad', model: 'gemini-4-hydrogen', effort: 'low', timeoutSec: 60, fetch: f })
    expect(r.ok).toBe(false)
    expect(await transcribeGemini({ audio: 'x', context: '', language: 'english' }, { apiKey: null, model: 'm', effort: null, timeoutSec: 60 })).toEqual({ ok: false, error: expect.stringContaining('no Google AI API key') })
  })

  it("uses the tutor's Gemini model when the tutor runs on Gemini, else the default", async () => {
    const urls: string[] = []
    const f = (async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const p = new Providers({ dataDir: () => '/tmp', key: () => 'key', fetch: f })
    await p.transcribe({ audio: 'x', context: '', language: 'english' }, DEFAULT_SETTINGS)
    const s = { ...DEFAULT_SETTINGS, tasks: { ...DEFAULT_SETTINGS.tasks, tutor: { provider: 'gemini', model: 'gemini-4-neon', effort: 'high' } } } as Settings
    await p.transcribe({ audio: 'x', context: '', language: 'english' }, s)
    expect(urls[0]).toContain('/models/gemini-4-hydrogen:')
    expect(urls[1]).toContain('/models/gemini-4-neon:')
  })
})
