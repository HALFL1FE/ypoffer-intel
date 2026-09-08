import { describe, expect, it, vi } from "vitest";

import { createChatbotSession } from "./chatbotSession";
import { createReportDataProvider } from "./report/reportDataProvider";
import { parityOffers, parityPaymentRecords, parityPublishers } from "./report/fixtures/parityData";

describe("Chatbot Report Mode 功能对齐回归", () => {
  it("保留支付优先级、自然语言分析和 follow-up 上下文", async () => {
    const session = createChatbotSession({
      offers: parityOffers,
      paymentRecords: parityPaymentRecords,
      language: "zh",
      llmEnabled: false,
      enableQuestionLogging: false
    });

    const payment = await session.submit("Tier 2 未付款");
    expect(payment).toMatchObject({ ok: true, intent: "payment" });
    expect(payment.report?.rows.map((row) => row.merchantId)).toEqual(["1003"]);

    const analysis = await session.submit("分析 Tier 2");
    expect(analysis).toMatchObject({ ok: true, intent: "analysis" });
    expect(analysis.report?.rows.map((row) => row.merchantId)).toEqual(["1002", "1003"]);

    await session.submit("Alpha Audio");
    const followup = await session.submit("EPC");
    expect(followup).toMatchObject({ ok: true, intent: "merchant" });
    expect(followup.report?.rows.map((row) => row.merchantId)).toEqual(["1001"]);
    session.dispose?.();
  });

  it("支持关键词数据晚到、Publisher Records 和 Profile", async () => {
    const loadKeywords = vi.fn(async () => ({ rows: [{ merchantId: "1001", productKeywords: ["headphones"] }] }));
    const loadPortfolio = vi.fn(async () => ({ merchants: [{ merchantId: "1001", merchantName: "Alpha Audio", category: "Electronics", tier: "Tier 1", clicks: 1000, orders: 50, sales: 5000, affCommission: 250 }] }));
    const provider = createReportDataProvider({
      offers: parityOffers,
      keywords: { merchants: [] },
      publishers: parityPublishers,
      loadKeywords,
      loadPublisherPortfolio: loadPortfolio
    });
    const session = createChatbotSession({
      offers: parityOffers,
      productKeywords: undefined,
      publishers: parityPublishers,
      reportProvider: provider,
      language: "zh",
      llmEnabled: false,
      enableQuestionLogging: false
    });

    const keyword = await session.submit("/keyword: headphones");
    expect(keyword).toMatchObject({ ok: true, intent: "keyword" });
    expect(keyword.report?.rows.some((row) => row.merchantId === "1001")).toBe(true);
    expect(loadKeywords).toHaveBeenCalledTimes(1);

    const records = await session.submit("/publisher");
    expect(records).toMatchObject({ ok: true, intent: "publisher" });
    expect(records.report?.title).toBe("Publisher Records");
    expect(records.report?.rows[0]?.userId).toBe("p-1");

    const missingProfile = await session.submit("/publisherprofile");
    expect(missingProfile).toMatchObject({ ok: false, intent: "publisherprofile" });

    const profile = await session.submit("/publisherprofile: Media One");
    expect(profile).toMatchObject({ ok: true, intent: "publisherprofile" });
    expect(profile.report?.rows[0]?.merchantId).toBe("1001");
    expect(loadPortfolio).toHaveBeenCalledWith("p-1", null, null, expect.any(AbortSignal));
    session.dispose?.();
  });

  it("将分类器 params 作为真实报告条件，而不是仅记录参数", async () => {
    const session = createChatbotSession({
      offers: parityOffers,
      language: "zh",
      llmEnabled: true,
      enableQuestionLogging: false,
      classify: async () => ({ intent: "recommendation", params: { tier: ["Tier 2"], count: 1, metricSort: { field: "epc", direction: "desc" } } })
    });

    const result = await session.submit("按分类器条件推荐");

    expect(result.ok).toBe(true);
    expect(result.report?.rows.map((row) => row.merchantId)).toEqual(["1003"]);
    session.dispose?.();
  });

  it("报告模式的自然语言排除/替换会继承上一轮推荐请求", async () => {
    const offers = [...parityOffers, {
      ...parityOffers[1],
      merchantId: "1006",
      brand: "Zeta Home",
      merchantName: "Zeta Home",
      tier: "Tier 1"
    }];
    const session = createChatbotSession({
      offers,
      language: "zh",
      llmEnabled: false,
      enableQuestionLogging: false
    });

    await session.submit("Tier 1 推荐 2 个");
    const result = await session.submit("排除 Alpha Audio，换一个");

    expect(result).toMatchObject({ ok: true, intent: "recommendation" });
    expect(result.document?.request).toMatchObject({
      intent: "recommendation",
      count: 2,
      tiers: ["Tier 1"],
      excludeMerchantIds: ["1001"],
      replaceMerchantIds: ["1001"]
    });
    session.dispose?.();
  });
});
