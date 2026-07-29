export function assertSemanticTranslation({
  id,
  translation,
  requiredConcepts,
  forbidden = [],
  preservedNumbers = []
}) {
  const normalized = normalizeTranslation(translation);
  if (!/[가-힣]/u.test(normalized)) {
    throw new Error(`${id}: 한국어 번역 결과가 아닙니다: ${normalized}`);
  }
  if (/<\/?(?:pad|s)>/iu.test(normalized)) {
    throw new Error(`${id}: 모델 특수 토큰이 남았습니다: ${normalized}`);
  }

  for (const alternatives of requiredConcepts) {
    if (!alternatives.some((pattern) => pattern.test(normalized))) {
      throw new Error(
        `${id}: 필수 의미 ${alternatives.map(String).join(" 또는 ")}가 없습니다: ${normalized}`
      );
    }
  }
  for (const pattern of forbidden) {
    if (pattern.test(normalized)) {
      throw new Error(`${id}: 금지된 오역 ${pattern}이 남았습니다: ${normalized}`);
    }
  }
  for (const number of preservedNumbers) {
    if (!normalized.includes(number)) {
      throw new Error(`${id}: 숫자 ${number}가 보존되지 않았습니다: ${normalized}`);
    }
  }
}

export function normalizeTranslation(value) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/gu, " ").trim();
}
