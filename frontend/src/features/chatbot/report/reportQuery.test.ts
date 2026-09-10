import { describe, expect, it } from "vitest";

import { resolveReportQuery } from "./reportQuery";

describe("resolveReportQuery", () => {
  it("uses explicit payment wording before a tier token", () => {
    const query = resolveReportQuery("Tier 2 未付款", { language: "zh", categories: ["Electronics"] });

    expect(query).toMatchObject({ intent: "payment", paymentStatus: "Unpaid", tiers: ["Tier 2"] });
  });

  it("maps classifier parameters into a complete recommendation query", () => {
    const query = resolveReportQuery("挑选符合条件的 offer", {
      language: "zh",
      categories: ["Electronics"],
      classification: {
        intent: "recommendation",
        params: {
          category: ["Electronics"],
          tier: ["Tier 1"],
          count: 2,
          metricFilters: [{ field: "aov", operator: ">=", value: 100 }],
          metricSort: { field: "salesAmount", direction: "desc" },
          includeTier4: false,
          includeBlack: false
        }
      }
    });

    expect(query.intent).toBe("recommendation");
    expect(query.categories).toEqual(["Electronics"]);
    expect(query.tiers).toEqual(["Tier 1"]);
    expect(query.count).toBe(2);
    expect(query.metricFilters[0]).toMatchObject({ field: "aov", operator: ">=", value: 100 });
    expect(query.metricSort).toEqual({ field: "salesAmount", direction: "desc" });
  });

  it("keeps publisher records and publisher profile distinct", () => {
    expect(resolveReportQuery("/publisher", { language: "zh", categories: [] }).intent).toBe("publisher");
    expect(resolveReportQuery("publisherprofile: Media One", { language: "zh", categories: [] })).toMatchObject({
      intent: "publisherprofile",
      publisherQuery: "Media One"
    });
  });

  it("把 merchant 命令的目标交给统一商户解析器", () => {
    const query = resolveReportQuery("merchant: shokz", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "362653", name: "Shokz Official" }]
    });

    expect(query).toMatchObject({ intent: "merchant", merchantIds: ["362653"] });
    expect(query.lookupText).toBeUndefined();
  });

  it("所有命令都只用前缀判断意图，并解析冒号后的参数", () => {
    const context = {
      language: "zh" as const,
      categories: ["Electronics"],
      merchantCandidates: [{ id: "362653", name: "Shokz Official" }]
    };

    expect(resolveReportQuery("payment: shokz 未付款", context)).toMatchObject({
      intent: "payment",
      paymentStatus: "Unpaid",
      merchantIds: ["362653"]
    });
    expect(resolveReportQuery("analysis: shokz", context)).toMatchObject({
      intent: "analysis",
      analysisType: "merchant",
      merchantIds: ["362653"]
    });
    expect(resolveReportQuery("trend: shokz", context)).toMatchObject({
      intent: "analysis",
      analysisType: "trend",
      merchantIds: ["362653"]
    });
    expect(resolveReportQuery("品类 + Tier: Electronics Tier 2", context)).toMatchObject({
      intent: "category",
      parsedBy: "command",
      categories: ["Electronics"],
      tiers: ["Tier 2"]
    });
    expect(resolveReportQuery("Category & Tier: Electronics Tier 2", {
      ...context,
      language: "en"
    })).toMatchObject({
      intent: "category",
      parsedBy: "command",
      categories: ["Electronics"],
      tiers: ["Tier 2"]
    });
    expect(resolveReportQuery("recommendation: Electronics 前 2 个", context)).toMatchObject({
      intent: "recommendation",
      categories: ["Electronics"],
      count: 2
    });
    expect(resolveReportQuery("keyword: headphones", context)).toMatchObject({ intent: "keyword", keyword: "headphones" });
    expect(resolveReportQuery("asin: B000000001", context)).toMatchObject({ intent: "asin", asins: ["B000000001"] });
    expect(resolveReportQuery("publisher: Germany ShareASale", context)).toMatchObject({
      intent: "publisher",
      publisherFilters: { market: "amazon.de", network: "ShareASale" }
    });
    expect(resolveReportQuery("help:", context)).toMatchObject({ intent: "help", parsedBy: "command" });
  });

  it("supports report follow-up using the previous unique merchant", () => {
    const query = resolveReportQuery("EPC 呢", {
      language: "zh",
      categories: [],
      previous: { intent: "merchant", merchantIds: ["1001"], merchantNames: ["Alpha Audio"] }
    });

    expect(query).toMatchObject({ intent: "merchant", merchantIds: ["1001"], analysisTargets: ["1001"] });
  });

  it("保留 CVR 和 AFF Comm% 的百分比单位", () => {
    const query = resolveReportQuery("CVR > 2%，AFF Comm% >= 5%", { language: "zh", categories: [] });

    expect(query.metricFilters).toEqual([
      { field: "conversionRate", operator: ">", value: 0.02 },
      { field: "commissionRate", operator: ">=", value: 0.05 }
    ]);
  });

  it("从分析问题中提取多个已知商户作为对比目标", () => {
    const query = resolveReportQuery("比较 Alpha Audio 和 Gamma Audio", {
      language: "zh",
      categories: ["Electronics"],
      merchantCandidates: [
        { id: "1001", name: "Alpha Audio" },
        { id: "1003", name: "Gamma Audio" }
      ]
    });

    expect(query).toMatchObject({ intent: "analysis", analysisType: "merchant", merchantIds: ["1001", "1003"] });
  });

  it("分析命令缺少目标时返回使用提示", () => {
    const query = resolveReportQuery("/analysis", { language: "zh", categories: [] });

    expect(query).toMatchObject({ intent: "analysis", resolution: "needs_input" });
    expect(query.issues.join(" ")).toContain("目标");
  });

  it("将 categorytier 命令解析为同时带品类和 Tier 过滤的品类报告", () => {
    const query = resolveReportQuery("/categorytier: Electronics Tier 2", {
      language: "zh",
      categories: ["Electronics"]
    });

    expect(query).toMatchObject({ intent: "category", categories: ["Electronics"], tiers: ["Tier 2"] });
  });

  it("付款查询会从候选商户名称解析稳定 merchantId", () => {
    const query = resolveReportQuery("Alpha Audio 未付款", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }]
    });

    expect(query).toMatchObject({ intent: "payment", paymentStatus: "Unpaid", merchantIds: ["1001"] });
  });

  it("后续排除和替换动作继承上一轮推荐条件并累积排除项", () => {
    const previous = resolveReportQuery("Tier 1 推荐 2 个", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }, { id: "1002", name: "Beta Home" }]
    });
    const query = resolveReportQuery("排除 Alpha Audio，换一个", {
      language: "zh",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }],
      previous: { request: previous } as never
    });

    expect(query).toMatchObject({ intent: "recommendation", count: 2, tiers: ["Tier 1"], excludeMerchantIds: ["1001"] });
    expect(query.replaceMerchantIds).toEqual(["1001"]);
  });

  it("识别自然语言 Top 指标排序", () => {
    const query = resolveReportQuery("Top 2 AOV offers", { language: "en", categories: [] });

    expect(query).toMatchObject({
      intent: "recommendation",
      count: 2,
      metricSort: { field: "aov", direction: "desc" }
    });
  });

  it("将付款周期 offer 查询路由到推荐候选池", () => {
    const query = resolveReportQuery("offers with payment cycle over 60 days", { language: "en", categories: [] });

    expect(query).toMatchObject({ intent: "recommendation", paymentCycleFilter: { operator: ">", days: 60 } });
  });

  it("解析媒体市场别名、动态网络和未识别词", () => {
    const query = resolveReportQuery("publishers in Germany ShareASale for Shokz", { language: "en", categories: [] });

    expect(query.publisherFilters).toMatchObject({ market: "amazon.de", network: "ShareASale", merchantQuery: "Shokz" });
    expect(query.publisherFilters.unrecognized).toEqual([]);

    const unknown = resolveReportQuery("publishers in UnknownNet", { language: "en", categories: [] });
    expect(unknown.publisherFilters.unrecognized).toContain("UnknownNet");
  });
});
