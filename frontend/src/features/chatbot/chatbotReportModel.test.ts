import { describe, expect, it } from "vitest";

import {
  buildChatbotReport,
  summarizeChatbotOffers,
  type ChatbotReportData
} from "./chatbotReportModel";

const data: ChatbotReportData = {
  offers: [
    {
      merchantId: "398679",
      merchantName: "Tapo",
      brand: "Tapo",
      tier: "Tier 1",
      category: "Electronics",
      topAsins: ["B0TEST123"],
      clicks: 100,
      orders: 12,
      salesAmount: 1200,
      affCommission: 120
    },
    {
      merchantId: "398680",
      merchantName: "Home Lamp",
      brand: "Home Lamp",
      tier: "Tier 2",
      category: "Home",
      clicks: 50,
      orders: 5,
      salesAmount: 500,
      affCommission: 50
    },
    {
      merchantId: "398681",
      merchantName: "Black Audio",
      brand: "Black Audio",
      tier: "BLACK TIER",
      category: "Electronics",
      clicks: 20,
      orders: 1,
      salesAmount: 100,
      affCommission: 10
    }
  ]
};

describe("chatbotReportModel", () => {
  it("preserves multiple classified categories and tiers", () => {
    const result = buildChatbotReport("Show both groups", data, "en", {
      intent: "category", params: { category: ["Electronics", "Home"], tier: ["Tier 1", "Tier 2"] }
    });
    expect(result.intent).toBe("category");
    expect(result.rows.map((row) => row.merchantId)).toEqual(["398679", "398680"]);
  });

  it("applies classified recommendation filters, sorting, and count", () => {
    const result = buildChatbotReport("Pick an offer", data, "en", {
      intent: "recommendation", params: {
        tier: ["Tier 1", "Tier 2"], count: 1,
        metricFilters: [{ field: "clicks", operator: ">=", value: 50 }],
        metricSort: { field: "salesAmount", direction: "asc" }
      }
    });
    expect(result.rows.map((row) => row.merchantId)).toEqual(["398680"]);
  });

  it("uses the classified ASIN rather than the original wording", () => {
    expect(buildChatbotReport("Find the product", data, "en", {
      intent: "asin", params: { asin: "B0TEST123" }
    }).rows).toEqual([data.offers[0]]);
  });

  it("summarizes numeric offer metrics without mutating source rows", () => {
    expect(summarizeChatbotOffers(data.offers)).toEqual({
      offerCount: 3,
      clicks: 170,
      orders: 18,
      revenue: 1800,
      commission: 180,
      conversionRate: 18 / 170
    });
  });

  it("builds a resolved merchant report with an ID-first result", () => {
    const result = buildChatbotReport("Tapo ID398679", data, "zh");

    expect(result).toMatchObject({
      intent: "merchant",
      status: "resolved",
      rows: [data.offers[0]],
      summary: {
        offerCount: 1,
        clicks: 100,
        orders: 12,
        revenue: 1200,
        commission: 120
      }
    });
    expect(result.message).toContain("Tapo");
  });

  it("builds category and tier reports from known cached data", () => {
    const category = buildChatbotReport("Electronics", data, "en");
    expect(category.intent).toBe("category");
    expect(category.rows.map((row) => row.merchantId)).toEqual(["398679"]);

    const tier = buildChatbotReport("Tier 1", data, "en");
    expect(tier.intent).toBe("tier");
    expect(tier.rows.map((row) => row.merchantId)).toEqual(["398679"]);
  });

  it("returns an explicit no-data result instead of inventing a row", () => {
    const result = buildChatbotReport("Unknown merchant", data, "en");

    expect(result.status).toBe("not_found");
    expect(result.rows).toEqual([]);
    expect(result.summary.offerCount).toBe(0);
    expect(result.message).toContain("No matching");
  });

  it("resolves ASIN searches from the cached offer rows", () => {
    const result = buildChatbotReport("ASIN B0TEST123", data, "en");

    expect(result.intent).toBe("asin");
    expect(result.status).toBe("resolved");
    expect(result.rows.map((row) => row.merchantId)).toEqual(["398679"]);
  });

  it("marks live analysis and payment questions as deferred instead of fabricating metrics", () => {
    const result = buildChatbotReport("show payment status", data, "en");

    expect(result.status).toBe("deferred");
    expect(result.rows).toEqual([]);
    expect(result.message).toContain("Chat Mode");
  });
});
