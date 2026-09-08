import { describe, expect, it } from "vitest";
import { parityOffers } from "./fixtures/parityData";
import { buildAnalysisReport } from "./analysisReports";
import { resolveReportQuery } from "./reportQuery";

describe("analysisReports", () => {
  it("使用确定性公式计算 EPC、AFF Comm% 和 AOV", () => {
    const query = resolveReportQuery("分析 Alpha Audio", { language: "zh", categories: [] });
    const result = buildAnalysisReport(query, parityOffers, "zh");
    expect(result.rows[0]).toMatchObject({ merchantId: "1001", epc: 0.25, commissionRate: 5, aov: 100 });
    expect(result.rows[0]).toHaveProperty("sampleGate");
  });

  it("EPC/CVR 需要 clicks>=100，低样本不生成百分位", () => {
    const rows = [
      ...parityOffers,
      { merchantId: "1006", brand: "Low Sample", tier: "Tier 1", mainCategory: "Electronics", clicks: 20, orders: 2, salesAmount: 200, affCommission: 20 }
    ];
    const result = buildAnalysisReport(resolveReportQuery("分析 Electronics", { language: "en", categories: ["Electronics"] }), rows, "en");
    const low = result.rows.find((row) => row.merchantId === "1006");
    expect(low?.percentileEpc).toBeNull();
    expect(low?.sampleGate).toContain("clicks");
  });

  it("单商户分析返回同品类同 Tier 的前三个 Peer", () => {
    const rows = [...parityOffers, { merchantId: "1006", brand: "Alpha Peer", tier: "Tier 1", mainCategory: "Electronics", clicks: 600, orders: 12, salesAmount: 1500, affCommission: 90 }];
    const result = buildAnalysisReport(resolveReportQuery("分析 Alpha Audio", { language: "en", categories: [] }), rows, "en");
    expect(result.peers.map((row) => row.merchantId)).toContain("1006");
    expect(result.peers.length).toBeLessThanOrEqual(3);
  });
});
