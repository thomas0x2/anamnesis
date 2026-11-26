// Microphone button (local Whisper, or Gemini when chosen in Settings → Voice) and the read-aloud button.
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useApp } from "../engine/app";
import { useStore } from "../engine/store";
import {
  Recorder,
  speak,
  speaking,
  stopSpeaking,
  transcriber,
} from "../voice/voice";
import { encodeWav, GEMINI_STT, LOCAL_STT_FALLBACK, sttContext, toBase64 } from "@shared/stt";
import { Icon } from "./Icon";

export type DictationPhase = "idle" | "recording" | "working";

/** Dictation: toggle() starts recording, the next toggle() stops and transcribes into onText. */
export function useDictation(onText: (text: string) => void): {
  phase: DictationPhase;
  toggle: () => Promise<void>;
  cancel: () => void;
  loading: string | null;
} {
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  const stt = useStore(transcriber.status, (s) => s);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const cloud = voice.sttModel === GEMINI_STT && !!app.backend.transcribeCloud;
  const [usingCloud, setUsingCloud] = useState(false);
  const localModel = voice.sttModel === GEMINI_STT ? LOCAL_STT_FALLBACK : voice.sttModel;
  const rec = useRef<Recorder | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => () => rec.current?.cancel(), []);

  const toggle = async (): Promise<void> => {
    if (phase === "working") return;
    if (phase === "idle") {
      try {
        if (!cloud) transcriber.preload(localModel);
        rec.current = new Recorder();
        await rec.current.start();
        setPhase("recording");
      } catch (e) {
        app.toast({
          kind: "error",
          text: `Microphone unavailable: ${String((e as Error).message ?? e)}. You can type instead.`,
        });
        setPhase("idle");
      }
      return;
    }
    setPhase("working");
    try {
      const audio = await rec.current!.stop();
      if (audio.length < 1600) {
        setPhase("idle");
        return;
      }
      let text: string | null = null;
      if (cloud) {
        // Gemini: the recording goes to Google with the course's name and topics, so terms and math come out right
        setUsingCloud(true);
        const graph = app.graph;
        const context = sttContext(
          app.course,
          [...graph.byId.values()].map((c) => c.title),
        );
        const r = await app.backend
          .transcribeCloud!({
            audio: toBase64(encodeWav(audio)),
            context,
            language: voice.sttLanguage,
          })
          .catch((e: unknown) => ({ ok: false as const, error: String((e as Error)?.message ?? e) }));
        setUsingCloud(false);
        if (r.ok) text = r.text;
        else
          app.toast({
            kind: "info",
            text: `Gemini could not transcribe (${r.error}), so this computer did instead.`,
          });
      }
      if (text === null)
        text = await transcriber.transcribe(
          audio,
          localModel,
          voice.sttLanguage,
        );
      if (text) cb.current(text);
      else
        app.toast({
          kind: "info",
          text: "I could not hear any words. Try again a little closer to the mic.",
        });
    } catch (e) {
      app.toast({
        kind: "error",
        text: `Transcription failed: ${String((e as Error).message ?? e)}`,
      });
    } finally {
      setPhase("idle");
    }
  };
  const loading =
    phase === "working"
      ? usingCloud
        ? "Transcribing with Gemini…"
        : stt.state === "loading"
        ? `Loading the speech model${stt.total ? ` ${Math.round((100 * stt.loaded) / stt.total)}%` : ""} (first time only)`
        : "Transcribing on this computer…"
      : null;
  const cancel = (): void => {
    if (phase !== "recording") return;
    rec.current?.cancel();
    rec.current = null;
    setPhase("idle");
  };
  return { phase, toggle, cancel, loading };
}

// ------------------------------------------------------------ one shortcut for whichever dictation is in front

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘D on macOS, Ctrl+D elsewhere: starts dictation in the answer in front, and stops it again. */
export const DICTATION_HOTKEY = isMac ? "⌘D" : "Ctrl+D";

type HotkeyTarget = {
  id: number;
  priority: number;
  busy: () => boolean;
  toggle: () => void;
};
const targets: HotkeyTarget[] = [];
let nextTargetId = 1;

