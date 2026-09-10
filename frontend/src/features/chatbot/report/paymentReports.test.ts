import { describe, expect, it } from "vitest";
import { parityOffers, parityPaymentRecords } from "./fixtures/parityData";
import { buildPaymentReport } from "./paymentReports";
import { resolveReportQuery } from "./reportQuery";

describe("paymentReports", () => {
  it("按状态、Tier 和月份筛选，并保留付款专用字段", () => {
    const query = resolveReportQuery("Tier 2 未付款 2026-08", { language: "zh", categories: [] });
    const result = buildPaymentReport(query, parityPaymentRecords, parityOffers, "zh", new Date("2026-09-08T00:00:00Z"));
    expect(result.rows.map((row) => row.merchantId)).toEqual(["1003"]);
    const unpaid = buildPaymentReport(resolveReportQuery("Tier 1 未付款 2026-08", { language: "zh", categories: [] }), parityPaymentRecords, parityOffers, "zh", new Date("2026-09-08T00:00:00Z"));
    expect(unpaid.rows.map((row) => row.merchantId)).toEqual(["1001"]);
    expect(unpaid.rows[0]).toMatchObject({ paymentStatus: "Unpaid", paymentCycle: 30, remainingAmount: 250 });
  });

  it("payment 命令把商户目标与付款状态一起解析", () => {
    const query = resolveReportQuery("payment: Alpha Audio 未付款", {
      language: "en",
      categories: [],
      merchantCandidates: [{ id: "1001", name: "Alpha Audio" }]
    });
    const result = buildPaymentReport(query, parityPaymentRecords, parityOffers, "en", new Date("2026-09-08T00:00:00Z"));

    expect(query).toMatchObject({ intent: "payment", paymentStatus: "Unpaid", merchantIds: ["1001"] });
    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001"]);
  });

  it("支持付款周期比较且 Unknown 不会被默认为 Unpaid", () => {
    const records = [...parityPaymentRecords, { merchantId: "1003", merchantName: "Gamma Audio", paymentStatus: "Unknown", paymentCycle: 90, revenueMade: 10, commissionMade: 1 }];
    const query = resolveReportQuery("payment cycle >= 60", { language: "en", categories: [] });
    const result = buildPaymentReport(query, records, parityOffers, "en", new Date("2026-09-08T00:00:00Z"));
    expect(result.rows.map((row) => row.merchantId)).toEqual(expect.arrayContaining(["1002", "1003"]));
    expect(result.rows).toHaveLength(2);
    expect(result.rows.find((row) => row.merchantId === "1003")?.paymentStatus).toBe("Unknown");
  });
});
