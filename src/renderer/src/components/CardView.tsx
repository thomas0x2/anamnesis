// One tutor card: content blocks, the interaction, nudges, confidence, feedback and the worked solution.
import type { Card, CardResponse, PracticeTarget } from "@shared/types";
import { CONFIDENCE_LABEL, CONFIDENCE_PROB } from "@shared/stats";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useApp } from "../engine/app";
import {
  MAX_ATTEMPTS,
  type AnswerPayload,
  type CardDraft,
  type SessionController,
} from "../engine/session";
import { useStore } from "../engine/store";
import {
  CUE_LABEL,
  KIND_LABEL,
  LEVEL_LABEL,
  speakable,
  VERDICT_LABEL,
} from "../lib/format";
import { speak } from "../voice/voice";
import { Blocks } from "./Blocks";
import { Icon } from "./Icon";
import {
  FillInput,
  FreeInput,
  McqInput,
  NumericInput,
  OrderInput,
} from "./Interactions";
import { Markdown } from "./Markdown";
import { SpeakButton, TalkButton, useDictation, useDictationHotkey } from "./Voice";

const KIND_ICON: Record<Card["kind"], string> = {
  probe: "probe",
  predict: "bulb",
  explain: "book",
  check: "target",
  practice: "dumbbell",
  review: "refresh",
  reflect: "chat",
  summary: "list",
  message: "tree",
};

export interface PredictionRef {
  text: string;
  si: number;
  ci: number;
  selfCheck: CardResponse["selfCheck"];
}

export interface CardViewProps {
  sc: SessionController;
  si: number;
  ci: number;
  stepId: string;
  card: Card;
  response: CardResponse | undefined;
  draft: CardDraft;
  current: boolean;
  compact: boolean;
  onToggle?: () => void;
  target: PracticeTarget | null;
  prediction?: PredictionRef | null;
  finishing: boolean;
  /** the learner wrote to the tutor instead of answering, and the tutor moved on */
  setAside?: boolean;
}

function cardSpeech(card: Card): string {
  if (card.speech) return card.speech;
  const parts = card.blocks.map((b) => b.md ?? "").filter(Boolean);
  if (card.interaction?.prompt) parts.push(card.interaction.prompt);
  return speakable(parts.join(" ")).slice(0, 600);
}

