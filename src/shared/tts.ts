import type { TtsStatus } from "./protocol";

// MMS-TTS WASM latency rises steeply with long romanized inputs. Keeping the
// source chunks short gets the first audio playing quickly and avoids multi-
// minute synthesis stalls on ordinary page translations.
const SPEECH_CHUNK_LENGTH = 6;
const KOREAN_DIGITS = ["영", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const INITIALS = [
  "g", "kk", "n", "d", "tt", "r", "m", "b", "pp",
  "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"
];
const VOWELS = [
  "a", "ae", "ya", "yae", "eo", "e", "yeo", "ye",
  "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi",
  "yu", "eu", "eui", "i"
];
const FINALS = [
  "", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m",
  "p", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng",
  "t", "t", "k", "t", "p", "t"
];
const FINALS_BEFORE_VOWEL = [
  "", "g", "kk", "gs", "n", "nj", "nh", "d", "l", "lg", "lm",
  "lb", "ls", "lt", "lp", "lh", "m", "b", "bs", "s", "ss",
  "ng", "j", "ch", "k", "t", "p", "h"
];

export function prepareKoreanForTts(text: string): string {
  const readableText = text.replace(/\d/g, (digit) => KOREAN_DIGITS[Number(digit)]!);
  return romanizeKorean(readableText)
    .toLowerCase()
    .replace(/[^a-z'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface TtsAudioMetrics {
  durationSeconds: number;
  rms: number;
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

export function romanizeKorean(text: string): string {
  const characters = Array.from(text);
  return characters.map((character, index) => {
    const code = character.charCodeAt(0);
    if (code < HANGUL_BASE || code > HANGUL_END) return character;

    const syllable = code - HANGUL_BASE;
    const initial = Math.floor(syllable / 588);
    const vowel = Math.floor((syllable % 588) / 28);
    const final = syllable % 28;
    const next = decomposeHangul(characters[index + 1]);
    let finalSound = FINALS[final]!;

    if (final && next?.initial === 11) {
      finalSound = FINALS_BEFORE_VOWEL[final]!;
    } else if (final && (next?.initial === 2 || next?.initial === 6)) {
      if ([1, 2, 3, 9, 24].includes(final)) finalSound = "ng";
      if ([7, 19, 20, 22, 23, 25, 27].includes(final)) finalSound = "n";
      if ([11, 14, 17, 18, 26].includes(final)) finalSound = "m";
    }

    return `${INITIALS[initial]}${VOWELS[vowel]}${finalSound}`;
  }).join("");
}

function decomposeHangul(character: string | undefined): {
  initial: number;
  vowel: number;
  final: number;
} | null {
  if (!character) return null;
  const code = character.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return null;
  const syllable = code - HANGUL_BASE;
  return {
    initial: Math.floor(syllable / 588),
    vowel: Math.floor((syllable % 588) / 28),
    final: syllable % 28
  };
}

export function chunkKoreanSpeech(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > SPEECH_CHUNK_LENGTH) {
    const window = remaining.slice(0, SPEECH_CHUNK_LENGTH + 1);
    const boundary = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf(", "),
      window.lastIndexOf(" ")
    );
    const end = boundary >= Math.floor(SPEECH_CHUNK_LENGTH * 0.55)
      ? boundary + 1
      : SPEECH_CHUNK_LENGTH;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
