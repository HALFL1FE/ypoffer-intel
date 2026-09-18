import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewReport } from "./reviewApi";
import { apiRequest } from "../../shared/api/client";
import { emptyMetrics, windowDates } from "./performanceModel";
vi.mock("../../shared/api/client", () => ({ apiRequest: vi.fn() }));
const request = {
  batchIds: ["fixture"],
  launchDate: "2026-09-07",
  startDate: "2026-09-07",
  endDate: "2026-09-14",
  beforeStart: "2026-08-30",
  beforeEnd: "2026-09-06",
};
const fixture = () => ({
  availableThrough: "2026-09-14",
  dateRange: windowDates("2026-09-07")!,
  merchants: [
    {
      merchantId: "101",
      before: { ...emptyMetrics(), clicks: 2 },
      after: { ...emptyMetrics(), clicks: 4 },
      daily: [{ date: "2026-09-07", clicks: 4 }],
    },
  ],
  media: [],
  links: [],
});
beforeEach(() => vi.mocked(apiRequest).mockReset());
describe("temporary review API", () => {
  it("splits summary and relations into independently bounded requests", async () => {
    vi.mocked(apiRequest).mockResolvedValue(fixture());
    const result = await reviewReport(request);
    expect(
      vi
        .mocked(apiRequest)
        .mock.calls.map((c) => JSON.parse(String(c[1]!.body)).part),
    ).toEqual(["summary", "relations"]);
    expect(result.merchants[0]!.daily).toHaveLength(1);
  });
  it("rejects inconsistent snapshots even when source dates match", async () => {
    const changed = fixture();
    changed.merchants[0]!.after.clicks = 5;
    vi.mocked(apiRequest)
      .mockResolvedValueOnce(fixture())
      .mockResolvedValueOnce(changed);
    await expect(reviewReport(request)).rejects.toThrow("totals changed");
  });
  it("uses a single query for merchant-level daily evidence", async () => {
    vi.mocked(apiRequest).mockResolvedValue(fixture());
    await reviewReport({ ...request, merchantId: "101" });
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });
});
