import { describe, expect, it } from "vitest";
import { parityOffers } from "./fixtures/parityData";
import { buildRecommendationReport, compareRecommendationOffers, recommendationScore } from "./recommendationReports";
import { resolveReportQuery } from "./reportQuery";

describe("recommendationReports", () => {
  it("按旧版默认排序排除 Tier 4/BLACK TIER，并应用小数阈值", () => {
    const query = resolveReportQuery("推荐 Electronics，EPC >= 0.12，前 2 个", { language: "zh", categories: ["Electronics"] });
    const result = buildRecommendationReport(query, parityOffers, "zh");
    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001", "1003"]);
    expect(result.rows.every((row) => row.tier !== "Tier 4" && row.tier !== "BLACK TIER")).toBe(true);
  });

  it("支持每个 Tier 各取 N 个，并保留可解释推荐分", () => {
    const query = resolveReportQuery("每个 Tier 推荐 1 个", { language: "zh", categories: [] });
    const result = buildRecommendationReport({ ...query, tierOfferPlan: [{ tier: "Tier 1", count: 1 }, { tier: "Tier 2", count: 1 }] }, parityOffers, "zh");
    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001", "1002"]);
    expect(result.rows[0]).toHaveProperty("recommendationScore");
  });

  it("默认比较器与综合推荐分是两套规则", () => {
    expect(compareRecommendationOffers(parityOffers[0], parityOffers[1], {})).toBeLessThan(0);
    expect(recommendationScore(parityOffers[0], {})).toBeGreaterThan(recommendationScore(parityOffers[1], {}));
  });

  it("付款周期筛选返回 Offer 而不是付款记录", () => {
    const offers = parityOffers.map((row, index) => ({ ...row, paymentCycle: index === 0 ? 30 : 90 }));
    const query = resolveReportQuery("offers with payment cycle over 60 days", { language: "en", categories: [] });
    const result = buildRecommendationReport(query, offers, "en");

    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((row) => Number(row.paymentCycle) > 60)).toBe(true);
  });
});
