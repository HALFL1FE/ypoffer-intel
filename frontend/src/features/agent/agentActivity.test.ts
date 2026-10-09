import { describe, expect, it, vi } from "vitest";

import { createAgentActivity } from "./agentActivity";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("createAgentActivity", () => {
  it.each(["error", "stopped"])("%s 结束后可反馈空回答，且不会关联到下一轮", async (status) => {
    let created = 0;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = JSON.parse(String(init?.body || "{}"));
      return response(payload.action === "create" ? { recordId: `record-${++created}` } : { ok: true });
    });
    const activity = createAgentActivity({ fetcher });
    const failed = activity.begin("查询失败的问题", "zh");
    const feedback = activity.feedbackForAnswer(failed)!;
    expect(feedback.isAvailable()).toBe(false);
    expect(await feedback.submit("not_answered")).toMatchObject({ ok: false, errorCode: "feedback_unavailable" });
    activity.finish({ ok: false, status, response: "" });
    activity.begin("下一轮问题", "zh");

    expect(feedback.isAvailable()).toBe(true);
    expect(await feedback.submit("not_answered", "查询没有完成")).toEqual({ ok: true });
    const completion = fetcher.mock.calls.find(([, init]) => JSON.parse(String(init?.body)).action === "complete");
    expect(JSON.parse(String(completion?.[1]?.body))).toMatchObject({ recordId: "record-1", status: "failed" });
    const submission = fetcher.mock.calls.find(([url]) => String(url).includes("operation=feedback"));
    expect(JSON.parse(String(submission?.[1]?.body))).toMatchObject({
      questionEventId: "record-1", mode: "agent", prompt: "查询失败的问题", answer: "", reasonCode: "not_answered"
    });
    expect(feedback.isAvailable()).toBe(false);
  });

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
