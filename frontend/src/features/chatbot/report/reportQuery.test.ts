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
