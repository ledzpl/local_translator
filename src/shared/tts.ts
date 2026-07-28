const SPEECH_CHUNK_LENGTH = 80;
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
  return romanizeKorean(text)
    .toLowerCase()
    .replace(/[^a-z'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
