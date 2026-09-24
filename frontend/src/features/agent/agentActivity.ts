import type { UiLanguage } from "../../shared/i18n";
import type { AgentFeedback, AgentFeedbackResult } from "./agentSession";

interface AnswerContext {
  readonly id: string;
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly record: Promise<string>;
  answer: string;
  completed?: Promise<string>;
  feedbackId?: string;
  submitted: boolean;
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (part) => {
    const digit = Math.floor(Math.random() * 16);
    return (part === "x" ? digit : (digit & 3) | 8).toString(16);
  });
}

function sessionId(storage?: Storage): string {
  try {
    const saved = storage?.getItem("oi_agent_session_v1")?.trim();
    if (saved && /^[A-Za-z0-9._:-]{16,64}$/.test(saved)) return saved;
    const created = `agent-${uuid().replace(/-/g, "")}`;
    storage?.setItem("oi_agent_session_v1", created);
    return created;
  } catch {
    return `agent-${uuid().replace(/-/g, "")}`;
  }
}

export function createAgentActivity(options: { readonly storage?: Storage; readonly fetcher?: typeof fetch } = {}) {
  const fetcher = options.fetcher || fetch;
  const session = sessionId(options.storage);
  const answers = new Map<string, AnswerContext>();
  let current: AnswerContext | null = null;

  async function post(operation: "questions" | "feedback", body: Record<string, unknown>): Promise<{ readonly recordId?: string; readonly ok?: boolean }> {
    const response = await fetcher(`/api/chat/stream?operation=${operation}`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body)
    });
    if (response.status === 409 && operation === "feedback") return { ok: true };
    if (!response.ok) throw new Error("agent_activity_request_failed");
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("agent_activity_invalid_response");
    const result = payload as { readonly recordId?: unknown; readonly ok?: unknown };
    if (result.ok === false) throw new Error("agent_activity_rejected");
    return { ...(typeof result.recordId === "string" ? { recordId: result.recordId } : {}), ok: true };
  }

  function begin(prompt: string, language: UiLanguage): string {
    const id = uuid();
    const context: AnswerContext = {
      id, prompt: prompt.slice(0, 20_000), language, answer: "", submitted: false,
      record: post("questions", {
        action: "create", eventId: id, sessionId: session, mode: "agent",
        prompt: prompt.slice(0, 20_000), language, intent: "agent"
      }).then((payload) => payload.recordId || "").catch(() => "")
    };
    current = context;
    answers.set(id, context);
    while (answers.size > 50) answers.delete(answers.keys().next().value!);
    return id;
  }

  function finish(result: { readonly ok: boolean; readonly status: string; readonly response: string }): void {
    const context = current;
    if (!context) return;
    current = null;
    context.answer = result.ok && result.status === "done" ? result.response.trim().slice(0, 120_000) : "";
    context.completed = context.record.then(async (recordId) => {
      if (!recordId) return "";
      try {
        await post("questions", { action: "complete", recordId, sessionId: session,
          status: context.answer ? "success" : "failed", intent: "agent" });
        return recordId;
      } catch {
        return "";
      }
    });
  }

  function feedbackForAnswer(id: string): AgentFeedback | null {
    const context = answers.get(id);
    if (!context) return null;
    return {
      isAvailable: () => Boolean(context.answer && !context.submitted),
      async submit(reasonCode: string, reasonDetail = ""): Promise<AgentFeedbackResult> {
        if (!context.answer || context.submitted) return { ok: false, errorCode: "feedback_unavailable" };
        if (!["inaccurate", "not_answered", "incomplete_data", "unclear", "other"].includes(reasonCode)) {
          return { ok: false, errorCode: "invalid_reason" };
        }
        const recordId = await context.completed;
        if (!recordId) return { ok: false, errorCode: "question_log_unavailable" };
        context.feedbackId ||= uuid();
        try {
          await post("feedback", {
            feedbackEventId: context.feedbackId, questionEventId: recordId, sessionId: session,
            mode: "agent", prompt: context.prompt, answer: context.answer,
            language: context.language, reasonCode, reasonDetail: reasonDetail.trim().slice(0, 4_000)
          });
          context.submitted = true;
          return { ok: true };
        } catch {
          return { ok: false, errorCode: "feedback_error" };
        }
      }
    };
  }

  function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): boolean {
    if (typeof document === "undefined") return false;
    const anchor = document.createElement("a");
    anchor.href = `/api/chat/stream?operation=${kind}&format=${format}`;
    anchor.download = `agent-${kind}.${format}`;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return true;
  }

  return {
    begin, finish, feedbackForAnswer, downloadLogs,
    get feedback(): AgentFeedback | undefined { return current ? feedbackForAnswer(current.id) || undefined : undefined; },
    clear(): void { answers.clear(); current = null; }
  };
}
