import { describe, expect, it, vi } from "vitest";

import { createAgentSession, type AgentSessionRequest } from "./agentSession";
import type { AgentPromotionAttachment } from "./agentAttachment";
import { emptyMetrics } from "../offer-performance/performanceModel";

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
    affCommission: 120,
    conversionRate: 0.12,
    epc: 12
  },
  {
    merchantId: "398680",
    merchantName: "Home Lamp",
    brand: "Home Lamp",
    tier: "Tier 2",
    category: "Home",
    clicks: 50,
    orders: 5,
    salesAmount: 500,
    affCommission: 50,
    conversionRate: 0.1,
    epc: 10
  }
];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function streamResponse(content: string): Response {
  return new Response(`data: ${JSON.stringify({ token: content })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" }
  });
}

describe("createAgentSession", () => {
  it("连续两轮查询将 Top ASIN 按原顺序传给追问规划", async () => {
    const asins = ["B0D2HKCMBP", "B0GQ3MD31D", "B0CS3JBP67", "B0D2HHDKTD", "B09BVXT8TJ"];
    const contexts: unknown[] = [];
    const session = createAgentSession({ offers: [{ merchantId: "362653", merchantName: "Shokz", topAsins: asins }],
      language: "zh", enableTrace: false, enableQuestionLogging: false, fetcher: vi.fn(async (input, init) => {
        if (String(input) === "/api/chat/agent") {
          const body = JSON.parse(String(init?.body));
          contexts.push(body.asinContext);
          return response({ ok: true, agentRunId: "ar_followup", planProof: "proof", toolCalls: contexts.length === 1
            ? [{ id: "r1c1", name: "merchant_analysis", arguments: { merchant: "362653", view: "top_asins" } }]
            : [{ id: "r1c1", name: "asin_analysis", arguments: { asins: body.asinContext, view: "details" } }] });
        }
        if (String(input).startsWith("/api/ui/db/asin?")) return response({ ok: true,
          rows: asins.map(asin => ({ asin, merchantId: "362653", productName: "耳机", monthly: [] })) });
        return response({ errorCode: "agent_synthesis_unavailable" }, 503);
      }) });
    const request = { language: "zh" as const, history: [], memoryText: "", signal: new AbortController().signal };
    await session.submit({ ...request, prompt: "Shokz top ASIN" });
    const result = await session.submit({ ...request, prompt: "给我这5个ASIN的信息" });
    expect(contexts).toEqual([[], asins]);
    expect(result.response).toContain("耳机");
    asins.forEach(asin => expect(result.response).toContain(asin));
  });
  it.each([
    ["$51.99", "$51.99"], ["$1,299.00", "$1,299.00"], ["€51.99", "€51.99"],
    ["USD 51.99", "USD 51.99"], [51.99, "51.99"], [0, "0"], ["51.99", "51.99"],
    ["", "未提供"], ["   ", "未提供"], [null, "未提供"], ["询价", "未提供"],
    ["$51.99 - $99.99", "未提供"], [true, "未提供"]
  ])("商品价格保留合法货币标记，缺失或无效价格不补零：%j", async (price, expected) => {
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false,
      fetcher: vi.fn(async () => response({ ok: true, rows: [{ asin: "B09DPRB3TR", merchantId: "406220",
        merchantName: "AOCHUAN", dealPrice: price, originalPrice: price, monthly: [] }] })) });
    const result = await session.executeTool({ callId: "price", toolName: "asin_analysis",
      arguments: { asins: ["B09DPRB3TR"], view: "details" }, prompt: "查询商品价格", signal: new AbortController().signal });
    for (const label of ["商品价格", "原价"]) {
      expect(result.resultView?.rows.find((row) => row.values[0] === label)?.values[1]).toBe(expected);
    }
    const data = (result.toolResult.result as { data: { rows: Record<string, unknown>[] } }).data;
    if (expected === "未提供") expect(data.rows[0]).not.toHaveProperty("dealPrice");
    else expect(String(data.rows[0]?.dealPrice)).toBe(expected);
  });
  it("商品详情在 modern 综合失败后仍保留字段且不生成零业绩", async () => {
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false,
      fetcher: vi.fn(async (input) => {
        if (String(input) === "/api/chat/agent") return response({ ok: true, agentRunId: "ar_details", planProof: "proof",
          toolCalls: [{ id: "r1c1", name: "asin_analysis", arguments: { asins: ["B09DPRB3TR"], view: "details" } }] });
        if (String(input).startsWith("/api/ui/db/asin?")) return response({ ok: true, rows: [{ asin: "B09DPRB3TR",
          merchantId: "406220", merchantName: "AOCHUAN", productName: "稳定器", dealPrice: "$51.99", monthly: [] }] });
        return response({ errorCode: "agent_synthesis_unavailable" }, 503);
      }) });
    const result = await session.submit({ prompt: "B09DPRB3TR 的商品详情", language: "zh", history: [], memoryText: "",
      signal: new AbortController().signal });
    expect(result.response).toContain("稳定器");
    expect(result.response).toContain("商品价格 | $51.99");
    expect(result.response).not.toContain("| 订单 |");
    expect(result.response).toContain("| --- | --- | --- |\n| B09DPRB3TR");
  });
  it.each([false, true])("ASIN 详情保留商品字段且不依赖月度表现（有表现：%s）", async (hasPerformance) => {
    const productUrl = "https://www.amazon.com/dp/B09DPRB3TR?tag=" + "a".repeat(150);
    const session = createAgentSession({ offers, language: "zh", enableTrace: false, enableQuestionLogging: false,
      fetcher: vi.fn(async () => response({ ok: true, checkedAt: "2026-09-20T00:00:00Z", rows: [{
        asin: "B09DPRB3TR", merchantId: "406220", merchantName: "AOCHUAN", productName: "手机稳定器",
        productUrl, dealPrice: 59, originalPrice: 100, discountPercent: 41, commissionRate: 0,
        updatedAt: "2026-09-18", asinPerformanceAvailable: hasPerformance,
        ...(hasPerformance ? { orders: 2, salesAmount: 118 } : {}),
        monthly: hasPerformance ? [{ month: "2026-09", orders: 2, salesAmount: 118 }] : []
      }] })) });
    const result = await session.executeTool({ callId: "details-1", toolName: "asin_analysis",
      arguments: { asins: ["B09DPRB3TR"], view: "details" }, prompt: "查看商品详细信息", signal: new AbortController().signal });
    const data = (result.toolResult.result as { data: { rows: Record<string, unknown>[] } }).data;
    expect(data.rows[0]).toMatchObject({ commissionRate: 0, updatedAt: "2026-09-18", asinPerformanceAvailable: hasPerformance });
    if (!hasPerformance) expect(data.rows[0]).not.toHaveProperty("orders");
    expect(result.resultView?.rows).toEqual(expect.arrayContaining([
      { label: "B09DPRB3TR", values: ["商品链接", productUrl] },
      { label: "B09DPRB3TR", values: ["佣金率（源值）", "0"] },
      { label: "B09DPRB3TR", values: ["品类", "未提供"] }
    ]));
    expect(JSON.stringify(result.memoryEvent)).not.toContain(productUrl);
  });
  it.each([false, true])("六商家结果完整进入综合，综合失败仍保留已查 ASIN（部分缺失：%s）", async (missing) => {
    const merchants = [["406220", "AOCHUAN"], ["362448", "Midland Radio"], ["380928", "DS18"],
      ["384704", "ISOtunes"], ["385315", "SABRENT"], ["362602", "Productech"]];
    const fixture = merchants.map(([merchantId, merchantName], i) => ({
      merchantId, merchantName, topAsins: missing && i === 4 ? [] : [`B00000000${i}`, "B09PFBWV55"]
    })).filter((_, i) => !missing || i !== 5);
    let sent: Array<{ arguments: Record<string, unknown>; result: { ok: boolean; data?: { topAsins: string[]; asinRanking: { status: string } } } }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/chat/agent") return response({ ok: true, agentRunId: "ar_top_six", planProof: "proof", toolCalls:
        merchants.map(([id], i) => ({ id: `r1c${i + 1}`, name: "merchant_analysis", arguments: { merchant: id, view: "top_asins" } })) });
      if (String(input) === "/api/chat/stream") {
        sent = JSON.parse(String(init?.body)).toolResults;
        return response({ errorCode: "agent_synthesis_unavailable" }, 503);
      }
      throw new Error("不应查询其他接口");
    });
    const session = createAgentSession({ offers: fixture, language: "zh", fetcher, enableQuestionLogging: false, enableTrace: false });
    const result = await session.submit({ prompt: merchants.map((row) => row.join("\t")).join("\n") + "；以上商家的top asin可以帮我提取吗",
      language: "zh", history: [], memoryText: "", signal: new AbortController().signal });
    expect(sent).toHaveLength(6);
    expect(sent.map((item) => item.arguments.merchant)).toEqual(merchants.map(([id]) => id));
    sent.slice(0, missing ? 4 : 6).forEach((item, i) => expect(item.result.data?.topAsins).toEqual([`B00000000${i}`, "B09PFBWV55"]));
    expect(result.resultViews).toHaveLength(6);
    expect(result.response).toContain("Midland Radio");
    expect(result.response).toContain("B000000001");
    expect(result.response).toContain("362602");
    expect(result.response).not.toContain("Month | Value");
    if (missing) {
      expect(sent[4]?.result.data?.asinRanking.status).toBe("empty");
      expect(sent[5]?.result.ok).toBe(false);
      expect(result.response).toContain("未提供");
      expect(result.response).toContain("数据不可用");
    }
  });

  it("Top ASIN 保持上限且不会凭缺失版本声称按营收排序", async () => {
    const session = createAgentSession({ offers: [{ merchantId: "406220", merchantName: "AOCHUAN",
      topAsins: Array.from({ length: 8 }, (_, i) => `B00000000${i}`) }], language: "en", enableTrace: false, enableQuestionLogging: false });
    const result = await session.executeTool({ callId: "limit", toolName: "merchant_analysis",
      arguments: { merchant: "406220", view: "top_asins" }, prompt: "top 10 ASINs from last year", signal: new AbortController().signal });
    expect(result.toolResult).toMatchObject({ result: { data: { topAsins: ["B000000000", "B000000001", "B000000002", "B000000003", "B000000004"],
      asinRanking: { returned: 5, basis: "unknown", version: null } } } });
    expect(result.resultView?.message).toContain("other periods and larger lists are not queried");
  });

  it("按商家提取快照内的 Top ASIN，保留排名、来源且不请求月度数据", async () => {
    const fetcher = vi.fn();
    const session = createAgentSession({
      offers: [{ merchantId: "362448", merchantName: "Midland Radio", topAsins: ["b09pfbwv55", "B000000001", "B09PFBWV55", "bad"] }],
      language: "zh", fetcher, enableQuestionLogging: false, enableTrace: false,
      dataAsOf: "2026-09-19T06:46:15Z",
      asinRankingContext: { version: 2, startDate: "2026-09-01", endDate: "2026-09-30" }
    });
    const result = await session.executeTool({
      callId: "top-1", toolName: "merchant_analysis", arguments: { merchant: "362448 Midland Radio", view: "top_asins" },
      prompt: "提取这个商家的top asin", signal: new AbortController().signal
    });
    expect(result.toolResult).toMatchObject({ result: {
      ok: true, source: { dataSource: "cache", dataAsOf: "2026-09-19T06:46:15Z" },
      data: { merchant: { id: "362448", name: "Midland Radio" }, topAsins: ["B09PFBWV55", "B000000001"],
        asinRanking: { status: "available", returned: 2, limit: 5, version: 2, basis: "period_revenue_desc_then_asin", startDate: "2026-09-01", endDate: "2026-09-30" } }
    } });
    expect(result.resultView).toMatchObject({ kind: "table", source: "cache", rows: [
      { label: "1", values: ["362448", "Midland Radio", "B09PFBWV55"] },
      { label: "2", values: ["362448", "Midland Radio", "B000000001"] }
    ] });
    expect(JSON.stringify(result.memoryEvent)).not.toContain("B09PFBWV55");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [[], "empty"], [undefined, "unavailable"], ["B09PFBWV55", "unavailable"], [["bad"], "unavailable"]
  ])("区分空列表和无效 ASIN 数据：%j", async (topAsins, status) => {
    const session = createAgentSession({ offers: [{ merchantId: "362448", merchantName: "Midland Radio", topAsins }],
      language: "zh", enableQuestionLogging: false, enableTrace: false });
    const result = await session.executeTool({ callId: "empty", toolName: "merchant_analysis",
      arguments: { merchant: "362448", view: "top_asins" }, prompt: "Top ASIN", signal: new AbortController().signal });
    expect(result.toolResult).toMatchObject({ result: { ok: true, data: { topAsins: [], asinRanking: {
      status, returned: 0, version: null, basis: "unknown", startDate: null, endDate: null, dataAsOf: null
    } } } });
    expect(result.resultView?.message).toContain(status === "empty" ? "未提供" : "不可用");
  });
  it("carries the uploaded promotion scope into planning, tool execution, and synthesis", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const attachment: AgentPromotionAttachment = {
      manifest: {
        attachmentId: "attachment-a",
        fileName: "campaign.csv",
        merchantCount: 1,
        merchants: [{ merchantId: "101", merchantName: "First merchant" }],
        window: {
          launchDate: "2026-09-07",
          startDate: "2026-09-07",
          endDate: "2026-09-13",
          beforeStart: "2026-08-31",
          beforeEnd: "2026-09-06",
          days: 7,
        },
      },
      offers: [{ merchantId: "101", merchantName: "First merchant", category: "Home", asins: [] }],
      diagnostics: { totalRows: 1, invalidIdRows: 0, duplicateRows: 0, missingNameRows: 0, sheetsWithMerchantHeader: 1 },
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      if (url === "/api/chat/agent") return response({
        ok: true,
        agentRunId: "ar_promotion_session_1234",
        planProof: "signed-proof",
        toolCalls: [{ id: "r1c1", name: "promotion_analysis", arguments: { attachmentId: "attachment-a", view: "merchants", merchantIds: ["101"], window: attachment.manifest.window, metric: "revenue", sortBy: "after", direction: "desc", offset: 0, limit: 25 } }]
      });
      if (url === "/api/chat/stream") return streamResponse("上传清单商家分析完成");
      throw new Error(`unexpected URL ${url}`);
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false,
      loadPromotionReport: async () => ({
        ok: true,
        availableThrough: "2026-09-20",
        generatedAt: "2026-09-21",
        clickSource: "click",
        dateRange: { startDate: "2026-09-07", endDate: "2026-09-13", beforeStart: "2026-08-31", beforeEnd: "2026-09-06", days: 7 },
        supported: { revenue: true, clicks: true, dpv: true, atc: true, orders: true, commission: true },
        merchants: [{ merchantId: "101", before: { ...emptyMetrics(), revenue: 100 }, after: { ...emptyMetrics(), revenue: 120 }, daily: [], monthly: [] }]
      })
    });

    const result = await session.submit({
      prompt: "分析上传清单推送后一周表现",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal,
      promotionAttachment: attachment
    });

    expect(result).toMatchObject({ ok: true, status: "done", response: "上传清单商家分析完成" });
    expect(calls[0]!.body.promotionContext).toMatchObject({ attachmentId: "attachment-a", merchantCount: 1 });
    const synthesis = calls.find((call) => call.url === "/api/chat/stream");
    expect(synthesis?.body.context).toMatchObject({ promotionContext: { attachmentId: "attachment-a" } });
    expect((synthesis?.body.toolResults as Array<Record<string, unknown>>)[0]).toMatchObject({ toolName: "promotion_analysis" });
    expect(result.resultViews?.[0]?.toolName).toBe("promotion_analysis");
  });

  it("sends the v2 planning contract without leaking tool schemas", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      return response({
        ok: true,
        contractVersion: "v2",
        registryVersion: "agent-tools-v1",
        agentRunId: "ar_test_planning_1234",
        content: "概念说明",
        toolCalls: [],
        finishReason: "stop"
      });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.submit({
      prompt: "EPC 是什么",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    });

    expect(result).toMatchObject({ ok: true, status: "done", response: "概念说明" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/chat/agent");
    expect(calls[0]!.body).toMatchObject({
      contractVersion: "v2",
      question: "EPC 是什么",
      language: "zh",
      enabledTools: expect.arrayContaining(["merchant_analysis", "trend", "asin_analysis"])
    });
    expect(calls[0]!.body.messages).toBeUndefined();
    expect(calls[0]!.body.tools).toBeUndefined();
  });

  it("retries an unavailable initial plan once and uses the recovered plan", async () => {
    let planningAttempts = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url !== "/api/chat/agent") throw new Error(`unexpected URL ${url}`);
      planningAttempts += 1;
      if (planningAttempts === 1) return response({ ok: false, errorCode: "agent_planning_unavailable" });
      return response({
        ok: true,
        contractVersion: "v2",
        registryVersion: "agent-tools-v1",
        agentRunId: "ar_retry_planning_1234",
        content: "重试后成功规划",
        toolCalls: [],
        finishReason: "stop",
      });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false,
    });

    const result = await session.submit({
      prompt: "查询当前推广数据",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal,
    });

    expect(planningAttempts).toBe(2);
    expect(result).toMatchObject({ ok: true, status: "done", response: "重试后成功规划" });
  });

  it("executes planned tools in parallel and sends only projected results to synthesis", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let firstToolStarted = false;
    let secondToolStarted = false;
    let releaseTools: (() => void) | undefined;
    const toolsReleased = new Promise<void>((resolve) => { releaseTools = resolve; });
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ url, body });
      if (url === "/api/chat/agent") {
        return response({
          ok: true,
          contractVersion: "v2",
          registryVersion: "agent-tools-v1",
          agentRunId: "ar_test_parallel_1234",
          planProof: "signed-proof",
          content: null,
          toolCalls: [
            { id: "r1c1", name: "merchant_analysis", arguments: { merchant: "Tapo" } },
            { id: "r1c2", name: "merchant_analysis", arguments: { merchant: "Home Lamp" } }
          ],
          finishReason: "tool_calls"
        });
      }
      if (url.startsWith("/api/ui/db/merchant")) {
        if (url.includes("398679")) firstToolStarted = true;
        if (url.includes("398680")) secondToolStarted = true;
        if (firstToolStarted && secondToolStarted) releaseTools?.();
        await toolsReleased;
        return response({ ok: true, monthlyAmazonMetrics: [] });
      }
      if (url === "/api/chat/stream") return streamResponse("两家商户均已完成分析");
      if (url.includes("operation=questions")) return response({ ok: true });
      throw new Error(`unexpected URL ${url}`);
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const views: unknown[] = [];
    const result = await session.submit({
      prompt: "分别查询 Tapo 和 Home Lamp 的表现",
      language: "zh",
      history: [],
      memoryText: "",
      signal: new AbortController().signal
    }, {
      onResultView: (view) => views.push(view)
    });

    expect(result).toMatchObject({ ok: true, status: "done", response: "两家商户均已完成分析" });
    expect(firstToolStarted).toBe(true);
    expect(secondToolStarted).toBe(true);
    const synthesis = calls.find((call) => call.url === "/api/chat/stream");
    expect(synthesis?.body).toMatchObject({
      contractVersion: "v2",
      agentRunId: "ar_test_parallel_1234",
      planProofs: ["signed-proof"],
      context: { history: [], memory: "" }
    });
    const toolResults = synthesis?.body.toolResults as Array<Record<string, unknown>>;
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ callId: "r1c1", toolName: "merchant_analysis" });
    expect((toolResults[0]!.result as Record<string, unknown>).error).toBeUndefined();
    expect(views).toHaveLength(2);
    expect(result.resultViews).toHaveLength(2);
  });

  it("does not commit a stopped turn to history", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve(), { once: true }));
      throw new DOMException("aborted", "AbortError");
    });
    const session = createAgentSession({
      offers,
      language: "en",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });
    const request: AgentSessionRequest = {
      prompt: "show a trend",
      language: "en",
      history: [],
      memoryText: "",
      signal: controller.signal
    };
    const pending = session.submit(request);
    controller.abort();
    const result = await pending;

    expect(result).toMatchObject({ ok: false, status: "stopped" });
    expect(session.getState().history).toEqual([]);
    expect(session.getState().messages).toEqual([]);
  });

  it("executes CopilotKit frontend tools without the Legacy bridge", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain("/api/ui/db/merchant?");
      return response({ ok: true, monthlyAmazonMetrics: [], checkedAt: "2026-09-03" });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.executeTool({
      callId: "tool-merchant-1",
      toolName: "merchant_analysis",
      arguments: { merchant: "Tapo" },
      prompt: "查询 Tapo 的 EPC",
      signal: new AbortController().signal
    });

    expect(result.toolResult).toMatchObject({
      callId: "tool-merchant-1",
      toolName: "merchant_analysis",
      result: { ok: true, source: { dataSource: "cache" } }
    });
    expect(result.memoryEvent).toMatchObject({ kind: "tool_success" });
    expect(result.resultView).toMatchObject({
      id: "tool-merchant-1",
      toolName: "merchant_analysis",
      status: "done"
    });
  });

  it("executes ASIN analysis through the browser-safe DB endpoint and renders monthly rows", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain("/api/ui/db/asin?");
      expect(url).toContain("asins=B0D2HKCMBP");
      return response({
        ok: true,
        checkedAt: "2026-09-11T08:00:00Z",
        available: true,
        unmatched: [],
        rows: [{
          asin: "B0D2HKCMBP",
          merchantId: "362653",
          merchantName: "Shokz Official",
          productName: "OpenRun Pro",
          category: "Electronics",
          clicks: 100,
          orders: 8,
          salesAmount: 800,
          affCommission: 80,
          monthly: [{
            asin: "B0D2HKCMBP",
            merchantName: "Shokz Official",
            month: "2026-08",
            clicks: 100,
            orders: 8,
            salesAmount: 800,
            affCommission: 80
          }]
        }]
      });
    });
    const session = createAgentSession({
      offers,
      language: "zh",
      fetcher,
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.executeTool({
      callId: "tool-asin-1",
      toolName: "asin_analysis",
      arguments: { asins: ["b0d2hkcmbp"] },
      prompt: "查询 ASIN B0D2HKCMBP 的产品信息和月度表现",
      signal: new AbortController().signal
    });

    expect(result.toolResult).toMatchObject({
      callId: "tool-asin-1",
      toolName: "asin_analysis",
      result: { ok: true, source: { dataSource: "database", dataAsOf: "2026-09-11T08:00:00Z" } }
    });
    const data = (result.toolResult.result as Record<string, unknown>).data as Record<string, unknown>;
    expect(data.asins).toEqual(["B0D2HKCMBP"]);
    expect(data.rows).toMatchObject([{ asin: "B0D2HKCMBP", merchantName: "Shokz Official" }]);
    expect(data.monthly).toMatchObject([{ asin: "B0D2HKCMBP", month: "2026-08", orders: 8 }]);
    expect(result.resultView).toMatchObject({
      id: "tool-asin-1",
      toolName: "asin_analysis",
      status: "done",
      kind: "table"
    });
    expect(result.resultView?.rows[0]?.label).toContain("B0D2HKCMBP");
  });

  it("formats tier aggregate metrics without exposing floating point noise", async () => {
    const decimalOffers = [{
      merchantId: "369290",
      merchantName: "Decimal Fixture",
      brand: "Decimal Fixture",
      tier: "Tier 2",
      category: "Kitchen & Dining",
      clicks: 44869,
      orders: 936,
      salesAmount: 87290.46,
      affCommission: 9931.64
    }];
    const session = createAgentSession({
      offers: decimalOffers,
      language: "zh",
      enableQuestionLogging: false,
      enableTrace: false
    });

    const result = await session.executeTool({
      callId: "tool-tier-decimal-format",
      toolName: "tier_analysis",
      arguments: { tier: "Tier 2" },
      prompt: "查询 Tier 2 商户",
      signal: new AbortController().signal
    });

    const metrics = Object.fromEntries((result.resultView?.metrics || []).map((metric) => [metric.label, metric.value]));
    expect(metrics).toMatchObject({
      merchantCount: "1",
      clicks: "44,869",
      orders: "936",
      revenue: "87,290.46",
      commission: "9,931.64",
      epc: "1.945",
      aov: "93.26",
      conversionRate: "2.09%"
    });
  });
});
