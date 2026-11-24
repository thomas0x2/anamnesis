// Settings: the tutor (Claude Code CLI), the lecture notes, voice, scheduling and your data.
import type { ApiKeyStatus, AppInfo, KeyProvider, LlmTestResult, Settings, TaskModel } from '@shared/types'
import { clampEffort, EFFORTS, GEMINI_DEFAULT_MODEL, geminiHasXhigh, MODEL_SUGGESTIONS, PROVIDERS, TASKS } from '@shared/models'
import { formatUsd, normalizeUsage, usageSummary, type UsageDay, type UsageSummary } from '@shared/usage'
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { Icon } from '../components/Icon'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct } from '../lib/format'
import { speak, transcriber, voices } from '../voice/voice'
import { GEMINI_STT, LOCAL_STT_FALLBACK } from '@shared/stt'

export const STT_MODELS: { id: string; label: string }[] = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Tiny, English only (fastest, ~40 MB)' },
  { id: 'onnx-community/whisper-base.en', label: 'Base, English only (~80 MB)' },
  { id: 'onnx-community/whisper-base', label: 'Base, English and German (~80 MB)' },
  { id: 'onnx-community/whisper-small', label: 'Small, English and German (best local, ~250 MB)' },
  { id: GEMINI_STT, label: 'Gemini, in the cloud (best for terms and math)' }
]


