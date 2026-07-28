const MAX_INPUT_CHARS = 420;

export function normalizeText(text: string): string {
  return text.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
}

export function chunkText(text: string, maxChars = MAX_INPUT_CHARS): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const sentences = normalized.split(/(?<=[.!?。！？])\s+/u);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(...splitLongSegment(sentence, maxChars));
      continue;
    }

    const candidate = current ? `${current} ${sentence}` : sentence;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongSegment(segment: string, maxChars: number): string[] {
  const words = segment.split(" ");
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        chunks.push(word.slice(index, index + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/fetch|network|failed to load|load failed/i.test(message)) {
    return "모델을 내려받지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  if (/memory|allocation|out of memory/i.test(message)) {
    return "모델을 실행할 메모리가 부족합니다. 다른 탭을 닫거나 WASM 모드로 바꿔 주세요.";
  }
  return message || "번역 중 알 수 없는 오류가 발생했습니다.";
}