function onHotkey(e: KeyboardEvent): void {
  if (e.key.toLowerCase() !== "d" || e.shiftKey || e.altKey) return;
  if (isMac ? !e.metaKey || e.ctrlKey : !e.ctrlKey || e.metaKey) return;
  if (e.repeat) return;
  // a dialog on top owns the keyboard
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
  // the one that is listening stops first; otherwise the most important (answer card over chat), newest first
  const pick =
    targets.find((t) => t.busy()) ??
    [...targets].sort((a, b) => b.priority - a.priority || b.id - a.id)[0];
  if (!pick) return;
  e.preventDefault();
  pick.toggle();
}

/**
 * Lets the dictation shortcut reach this control while it is mounted and enabled. Priority 2 is an
 * answer on a card, 1 the chat composer: with both on screen the shortcut goes to the answer.
 */
export function useDictationHotkey(
  enabled: boolean,
  priority: number,
  toggle: () => void,
  busy: boolean,
): void {
  const t = useRef(toggle);
  t.current = toggle;
  const b = useRef(busy);
  b.current = busy;
  useEffect(() => {
    if (!enabled) return;
    const target: HotkeyTarget = {
      id: nextTargetId++,
      priority,
      busy: () => b.current,
      toggle: () => t.current(),
    };
    if (!targets.length) window.addEventListener("keydown", onHotkey);
    targets.push(target);
    return () => {
      targets.splice(targets.indexOf(target), 1);
      if (!targets.length) window.removeEventListener("keydown", onHotkey);
    };
  }, [enabled, priority]);
}

/**
 * The big dictation button: a vermilion point with the mic, what it will do, and the shortcut.
 * `compact` is the round version that sits next to the chat's send button.
 */
export function TalkButton({
  phase,
  loading,
  idleLabel,
  onClick,
  disabled,
  compact,
  className,
}: {
  phase: DictationPhase;
  loading: string | null;
  idleLabel: string;
  onClick: () => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}): ReactElement {
  const label =
    phase === "recording"
      ? "Listening… click when done"
      : phase === "working"
        ? (loading ?? "Transcribing…")
        : idleLabel;
  const title = `${phase === "recording" ? "Stop and transcribe" : phase === "working" ? label : idleLabel} (${DICTATION_HOTKEY})`;
  return (
    <button
      type="button"
      className={`talk ${phase} ${compact ? "compact" : ""} ${className ?? ""}`}
      onClick={onClick}
      disabled={disabled || phase === "working"}
      title={title}
      aria-label={compact ? title : undefined}
    >
      <span className="talk-point" aria-hidden>
        {phase === "recording" ? (
          <span className="talk-bars">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <Icon name={phase === "working" ? "clock" : "mic"} size={compact ? 17 : 18} />
        )}
      </span>
      {!compact && <span className="talk-label">{label}</span>}
      {!compact && phase !== "working" && <kbd>{DICTATION_HOTKEY}</kbd>}
    </button>
  );
}

/** Dictation into a text field: the big talk button (or the round one in the chat), with the shortcut. */
export function VoiceButton({
  onText,
  compact,
  priority = 2,
  idleLabel = "Say it",
}: {
  onText: (text: string) => void;
  compact?: boolean;
  priority?: number;
  idleLabel?: string;
}): ReactElement {
  const { phase, toggle, loading } = useDictation(onText);
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  useDictationHotkey(true, priority, () => void toggle(), phase !== "idle");
  const where = voice.sttModel === GEMINI_STT ? "transcribed by Gemini" : "transcribed locally";
  const status =
    phase === "recording" ? "Listening… click when done" : loading;
  return (
    <span className={`talk-wrap ${compact ? "compact" : ""}`}>
      <TalkButton
        phase={phase}
        loading={loading}
        idleLabel={compact ? `Answer by voice (${where})` : idleLabel}
        onClick={() => void toggle()}
        compact={compact}
      />
      {compact && status && <span className="voice-status talk-status">{status}</span>}
    </span>
  );
}

export function SpeakButton({
  id,
  text,
}: {
  id: string;
  text: string | null;
}): ReactElement | null {
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  const now = useStore(speaking, (s) => s);
  if (!voice.tts || !text) return null;
  const on = now === id;
  return (
    <button
      className={`btn icon sm ghost speak ${on ? "on" : ""}`}
      title={on ? "Stop reading" : "Read aloud"}
      aria-label={on ? "Stop reading" : "Read aloud"}
      onClick={() =>
        on
          ? stopSpeaking()
          : speak(id, text, { voice: voice.ttsVoice, rate: voice.ttsRate })
      }
    >
      <Icon name={on ? "stop" : "speaker"} size={16} />
    </button>
  );
}
