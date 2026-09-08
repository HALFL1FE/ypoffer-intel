import { describe, expect, it } from "vitest";

import { resolveReportQuery } from "./reportQuery";
import { parityOffers } from "./fixtures/parityData";
import { buildEntityReport, metricValue, normalizeOfferRow } from "./entityReports";

describe("entityReports", () => {
  it("按商户 ID 返回规范化指标并保留产品字段", () => {
    const query = resolveReportQuery("merchant: 1001", { language: "zh", categories: [] });
    const result = buildEntityReport(query, [{ ...parityOffers[0], products: [{ asin: "B000000001", productName: "Alpha headphones" }] }], {}, "zh");

    expect(result.status).toBe("resolved");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ merchantId: "1001", merchantName: "Alpha Audio", salesAmount: 5000, epc: 0.25 });
    expect(result.rows[0]?.products).toEqual([{ asin: "B000000001", productName: "Alpha headphones" }]);
  });

  it("同名商户不自动选择第一项，并同时报告 ASIN 未匹配项", () => {
    const duplicate = { ...parityOffers[0], merchantId: "1099" };
    const merchantQuery = resolveReportQuery("Alpha Audio", { language: "en", categories: [], merchantCandidates: [
      { id: "1001", name: "Alpha Audio" }, { id: "1099", name: "Alpha Audio" }
    ] });
    const merchantResult = buildEntityReport(merchantQuery, [parityOffers[0], duplicate], {}, "en");
    expect(merchantResult.status).toBe("ambiguous");
    expect(merchantResult.rows).toHaveLength(2);

    const asinQuery = resolveReportQuery("B000000001 B000000002 B000000009", { language: "zh", categories: [] });
    const asinResult = buildEntityReport(asinQuery, parityOffers, {}, "zh");
    expect(asinResult.rows.map((row) => row.merchantId)).toEqual(["1001", "1002"]);
    expect(asinResult.unmatched).toEqual(["B000000009"]);
  });

  it("合并晚到的产品关键词索引，并统一百分比型输入", () => {
    const query = resolveReportQuery("keyword: headphones", { language: "en", categories: [] });
    const result = buildEntityReport(query, [parityOffers[1]], {
      merchants: [{ merchantId: "1001", merchantName: "Alpha Audio", productNameKeywords: ["headphones"] }]
    }, "en");
    expect(result.rows.some((row) => row.merchantId === "1001" || row.merchantName === "Alpha Audio")).toBe(true);

    const normalized = normalizeOfferRow({ merchantId: "x", brand: "Percent", conversionRate: "2.4%", commissionRate: 5 });
    expect(metricValue(normalized, "conversionRate")).toBeCloseTo(0.024);
    expect(metricValue(normalized, "commissionRate")).toBeCloseTo(0.05);
  });

  it("品类查询默认排除 Tier 4 和 BLACK TIER", () => {
    const query = resolveReportQuery("Electronics", { language: "zh", categories: ["Electronics"] });
    const result = buildEntityReport(query, parityOffers, {}, "zh");

    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001", "1003"]);
  });

  it("未知商户不应退化为销售额 Top 50", () => {
    const query = resolveReportQuery("Unknown Brand", { language: "en", categories: [] });
    const result = buildEntityReport(query, parityOffers, {}, "en");

    expect(result.status).toBe("not_found");
    expect(result.rows).toEqual([]);
  });

  it("品类加 Tier 查询同时应用两个过滤条件", () => {
    const query = resolveReportQuery("/categorytier: Electronics Tier 2", {
      language: "zh",
      categories: ["Electronics"]
    });
    const result = buildEntityReport(query, parityOffers, {}, "zh");

    expect(result.rows.map((row) => row.merchantId)).toEqual(["1003"]);
  });

  it("关键词查询保留 Tier、指标筛选和排序条件", () => {
    const query = resolveReportQuery("headphones", {
      language: "en",
      categories: [],
      classification: {
        intent: "keyword",
        params: {
          keyword: "headphones",
          tier: ["Tier 2"],
          metricFilters: [{ field: "aov", operator: ">=", value: 100 }],
          metricSort: { field: "epc", direction: "desc" }
        }
      }
    });
    const result = buildEntityReport(query, parityOffers, {}, "en");

    expect(result.rows.map((row) => row.merchantId)).toEqual(["1003"]);
  });

  it("把宽泛 audio 关键词交给用户澄清，而不是扩大成全部电子产品", () => {
    const query = resolveReportQuery("/keyword: audio", { language: "en", categories: [] });
    const result = buildEntityReport(query, parityOffers, {}, "en");

    expect(result.status).toBe("needs_input");
    expect(result.note).toContain("headphones");
    expect(result.rows).toEqual([]);
  });
});
