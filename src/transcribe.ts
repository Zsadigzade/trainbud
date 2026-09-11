import { getSetting } from "./appDb.js";
import { recordAiUsage } from "./usage.js";
import { logger } from "./utils/logger.js";

// SECTION: Speech to text
//
// Only iPhones need this. Chrome on Android has the Web Speech API and
// recognises speech on the device's own terms for free, so the voice page uses
// it there and never reaches this file. iOS Safari's `webkitSpeechRecognition`
// is inconsistent across versions and fails silently when it fails, which is
// the worst possible shape for a feature you are holding at arm's length while
// running -- so on iOS the page records audio and posts it here instead.
//
// Groq's whisper-large-v3-turbo is the provider: roughly $0.04 per HOUR of
// audio, which puts a ten-second question at about a hundredth of a cent, and
// its API is OpenAI-shaped so swapping providers later is a base URL and a
// model name.
//
// TWO THINGS THIS DELIBERATELY DOES NOT DO:
//
//   It does not fall back to Anthropic. There is no Anthropic speech-to-text
//   API, and a fallback that cannot work is worse than an error that explains
//   itself.
//
//   It does not bill by tokens. Transcription is priced by audio duration, so
//   the usage row carries zero tokens and a cost computed from seconds. Putting
//   seconds in a column named `input_tokens` would make every future reader of
//   that table wrong.

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";

/** Published rate: $0.04 per hour of audio. */
const USD_PER_AUDIO_SECOND = 0.04 / 3600;

/**
 * Caps the request rather than the transcript.
 *
 * A question asked into a watch-side microphone is a sentence. Two minutes of
 * audio is not a question, it is a stuck record button, and it should cost a
 * clear error rather than a silent charge.
 */
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

export class TranscriptionNotConfiguredError extends Error {
  constructor() {
    super(
      "No speech-to-text key. Add a Groq API key on the dashboard, or use Chrome on " +
        "Android where speech is recognised by the browser at no cost."
    );
    this.name = "TranscriptionNotConfiguredError";
  }
}

export class TranscriptionError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "TranscriptionError";
    this.statusCode = statusCode;
  }
}

/**
 * The key, from the database first and the environment second.
 *
 * Same precedence as the AI key, for the same reason: the database copy is the
 * one a person last set through the UI, and a server that preferred the
 * environment would ignore what the dashboard just saved until a restart.
 */
export function resolveTranscriptionKey(): string {
  return getSetting("groq_api_key") ?? process.env["GROQ_API_KEY"] ?? "";
}

export function isTranscriptionConfigured(): boolean {
  return resolveTranscriptionKey().length > 0;
}

export interface TranscriptionResult {
  text: string;
  /** Audio duration as the provider measured it, when it reports one. */
  seconds: number | null;
  costUsd: number | null;
}

export function transcriptionCostUsd(seconds: number | null): number | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  return seconds * USD_PER_AUDIO_SECOND;
}

/**
 * Send audio to Groq and return what it heard.
 *
 * `contentType` decides the filename extension, which Groq uses to pick a
 * decoder -- posting webm under a `.wav` name fails with a decode error that
 * says nothing about the real cause.
 */
export async function transcribeAudio(
  audio: Buffer,
  contentType: string
): Promise<TranscriptionResult> {
  const key = resolveTranscriptionKey();
  if (!key) {
    throw new TranscriptionNotConfiguredError();
  }

  if (audio.length === 0) {
    throw new TranscriptionError("Empty audio.", 400);
  }
  if (audio.length > MAX_AUDIO_BYTES) {
    throw new TranscriptionError(
      `Audio is ${Math.round(audio.length / 1024)} KB; the limit is ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`,
      413
    );
  }

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: contentType }), audioFilename(contentType));
  form.append("model", GROQ_MODEL);
  // verbose_json is what carries `duration`, and duration is what the charge is
  // computed from. With plain json the cost would have to be guessed.
  form.append("response_format", "verbose_json");

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "network error";
    throw new TranscriptionError(`Could not reach the transcription service: ${message}`, 502);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // 401 from the provider is the user's key, not a bug here, and it has to
    // read that way or it gets reported as a TrainBud failure.
    const message =
      response.status === 401
        ? "The transcription provider rejected the API key. Check it on the dashboard."
        : `Transcription failed (${response.status}). ${detail.slice(0, 200)}`;
    throw new TranscriptionError(message, response.status === 401 ? 401 : 502);
  }

  const payload = (await response.json()) as { text?: unknown; duration?: unknown };
  const text = typeof payload.text === "string" ? payload.text.trim() : "";
  const seconds = typeof payload.duration === "number" ? payload.duration : null;

  if (seconds !== null && seconds > MAX_AUDIO_SECONDS) {
    logger.warn({ seconds }, "transcribed audio longer than the intended cap");
  }

  const costUsd = transcriptionCostUsd(seconds);

  recordAiUsage({
    kind: "transcribe",
    model: GROQ_MODEL,
    source: "dashboard",
    inputTokens: 0,
    outputTokens: 0,
    costUsdOverride: costUsd,
  });

  return { text, seconds, costUsd };
}

/** Groq picks its decoder from the extension, so this has to be right. */
export function audioFilename(contentType: string): string {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension =
    base === "audio/webm"
      ? "webm"
      : base === "audio/ogg"
        ? "ogg"
        : base === "audio/mp4" || base === "audio/x-m4a" || base === "audio/aac"
          ? "m4a"
          : base === "audio/mpeg"
            ? "mp3"
            : base === "audio/wav" || base === "audio/x-wav"
              ? "wav"
              : "webm";
  return `speech.${extension}`;
}