function Row({ name, desc, children }: { name: string; desc?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="setting">
      <div>
        <div className="name">{name}</div>
        {desc && <div className="desc">{desc}</div>}
      </div>
      <div className="control">{children}</div>
    </div>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }): ReactElement {
  return <button className={`toggle ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

/** A text input that saves when it loses focus or on Enter. */
function TextSetting({ value, placeholder, onSave, width = 240, list, label }: { value: string; placeholder?: string; onSave: (v: string) => void; width?: number; list?: string; label?: string }): ReactElement {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input
      className="input"
      style={{ width }}
      value={v}
      placeholder={placeholder}
      list={list}
      aria-label={label}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

const CONSOLE_KEYS = 'https://console.anthropic.com/settings/keys'
const CONSOLE_BILLING = 'https://console.anthropic.com/settings/billing'
const AISTUDIO_KEYS = 'https://aistudio.google.com/apikey'

type Save = (p: Parameters<ReturnType<typeof useApp>['saveSettings']>[0]) => void

function ExtLink({ url, children }: { url: string; children: ReactNode }): ReactElement {
  const app = useApp()
  return (
    <a href={url} onClick={(e) => (e.preventDefault(), void app.backend.openExternal(url))}>
      {children}
    </a>
  )
}

const KEY_INFO: Record<KeyProvider, { label: string; placeholder: string; prefix: string; env: string }> = {
  anthropic: { label: 'Anthropic API key', placeholder: 'sk-ant-…', prefix: 'sk-ant-', env: 'ANTHROPIC_API_KEY' },
  google: { label: 'Google AI API key', placeholder: 'AIza…', prefix: '', env: 'GEMINI_API_KEY' }
}

/** An API key, saved encrypted by the desktop app; the renderer only ever sees its last characters. */
function KeyField({ provider, onSaved }: { provider: KeyProvider; onSaved?: () => void }): ReactElement {
  const app = useApp()
  const info = KEY_INFO[provider]
  const [key, setKey] = useState<ApiKeyStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void app.backend.apiKeyStatus?.(provider).then(setKey)
  }, [app, provider])
  if (!app.backend.apiKeyStatus) {
    return (
      <span className="small muted">
        The browser version reads <code>{info.env}</code> from the dev server’s environment.
      </span>
    )
  }
  const store = async (k: string | null): Promise<void> => {
    if (!app.backend.setApiKey) return
    setBusy(true)
    try {
      const st = await app.backend.setApiKey(provider, k)
      setKey(st)
      if (!st.error) setDraft('')
      if (!st.error && k) onSaved?.()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="stack" style={{ gap: 6, alignItems: 'flex-end' }}>
      {key?.saved ? (
        <span className="row" style={{ gap: 8 }}>
          <span className="small mono">
            {info.prefix}
            {key.hint}
          </span>
          <button className="btn sm ghost" disabled={busy} onClick={() => void store(null)} aria-label={`Remove the ${info.label}`}>
            Remove
          </button>
        </span>
      ) : (
        <span className="row" style={{ gap: 6 }}>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            style={{ width: 220 }}
            placeholder={info.placeholder}
            aria-label={info.label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && draft.trim() && void store(draft)}
          />
          <button className="btn sm" disabled={busy || !draft.trim()} onClick={() => void store(draft)} aria-label={`Save the ${info.label}`}>
            Save
          </button>
        </span>
      )}
      {key?.error && <span className="tiny" style={{ color: 'var(--bad)' }}>{key.error}</span>}
      {key && !key.saved && !key.canStore && <span className="tiny" style={{ color: 'var(--bad)' }}>No encrypted storage on this system.</span>}
    </div>
  )
}

/** Claude: subscription or API credits, and the Anthropic key. */
function ClaudeAccountRows({ s, save }: { s: Settings; save: Save }): ReactElement {
  return (
    <>
      <Row
        name="Claude account"
        desc={
          s.cli.auth === 'api-key'
            ? 'Claude calls are billed to your Anthropic API key (pay as you go with API credits), not your Claude plan.'
            : 'Claude calls count toward your Claude plan’s usage limits. Switch to API credits if you keep running out.'
        }
      >
        <span className="seg">
          <button className={s.cli.auth !== 'api-key' ? 'on' : ''} onClick={() => save({ cli: { auth: 'subscription' } })}>
            Claude subscription
          </button>
          <button className={s.cli.auth === 'api-key' ? 'on' : ''} onClick={() => save({ cli: { auth: 'api-key' } })}>
            API credits
          </button>
        </span>
      </Row>
      {s.cli.auth === 'api-key' && (
        <Row
          name="Anthropic API key"
          desc={
            <>
              Create one in the <ExtLink url={CONSOLE_KEYS}>Anthropic Console</ExtLink> and add credits under <ExtLink url={CONSOLE_BILLING}>Billing</ExtLink>. Stored encrypted with your system keychain, only on this computer.
            </>
          }
        >
          <KeyField provider="anthropic" onSaved={() => s.cli.auth !== 'api-key' && save({ cli: { auth: 'api-key' } })} />
        </Row>
      )}
    </>
  )
}

/** Provider, model and effort for one kind of work. */
function TaskRow({ task, s, save, geminiModels }: { task: (typeof TASKS)[number]; s: Settings; save: Save; geminiModels: string[] }): ReactElement {
  const t = s.tasks[task.id]
  const set = (patch: Partial<TaskModel>): void => save({ tasks: { [task.id]: { ...t, ...patch } } })
  const suggestions = t.provider === 'gemini' ? [...new Set([...MODEL_SUGGESTIONS.gemini.map((m) => m.id), ...geminiModels])] : MODEL_SUGGESTIONS.claude.map((m) => m.id)
  const labels = new Map(MODEL_SUGGESTIONS[t.provider].map((m) => [m.id, m.label]))
  // on Gemini, Extra is offered only for models with an xhigh thinking level
  const efforts = t.provider === 'gemini' && !geminiHasXhigh(t.model || GEMINI_DEFAULT_MODEL) ? EFFORTS.gemini.filter((e) => e.id !== 'xhigh') : EFFORTS[t.provider]
  const shownEffort = t.effort === 'auto' ? 'auto' : clampEffort(t.provider, t.effort, t.model)
  return (
    <Row name={task.label} desc={task.desc}>
      <div className="stack task-model" style={{ gap: 6, alignItems: 'flex-end' }}>
        <span className="seg" role="group" aria-label={`${task.label}: provider`}>
          {PROVIDERS.map((p) => (
            <button key={p.id} className={t.provider === p.id ? 'on' : ''} onClick={() => t.provider !== p.id && set({ provider: p.id, model: '', effort: t.effort === 'auto' ? 'auto' : clampEffort(p.id, t.effort) })}>
              {p.label}
            </button>
          ))}
        </span>
        <span className="row" style={{ gap: 6 }}>
          <TextSetting
            value={t.model}
            width={210}
            placeholder={t.provider === 'gemini' ? `${GEMINI_DEFAULT_MODEL} (default)` : 'Claude Code default'}
            onSave={(v) => set({ model: v })}
            list={`models-${task.id}`}
            label={`${task.label}: model`}
          />
          <datalist id={`models-${task.id}`}>
            {suggestions.map((m) => (
              <option key={m} value={m}>
                {labels.get(m) ?? m}
              </option>
            ))}
          </datalist>
        </span>
        <span className="seg" role="group" aria-label={`${task.label}: effort`}>
          <button className={t.effort === 'auto' ? 'on' : ''} onClick={() => set({ effort: 'auto' })} title="What the app asks for per call">
            Auto
          </button>
          {efforts.map((e) => (
            <button key={e.id} className={shownEffort === e.id ? 'on' : ''} onClick={() => set({ effort: e.id })}>
              {e.label}
            </button>
          ))}
        </span>
      </div>
    </Row>
  )
}

/** Models per task, and the accounts they run on. */
function ModelRows({ s, save }: { s: Settings; save: Save }): ReactElement {
  const app = useApp()
  const usesGemini = TASKS.some((t) => s.tasks[t.id].provider === 'gemini')
  const usesClaude = TASKS.some((t) => s.tasks[t.id].provider === 'claude')
  const [geminiModels, setGeminiModels] = useState<string[]>([])
  const [keyTick, setKeyTick] = useState(0)
  useEffect(() => {
    if (usesGemini) void app.backend.listModels?.('gemini').then(setGeminiModels).catch(() => {})
  }, [app, usesGemini, keyTick])
  return (
    <>
      {TASKS.map((t) => (
        <TaskRow key={t.id} task={t} s={s} save={save} geminiModels={geminiModels} />
      ))}
      {usesClaude && <ClaudeAccountRows s={s} save={save} />}
      {usesGemini && (
        <Row
          name="Google AI API key"
          desc={
            <>
              Create one in <ExtLink url={AISTUDIO_KEYS}>Google AI Studio</ExtLink> and turn on billing there for higher limits. Stored encrypted with your system keychain, only on this computer.
            </>
          }
        >
          <KeyField provider="google" onSaved={() => setKeyTick((n) => n + 1)} />
        </Row>
      )}
    </>
  )
}

const KIND_LABEL: Record<string, string> = { tutor: 'tutor', map: 'course maps', grading: 'grading', other: 'other' }

function costLine(d: UsageDay, auth: Settings['cli']['auth']): string {
  const main = auth === 'api-key' ? d.api : d.api + d.subscription
  const parts = Object.entries(d.byKind)
    .filter(([, x]) => (x ?? 0) >= 0.005)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, x]) => `${KIND_LABEL[k] ?? k} ${formatUsd(x ?? 0)}`)
  return `${formatUsd(main)}${parts.length ? ` (${parts.join(', ')})` : ''}`
}

/** What the calls cost, as Claude Code reports it. */
function UsageRow({ auth }: { auth: Settings['cli']['auth'] }): ReactElement {
  const app = useApp()
  const [u, setU] = useState<UsageSummary | null>(null)
  useEffect(() => {
    void app.backend.readJson('usage').then((raw) => setU(usageSummary(normalizeUsage(raw), new Date())))
  }, [app])
  const sub = u ? u.month.subscription : 0
  return (
    <Row
      name="Cost"
      desc={
        auth === 'api-key'
          ? 'Claude calls billed to your API key, as Claude Code reports it (the Console shows the exact amount). Gemini usage is in Google AI Studio.'
          : 'What the Claude calls would cost on API credits (your plan covers them), as Claude Code reports it. Gemini usage is in Google AI Studio.'
      }
    >
      {u ? (
        <div className="stack small" style={{ gap: 2, textAlign: 'right' }}>
          <span>Today {costLine(u.today, auth)}</span>
          <span>This month {costLine(u.month, auth)}</span>
          {auth === 'api-key' && sub > 0 && <span className="tiny muted">plus {formatUsd(sub)} on the subscription this month</span>}
        </div>
      ) : (
        <span className="small muted">…</span>
      )}
    </Row>
  )
}

export function CliTest({ compact = false }: { compact?: boolean }): ReactElement {
  const app = useApp()
  const [test, setTest] = useState<LlmTestResult | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (): Promise<void> => {
    setBusy(true)
    setTest(null)
    try {
      setTest(await app.backend.testLlm())
    } catch (e) {
      setTest({ ok: false, message: String(e), path: null, version: null })
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <button className={`btn ${compact ? '' : 'sm'}`} onClick={() => void run()} disabled={busy}>
        <Icon name={busy ? 'clock' : 'zap'} size={15} /> {busy ? 'Testing… (a few seconds)' : 'Test the connection'}
      </button>
      {test && (
        <div className={`test-result ${test.ok ? 'ok' : 'fail'}`}>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Icon name={test.ok ? 'check' : 'alert'} size={16} style={{ color: test.ok ? 'var(--good)' : 'var(--bad)', flex: 'none', marginTop: 2 }} />
            <div>
              {test.message}
              {test.path && <div className="tiny muted">{test.path}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export function SettingsView(): ReactElement {
  const app = useApp()
  const s = useStore(app.settings, (x) => x)
  const script = useStore(app.script.status, (x) => x)
  const stt = useStore(transcriber.status, (x) => x)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [voiceList, setVoiceList] = useState(() => voices())
  const [confirmReset, setConfirmReset] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const save = (patch: Parameters<typeof app.saveSettings>[0]): void => void app.saveSettings(patch)
  const isDemo = app.backend.kind === 'demo'
  const sttGemini = s.voice.sttModel === GEMINI_STT
  const [googleKey, setGoogleKey] = useState<boolean | null>(null)
  useEffect(() => {
    if (sttGemini) void app.backend.apiKeyStatus?.('google').then((k) => setGoogleKey(k.saved)).catch(() => setGoogleKey(null))
  }, [sttGemini]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void app.backend
      .info()
      .then(setInfo)
      .catch(() => {})
    if (typeof speechSynthesis === 'undefined') return
    const f = (): void => setVoiceList(voices())
    speechSynthesis.addEventListener('voiceschanged', f)
    return () => speechSynthesis.removeEventListener('voiceschanged', f)
  }, [app])

  const exportData = (): void => {
    const blob = new Blob([app.exportData()], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `anamnesis-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const importData = async (f: File): Promise<void> => {
    const ok = app.importData(await f.text())
    app.toast({ kind: ok ? 'info' : 'error', text: ok ? 'Imported: your learner model was replaced.' : 'That file is not an Anamnesis export.' })
  }
  const english = voiceList.filter((v) => /^(en|de)/i.test(v.lang))

  return (
    <div className="page page-narrow">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <div className="sub">Everything is stored on this computer.</div>
        </div>
      </div>

      <div className="settings">
        <div className="panel">
          <div className="panel-title">
            <h3>Tutor</h3>
            <span className="hint">Claude (through Claude Code) or Gemini (through the Gemini API), chosen per task</span>
          </div>
          <Row name="Tutor" desc="The demo tutor is a scripted stand-in for trying the interface without a model.">
            <span className="seg">
              <button className={s.provider === 'claude-cli' ? 'on' : ''} disabled={isDemo} onClick={() => save({ provider: 'claude-cli' })}>
                Claude or Gemini
              </button>
              <button className={s.provider === 'demo' ? 'on' : ''} onClick={() => save({ provider: 'demo' })}>
                Demo tutor
              </button>
            </span>
          </Row>
          {s.provider === 'claude-cli' && <ModelRows s={s} save={save} />}
          <Row name="Connection" desc="Runs a tiny request on the tutor’s provider and model.">
            <CliTest />
          </Row>
          <Row name="Claude Code path" desc="Leave empty to find claude on your PATH and in the usual install locations.">
            <TextSetting value={s.cli.path ?? ''} placeholder="auto-detect" onSave={(v) => save({ cli: { path: v || null } })} />
          </Row>
          <Row name="Claude fallback model" desc="Used automatically when the chosen Claude model is overloaded. Optional.">
            <TextSetting value={s.cli.fallbackModel ?? ''} placeholder="none" onSave={(v) => save({ cli: { fallbackModel: v || null } })} />
          </Row>
          {s.provider === 'claude-cli' && <UsageRow auth={s.cli.auth} />}
          <Row name="Time limit per step" desc="A step that takes longer is stopped and can be retried.">
            <span className="row" style={{ gap: 6 }}>
              <input className="input" type="number" min={60} max={900} step={30} style={{ width: 90 }} value={s.cli.timeoutSec} onChange={(e) => save({ cli: { timeoutSec: Math.max(60, Math.min(900, Number(e.target.value) || 240)) } })} />
              <span className="small muted">seconds</span>
            </span>
          </Row>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Course materials</h3>
            <span className="hint">{app.course.builtin ? app.course.script.fileName : app.course.short}</span>
          </div>
          {!app.course.builtin && (
            <Row name="Materials" desc="Scripts, slides and problem sets of this course. Each new PDF extends the course map.">
              <button className="btn sm" onClick={() => app.go({ name: 'materials' })}>
                <Icon name="book" size={15} /> Open materials
              </button>
            </Row>
          )}
          {app.course.builtin && <Row
            name="Script PDF"
            desc={
              script.state === 'ready'
                ? `${script.numPages} pages indexed.${s.script.path ? ` ${s.script.path}` : ''}`
                : script.state === 'indexing'
                  ? `Reading pages… ${pct(script.progress)}`
                  : script.state === 'error'
                    ? script.message
                    : 'Not chosen yet. The tutor still works, but cannot quote or open the script.'
            }
          >
            {app.backend.kind === 'electron' && (
              <button className="btn sm" onClick={() => void app.chooseScript()}>
                <Icon name="book" size={15} /> {s.script.path ? 'Change' : 'Choose PDF'}
              </button>
            )}
            {script.state === 'ready' && (
              <button className="btn sm ghost" onClick={() => void app.reindexScript()}>
                <Icon name="refresh" size={15} /> Re-read
              </button>
            )}
          </Row>}
          <Row name="Ground steps in the script" desc="Send the pages of the concept being taught along with each step, so explanations use the script’s definitions and numbering.">
            <Toggle on={s.script.sendPages} onChange={(v) => save({ script: { sendPages: v } })} label="Ground steps in the script" />
          </Row>
          <Row name="Pages per step" desc="More pages give more context but make each step slower.">
            <span className="row" style={{ gap: 6 }}>
              <input type="range" min={2} max={16} value={s.script.maxPages} onChange={(e) => save({ script: { maxPages: Number(e.target.value) } })} />
              <span className="small" style={{ width: 24, textAlign: 'right' }}>
                {s.script.maxPages}
              </span>
            </span>
          </Row>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Voice</h3>
            <span className="hint">speech recognition runs locally; nothing is uploaded</span>
          </div>
          <Row name="Read cards aloud" desc="Shows a speaker button on each card.">
            <Toggle on={s.voice.tts} onChange={(v) => save({ voice: { tts: v } })} label="Read cards aloud" />
          </Row>
          <Row name="Read new cards automatically">
            <Toggle on={s.voice.autoSpeak} onChange={(v) => save({ voice: { autoSpeak: v } })} label="Read new cards automatically" />
          </Row>
          <Row name="Voice">
            <select className="select" style={{ width: 220 }} value={s.voice.ttsVoice ?? ''} onChange={(e) => save({ voice: { ttsVoice: e.target.value || null } })}>
              <option value="">Automatic</option>
              {(english.length ? english : voiceList).map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
            <button className="btn icon sm ghost" title="Try it" onClick={() => speak('settings-test', 'This is how I will read the cards to you. You can interrupt me any time.', { voice: s.voice.ttsVoice, rate: s.voice.ttsRate })}>
              <Icon name="speaker" size={15} />
            </button>
          </Row>
          <Row name="Speaking rate">
            <span className="row" style={{ gap: 6 }}>
              <input type="range" min={0.8} max={1.5} step={0.05} value={s.voice.ttsRate} onChange={(e) => save({ voice: { ttsRate: Number(e.target.value) } })} />
              <span className="small" style={{ width: 36, textAlign: 'right' }}>
                {s.voice.ttsRate.toFixed(2)}×
              </span>
            </span>
          </Row>
          <Row
            name="Speech recognition model"
            desc={
              sttGemini ? (
                <>
                  Your recording is <b>sent to Google</b> and transcribed by Gemini with your Google AI key, together with the course name and its topic list, so terms come out right and spoken math is written as LaTeX.
                  {googleKey === false ? ' No Google AI key is saved yet: add one under Models.' : ''} If Gemini fails, this computer transcribes instead (local Whisper Base).
                </>
              ) : (
                'Runs on this computer: downloaded once from Hugging Face, then cached; audio never leaves your Mac. Answer by voice with the microphone button.'
              )
            }
          >
            <select className="select" style={{ width: 260 }} value={s.voice.sttModel} onChange={(e) => save({ voice: { sttModel: e.target.value } })} aria-label="Speech recognition model">
              {STT_MODELS.filter((m) => m.id !== GEMINI_STT || !!app.backend.transcribeCloud || sttGemini).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          <Row name="Spoken language" desc={sttGemini ? 'Gemini writes what you say in this language; it never translates.' : 'English-only models always transcribe English.'}>
            <select className="select" style={{ width: 160 }} value={s.voice.sttLanguage} onChange={(e) => save({ voice: { sttLanguage: e.target.value as Settings['voice']['sttLanguage'] } })}>
              <option value="english">English</option>
              <option value="german">German</option>
              <option value="auto">Detect</option>
            </select>
          </Row>
          <Row
            name={sttGemini ? 'Prepare the local fallback' : 'Prepare speech recognition'}
            desc={
              stt.state === 'ready'
                ? `Ready${stt.device ? ` (${stt.device === 'webgpu' ? 'GPU' : 'CPU'})` : ''}.`
                : stt.state === 'loading'
                  ? stt.total
                    ? `Downloading… ${pct(stt.loaded / stt.total)}`
                    : 'Loading…'
                  : stt.state === 'error'
                    ? `Failed: ${stt.message}`
                    : 'Otherwise it loads the first time you press the microphone.'
            }
          >
            <button className="btn sm" disabled={stt.state === 'loading' || stt.state === 'ready'} onClick={() => transcriber.preload(sttGemini ? LOCAL_STT_FALLBACK : s.voice.sttModel)}>
              <Icon name="mic" size={15} /> Load now
            </button>
          </Row>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Learning</h3>
          </div>
          <Row
            name="How the tutor works"
            desc="Agent chat: the tutor is an agent you talk to; it builds questions, explanations, plans and demos with its tools and decides the next step. Guided sessions: the fixed probe, plan, teach and wrap-up loop."
          >
            <span className="seg">
              <button className={s.learning.tutorMode !== 'guided' ? 'on' : ''} onClick={() => save({ learning: { tutorMode: 'agent' } })}>
                Agent chat
              </button>
              <button className={s.learning.tutorMode === 'guided' ? 'on' : ''} onClick={() => save({ learning: { tutorMode: 'guided' } })}>
                Guided sessions
              </button>
            </span>
          </Row>
          <Row name="Target memory" desc={`Reviews are scheduled for when your chance of recalling a concept drops to ${pct(s.learning.desiredRetention)}. Higher means more frequent reviews.`}>
            <span className="row" style={{ gap: 6 }}>
              <input type="range" min={0.8} max={0.95} step={0.01} value={s.learning.desiredRetention} onChange={(e) => save({ learning: { desiredRetention: Number(e.target.value) } })} />
              <span className="small" style={{ width: 36, textAlign: 'right' }}>
                {pct(s.learning.desiredRetention)}
              </span>
            </span>
          </Row>
          <Row name="Items per practice session">
            <span className="row" style={{ gap: 6 }}>
              <input type="range" min={4} max={16} value={s.learning.practiceItems} onChange={(e) => save({ learning: { practiceItems: Number(e.target.value) } })} />
              <span className="small" style={{ width: 24, textAlign: 'right' }}>
                {s.learning.practiceItems}
              </span>
            </span>
          </Row>
        </div>

        <div className="panel">
          <div className="panel-title">
            <h3>Your data</h3>
            <span className="hint">{info?.dataDir}</span>
          </div>
          <Row name="Export" desc="Your learner model, answers and points as one JSON file.">
            <button className="btn sm" onClick={exportData}>
              <Icon name="copy" size={15} /> Export
            </button>
          </Row>
          <Row name="Import" desc="Replace the learner model with an export.">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importData(f)
                e.target.value = ''
              }}
            />
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              Import…
            </button>
          </Row>
          <Row name="Start over" desc="Forget everything the tutor learned about you. Settings are kept.">
            {confirmReset ? (
              <>
                <button className="btn sm ghost" onClick={() => setConfirmReset(false)}>
                  Keep it
                </button>
                <button
                  className="btn sm danger"
                  onClick={() => {
                    setConfirmReset(false)
                    void app.resetAll().then(() => app.toast({ kind: 'info', text: 'Your learner model was reset.' }))
                  }}
                >
                  Yes, erase it
                </button>
              </>
            ) : (
              <button className="btn sm danger" onClick={() => setConfirmReset(true)}>
                <Icon name="trash" size={15} /> Reset
              </button>
            )}
          </Row>
          <Row name="Welcome tour" desc="See the learning principles again and redo the setup.">
            <button className="btn sm ghost" onClick={() => app.ui.set((u) => ({ ...u, onboarding: true }))}>
              Open
            </button>
          </Row>
          <div className="tiny muted" style={{ marginTop: 10 }}>
            Anamnesis {info?.version ?? ''} · {info?.backend === 'electron' ? 'desktop app' : info?.backend === 'http' ? 'browser, dev server' : 'browser demo'}
          </div>
        </div>
      </div>
    </div>
  )
}
