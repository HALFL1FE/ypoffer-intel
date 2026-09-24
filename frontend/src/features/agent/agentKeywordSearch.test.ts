import { describe, expect, it } from "vitest";

import { searchAgentKeywords } from "./agentKeywordSearch";

describe("searchAgentKeywords", () => {
  it("原词未命中时沿用 Report Mode 的候选词匹配并标记来源", () => {
    const result = searchAgentKeywords("mobilityscooter", "search", 10, [
      { merchantId: "1001", merchantName: "Scooter Shop", tier: "Tier 1", productTitles: ["scooter board"] }
    ], {}, "zh", false, ["mobility scooter", "scooter"]);

    expect(result.rows.map((row) => row.merchantId)).toEqual(["1001"]);
    expect(result).toMatchObject({ matchedKeyword: "scooter", matchType: "semantic" });
    expect(result.note).toContain("mobilityscooter");
  });
});
