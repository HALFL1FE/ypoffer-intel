const CLASSIFY_MAX_BYTES = 2_048;
const ANALYZE_MAX_BYTES = 16_384;

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function jsonBody(payload: Record<string, unknown>, maximum: number): string | null {
  const body = JSON.stringify(payload);
  return byteLength(body) <= maximum ? body : null;
}

export function buildClassifyBody(prompt: string, categories: readonly string[]): string | null {
  const normalizedPrompt = String(prompt || "").trim();
  if (!normalizedPrompt) return null;
  const base = { prompt: normalizedPrompt, categories: [] as string[] };
  if (!jsonBody(base, CLASSIFY_MAX_BYTES)) return null;

  const selected: string[] = [];
  for (const category of categories) {
    const value = String(category || "").trim().slice(0, 160);
    if (!value || selected.includes(value)) continue;
    const candidate = jsonBody({ prompt: normalizedPrompt, categories: [...selected, value] }, CLASSIFY_MAX_BYTES);
    if (!candidate) break;
    selected.push(value);
  }
  return jsonBody({ prompt: normalizedPrompt, categories: selected }, CLASSIFY_MAX_BYTES);
}

export function buildAnalyzeBody(summary: Readonly<Record<string, unknown>>, language: "zh" | "en"): string | null {
  return jsonBody({ summary, language }, ANALYZE_MAX_BYTES);
}

export const REPORT_REQUEST_LIMITS = Object.freeze({
  classifyBytes: CLASSIFY_MAX_BYTES,
  analyzeBytes: ANALYZE_MAX_BYTES
});
