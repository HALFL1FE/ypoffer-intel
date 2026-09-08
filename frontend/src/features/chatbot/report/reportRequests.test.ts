import { describe, expect, it } from "vitest";

import { buildClassifyBody } from "./reportRequests";

describe("report request budgets", () => {
  it("keeps the full prompt and stays within the classify byte budget", () => {
    const prompt = "电子产品，AOV 大于 100，推荐 2 个";
    const body = buildClassifyBody(prompt, Array.from({ length: 200 }, (_, index) => `Category ${index}`));

    expect(body).not.toBeNull();
    expect(new TextEncoder().encode(body!).byteLength).toBeLessThanOrEqual(2048);
    expect(JSON.parse(body!).prompt).toBe(prompt);
  });

  it("does not send a truncated oversized prompt", () => {
    expect(buildClassifyBody("长".repeat(3000), [])).toBeNull();
  });
});
