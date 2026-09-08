import type { ChatbotIntent } from "./chatbotTypes";

export interface ChatbotClassification {
  readonly intent: ChatbotIntent;
  readonly params: Readonly<Record<string, unknown>>;
}

const INTENTS: readonly string[] = ["asin", "merchant", "category", "tier", "recommendation", "payment", "analysis"];

export function normalizeChatbotClassification(value: unknown): ChatbotClassification | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  if (result.ok === false || typeof result.intent !== "string" || !INTENTS.includes(result.intent)) return null;
  if (!result.params || typeof result.params !== "object" || Array.isArray(result.params)) return null;
  return { intent: result.intent as ChatbotIntent, params: result.params as Record<string, unknown> };
}

export function classificationValues(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean);
}
