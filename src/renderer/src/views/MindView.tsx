// The persistent model of your mind: how you learn, where each concept stands and why the tutor thinks so.
// Everything here is editable or traceable to the answers that produced it.
import { cardRetrievability } from '@shared/fsrs'
import { masteryMean, statusRank } from '@shared/mastery'
import { masteryInterval } from '@shared/stats'
import type { ConceptState, ConceptStatus, Evidence, ProfileNote } from '@shared/types'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { Icon } from '../components/Icon'
import { Markdown } from '../components/Markdown'
import { useApp } from '../engine/app'
import { useStore } from '../engine/store'
import { LEVEL_LABEL, pct, plural, relTime, STATUS_HELP, STATUS_LABEL } from '../lib/format'
import { useNow } from '../lib/hooks'
import { StatusLegend } from './HomeView'

type Filter = 'started' | 'all' | 'misc'

export function MindView({ conceptId }: { conceptId?: string }): ReactElement {
  const app = useApp()
  const learner = useStore(app.state, (s) => s.learner)
  const graph = app.graph
  const now = useNow()
  const started = useMemo(() => app.course.concepts.filter((c) => (learner.concepts[c.id]?.status ?? 'unseen') !== 'unseen'), [app, learner])
  const lastSeen = useMemo(() => [...started].sort((a, b) => (learner.concepts[b.id]?.lastSeen ?? '').localeCompare(learner.concepts[a.id]?.lastSeen ?? ''))[0]?.id ?? null, [started, learner])
  const [selected, setSelected] = useState<string | null>(conceptId ?? lastSeen ?? graph.frontier(learner)[0] ?? null)
  const [filter, setFilter] = useState<Filter>(started.length ? 'started' : 'all')

  useEffect(() => {
    if (conceptId) setSelected(conceptId)
  }, [conceptId])

  const activeMisc = useMemo(() => Object.values(learner.concepts).reduce((s, c) => s + c.misconceptions.filter((m) => m.status === 'active').length, 0), [learner])
  const chapters = useMemo(() => [...app.course.chapters].sort((a, b) => (a.number || 99) - (b.number || 99)), [app])
  const rows = useMemo(() => {
    return app.course.concepts.filter((c) => {
      const cs = learner.concepts[c.id]
      if (filter === 'started') return (cs?.status ?? 'unseen') !== 'unseen'
      if (filter === 'misc') return !!cs?.misconceptions.some((m) => m.status === 'active')
      return true
    })
  }, [app, learner, filter])

  return (
    <div className="page" style={{ maxWidth: 1320 }}>
      <div className="page-head">
        <div>
          <h1>Your mind model</h1>
          <div className="sub">
            What the tutor believes you understand, and the evidence behind it. {started.length ? `${plural(started.length, 'concept')} started` : 'Nothing measured yet'}
            {activeMisc ? `, ${plural(activeMisc, 'open misconception')}` : ''}. Correct anything that is wrong.
          </div>
        </div>
      </div>

      <div className="mind-layout">
        <div className="stack" style={{ gap: 16, minWidth: 0 }}>
          <ProfilePanel />

          <div className="panel">
            <div className="panel-title">
              <h3>Understanding by chapter</h3>
              <span className="hint">one square per concept</span>
            </div>
            <div className="mastery-grid">
              {chapters.map((ch) => (
                <div className="mg-row" key={ch.number}>
                  <span className="t" title={ch.title}>
                    {ch.number ? `${ch.number}. ` : ''}
                    {ch.title}
                  </span>
                  <span className="mg-cells">
                    {graph.chapterConcepts(ch.number).map((c) => {
                      const cs = learner.concepts[c.id]
                      const st = cs?.status ?? 'unseen'
                      const misc = !!cs?.misconceptions.some((m) => m.status === 'active')
                      return (
                        <button
                          key={c.id}
                          className={`mg-cell ${st} ${misc ? 'misc' : ''} ${selected === c.id ? 'selected' : ''}`}
                          title={`${c.title}: ${STATUS_LABEL[st]}${misc ? ' · open misconception' : ''}`}
                          aria-label={`${c.title}: ${STATUS_LABEL[st]}`}
                          onClick={() => setSelected(c.id)}
                        />
                      )
                    })}
                  </span>
                </div>
              ))}
            </div>
            <StatusLegend />
          </div>

          <div className="panel">
            <div className="panel-title">
              <h3>Concepts</h3>
              <div className="tabs">
                <button className={filter === 'started' ? 'active' : ''} onClick={() => setFilter('started')}>
                  Started
                </button>
                <button className={filter === 'misc' ? 'active' : ''} onClick={() => setFilter('misc')}>
                  Misconceptions
                </button>
                <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
                  All
                </button>
              </div>
            </div>
            {rows.length ? (
              <div style={{ maxHeight: 520, overflow: 'auto' }}>
                <table className="concept-table">
                  <thead>
                    <tr>
                      <th>Concept</th>
                      <th>Status</th>
                      <th>Mastery</th>
                      <th>Memory</th>
                      <th>Next review</th>
                      <th>Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => {
                      const cs = learner.concepts[c.id]
                      const st = cs?.status ?? 'unseen'
                      const mem = cs ? cardRetrievability(cs.fsrs, now) : null
                      const misc = cs?.misconceptions.filter((m) => m.status === 'active').length ?? 0
                      return (
                        <tr key={c.id} className={selected === c.id ? 'selected' : ''} onClick={() => setSelected(c.id)}>
                          <td>
                            <span className="row" style={{ gap: 8 }}>
                              <span className="muted tiny" style={{ width: 22 }}>
                                {c.chapter || '·'}
                              </span>
                              <Markdown text={c.title} inline />
                              {misc > 0 && (
                                <span className="chip warn" title="open misconceptions">
                                  <Icon name="alert" size={12} /> {misc}
                                </span>
                              )}
                            </span>
                          </td>
                          <td>
                            <span className="row" style={{ gap: 6 }}>
                              <span className={`status-dot ${st}`} />
                              {STATUS_LABEL[st]}
                            </span>
                          </td>
                          <td>{cs && st !== 'unseen' ? pct(masteryMean(cs)) : '–'}</td>
                          <td>{mem !== null ? pct(mem) : '–'}</td>
                          <td className="muted">{cs?.fsrs?.due ? relTime(cs.fsrs.due, now) : '–'}</td>
                          <td>{cs && st !== 'unseen' ? cs.level : '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">{filter === 'misc' ? 'No open misconceptions. When the tutor notices one, it shows up here.' : 'Nothing here yet.'}</div>
            )}
          </div>
        </div>

        <div className="concept-panel">{selected && graph.get(selected) ? <ConceptDetail id={selected} /> : <div className="panel empty">Select a concept to see its evidence.</div>}</div>
      </div>
    </div>
  )
}

const SOURCE_LABEL: Record<ProfileNote['source'], string> = { seed: 'from setup', tutor: 'tutor noticed', user: 'you wrote' }

function ProfilePanel(): ReactElement {
  const app = useApp()
  const profile = useStore(app.state, (s) => s.learner.profile)
  const [editing, setEditing] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [adding, setAdding] = useState('')
  const save = (list: ProfileNote[]): void => app.setProfile(list.map((p) => ({ id: p.id, text: p.text, source: p.source })))

  return (
    <div className="panel">
      <div className="panel-title">
        <h3>How you learn</h3>
        <span className="hint">the tutor reads this before every step</span>
      </div>
      <div className="profile-list">
        {profile.map((p) => (
          <div className="profile-item" key={p.id}>
            <span className={`chip src ${p.source === 'tutor' ? 'accent' : 'outline'}`}>{SOURCE_LABEL[p.source]}</span>
            {editing === p.id ? (
              <input
                className="input txt"
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    save(profile.map((x) => (x.id === p.id ? { ...x, text, source: 'user' } : x)))
                    setEditing(null)
                  }
                  if (e.key === 'Escape') setEditing(null)
                }}
                onBlur={() => {
                  if (text.trim() && text !== p.text) save(profile.map((x) => (x.id === p.id ? { ...x, text, source: 'user' } : x)))
                  setEditing(null)
                }}
              />
            ) : (
              <span className="txt">{p.text}</span>
            )}
            <button
              className="btn icon sm ghost"
              title="Edit"
              onClick={() => {
                setEditing(p.id)
                setText(p.text)
              }}
            >
              <Icon name="edit" size={14} />
            </button>
            <button className="btn icon sm ghost" title="Remove" onClick={() => save(profile.filter((x) => x.id !== p.id))}>
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
        {!profile.length && <div className="small muted">No notes yet. Add what helps you learn, or let the tutor add what it notices.</div>}
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            if (!adding.trim()) return
            app.setProfile([...profile.map((p) => ({ id: p.id, text: p.text, source: p.source })), { text: adding.trim(), source: 'user' }])
            setAdding('')
          }}
        >
          <input className="input" placeholder="Add a note, e.g. “I learn faster from a picture first”" value={adding} onChange={(e) => setAdding(e.target.value)} />
          <button className="btn" type="submit" disabled={!adding.trim()}>
            <Icon name="plus" size={15} /> Add
          </button>
        </form>
      </div>
    </div>
  )
}

const KIND_NAME: Record<Evidence['kind'], string> = { probe: 'Probe', predict: 'Prediction', check: 'Check', practice: 'Practice', review: 'Review', reflect: 'Explain-back', work: 'Problem set', exam: 'Mock exam' }

function ConceptDetail({ id }: { id: string }): ReactElement {
  const app = useApp()
  const c = app.graph.get(id)!
  const cs = useStore(app.state, (s) => s.learner.concepts[id]) as ConceptState | undefined
  const now = useNow()
  const [note, setNote] = useState(cs?.userNote ?? '')
  const [hover, setHover] = useState<Evidence | null>(null)

  useEffect(() => {
    setNote(cs?.userNote ?? '')
    setHover(null)
    // reset only when the concept changes, not on every save
  }, [id])

  const st: ConceptStatus = cs?.status ?? 'unseen'
  const mastery = cs && st !== 'unseen' ? masteryMean(cs) : null
  const [lo, hi] = cs && st !== 'unseen' ? masteryInterval(cs) : [0, 0]
  const memory = cs ? cardRetrievability(cs.fsrs, now) : null
  const evidence = (cs?.evidence ?? []).slice(-28)
  const misc = cs?.misconceptions ?? []
  const shown = hover ?? evidence[evidence.length - 1] ?? null

  return (
    <div className="panel stack">
      <div>
        <div className="row" style={{ marginBottom: 6 }}>
          <span className="chip outline">{c.chapter ? `Chapter ${c.chapter}` : 'Refresher'}</span>
          <span className="chip">
            <span className={`status-dot ${st}`} /> {STATUS_LABEL[st]}
          </span>
        </div>
        <h2>
          <Markdown text={c.title} inline />
        </h2>
        <div className="small muted" style={{ marginTop: 4 }}>
          {STATUS_HELP[st]}
        </div>
      </div>

      {st !== 'unseen' && cs ? (
        <div className="kv">
          <span className="k">Mastery</span>
          <span>
            <span className="row" style={{ gap: 8 }}>
              <span className="bar" style={{ flex: 1, position: 'relative' }}>
                <span style={{ left: pct(lo), width: pct(hi - lo), background: 'rgba(143,179,224,0.3)' }} />
                <span style={{ width: pct(mastery ?? 0) }} />
              </span>
              {pct(mastery)}
            </span>
            <span className="tiny muted">
              likely between {pct(lo)} and {pct(hi)}, from {plural(cs.evidence.length, 'answer')}
            </span>
          </span>
          <span className="k">Memory</span>
          <span>
            {memory !== null ? `${pct(memory)} chance you recall it now` : 'not scheduled yet'}
            {cs.fsrs?.due && (
              <span className="tiny muted" style={{ display: 'block' }}>
                next review {relTime(cs.fsrs.due, now)} · stable for about {cs.fsrs.stability < 1 ? '<1 day' : plural(Math.round(cs.fsrs.stability), 'day')}
                {cs.fsrs.lapses ? ` · forgotten ${plural(cs.fsrs.lapses, 'time')}` : ''}
              </span>
            )}
          </span>
          <span className="k">Practice level</span>
          <span>
            {cs.level} · {LEVEL_LABEL[cs.level]}
            <span className="tiny muted" style={{ display: 'block' }}>
              highest solved without help: {cs.maxLevelSolved ? `${cs.maxLevelSolved} · ${LEVEL_LABEL[cs.maxLevelSolved]}` : 'none yet'}
            </span>
          </span>
          {cs.understanding !== null && (
            <>
              <span className="k">Understanding</span>
              <span>{pct(cs.understanding)} on comprehension checks</span>
            </>
          )}
          {cs.independence !== null && (
            <>
              <span className="k">Independence</span>
              <span>{pct(cs.independence)} without hints or the solution</span>
            </>
          )}
          {cs.transfer !== null && (
            <>
              <span className="k">Transfer</span>
              <span>{pct(cs.transfer)} on unfamiliar or composed problems</span>
            </>
          )}
        </div>
      ) : (
        <div className="small muted">No answers on this concept yet. A probe at the start of a session measures where you stand.</div>
      )}

      {cs?.tutorNote && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Tutor’s note {cs.tutorNoteAt ? `· ${relTime(cs.tutorNoteAt, now)}` : ''}
          </div>
          <div className="note-box">
            <Markdown text={cs.tutorNote} />
          </div>
        </div>
      )}

      <div>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Your note (the tutor reads it)
        </div>
        <textarea className="textarea" style={{ minHeight: 64 }} placeholder="e.g. I keep forgetting why the weights only depend on the nodes" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => app.setUserNote(id, note)} />
      </div>

      {misc.length > 0 && (
        <div>
          <div className="small muted" style={{ marginBottom: 6 }}>
            Misconceptions
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {misc.map((m) => (
              <div key={m.id} className={`misc-item ${m.status}`}>
                <Icon name={m.status === 'active' ? 'alert' : 'check'} size={15} style={{ color: m.status === 'active' ? 'var(--warn)' : 'var(--good)', flex: 'none', marginTop: 2 }} />
                <span className="txt">
                  <Markdown text={m.text} inline />
                  <span className="tiny muted" style={{ display: 'block' }}>
                    {m.status === 'active' ? `seen ${plural(m.count, 'time')}, last ${relTime(m.lastSeen, now)}` : `resolved ${relTime(m.resolvedAt, now)}`}
                  </span>
                </span>
                <button className="btn sm ghost" onClick={() => app.setMisconceptionStatus(id, m.id, m.status === 'active' ? 'resolved' : 'active')}>
                  {m.status === 'active' ? 'Resolved' : 'Reopen'}
                </button>
                <button className="btn icon sm ghost" title="Delete (it was wrong)" onClick={() => app.setMisconceptionStatus(id, m.id, 'deleted')}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {evidence.length > 0 && (
        <div>
          <div className="small muted">Recent answers (height = score after hints)</div>
          <div className="evidence-strip" onMouseLeave={() => setHover(null)}>
            {evidence.map((e) => (
              <span
                key={e.id}
                className="ev"
                onMouseEnter={() => setHover(e)}
                style={{
                  height: `${Math.max(8, e.score * 100)}%`,
                  background: e.kind === 'predict' || e.kind === 'probe' ? 'var(--s2)' : 'var(--s1)',
                  outline: shown?.id === e.id ? '2px solid var(--text-2)' : undefined,
                  outlineOffset: 1
                }}
              />
            ))}
          </div>
          {shown && (
            <div className="tiny" style={{ color: 'var(--text-2)' }}>
              <b>{KIND_NAME[shown.kind]}</b>
              {shown.level ? ` · level ${shown.level}` : ''} · {pct(shown.score)}
              {shown.hints ? ` · ${plural(shown.hints, 'hint')}` : ''}
              {shown.revealed ? ' · solution shown' : ''} · {relTime(shown.at, now)}
              <div className="muted" style={{ marginTop: 2 }}>
                <Markdown text={shown.summary} inline />
              </div>
            </div>
          )}
          <div className="legend-row" style={{ marginTop: 8 }}>
            <span>
              <span className="status-dot" style={{ background: 'var(--s1)' }} /> graded answer
            </span>
            <span>
              <span className="status-dot" style={{ background: 'var(--s2)' }} /> probe or prediction (weighs less)
            </span>
          </div>
        </div>
      )}

      <div className="row wrap">
        <button className="btn primary" onClick={() => void app.startLearn(id)}>
          <Icon name="probe" size={16} /> {st === 'unseen' ? 'Learn this' : 'Learn again'}
        </button>
        <button className="btn" disabled={statusRank(st) < 1} onClick={() => void app.startPractice([id])}>
          <Icon name="dumbbell" size={16} /> Practice
        </button>
        <button className="btn ghost" onClick={() => app.go({ name: 'map', conceptId: id })}>
          <Icon name="map" size={16} /> Map
        </button>
      </div>
    </div>
  )
}