export function CardView(props: CardViewProps): ReactElement {
  const {
    sc,
    si,
    ci,
    card,
    response,
    draft,
    current,
    compact,
    target,
    prediction,
    finishing,
  } = props;
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  const it = card.interaction;
  const isContinue = !it || it.type === "continue";
  const done = !!response || draft.done;
  const [payload, setPayload] = useState<AnswerPayload | null>(null);
  const [tried, setTried] = useState<string[]>([]);
  const [showSolution, setShowSolution] = useState(false);
  const [reasoning, setReasoning] = useState("");
  const [reasoningOpen, setReasoningOpen] = useState(false);
  // while the learner is still talking (or it is being transcribed), the answer waits for it
  const [dictating, setDictating] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const speechKey = `${props.stepId}:${ci}`;

  useEffect(() => {
    if (!current) return;
    sc.touch(si, ci);
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (voice.tts && voice.autoSpeak && !done)
      speak(speechKey, cardSpeech(card), {
        voice: voice.ttsVoice,
        rate: voice.ttsRate,
      });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps

  if (compact) return <CompactCard {...props} />;

  const isOpenPrediction =
    (card.kind === "probe" || card.kind === "predict") && it?.type === "free";
  const needsConfidence =
    !!it &&
    it.confidence &&
    !isContinue &&
    draft.attempts === 0 &&
    !isOpenPrediction;
  const maxAttempts = MAX_ATTEMPTS[card.kind];
  const hintsLeft = it ? it.hints.length - draft.hintsUsed : 0;
  const neutral = card.kind === "probe";
  const verdict = response?.verdict ?? draft.verdict;
  const finalMarks = done && !neutral;
  const canReveal =
    !!it &&
    !isContinue &&
    !done &&
    card.kind !== "probe" &&
    card.kind !== "predict" &&
    (draft.attempts > 0 || hintsLeft <= 0);

  const submit = async (confidence: number | null): Promise<void> => {
    if (!payload || done || draft.grading) return;
    await sc.answer(
      si,
      ci,
      payload,
      confidence,
      reasoningOpen ? reasoning : "",
    );
    const d = sc.draft(si, ci);
    if (
      !d.done &&
      payload.kind === "mcq" &&
      !it?.multi &&
      d.verdict === "incorrect"
    )
      setTried((t) => [...new Set([...t, ...payload.selected])]);
  };
  const onEnterSubmit = (): void => {
    if (!needsConfidence) void submit(null);
    else
      (
        ref.current?.querySelector(".conf-btn") as HTMLButtonElement | null
      )?.focus();
  };

  const inputProps = {
    it: it!,
    disabled: done || draft.grading || !current,
    final: finalMarks,
    onChange: setPayload,
    onSubmit: onEnterSubmit,
    initial: response?.answer,
  };

  return (
    <div
      ref={ref}
      className={`card ${current ? "current" : "past"}`}
      data-kind={card.kind}
    >
      <div className="card-head">
        <span className={`kind ${card.kind}`}>
          <Icon name={KIND_ICON[card.kind]} size={15} />
          {KIND_LABEL[card.kind]}
        </span>
        {(card.kind === "practice" || card.kind === "review") &&
          (it?.level ?? target?.level) && (
            <span
              className="chip outline"
              title={`Difficulty level ${it?.level ?? target?.level}`}
            >
              L{it?.level ?? target?.level} ·{" "}
              {LEVEL_LABEL[it?.level ?? target?.level ?? 1]}
            </span>
          )}
        {(card.kind === "practice" || card.kind === "review") &&
          (it?.cue ?? target?.cue) && (
            <span className="chip outline">
              {CUE_LABEL[it?.cue ?? target?.cue ?? "familiar"]}
            </span>
          )}
        <span className="spacer" />
        <SpeakButton id={speechKey} text={cardSpeech(card)} />
        {!current && props.onToggle && (
          <button
            className="btn icon sm ghost"
            onClick={props.onToggle}
            title="Collapse"
          >
            <Icon name="chev-up" size={16} />
          </button>
        )}
      </div>
      {card.title && (
        <h3 className="card-title" style={{ marginBottom: 10 }}>
          {<Markdown text={card.title} inline />}
        </h3>
      )}

      {prediction && card.kind === "explain" && (
        <div className="callout info" style={{ marginBottom: 12 }}>
          <Icon name="bulb" />
          <div>
            <div
              className="tiny muted"
              style={{
                fontWeight: 650,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              Your prediction
            </div>
            <Markdown text={prediction.text} />
          </div>
        </div>
      )}

      <Blocks blocks={card.blocks} live={current} />

      {it && !isContinue && (
        <div className="interaction">
          <div className="prompt">
            <Markdown text={it.prompt} />
          </div>
          {it.type === "mcq" && <McqInput {...inputProps} tried={tried} />}
          {it.type === "numeric" && <NumericInput {...inputProps} />}
          {it.type === "free" && (
            <FreeInput
              {...inputProps}
              placeholder={
                isOpenPrediction
                  ? "Your best guess, in a sentence or a formula. Being wrong is useful here."
                  : undefined
              }
            />
          )}
          {it.type === "order" && <OrderInput {...inputProps} />}
          {it.type === "fill" && <FillInput {...inputProps} />}

          {it.type !== "free" && !done && current && (
            <ReasoningBox
              open={reasoningOpen}
              setOpen={setReasoningOpen}
              text={reasoning}
              setText={setReasoning}
              disabled={draft.grading}
              onBusy={setDictating}
            />
          )}
          {it.type !== "free" && done && response?.reasoning && (
            <div className="reasoning-done small">
              <span className="muted">Your reasoning: </span>
              {response.reasoning}
            </div>
          )}

          {draft.hintsUsed > 0 && (
            <div className="hints">
              {it.hints.slice(0, draft.hintsUsed).map((h, i) => (
                <div className="hint" key={i}>
                  <Icon name="spark" size={15} />
                  <div>
                    <div className="n">Nudge {i + 1}</div>
                    <Markdown text={h} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!done && draft.feedback.length > 0 && draft.verdict && (
            <div
              className={`feedback ${draft.verdict === "partial" ? "partial" : "incorrect"}`}
            >
              <Icon name="refresh" />
              <div>
                <div className="verdict">
                  {draft.verdict === "partial" ? "Partly there" : "Not yet"}:
                  try again ({draft.attempts + 1} of {maxAttempts})
                </div>
                {draft.feedback.map((f, i) => (
                  <Markdown key={i} text={f} />
                ))}
                {draft.missing.length > 0 && (
                  <ul>
                    {draft.missing.map((m, i) => (
                      <li key={i}>
                        <Markdown text={m} inline />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {!done &&
            draft.feedback.length === 0 &&
            draft.verdict &&
            draft.verdict !== "correct" && (
              <div className="feedback incorrect">
                <Icon name="refresh" />
                <div className="verdict">
                  Not yet: try again ({draft.attempts + 1} of {maxAttempts})
                </div>
              </div>
            )}

          {draft.grading && (
            <div className="feedback neutral">
              <Icon name="clock" />
              <div>Checking your answer against the key points…</div>
            </div>
          )}

          {done && (
            <Outcome
              card={card}
              response={response}
              draft={draft}
              neutral={neutral}
            />
          )}

          {done && !neutral && (it.solution || it.modelAnswer) && (
            <>
              {showSolution ||
              verdict === "incorrect" ||
              response?.revealed ||
              verdict === "dontknow" ? (
                <div className="solution">
                  <div className="label">
                    {it.type === "free" && it.modelAnswer
                      ? "Model answer"
                      : "Worked solution"}
                  </div>
                  <Markdown
                    text={
                      it.type === "free" && it.modelAnswer
                        ? it.modelAnswer
                        : it.solution
                    }
                  />
                  {it.type === "free" &&
                    it.modelAnswer &&
                    it.solution &&
                    it.solution !== it.modelAnswer && (
                      <div style={{ marginTop: 8 }}>
                        <Markdown text={it.solution} />
                      </div>
                    )}
                </div>
              ) : (
                <button
                  className="btn sm ghost"
                  style={{ marginTop: 10 }}
                  onClick={() => setShowSolution(true)}
                >
                  <Icon name="eye" size={15} /> Show the worked solution
                </button>
              )}
            </>
          )}
          {done && it.explain && verdict === "correct" && (
            <div className="callout insight" style={{ marginTop: 12 }}>
              <Icon name="bulb" />
              <Markdown text={it.explain} />
            </div>
          )}

          {!done && current && needsConfidence && (
            <div className="confidence">
              <div className="label">
                {!payload
                  ? "Pick an answer, then say how sure you are. That submits it."
                  : dictating
                    ? "Finish explaining first, then say how sure you are."
                    : "How sure are you? Picking one submits your answer."}
              </div>
              <div className="row">
                {[1, 2, 3, 4].map((c) => (
                  <button
                    key={c}
                    className="conf-btn"
                    disabled={!payload || draft.grading || dictating}
                    onClick={() => void submit(c)}
                  >
                    <span className="t">{CONFIDENCE_LABEL[c]}</span>
                    <span className="p">
                      ~{Math.round(CONFIDENCE_PROB[c] * 100)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!done && current && (
            <div className="actions">
              {card.kind !== "probe" && it.hints.length > 0 && (
                <button
                  className="btn sm"
                  disabled={hintsLeft <= 0 || draft.grading}
                  onClick={() => sc.hint(si, ci)}
                  title="A small hint that keeps the thinking with you"
                >
                  <Icon name="spark" size={15} /> Nudge me
                  {it.hints.length
                    ? ` (${draft.hintsUsed}/${it.hints.length})`
                    : ""}
                </button>
              )}
              {(card.kind === "probe" || card.kind === "predict") && (
                <button
                  className="btn sm ghost"
                  onClick={() => void sc.answer(si, ci, { kind: "dontknow" })}
                >
                  I don't know yet
                </button>
              )}
              {canReveal && (
                <button
                  className="btn sm ghost"
                  onClick={() => sc.reveal(si, ci)}
                >
                  <Icon name="eye" size={15} /> Show solution
                </button>
              )}
              <span className="spacer" />
              {!needsConfidence && (
                <button
                  className="btn primary"
                  disabled={!payload || draft.grading}
                  onClick={() => void submit(null)}
                >
                  {draft.attempts > 0
                    ? "Check again"
                    : isOpenPrediction
                      ? "Lock in my prediction"
                      : "Check"}
                  {it.type === "free" && <span className="kbd-hint">⌘↵</span>}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {prediction && card.kind === "explain" && current && (
        <div className="row" style={{ marginTop: 14 }}>
          <span className="small muted">Did your prediction match?</span>
          {(["right", "partly", "wrong"] as const).map((v) => (
            <button
              key={v}
              className={`btn sm ${prediction.selfCheck === v ? "primary" : ""}`}
              onClick={() => sc.selfCheck(prediction.si, prediction.ci, v)}
            >
              {v === "right" ? "Yes" : v === "partly" ? "Partly" : "No"}
            </button>
          ))}
        </div>
      )}

      {current && (isContinue ? !done : done) && (
        <div className="actions">
          <span className="spacer" />
          {isContinue && !done ? (
            <button
              className="btn primary"
              autoFocus
              onClick={() => {
                void sc.answer(si, ci, { kind: "continue" });
                sc.advance();
              }}
            >
              {card.kind === "summary" ? "Finish" : "Continue"}{" "}
              <Icon name="arrow" size={16} />
            </button>
          ) : (
            <button
              className="btn primary"
              autoFocus
              onClick={() => sc.advance()}
            >
              {finishing ? "See results" : "Next"}{" "}
              <Icon name="arrow" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Optional explanation of how the learner got the answer, spoken (local Whisper) or typed; it is
 * graded with the answer. One click starts listening; the next click stops and transcribes.
 */
function ReasoningBox({
  open,
  setOpen,
  text,
  setText,
  disabled,
  onBusy,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  text: string;
  setText: (f: (t: string) => string) => void;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
}): ReactElement {
  const { phase, toggle, cancel, loading } = useDictation((t) =>
    setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t)),
  );
  useEffect(() => onBusy(phase !== "idle"), [phase, onBusy]);
  const start = (): void => {
    setOpen(true);
    void toggle();
  };
  // the shortcut opens the box and starts listening in one go, like the button
  useDictationHotkey(!disabled, 2, open ? () => void toggle() : start, phase !== "idle");
  if (!open) {
    return (
      <div className="reasoning-start">
        <TalkButton
          className="reasoning-toggle"
          phase={phase}
          loading={loading}
          idleLabel="Talk through your reasoning"
          disabled={disabled}
          onClick={start}
        />
        <span className="tiny muted">Graded with your answer: sound reasoning can earn partial credit for a slip.</span>
      </div>
    );
  }
  const recording = phase === "recording";
  return (
    <div className={`reasoning-box ${recording ? "recording" : ""}`}>
      <div className="reasoning-head">
        <TalkButton
          className={`reasoning-mic ${recording ? "rec" : ""}`}
          phase={phase}
          loading={loading}
          idleLabel={text.trim() ? "Add more by voice" : "Talk it through"}
          disabled={disabled}
          onClick={() => void toggle()}
        />
        <span className="spacer" />
        <button
          className="btn icon sm ghost"
          onClick={() => {
            cancel();
            setOpen(false);
          }}
          title="Answer without reasoning"
          aria-label="Answer without reasoning"
        >
          <Icon name="x" size={15} />
        </button>
      </div>
      <textarea
        className="textarea"
        rows={2}
        value={text}
        disabled={disabled}
        placeholder="Or type it: what you noticed, which idea you used, each step."
        onChange={(e) => setText(() => e.target.value)}
      />
      <div className="tiny muted">
        Graded with your answer: sound reasoning can earn partial credit for a slip. Audio stays on this computer.
      </div>
    </div>
  );
}

function Outcome({
  card,
  response,
  draft,
  neutral,
}: {
  card: Card;
  response: CardResponse | undefined;
  draft: CardDraft;
  neutral: boolean;
}): ReactElement | null {
  const verdict = response?.verdict ?? draft.verdict;
  const fb = response?.feedback ? [response.feedback] : draft.feedback;
  const missing = response?.missing ?? draft.missing;
  if (neutral) {
    return (
      <div className="feedback neutral">
        <Icon name="check" />
        <div>
          <div className="verdict">
            {verdict === "dontknow"
              ? "Fine: that tells me where to start."
              : "Noted."}
          </div>
          <div className="small muted">
            Probe answers shape your plan; you get feedback once we work through
            it.
          </div>
        </div>
      </div>
    );
  }
  if (verdict === "seen") {
    return (
      <div className="feedback neutral">
        <Icon name="bulb" />
        <div>
          <div className="verdict">Prediction locked in.</div>
          <div className="small muted">
            The next card reveals the answer: compare it with what you wrote.
          </div>
        </div>
      </div>
    );
  }
  if (verdict === "dontknow") {
    return (
      <div className="feedback neutral">
        <Icon name="info" />
        <div>
          <div className="verdict">No problem.</div>
          <div className="small muted">
            {card.kind === "predict"
              ? "Watch for it in the next card."
              : "Read the solution, then we try a similar one later."}
          </div>
        </div>
      </div>
    );
  }
  if (!verdict) return null;
  const cls =
    verdict === "correct"
      ? "correct"
      : verdict === "partial"
        ? "partial"
        : "incorrect";
  const revealed = response?.revealed;
  return (
    <div className={`feedback ${cls}`}>
      <Icon
        name={
          verdict === "correct"
            ? "check"
            : verdict === "partial"
              ? "minus"
              : "x"
        }
      />
      <div>
        <div className="verdict">
          {revealed ? "Solution shown" : VERDICT_LABEL[verdict]}
          {verdict === "correct" &&
          response &&
          response.hintsUsed === 0 &&
          response.attempts <= 1 &&
          card.kind !== "predict"
            ? ": on your own"
            : ""}
        </div>
        {fb.map((f, i) => (
          <Markdown key={i} text={f} />
        ))}
        {missing && missing.length > 0 && (
          <>
            <div className="small muted" style={{ marginTop: 6 }}>
              Not yet in your answer:
            </div>
            <ul>
              {missing.map((m, i) => (
                <li key={i}>
                  <Markdown text={m} inline />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function CompactCard({
  card,
  response,
  onToggle,
  setAside,
}: CardViewProps): ReactElement {
  const verdict = response?.verdict ?? null;
  const title =
    card.title ??
    card.interaction?.prompt ??
    card.blocks.find((b) => b.md)?.md ??
    KIND_LABEL[card.kind];
  return (
    <div
      className="card compact past"
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onToggle?.()}
    >
      <div className="card-head">
        <span className={`kind ${card.kind}`}>
          <Icon name={KIND_ICON[card.kind]} size={14} />
          {KIND_LABEL[card.kind]}
        </span>
        <span className="card-title">
          <Markdown text={title.split("\n")[0].slice(0, 140)} inline />
        </span>
        <span className="spacer" />
        {setAside && !response && card.interaction?.type !== "continue" && (
          <span className="chip" title="You asked the tutor instead; it may come back to this">
            set aside
          </span>
        )}
        {verdict && verdict !== "seen" && card.kind !== "probe" && (
          <span
            className={`chip verdict-chip ${verdict === "correct" ? "good" : verdict === "partial" ? "warn" : verdict === "incorrect" ? "bad" : ""}`}
          >
            {verdict === "correct" ? (
              <Icon name="check" size={12} />
            ) : verdict === "incorrect" ? (
              <Icon name="x" size={12} />
            ) : null}
            {VERDICT_LABEL[verdict]}
          </span>
        )}
        <Icon name="chev-down" size={16} style={{ color: "var(--faint)" }} />
      </div>
    </div>
  );
}
