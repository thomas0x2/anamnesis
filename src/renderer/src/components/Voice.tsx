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

export function VoiceButton({
  onText,
  text,
}: {
  onText: (text: string) => void;
  text?: string;
}): ReactElement {
  const { phase, toggle, loading } = useDictation(onText);
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  const label =
    phase === "recording"
      ? "Listening… click to stop"
      : (loading ??
        (voice.sttModel === GEMINI_STT
          ? "Answer by voice (transcribed by Gemini)"
          : "Answer by voice (transcribed locally)"));
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`btn ${text ? "" : "icon"} sm mic ${phase === "recording" ? "rec" : ""}`}
        onClick={() => void toggle()}
        title={label}
        aria-label={text ? undefined : label}
        disabled={phase === "working"}
      >
        <Icon
          name={
            phase === "working"
              ? "clock"
              : phase === "recording" && text
                ? "stop"
                : "mic"
          }
          size={16}
        />
        {text && (
          <span>{phase === "recording" ? "Stop and transcribe" : text}</span>
        )}
      </button>
      {phase !== "idle" && (
        <span
          className="voice-status"
          style={{
            position: "absolute",
            [text ? "left" : "right"]: 0,
            top: 34,
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      )}
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
