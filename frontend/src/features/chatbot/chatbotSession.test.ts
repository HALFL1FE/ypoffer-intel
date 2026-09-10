import { describe, expect, it, vi } from "vitest";

import { createChatbotSession } from "./chatbotSession";
import type { ChatbotChatRunner } from "./chatbotViewTypes";
import { parityOffers } from "./report/fixtures/parityData";
import { createReportDataProvider } from "./report/reportDataProvider";

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
    const result = await session.submit("Tapo");
    expect(result.report?.rows).toHaveLength(1);
    expect(result.report?.rows[0]).toMatchObject(other);
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
    expect(result.report?.rows).toHaveLength(1);
    expect(result.report?.rows[0]).toMatchObject(record);
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
    const result = await session.submit("Tapo");
    expect(result.report?.rows).toHaveLength(1);
    expect(result.report?.rows[0]).toMatchObject(offers[0]!);
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

  function storage(): Storage {
    const values = new Map<string, string>();
    return {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => { values.clear(); },
      key: (index: number) => [...values.keys()][index] || null,
      get length() { return values.size; }
    } as Storage;
  }

  it("首次打开自动显示引导，跳过后不再自动打开但仍可手动重播", () => {
    const saved = storage();
    const first = createChatbotSession({ offers, language: "en", storage: saved, enableQuestionLogging: false });

    expect(first.getState().utility?.onboardingOpen).toBe(true);
    first.skipOnboarding?.();
    expect(saved.getItem("oi_onboarding_done")).toBe("1");

    const second = createChatbotSession({ offers, language: "en", storage: saved, enableQuestionLogging: false });
    expect(second.getState().utility?.onboardingOpen).toBe(false);
    second.startOnboarding?.();
    expect(second.getState().utility?.onboardingOpen).toBe(true);
  });

  it("报告失败停留在等待结果，且没有 Memory 时 Chat 事件不能推进到最后一步", async () => {
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, enableQuestionLogging: false });
    await session.submit("merchant that does not exist");

    expect(session.getState().utility?.onboardingStep).toBe(2);
    session.setMode("chat");
    const runChat: ChatbotChatRunner = vi.fn(async () => ({ ok: true, response: "answer" }));
    const chatSession = createChatbotSession({ offers, language: "en", llmEnabled: false, runChat, enableQuestionLogging: false });
    chatSession.setMode("chat");
    await chatSession.submit("chat without memory");

    expect(chatSession.getState().utility?.onboardingStep).not.toBe(4);
  });

  it("报告执行通过回调暴露理解、查询、生成三个阶段", async () => {
    const stages: string[] = [];
    const session = createChatbotSession({ offers, language: "en", llmEnabled: false, enableQuestionLogging: false });

    await session.submit("Tapo", {
      onProgress: (stage) => stages.push(stage)
    });

    expect(stages).toEqual(["understand", "query", "report"]);
  });

  it("uses the cached report model and exposes a structured snapshot", async () => {
    const session = createChatbotSession({ offers, language: "zh", llmEnabled: false, enableQuestionLogging: false });

    const result = await session.submit("Tapo ID398679");

    expect(result).toMatchObject({ ok: true, mode: "report", source: "cache" });
    expect(result.report).toMatchObject({ intent: "merchant", query: "Tapo ID398679", rows: offers });
    expect(session.getState()).toMatchObject({ status: "success", hasMemory: false });
  });

  it("Deep Window 趋势的核心列保持旧版九项指标，而不是前三个结构列", async () => {
    const session = createChatbotSession({
      offers: [{
        ...parityOffers[0],
        monthly: [
          { month: "2026-07", revenue: 4000, orders: 40, clicks: 800, affiliatePayout: 200 },
          { month: "2026-08", revenue: 5000, orders: 50, clicks: 1000, affiliatePayout: 250 }
        ]
      }],
      language: "zh",
      llmEnabled: false,
      enableQuestionLogging: false
    });

    const result = await session.submit("Alpha Audio 近 3 个月趋势");
    expect(result.ok).toBe(true);
    expect(session.interactContext?.("trend-column-core")).toBe(true);
    const trend = session.getState().currentResult?.document?.blocks.find((block) => block.kind === "trend");
    expect(trend && trend.kind === "trend" ? trend.visibleColumns : []).toEqual([
      "month", "salesAmount", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate", "deltaPct"
    ]);
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

  it("加入 Memory 时保留回答对应的原始报告快照", async () => {
    const session = createChatbotSession({ offers: parityOffers, language: "zh", llmEnabled: false, enableQuestionLogging: false });
    const result = await session.submit("推荐 Electronics 前 1 个");

    expect(session.addMemory?.(result)).toBe(true);
    expect(session.getState().memory[0]?.result?.reportSnapshot).toMatchObject({
      documentId: result.document?.documentId,
      rankingOffers: expect.any(Array)
    });
  });

  it("旧回答导出时使用旧 answerId，而不是被最新回答替换", async () => {
    const downloadReport = vi.fn(() => true);
    const session = createChatbotSession({
      offers: [
        { ...offers[0], merchantName: "Tapo", brand: "Tapo" },
        { ...offers[0], merchantId: "398680", merchantName: "Shokz", brand: "Shokz" }
      ],
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false,
      downloadReport
    });
    const first = await session.submit("Tapo");
    await session.submit("Shokz");

    const download = session.downloadRecommendation as ((downloadId: string, answerId?: string) => boolean) | undefined;
    expect(download?.("answer-export", first.answerId ?? undefined)).toBe(true);
    expect(downloadReport).toHaveBeenLastCalledWith(expect.objectContaining({ query: "Tapo" }));
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

  it("uses classifier parameters to select the requested recommendation", async () => {
    const session = createChatbotSession({
      offers: parityOffers,
      language: "zh",
      llmEnabled: true,
      enableQuestionLogging: false,
      classify: async () => ({
        intent: "recommendation",
        params: {
          tier: ["Tier 1"],
          count: 1,
          metricFilters: [{ field: "aov", operator: ">=", value: 100 }]
        }
      })
    });

    const result = await session.submit("按已说明的条件挑一项");

    expect(result.ok).toBe(true);
    expect(result.report?.rows.map((row) => row.merchantId)).toEqual(["1001"]);
    session.dispose?.();
  });

  it("uses remote offers when resolving a merchant name that was absent from bootstrap", async () => {
    const provider = createReportDataProvider({
      offers: [],
      loadOffers: async () => ({
        offers: [
          { merchantId: "2001", brand: "Live Merchant", tier: "Tier 1", category: "Electronics", salesAmount: 100, clicks: 100, orders: 2 },
          { merchantId: "2002", brand: "Other Merchant", tier: "Tier 1", category: "Electronics", salesAmount: 900, clicks: 100, orders: 18 }
        ]
      })
    });
    const session = createChatbotSession({
      offers: [],
      reportProvider: provider,
      language: "en",
      llmEnabled: false,
      enableQuestionLogging: false
    });

    const result = await session.submit("Live Merchant");

    expect(result.ok).toBe(true);
    expect(result.report?.rows.map((row) => row.merchantId)).toEqual(["2001"]);
    session.dispose?.();
  });
});
