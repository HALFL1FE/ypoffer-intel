import { describe, expect, it } from "vitest";
import { parityOffers } from "./fixtures/parityData";
import { buildTrendReport, mergeMerchantMonths } from "./trendReports";
import { resolveReportQuery } from "./reportQuery";

describe("trendReports", () => {
  it("优先使用真实月度数据并计算首末月变化", () => {
    const rows = [{
      ...parityOffers[0],
      monthly: [
        { month: "2026-06", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
        { month: "2026-07", clicks: 200, orders: 12, salesAmount: 1200, affCommission: 60 },
        { month: "2026-08", clicks: 300, orders: 18, salesAmount: 1800, affCommission: 90 }
      ]
    }];
    const result = buildTrendReport(resolveReportQuery("Alpha Audio 近 3 个月趋势", { language: "zh", categories: [] }), rows, "zh");
    expect(result.estimated).toBe(false);
    expect(result.rows).toHaveLength(3);
    expect(result.rows.at(-1)).toMatchObject({ month: "2026-08", value: 1800, delta: 600 });
  });

  it("没有月度数据时标记 estimated，且品类趋势排除 Tier 4/BLACK TIER", () => {
    const query = resolveReportQuery("Electronics 趋势", { language: "en", categories: ["Electronics"] });
    const result = buildTrendReport(query, parityOffers, "en");
    expect(result.estimated).toBe(true);
    expect(result.rows.length).toBeGreaterThanOrEqual(2);
    expect(result.note).toContain("estimated");
  });

  it("合并商户详情的重复月度字段，并拒绝单月趋势范围", () => {
    const merged = mergeMerchantMonths({
      merchant: { merchantId: "1001", brand: "Alpha Audio" },
      monthlyAmazonMetrics: [{ month: "2026-08", clicks: 100, orders: 5, salesAmount: 500 }],
      monthlyAggregateMetrics: [{ month: "2026-08", affCommission: 25 }, { month: "2026-09", affCommission: 30 }]
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.monthly).toEqual([
      { month: "2026-08", clicks: 100, orders: 5, salesAmount: 500, affCommission: 25 },
      { month: "2026-09", affCommission: 30 }
    ]);

    const query = resolveReportQuery("Alpha Audio 2026-08 至 2026-08 趋势", { language: "zh", categories: [] });
    const singleMonth = buildTrendReport(query, parityOffers, "zh");
    expect(singleMonth.status).toBe("needs_input");
  });

  it("品类趋势显式指定 Tier 4 时不会被默认排除", () => {
    const rows = [{
      ...parityOffers[3],
      monthly: [
        { month: "2026-07", clicks: 10, orders: 1, salesAmount: 100 },
        { month: "2026-08", clicks: 20, orders: 2, salesAmount: 240 }
      ]
    }];
    const query = resolveReportQuery("Electronics Tier 4 趋势", { language: "zh", categories: ["Electronics"] });
    const result = buildTrendReport(query, rows, "zh");

    expect(query.tiers).toEqual(["Tier 4"]);
    expect(result.status).toBe("resolved");
    expect(result.rows.some((row) => row.month === "2026-08" && row.value === 240)).toBe(true);
  });
});
