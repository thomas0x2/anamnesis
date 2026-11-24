// Speech to text in the cloud (Gemini): the recording as a WAV file, and the prompt that keeps the
// transcript verbatim while writing the course's terms and math correctly. Pure functions, unit tested.

/** The value of Settings.voice.sttModel that sends recordings to Gemini instead of the local Whisper. */
export const GEMINI_STT = 'gemini'
/** The local model used when Gemini cannot transcribe (no key, offline, an error). */
export const LOCAL_STT_FALLBACK = 'onnx-community/whisper-base'

/** 16-bit PCM mono WAV from float samples in [-1, 1]. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): Uint8Array {
  const out = new Uint8Array(44 + samples.length * 2)
  const v = new DataView(out.buffer)
  const str = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true)
  }
  return out
}

export function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface CloudSttRequest {
  /** WAV, base64 */
  audio: string
  /** what the learner is studying: course name and its concept titles */
  context: string
  /** 'english' | 'german' | 'auto' */
  language: string
}

export function sttPrompt(context: string, language: string): string {
  const lang = language === 'german' ? 'The speaker speaks German.' : language === 'english' ? 'The speaker speaks English.' : 'The speaker may speak English or German.'
  return [
    'Transcribe this recording of a student answering or asking a question while studying.',
    lang,
    'Write exactly what was said, in the spoken language: do not translate, summarise, answer or add anything.',
    'Leave out filler sounds (um, uh) and false starts.',
    'Spell technical terms and names as they are usually written in the course (context below).',
    'Write spoken math as LaTeX in $…$: "x sub k" becomes $x_k$, "ten to the minus sixteen" becomes $10^{-16}$, "the sum over j of y j times l j of x" becomes $\\sum_j y_j \\ell_j(x)$.',
    'Reply with the transcript only. If nothing intelligible was said, reply with an empty text.',
    context ? `\nCourse context: ${context}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

/** Short course context for the prompt: the course and up to `max` concept titles. */
export function sttContext(course: { title: string; short?: string }, conceptTitles: string[], max = 80): string {
  const titles = [...new Set(conceptTitles.map((t) => t.trim()).filter(Boolean))].slice(0, max)
  return `${course.title}${course.short ? ` (${course.short})` : ''}${titles.length ? `. Topics: ${titles.join('; ')}` : ''}`.slice(0, 4000)
}
