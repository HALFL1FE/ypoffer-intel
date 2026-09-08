import { describe, expect, it, vi } from "vitest";

import { parityOffers } from "./fixtures/parityData";
import { createReportDataProvider } from "./reportDataProvider";
import { applyReportAction, executeReport } from "./reportEngine";
import { resolveReportQuery } from "./reportQuery";
import type { ReportEngineContext } from "./reportContracts";

function context(): ReportEngineContext {
  const offers = [{
    ...parityOffers[0],
    monthly: [
      { month: "2026-06", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
      { month: "2026-07", clicks: 200, orders: 12, salesAmount: 1200, affCommission: 60 },
      { month: "2026-08", clicks: 300, orders: 18, salesAmount: 1800, affCommission: 90 }
    ]
  }];
  return {
    offers,
    paymentRecords: [],
    productKeywords: {},
    provider: createReportDataProvider({ offers }),
    now: () => new Date("2026-09-08T00:00:00Z")
  };
}

describe("reportEngine actions", () => {
  it("缓存未命中 Merchant 时使用远程搜索结果而不退化为全量列表", async () => {
    const loadSearch = vi.fn(async () => ({
      rows: [{
        merchantId: "9001",
        merchantName: "Remote Brand",
        tier: "Tier 2",
        category: "Electronics",
        clicks: 80,
        orders: 8,
        salesAmount: 800,
        affCommission: 80
      }]
    }));
    const provider = createReportDataProvider({ offers: [], loadSearch });
    const base: ReportEngineContext = {
      offers: [],
      paymentRecords: [],
      productKeywords: {},
      provider,
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("/merchant: Remote Brand", { language: "en", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(loadSearch).toHaveBeenCalledWith("Remote Brand", expect.any(AbortSignal));
    expect(document.rows.map((row) => row.merchantId)).toEqual(["9001"]);
  });

  it("远程命中 ASIN 后不再保留错误的未匹配提示", async () => {
    const provider = createReportDataProvider({
      offers: [],
      loadSearch: async () => ({ rows: [{ merchantId: "9002", merchantName: "Remote Product", asins: ["B000000001"] }] })
    });
    const base: ReportEngineContext = {
      offers: [],
      paymentRecords: [],
      productKeywords: {},
      provider,
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("/asin: B000000001", { language: "en", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.rows.map((row) => row.merchantId)).toEqual(["9002"]);
    expect(document.blocks.some((block) => block.id === "asin-unmatched")).toBe(false);
  });

  it("通过统一入口执行趋势，并让列动作同步报告工作表", async () => {
    const base = context();
    const query = resolveReportQuery("Alpha Audio 近 3 个月趋势", { language: "zh", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.intent).toBe("analysis");
    expect(document.blocks.some((block) => block.kind === "trend")).toBe(true);

    const next = await applyReportAction(document, {
      documentId: document.documentId,
      blockId: "trend",
      type: "trend-columns",
      value: ["month", "value"]
    }, base, new AbortController().signal);
    const trend = next.blocks.find((block) => block.kind === "trend");
    expect(trend && trend.kind === "trend" ? trend.visibleColumns : []).toEqual(["month", "value"]);
    expect(next.sheets[0]?.columns.map((column) => column.key)).toEqual(["month", "value"]);
  });

  it("拒绝不属于当前报告的动作", async () => {
    const base = context();
    const query = resolveReportQuery("Alpha Audio", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }]
    });
    const document = await executeReport(query, base, new AbortController().signal);

    await expect(applyReportAction(document, {
      documentId: "report-other",
      type: "select-merchant",
      value: "1001"
    }, base, new AbortController().signal)).rejects.toThrow("does not match");
  });

  it("拒绝不在趋势列举中的指标动作", async () => {
    const base = context();
    const query = resolveReportQuery("Alpha Audio 近 3 个月趋势", { language: "zh", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    await expect(applyReportAction(document, {
      documentId: document.documentId,
      type: "trend-metric",
      value: "not-a-trend-metric"
    }, base, new AbortController().signal)).rejects.toThrow("value is invalid");
  });

  it("商户详情报告包含月度指标与产品明细区块", async () => {
    const offers = [{
      ...parityOffers[0],
      products: [{ asin: "B000000001", productName: "Alpha headphones" }]
    }];
    const base: ReportEngineContext = {
      offers,
      paymentRecords: [],
      productKeywords: {},
      provider: createReportDataProvider({
        offers,
        loadMerchant: async () => ({
          merchant: { merchantId: "1001", merchantName: "Alpha Audio" },
          monthlyAmazonMetrics: [
            { month: "2026-07", clicks: 200, orders: 12, salesAmount: 1200, affCommission: 60 },
            { month: "2026-08", clicks: 300, orders: 18, salesAmount: 1800, affCommission: 90 }
          ],
          products: [{ asin: "B000000001", productName: "Alpha headphones" }]
        })
      }),
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("Alpha Audio", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }]
    });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.blocks.map((block) => block.id)).toEqual(expect.arrayContaining(["merchant-monthly", "merchant-products"]));
    const monthly = document.blocks.find((block) => block.id === "merchant-monthly");
    expect(monthly && monthly.kind !== "notice" ? monthly.rows : []).toHaveLength(2);
  });

  it("ASIN 报告显式展示未匹配 ASIN", async () => {
    const base = context();
    const query = resolveReportQuery("B000000001 B000000009", { language: "zh", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.blocks.some((block) => block.id === "asin-unmatched")).toBe(true);
    expect(document.message).toContain("B000000009");
  });

  it("推荐结果展示推荐分、推荐理由和流量角度", async () => {
    const base = context();
    const query = resolveReportQuery("Top 1 AOV offers", { language: "en", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);
    const recommendations = document.blocks.find((block) => block.id === "recommendations");

    expect(recommendations && recommendations.kind !== "notice" ? recommendations.columns.map((column) => column.key) : []).toEqual(expect.arrayContaining([
      "recommendationScore", "recommendationReason", "trafficAngle"
    ]));
    expect(document.rows[0]).toHaveProperty("recommendationReason");
  });

  it("推荐报告保留完整候选池供 Memory 使用", async () => {
    const base: ReportEngineContext = {
      offers: parityOffers,
      paymentRecords: [],
      productKeywords: {},
      provider: createReportDataProvider({ offers: parityOffers }),
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("推荐 Electronics 前 1 个", { language: "zh", categories: ["Electronics"] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.rows).toHaveLength(1);
    expect(document.rankingOffers?.length).toBe(parityOffers.length);
  });

  it("品类或 Tier 趋势会批量加载商户月度详情并保留覆盖状态", async () => {
    const offers = parityOffers.slice(0, 3).map((row) => ({ ...row, monthly: [] }));
    const loadMerchant = vi.fn(async (merchantId: string) => ({
      merchant: { merchantId },
      monthlyAmazonMetrics: [
        { month: "2026-07", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
        { month: "2026-08", clicks: 200, orders: 10, salesAmount: 1200, affCommission: 60 }
      ]
    }));
    const provider = createReportDataProvider({ offers, loadMerchant });
    const base: ReportEngineContext = {
      offers,
      paymentRecords: [],
      productKeywords: {},
      provider,
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("Electronics Tier 1 趋势", { language: "zh", categories: ["Electronics"] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(loadMerchant).toHaveBeenCalledWith("1001", expect.any(Number), expect.any(AbortSignal));
    const trend = document.blocks.find((block) => block.id === "trend");
    expect(trend && trend.kind !== "notice" ? trend.rows.length : 0).toBeGreaterThanOrEqual(2);
    expect(document.sourceInfo.covered).toBeGreaterThan(0);
  });

  it("媒体画像报告展示偏好、AOV、市场和信号区块", async () => {
    const provider = createReportDataProvider({
      offers: [],
      publishers: parityOffers.length ? {
        publishers: [{
          userId: "p-1",
          userName: "Media One",
          adminName: "Manager A",
          networks: ["Levanta"],
          markets: { "amazon.com": { clicks: 100, orders: 4, sales: 400, allCommission: 40, affCommission: 20 } },
          total: { clicks: 100, orders: 4, sales: 400, allCommission: 40, affCommission: 20 },
          merchantIds: ["1001"]
        }]
      } : null,
      loadPublisherPortfolio: async () => ({
        merchants: [{
          merchantId: "1001",
          merchantName: "Alpha Audio",
          category: "Electronics",
          tier: "Tier 1",
          network: "Levanta",
          markets: { "amazon.com": { sales: 400, clicks: 100, orders: 4 } },
          total: { sales: 400, clicks: 100, orders: 4 }
        }]
      })
    });
    const base: ReportEngineContext = {
      offers: [],
      paymentRecords: [],
      productKeywords: {},
      provider,
      now: () => new Date("2026-09-08T00:00:00Z")
    };
    const query = resolveReportQuery("/publisherprofile: Media One", { language: "en", categories: [] });
    const document = await executeReport(query, base, new AbortController().signal);

    expect(document.blocks.map((block) => block.id)).toEqual(expect.arrayContaining([
      "publisher-affinity", "publisher-aov-bands", "publisher-markets", "publisher-signals"
    ]));
  });
});
