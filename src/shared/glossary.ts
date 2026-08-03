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
  const replacements: ProtectedGlossaryText["replacements"] = [];
  const ordered = [...entries]
    .filter((entry) => entry.source.trim())
    .sort((left, right) => right.source.length - left.source.length);
  if (ordered.length === 0) return { text, replacements };

  // Replace every source term in one pass. Re-running one regexp per entry can
  // match a later glossary term inside a token created for an earlier entry
  // (for example, the source term "term" matches `...TERM0...`) and corrupt
  // both replacements. A namespace that does not occur in the source also
  // keeps literal token-looking user text from being restored accidentally.
  const tokenNamespace = createTokenNamespace(text);
  const tokens = new Map<GlossaryEntry, string>();
  const pattern = new RegExp(
    ordered.map((entry) => escapeRegExp(entry.source)).join("|"),
    "giu"
  );
  const protectedText = text.replace(pattern, (matched) => {
    const entry = ordered.find((candidate) =>
      new RegExp(`^(?:${escapeRegExp(candidate.source)})$`, "iu").test(matched)
    );
    if (!entry) return matched;
    const existing = tokens.get(entry);
    if (existing) return existing;
    const token = `ZXQONGEULGLOSSARY${tokenNamespace}TERM${replacements.length}QXZ`;
    tokens.set(entry, token);
    replacements.push({
      token,
      value: entry.mode === "preserve" ? entry.source : entry.target
    });
    return token;
  });
  return { text: protectedText, replacements };
}

export function restoreGlossaryTerms(
  text: string,
  replacements: readonly { token: string; value: string }[]
): string {
  if (replacements.length === 0) return text;
  const values = new Map(
    replacements.map((replacement) => [
      replacement.token.toUpperCase(),
      replacement.value
    ])
  );
  const pattern = new RegExp(
    replacements.map((replacement) => escapeRegExp(replacement.token)).join("|"),
    "giu"
  );
  return text.replace(pattern, (matched) => values.get(matched.toUpperCase()) ?? matched);
}

export function createGlossarySignature(entries: readonly GlossaryEntry[]): string {
  return JSON.stringify(entries
    .map((entry) => [entry.mode, entry.source, entry.target] as const)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createTokenNamespace(text: string): number {
  const normalized = text.toUpperCase();
  let namespace = 0;
  while (normalized.includes(`ZXQONGEULGLOSSARY${namespace}TERM`)) {
    namespace += 1;
  }
  return namespace;
}
