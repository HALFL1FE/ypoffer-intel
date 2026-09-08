import { describe, expect, it } from "vitest";
import { parityOffers } from "./fixtures/parityData";
import { buildRecommendationReport } from "./recommendationReports";
import { resolveReportQuery } from "./reportQuery";
import { createReportSnapshot, filterReportSnapshot, buildMemoryRecommendation } from "./reportSnapshots";

describe("reportSnapshots", () => {
  it("创建包含区块和工作表的固定快照，并可按商户过滤", () => {
    const query = resolveReportQuery("推荐 Electronics 前 2 个", { language: "zh", categories: ["Electronics"] });
    const recommendation = buildRecommendationReport(query, parityOffers, "zh");
    const document = {
      intent: "recommendation" as const,
      status: "resolved" as const,
      query: query.prompt,
      source: "cache" as const,
      rows: recommendation.rows.slice(0, 1),
      rankingOffers: parityOffers,
      summary: { offerCount: 2, clicks: 1500, orders: 60, revenue: 6200, commission: 310, conversionRate: 0.04 },
      message: "ok",
      documentId: "report-1",
      request: query,
      blocks: [],
      sheets: [{ name: "Recommendations", role: "detail" as const, rows: recommendation.rows, columns: [] }],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 2, requested: 2 }
    };
    const snapshot = createReportSnapshot(document);
    expect(snapshot.rows).toHaveLength(1);
    expect(snapshot.rankingOffers).toHaveLength(parityOffers.length);
    expect(filterReportSnapshot(snapshot, ["1001"]).rows.map((row) => row.merchantId)).toEqual(["1001"]);
  });

  it("从完整候选池推荐，而不是只从当前可见行推荐", () => {
    const query = resolveReportQuery("推荐 Electronics 前 2 个", { language: "zh", categories: ["Electronics"] });
    const candidates = Array.from({ length: 10 }, (_, index) => ({
      merchantId: `candidate-${index}`,
      merchantName: `Candidate ${index}`,
      category: "Electronics",
      tier: "Tier 1",
      clicks: 100 + index,
      orders: 10 + index,
      salesAmount: 1_000 + index * 100,
      affCommission: 100 + index * 10
    }));
    const visible = buildRecommendationReport(query, candidates, "zh").rows.slice(0, 1);
    const document = {
      intent: "recommendation" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: visible, rankingOffers: candidates, summary: { offerCount: 1, clicks: 100, orders: 10, revenue: 1000, commission: 100, conversionRate: 0.1 }, message: "ok",
      documentId: "report-candidates", request: query, blocks: [], sheets: [],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 10, requested: 10 }
    };
    const result = buildMemoryRecommendation("从报告记忆推荐 2 个", [createReportSnapshot(document)]);

    expect(result.status).toBe("ready");
    expect(result.matchedCount).toBe(2);
    expect(result.selectedMerchantIds).toHaveLength(2);
  });

  it("从单个记忆快照选择唯一商户并返回过滤后的工作表", () => {
    const query = resolveReportQuery("推荐 Electronics 前 2 个", { language: "zh", categories: ["Electronics"] });
    const recommendation = buildRecommendationReport(query, parityOffers, "zh");
    const document = {
      intent: "recommendation" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: recommendation.rows, summary: { offerCount: 2, clicks: 1500, orders: 60, revenue: 6200, commission: 310, conversionRate: 0.04 }, message: "ok",
      documentId: "report-2", request: query, blocks: [], sheets: [{ name: "Recommendations", role: "detail" as const, rows: recommendation.rows, columns: [] }],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 2, requested: 2 }
    };
    const result = buildMemoryRecommendation("从报告记忆推荐 1 个", [createReportSnapshot(document, recommendation.rows)]);
    expect(result.status).toBe("ready");
    expect(result.selectedMerchantIds).toHaveLength(1);
    expect(result.filteredSheets[0]?.rows).toHaveLength(1);
  });

  it("没有快照、多个候选快照和无可用行分别返回不可用、歧义和空结果", () => {
    expect(buildMemoryRecommendation("从报告记忆推荐 1 个", []).status).toBe("unavailable");
    const query = resolveReportQuery("推荐 Electronics 前 1 个", { language: "zh", categories: ["Electronics"] });
    const recommendation = buildRecommendationReport(query, parityOffers, "zh");
    const document = {
      intent: "recommendation" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: recommendation.rows, summary: { offerCount: 1, clicks: 1000, orders: 50, revenue: 5000, commission: 250, conversionRate: 0.05 }, message: "ok",
      documentId: "report-3", request: query, blocks: [], sheets: [],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 1, requested: 1 }
    };
    const snapshot = createReportSnapshot(document, recommendation.rows);
    expect(buildMemoryRecommendation("从报告记忆推荐 1 个", [snapshot, snapshot]).status).toBe("ambiguous");
    const emptyDocument = { ...document, documentId: "report-4", rows: [], sheets: [] };
    expect(buildMemoryRecommendation("从报告记忆推荐 1 个", [createReportSnapshot(emptyDocument)]).status).toBe("unavailable");
  });

  it("命中数量不足时保持 ready 并标记 partial，仍允许后续导出", () => {
    const query = resolveReportQuery("推荐 Electronics 前 2 个", { language: "zh", categories: ["Electronics"] });
    const document = {
      intent: "recommendation" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: [parityOffers[0]], rankingOffers: [parityOffers[0]], summary: { offerCount: 1, clicks: 100, orders: 10, revenue: 1000, commission: 100, conversionRate: 0.1 }, message: "ok",
      documentId: "report-partial", request: query, blocks: [], sheets: [],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 1, requested: 1 }
    };
    const result = buildMemoryRecommendation("从报告记忆推荐 5 个", [createReportSnapshot(document)]);

    expect(result.status).toBe("ready");
    expect(result.partial).toBe(true);
    expect(result.matchedCount).toBe(1);
  });

  it("快照深拷贝嵌套产品和月度数据，原报告更新不会污染 Memory", () => {
    const query = resolveReportQuery("Alpha Audio", { language: "zh", categories: [] });
    const nestedRow = { merchantId: "1001", products: [{ asin: "B000000001" }], monthly: [{ month: "2026-08", revenue: 100 }] };
    const document = {
      intent: "merchant" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: [nestedRow], summary: { offerCount: 1, clicks: 1, orders: 1, revenue: 100, commission: 1, conversionRate: 1 }, message: "ok",
      documentId: "report-5", request: query, blocks: [{ id: "rows", kind: "table" as const, title: "Rows", rows: [nestedRow], columns: [] }], sheets: [],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 1, requested: 1 }
    };
    const snapshot = createReportSnapshot(document);
    nestedRow.products[0]!.asin = "changed";
    nestedRow.monthly[0]!.revenue = 999;
    expect(snapshot.rows[0]?.products).toEqual([{ asin: "B000000001" }]);
    expect(snapshot.rows[0]?.monthly).toEqual([{ month: "2026-08", revenue: 100 }]);
  });

  it("过滤重复明细时重算 Category Summary，而不是保留原全量合计", () => {
    const query = resolveReportQuery("推荐 Electronics 前 2 个", { language: "zh", categories: ["Electronics"] });
    const duplicateRows = [parityOffers[0], parityOffers[0], parityOffers[1]];
    const document = {
      intent: "recommendation" as const, status: "resolved" as const, query: query.prompt, source: "cache" as const,
      rows: duplicateRows, summary: { offerCount: 3, clicks: 2300, orders: 70, revenue: 6600, commission: 330, conversionRate: 0.03 }, message: "ok",
      documentId: "report-summary", request: query, blocks: [], sheets: [
        { name: "Offers", role: "detail" as const, rows: duplicateRows, columns: [] },
        { name: "Category Summary", role: "category-summary" as const, rows: [
          { category: "Electronics", offerCount: 2, salesAmount: 10000 },
          { category: "Home & Kitchen", offerCount: 1, salesAmount: 1600 }
        ], columns: [
          { key: "category", label: "Category", format: "text" as const },
          { key: "offerCount", label: "Offers", format: "integer" as const },
          { key: "salesAmount", label: "Revenue", format: "money" as const }
        ] }
      ],
      sourceInfo: { kind: "cache" as const, asOf: null, estimated: false, partial: false, covered: 3, requested: 3 }
    };
    const filtered = filterReportSnapshot(createReportSnapshot(document), ["1001"]);
    const summary = filtered.sheets.find((sheet) => sheet.role === "category-summary");

    expect(filtered.sheets[0]?.rows).toHaveLength(2);
    expect(summary?.rows).toHaveLength(1);
    expect(summary?.rows[0]).toMatchObject({ category: "Electronics", offerCount: 2, salesAmount: 10000 });
  });
});
