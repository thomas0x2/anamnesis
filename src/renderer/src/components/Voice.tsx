// Microphone button (local Whisper transcription) and the read-aloud button.
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
import { Icon } from "./Icon";

export function VoiceButton({
  onText,
  text,
}: {
  onText: (text: string) => void;
  text?: string;
}): ReactElement {
  const app = useApp();
  const voice = useStore(app.settings, (s) => s.voice);
  const stt = useStore(transcriber.status, (s) => s);
  const [phase, setPhase] = useState<"idle" | "recording" | "working">("idle");
  const rec = useRef<Recorder | null>(null);
  useEffect(() => () => rec.current?.cancel(), []);

  const toggle = async (): Promise<void> => {
    if (phase === "working") return;
    if (phase === "idle") {
      try {
        transcriber.preload(voice.sttModel);
        rec.current = new Recorder();
        await rec.current.start();
        setPhase("recording");
      } catch (e) {
        app.toast({
          kind: "error",
          text: `Microphone unavailable: ${String((e as Error).message ?? e)}`,
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
      const text = await transcriber.transcribe(
        audio,
        voice.sttModel,
        voice.sttLanguage,
      );
      if (text) onText(text);
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

  const label =
    phase === "recording"
      ? "Listening… click to stop"
      : phase === "working"
        ? stt.state === "loading"
          ? `Loading the speech model${stt.total ? ` ${Math.round((100 * stt.loaded) / stt.total)}%` : ""} (first time only)`
          : "Transcribing on this Mac…"
        : "Answer by voice (transcribed locally)";
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
