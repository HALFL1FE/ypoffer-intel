import { describe, expect, it } from "vitest";
import { parityPublishers } from "./fixtures/parityData";
import { buildPublisherProfileReport, buildPublisherRecordsReport } from "./publisherReports";
import { resolveReportQuery } from "./reportQuery";

describe("publisherReports", () => {
  it("空过滤的 Publisher Records 默认按 clicks 降序并按全量过滤结果汇总", () => {
    const query = resolveReportQuery("publisher", { language: "en", categories: [] });
    const result = buildPublisherRecordsReport(query, parityPublishers, "en");
    expect(result.rows.map((row) => row.userId)).toEqual(["p-1", "p-2"]);
    expect(result.summary.clicks).toBe(1500);
    expect(result.summary.publisherCount).toBe(2);
  });

  it("HTTP 200 但 ok=false 时保持不可用，不伪装成空结果", () => {
    const query = resolveReportQuery("publisher", { language: "en", categories: [] });
    expect(buildPublisherRecordsReport(query, { ok: false, error: "upstream unavailable" }, "en").status).toBe("unavailable");
  });

  it("Publisher Profile 对唯一媒体返回 portfolio 与 KPI", () => {
    const query = resolveReportQuery("publisherprofile: Media One", { language: "en", categories: [] });
    const result = buildPublisherProfileReport(query, parityPublishers, {
      publisher: { userId: "p-1", userName: "Media One" },
      merchants: [{ merchantId: "1001", merchantName: "Alpha Audio", category: "Electronics", tier: "Tier 1", network: "Levanta", total: { clicks: 100, orders: 4, sales: 400, allCommission: 40 } }]
    }, "en");
    expect(result.status).toBe("resolved");
    expect(result.rows[0]).toMatchObject({ merchantId: "1001", merchantName: "Alpha Audio" });
    expect(result.summary.sales).toBe(400);
  });

  it("媒体画像组合商户市场和销售份额字段", () => {
    const query = resolveReportQuery("publisherprofile: Media One", { language: "en", categories: [] });
    const result = buildPublisherProfileReport(query, parityPublishers, {
      publisher: { userId: "p-1", userName: "Media One" },
      merchants: [
        {
          merchantId: "1001",
          merchantName: "Alpha Audio",
          category: "Electronics",
          tier: "Tier 1",
          network: "Levanta",
          markets: { "amazon.com": { sales: 400, clicks: 100, orders: 4 } },
          total: { sales: 400, clicks: 100, orders: 4 }
        }
      ]
    }, "en");

    expect(result.rows[0]).toMatchObject({ market: "amazon.com", salesShare: 1 });
    expect((result.summary.categories as readonly unknown[]).length).toBeGreaterThan(0);
    expect((result.summary.aovBands as readonly unknown[]).length).toBeGreaterThan(0);
    expect((result.summary.markets as readonly unknown[]).length).toBeGreaterThan(0);
  });
});
