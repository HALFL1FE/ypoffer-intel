import { describe, expect, it, vi } from "vitest";

import { createAgentActivity } from "./agentActivity";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createAgentActivity", () => {
  it("logs Copilot answers and submits feedback for the selected answer", async () => {
    let created = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      if (payload.action === "create") return response({ recordId: `record-${++created}` });
      return response({ ok: true });
    });
    const activity = createAgentActivity({ fetcher });
    const first = activity.begin("First question", "en");
    activity.finish({ ok: true, status: "done", response: "First answer" });
    const second = activity.begin("Second question", "en");
    activity.finish({ ok: true, status: "done", response: "Second answer" });

    expect(activity.feedbackForAnswer(first)?.isAvailable()).toBe(true);
    expect(activity.feedbackForAnswer(second)?.isAvailable()).toBe(true);
    expect(await activity.feedbackForAnswer(first)?.submit("unclear", "Explain more")).toEqual({ ok: true });
    const feedbackCall = fetcher.mock.calls.find(([url]) => String(url).includes("operation=feedback"));
    expect(JSON.parse(String(feedbackCall?.[1]?.body))).toMatchObject({
      questionEventId: "record-1", mode: "agent", prompt: "First question", answer: "First answer",
      reasonCode: "unclear", reasonDetail: "Explain more"
    });
    expect(activity.feedbackForAnswer(first)?.isAvailable()).toBe(false);
    expect(activity.feedbackForAnswer(second)?.isAvailable()).toBe(true);
  });
});
