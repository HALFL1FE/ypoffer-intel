import { describe, expect, it, vi } from "vitest";

import { createChatbotSession } from "./chatbotSession";
import type { ChatbotChatRunner } from "./chatbotViewTypes";

const offers = [
  {
    merchantId: "398679",
    merchantName: "Tapo",
    brand: "Tapo",
    tier: "Tier 1",
    category: "Electronics",
    clicks: 100,
    orders: 12,
    salesAmount: 1200,
    affCommission: 120
  }
];

describe("createChatbotSession", () => {
  it("routes by the classifier and applies category/tier parameters over conflicting local tokens", async () => {
    const classify = vi.fn(async () => ({ intent: "category", params: { category: ["Electronics"], tier: ["Tier 1"] } }));
    const session = createChatbotSession({ offers, language: "en", classify, enableQuestionLogging: false });
    const result = await session.submit("Show devices in Tier 2");
    expect(result).toMatchObject({ ok: true, intent: "category" });
    expect(result.report).toMatchObject({ query: "Show devices in Tier 2", rows: offers, category: "Electronics", tier: "Tier 1" });
  });

  it("uses the classified merchant ID even when the prompt names a different merchant", async () => {
    const other = { ...offers[0], merchantId: "888888", brand: "Other", merchantName: "Other" };
    const session = createChatbotSession({
      offers: [...offers, other], language: "en", enableQuestionLogging: false,
      classify: async () => ({ intent: "merchant", params: { merchantId: "888888" } })
    });
    expect((await session.submit("Tapo")).report?.rows).toEqual([other]);
  });

  it("applies classified payment filters without searching the original natural-language sentence as a name", async () => {
    const record = { merchantName: "Tapo", month: "2026-08", status: "unpaid", revenue: 40 };
    const session = createChatbotSession({
      offers, paymentRecords: [record, { ...record, status: "paid" }, { ...record, merchantName: "Other" }],
      language: "en", enableQuestionLogging: false,
      classify: async () => ({ intent: "payment", params: { merchantName: "Tapo", paymentStatus: "unpaid", month: "August" } })
    });
    const result = await session.submit("What do they owe for last month?");
    expect(result).toMatchObject({ ok: true, intent: "payment" });
    expect(result.report?.rows).toEqual([record]);
  });

  it("uses classified analysis targets and never substitutes unrelated merchants for an unknown target", async () => {
    const analyze = vi.fn(async (_summary: Readonly<Record<string, unknown>>) => "Analysis result");
    const classify = vi.fn(async () => ({ intent: "analysis", params: { analysisType: "merchant", analysisTarget: "Tapo" } }));
    const session = createChatbotSession({ offers, language: "en", enableQuestionLogging: false, classify, analyze });
    expect((await session.submit("How is it doing?")).intent).toBe("analysis");
    expect(analyze.mock.calls[0]?.[0]).toMatchObject({ rows: offers });
    classify.mockResolvedValue({ intent: "analysis", params: { analysisType: "merchant", analysisTarget: "Absent" } });
    expect((await session.submit("How about another?")).report?.rows).toEqual([]);
  });

  it.each([null, { intent: "publisher", params: {} }, { intent: "category", params: [] }])("falls back to local reports for invalid classifier output %j", async (classification) => {
    const session = createChatbotSession({ offers, language: "en", enableQuestionLogging: false, classify: async () => classification });
    expect((await session.submit("Tapo")).report?.rows).toEqual(offers);
  });

  it("falls back when classification fails and stops before analysis if classification is cancelled", async () => {
    const analyze = vi.fn();
    const session = createChatbotSession({
      offers, language: "en", enableQuestionLogging: false, analyze,
      classify: async () => { throw new Error("offline"); }
    });
    expect((await session.submit("Tapo")).ok).toBe(true);
    const controller = new AbortController();
    const cancelled = createChatbotSession({
      offers, language: "en", enableQuestionLogging: false, analyze, signal: controller.signal,
      classify: async () => { controller.abort(); return { intent: "analysis", params: {} }; }
    });
    expect((await cancelled.submit("Tapo")).stopped).toBe(true);
    expect(analyze).not.toHaveBeenCalled();
  });

  it("uses keywords arriving after session creation, joining by ID without changing offer metrics", async () => {
    let keywords: unknown = { merchants: [] };
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, enableQuestionLogging: false, getProductKeywords: () => keywords });
    expect((await session.submit("aurora smart plug")).ok).toBe(false);
    keywords = { merchants: [
      { merchantId: 398679, merchantName: "Different label", productTitles: ["aurora smart plug"], productKeywords: ["nebulawifi"], salesAmount: 999 },
      { merchantId: "000000", merchantName: "Tapo", productKeywords: ["wrongmerchant"] }
    ] };
    const result = await session.submit("aurora smart plug");
    expect(result).toMatchObject({ ok: true, report: { summary: { revenue: 1200 } } });
    expect(result.report?.rows[0]?.merchantId).toBe("398679");
    expect((await session.submit("nebulawifi")).ok).toBe(true);
    expect((await session.submit("wrongmerchant")).ok).toBe(false);
    expect(offers[0]).not.toHaveProperty("productKeywords");
    keywords = null;
    expect((await session.submit("Tapo")).ok).toBe(true);
  });

  it("uses the cached report model and exposes a structured snapshot", async () => {
    const session = createChatbotSession({ offers, language: "zh", llmEnabled: false, enableQuestionLogging: false });

    const result = await session.submit("Tapo ID398679");

    expect(result).toMatchObject({ ok: true, mode: "report", source: "cache" });
    expect(result.report).toMatchObject({ intent: "merchant", query: "Tapo ID398679", rows: offers });
    expect(session.getState()).toMatchObject({ status: "success", hasMemory: false });
  });

  it("keeps Chat Mode streaming, usage, and successful history separate from stopped turns", async () => {
    const calls: string[] = [];
    const runChat: ChatbotChatRunner = vi.fn(async (request, onToken) => {
      calls.push(request.prompt);
      if (request.prompt === "stop") return { ok: false, stopped: true, response: "" };
      onToken?.("hello");
      return { ok: true, response: "hello", usage: { usageAvailable: true, outputTokens: 1 } };
    });
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, runChat, enableQuestionLogging: false });
    session.setMode("chat");

    const stopped = await session.submit("stop");
    const done = await session.submit("continue");

    expect(stopped.stopped).toBe(true);
    expect(done).toMatchObject({ ok: true, response: "hello", usage: { outputTokens: 1 } });
    expect(calls).toEqual(["stop", "continue"]);
    expect(session.getState().history).toEqual([
      { role: "user", content: "continue" },
      { role: "assistant", content: "hello" }
    ]);
    expect(session.getState().messages.map(({ role, content }) => ({ role, content }))).toEqual(session.getState().history);
  });

  it("adds bounded report memory and routes Deep Window memory actions", async () => {
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, enableQuestionLogging: false });
    const result = await session.submit("Tapo");

    expect(session.addMemory?.(result)).toBe(true);
    expect(session.getState().memory).toHaveLength(1);
    const windowId = session.openDeepWindow?.();
    expect(windowId).toBeTruthy();
    expect(session.deepWindows.addToChat(windowId!)).toBe(true);
    expect(session.getState().memory).toHaveLength(1);
  });

  it("does not leave a stopped request in the formal conversation", async () => {
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      runChat: vi.fn(async () => ({ ok: false, stopped: true, response: "" }))
    });
    session.setMode("chat");
    await session.submit("live query");

    expect(session.getState().messages).toEqual([]);
    expect(session.getState().history).toEqual([]);
  });

  it("exports the current report and Deep Window without a Legacy bridge", async () => {
    const downloadReport = vi.fn(() => true);
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      downloadReport
    });
    await session.submit("Tapo");

    expect(session.downloadOverview?.()).toBe(true);
    const windowId = session.openDeepWindow?.();
    expect(session.deepWindows.export(windowId!)).toBeTruthy();
    expect(downloadReport).toHaveBeenCalledTimes(2);
  });

  it("keeps Chat answers addressable for feedback, Deep Window, and context controls", async () => {
    const session = createChatbotSession({
      offers,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      runChat: vi.fn(async () => ({ ok: true, response: "Revenue is stable." }))
    });
    session.setMode("chat");

    const result = await session.submit("Explain the trend");
    const answerId = result.answerId;

    expect(answerId).toBeTruthy();
    expect(result.feedbackState).toBe("available");
    expect(session.getState().messages.at(-1)).toMatchObject({
      role: "assistant",
      answerId,
      canOpenDeep: true,
      feedbackState: "available"
    });
    expect(session.feedbackForAnswer?.(answerId!)).toMatchObject({ isAvailable: expect.any(Function) });
    expect(session.feedbackForAnswer?.(answerId!)?.isAvailable()).toBe(true);

    const deepWindowId = session.openChatAnswer?.(answerId!);
    expect(deepWindowId).toBeTruthy();
    expect(session.feedbackForDeepWindow?.(deepWindowId!)?.isAvailable()).toBe(true);
    expect(session.deepWindows.getState().windows[0]).toMatchObject({
      mode: "chat",
      contentHtml: expect.stringContaining("Revenue is stable")
    });
    expect(session.interactContext?.("reminder-toggle")).toBe(true);
    expect(session.getState().utility?.reminderCollapsed).toBe(true);
  });
});
