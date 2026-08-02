import type { GlossaryEntry } from "./protocol";

export const GLOSSARY_STORAGE_KEY = "glossaryEntries";
export const MAX_GLOSSARY_ENTRIES = 80;

export interface ProtectedGlossaryText {
  text: string;
  replacements: Array<{ token: string; value: string }>;
}

export function normalizeGlossaryEntries(value: unknown): GlossaryEntry[] {
  if (!Array.isArray(value)) return [];
  const normalized: GlossaryEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const source = "source" in candidate ? String(candidate.source).trim() : "";
    const target = "target" in candidate ? String(candidate.target).trim() : "";
    const mode = "mode" in candidate && candidate.mode === "preserve"
      ? "preserve"
      : "translate";
    if (!source || (mode === "translate" && !target)) continue;
    normalized.push({
      id: "id" in candidate && typeof candidate.id === "string"
        ? candidate.id
        : crypto.randomUUID(),
      source: source.slice(0, 120),
      target: (mode === "preserve" ? source : target).slice(0, 120),
      mode
    });
    if (normalized.length >= MAX_GLOSSARY_ENTRIES) break;
  }
  return normalized;
}

export function protectGlossaryTerms(
  text: string,
  entries: readonly GlossaryEntry[]
): ProtectedGlossaryText {
  let protectedText = text;
  const replacements: ProtectedGlossaryText["replacements"] = [];
  const ordered = [...entries]
    .filter((entry) => entry.source.trim())
    .sort((left, right) => right.source.length - left.source.length);

  for (const entry of ordered) {
    const pattern = new RegExp(escapeRegExp(entry.source), "giu");
    if (!pattern.test(protectedText)) continue;
    const token = `ZXQONGEULTERM${replacements.length}QXZ`;
    protectedText = protectedText.replace(pattern, token);
    replacements.push({
      token,
      value: entry.mode === "preserve" ? entry.source : entry.target
    });
  }
  return { text: protectedText, replacements };
}

export function restoreGlossaryTerms(
  text: string,
  replacements: readonly { token: string; value: string }[]
): string {
  return replacements.reduce(
    (result, replacement) =>
      result.replace(new RegExp(escapeRegExp(replacement.token), "giu"), replacement.value),
    text
  );
}

export function createGlossarySignature(entries: readonly GlossaryEntry[]): string {
  return entries
    .map((entry) => `${entry.mode}:${entry.source}:${entry.target}`)
    .sort()
    .join("\u0001");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
