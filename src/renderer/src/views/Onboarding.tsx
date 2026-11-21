// First run: how the app teaches (and why), connecting Claude, the lecture notes, and a few notes about you.
import { useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { Modal } from '../components/Modal'
import { SEED_PROFILE, useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { pct } from '../lib/format'
import { CliTest } from './SettingsView'

const PRINCIPLES: { title: string; text: string }[] = [
  { title: 'Probe, then plan', text: 'A few quick questions find what you already know; the tutor then builds the path from there to the goal.' },
  { title: 'Predict before you are told', text: 'Guessing the next step first, even wrongly, makes the explanation stick (pretesting).' },
  { title: 'Retrieve, do not reread', text: 'Every idea comes back as a question. Recalling it is what builds memory (the testing effect).' },
  { title: 'Nudges, not answers', text: 'When you are stuck you get the smallest hint that moves you on. The full solution is always one click away.' },
  { title: 'Explain it back', text: 'Putting the reasoning in your own words, by typing or speaking, shows what you really understood.' },
  { title: 'Harder over time', text: 'Practice climbs from recall to composed, unfamiliar, exam-style problems as you succeed.' },
  { title: 'Spaced and mixed', text: 'Reviews come back just before you would forget, mixed across topics so you learn to pick the method.' },
  { title: 'Honest numbers', text: 'Mastery, memory and calibration come from your answers only, and you can inspect every one.' }
]

export function Onboarding(): ReactElement {
  const app = useApp()
  const settings = useStore(app.settings, (s) => s)
  const script = useStore(app.script.status, (s) => s)
  const profile = useStore(app.state, (s) => s.learner.profile)
  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(() => new Set(profile.filter((p) => SEED_PROFILE.includes(p.text)).map((p) => p.text)))
  const [extra, setExtra] = useState('')
  const steps = 4
  const close = (): void => {
    void app.saveSettings({ onboarded: true })
    app.ui.set((u) => ({ ...u, onboarding: false }))
  }
  const finish = (): void => {
    const keep = profile.filter((p) => !SEED_PROFILE.includes(p.text)).map((p) => ({ id: p.id, text: p.text, source: p.source }))
    const seeds = SEED_PROFILE.filter((t) => picked.has(t)).map((text) => ({ text, source: 'seed' as const }))
    const own = extra.trim() ? [{ text: extra.trim(), source: 'user' as const }] : []
    app.setProfile([...seeds, ...keep, ...own])
    close()
  }
  const first = app.graph.frontier(app.state.get().learner)[0]

  return (
    <Modal onClose={close} width={720} label="Welcome">
      <div className="onb-steps" aria-hidden>
        {Array.from({ length: steps }, (_, i) => (
          <span key={i} className={i <= step ? 'on' : ''} />
        ))}
      </div>

      {step === 0 && (
        <>
          <h1 style={{ fontSize: 24 }}>Welcome to Anamnesis</h1>
          <p style={{ color: 'var(--text-2)', marginTop: 8 }}>
            A tutor for Numerical Methods for CS that teaches the way memory research says works: short interactive steps, questions before answers, and a model of your understanding that keeps up with you.
          </p>
          <div className="principles">
            {PRINCIPLES.map((p) => (
              <div className="principle" key={p.title}>
                <b>{p.title}</b>
                {p.text}
              </div>
            ))}
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <h2>Connect the tutor</h2>
          <p style={{ color: 'var(--text-2)', marginTop: 8 }}>
            Anamnesis talks to Claude through the Claude Code command line tool, using your own Claude login. Install it once with <code>npm install -g @anthropic-ai/claude-code</code>, run <code>claude</code> in a terminal to sign in, then test here.
          </p>
          <CliTest compact />
          <div className="divider" />
          <div className="row between">
            <span className="small muted">No Claude yet? The scripted demo tutor shows how everything works.</span>
            <button className={`btn sm ${settings.provider === 'demo' ? 'primary' : ''}`} onClick={() => void app.saveSettings({ provider: settings.provider === 'demo' ? 'claude-cli' : 'demo' })}>
              {settings.provider === 'demo' ? 'Using the demo tutor' : 'Use the demo tutor'}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <h2>Your lecture notes</h2>
          <p style={{ color: 'var(--text-2)', marginTop: 8 }}>
            Choose your copy of <code>{app.course.script.fileName}</code>. The tutor then uses the script’s definitions, notation and numbering, and every card can open the exact page. The PDF stays on this computer.
          </p>
          {script.state === 'ready' ? (
            <div className="test-result ok row" style={{ gap: 8 }}>
              <Icon name="check" size={16} style={{ color: 'var(--good)' }} /> {script.numPages} pages ready.
            </div>
          ) : script.state === 'indexing' || script.state === 'loading' ? (
            <div className="stack" style={{ gap: 8 }}>
              <div className="small">Reading the pages once… {pct(script.progress)}</div>
              <div className="bar">
                <span style={{ width: pct(script.progress) }} />
              </div>
            </div>
          ) : app.backend.kind === 'electron' ? (
            <button className="btn primary" onClick={() => void app.chooseScript()}>
              <Icon name="book" size={16} /> Choose the PDF
            </button>
          ) : (
            <div className="small muted">In the browser preview the dev server provides the PDF (ANAMNESIS_SCRIPT). You can skip this.</div>
          )}
          {script.state === 'error' && <div className="tex-error">{script.message}</div>}
        </>
      )}

      {step === 3 && (
        <>
          <h2>A few notes about you</h2>
          <p style={{ color: 'var(--text-2)', marginTop: 8 }}>Tick what applies. The tutor reads these before every step, adds its own observations over time, and you can edit all of them in the mind model.</p>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            {SEED_PROFILE.map((t) => (
              <label className="check-item" key={t}>
                <input
                  type="checkbox"
                  checked={picked.has(t)}
                  onChange={(e) =>
                    setPicked((s) => {
                      const n = new Set(s)
                      if (e.target.checked) n.add(t)
                      else n.delete(t)
                      return n
                    })
                  }
                />
                <span>{t}</span>
              </label>
            ))}
            <input className="input" placeholder="Anything else the tutor should know about how you learn?" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
          {first && (
            <p className="small muted" style={{ marginTop: 14 }}>
              Tip: the first concept ready for you is <Markdown text={app.graph.title(first)} inline />. You can also pick any topic on the course map; the probe checks the prerequisites for you.
            </p>
          )}
        </>
      )}

      <div className="row" style={{ marginTop: 20 }}>
        {step > 0 && (
          <button className="btn ghost" onClick={() => setStep((s) => s - 1)}>
            Back
          </button>
        )}
        <div className="spacer" />
        {step < steps - 1 ? (
          <>
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep((s) => s + 1)}>
                Skip
              </button>
            )}
            <button className="btn primary" onClick={() => setStep((s) => s + 1)}>
              Next <Icon name="chev-right" size={15} />
            </button>
          </>
        ) : (
          <button className="btn primary" onClick={finish}>
            Start learning
          </button>
        )}
      </div>
    </Modal>
  )
}
