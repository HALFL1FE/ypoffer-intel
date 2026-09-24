import { describe, expect, it } from "vitest";

import { normalizeChatbotClassification } from "./chatbotClassification";

describe("normalizeChatbotClassification", () => {
  it("接收分类器的关键词意图和近似候选词", () => {
    expect(normalizeChatbotClassification({
      intent: "keyword",
      params: { keywordSearch: "mobilityscooter", semanticAlternatives: ["mobility scooter", "scooter"] }
    })).toMatchObject({ intent: "keyword", params: { keywordSearch: "mobilityscooter" } });
  });
});
