import { describe, expect, it } from "vitest";
import {
  comparison,
  historicalTop,
  reviewDays,
  targetSummary,
} from "./reviewModel";
import { emptyMetrics, windowDates, type MediaRow } from "./performanceModel";
const range = windowDates(
  "2026-09-07",
  "2026-09-09",
  "2026-09-14",
  "2026-09-01",
  "2026-09-04",
)!;
const metrics = (clicks: number, orders = 0) => ({
  ...emptyMetrics(),
  clicks,
  orders,
  revenue: 10,
});
const link = (asin: string, clicks: number, purchasedAsin = ""): MediaRow => ({
  merchantId: "101",
  publisherId: "7",
  publisherName: "Fixture",
  asin,
  purchasedAsin,
  linkType: asin ? "asin" : "storefront",
  before: metrics(0, purchasedAsin ? 2 : 0),
  after: metrics(clicks),
});
describe("offer review evidence", () => {
  it("uses observed days and suppresses incomplete changes", () => {
    expect(comparison(40, 60, range, "2026-09-14").rate).toBe(0);
    expect(comparison(40, 60, range, "2026-09-12").state).toBe("pending");
    expect(comparison(0, 60, range, "2026-09-14").state).toBe("new");
  });
  it("keeps gaps and pending days blank and negative revenue visible", () => {
    const values = reviewDays(
      [
        {
          merchantId: "101",
          before: metrics(1),
          after: metrics(1),
          monthly: [],
          daily: [{ date: "2026-09-10", ...metrics(1), revenue: -5 }],
        },
      ],
      range,
      "2026-09-12",
      "revenue",
    );
    expect(values.find((p) => p.date === "2026-09-07")).toMatchObject({
      period: "gap",
      value: null,
    });
    expect(values.find((p) => p.date === "2026-09-14")?.value).toBeNull();
    expect(values.find((p) => p.date === "2026-09-10")?.value).toBe(-5);
  });
  it("keeps all-click and product-click denominators distinct", () => {
    const result = targetSummary(
      {
        merchantId: "101",
        merchantName: "Fixture",
        category: "",
        asins: ["B012345678"],
      },
      [
        link("B012345678", 20),
        link("B098765432", 10),
        link("", 70),
        { ...link("B012345678", 999), merchantId: "1101" },
      ],
    );
    expect(result).toEqual({
      total: 100,
      productClicks: 30,
      hitClicks: 20,
      hitAsins: 1,
      targetCount: 1,
      actualAsins: 2,
    });
  });
  it("ranks historical purchased ASINs independently of promoted targets", () => {
    expect(
      historicalTop([link("B012345678", 20, "B098765432")], "101"),
    ).toEqual(["B098765432"]);
  });
});
