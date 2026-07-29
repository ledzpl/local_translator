import type { TtsStatus } from "./protocol";

// Supertonic 3 accepts Korean directly and supports up to 120 Korean
// characters per inference. Longer clauses reduce model churn and make the
// voice more consistent while keeping page-reading latency bounded.
const SPEECH_CHUNK_TARGET_LENGTH = 80;
const SPEECH_CHUNK_MAX_LENGTH = 120;
const SPEECH_CHUNK_MIN_BOUNDARY = 30;

export function prepareKoreanForTts(text: string): string {
  return text
    .replace(/\s+/gu, " ")
    .trim();
}

export interface TtsAudioMetrics {
  durationSeconds: number;
  rms: number;
}

export interface ActiveSpeechEngine<Engine> {
  current: Engine;
}

export async function synthesizeWithSpeechEngineFallback<
  Engine extends { device: "webgpu" | "wasm" },
  Output
>(
  activeEngine: ActiveSpeechEngine<Engine>,
  synthesize: (engine: Engine) => Promise<Output>,
  loadFallback: (failedEngine: Engine, error: unknown) => Promise<Engine>
): Promise<Output> {
  const engine = activeEngine.current;
  try {
    return await synthesize(engine);
  } catch (error) {
    if (engine.device !== "webgpu") throw error;
    const fallbackEngine = await loadFallback(engine, error);
    activeEngine.current = fallbackEngine;
    return synthesize(fallbackEngine);
  }
}

export function canControlSpeech(
  activeSpeechId: string | null,
  requestedSpeechId?: string
): boolean {
  return requestedSpeechId === undefined || activeSpeechId === requestedSpeechId;
}

export function isSpeechStatusFor(
  status: Pick<TtsStatus, "speechId">,
  speechId: string | null
): boolean {
  return Boolean(speechId && status.speechId === speechId);
}

export function shouldMarkSpeechIdle(
  activeSpeechId: string | undefined,
  requestedSpeechId: string,
  offscreenExists: boolean,
  stopped: boolean
): boolean {
  return activeSpeechId === requestedSpeechId &&
    (!offscreenExists || stopped);
}

export function validateTtsAudio(
  samples: Float32Array,
  sampleRate: number
): TtsAudioMetrics {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("음성 모델이 올바른 샘플 속도를 만들지 못했습니다.");
  }
  if (samples.length < sampleRate * 0.03) {
    throw new Error("음성 모델이 재생할 만큼 긴 오디오를 만들지 못했습니다.");
  }

  let energy = 0;
  for (const sample of samples) {
    if (!Number.isFinite(sample)) {
      throw new Error("음성 모델이 손상된 오디오를 만들었습니다.");
    }
    energy += sample * sample;
  }
  const rms = Math.sqrt(energy / samples.length);
  if (rms < 1e-6) {
    throw new Error("음성 모델이 무음 오디오를 만들었습니다.");
  }
  return {
    durationSeconds: samples.length / sampleRate,
    rms
  };
}

export function chunkKoreanSpeech(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > SPEECH_CHUNK_MAX_LENGTH) {
    const window = remaining.slice(0, SPEECH_CHUNK_MAX_LENGTH + 1);
    const sentenceBoundary = findLastSpeechBoundary(
      window,
      /[.!?。！？](?:["'”’)\]}]*)?(?:\s|$)/gu
    );
    const phraseWindow = remaining.slice(0, SPEECH_CHUNK_TARGET_LENGTH + 1);
    const phraseBoundary = findLastSpeechBoundary(
      phraseWindow,
      /[,，、;:](?:\s|$)|\s/gu
    );
    const end = sentenceBoundary >= SPEECH_CHUNK_MIN_BOUNDARY
      ? sentenceBoundary
      : phraseBoundary >= SPEECH_CHUNK_MIN_BOUNDARY
        ? phraseBoundary
        : SPEECH_CHUNK_TARGET_LENGTH;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function findLastSpeechBoundary(text: string, pattern: RegExp): number {
  let end = -1;
  for (const match of text.matchAll(pattern)) {
    end = match.index + match[0].length;
  }
  return end;
}
