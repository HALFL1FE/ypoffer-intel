import { afterEach, describe, expect, it, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import OfferReviewWorkspace from "./OfferReviewWorkspace.vue";
import DatePicker from "../../shared/components/DatePicker.vue";
import { windowDates } from "./performanceModel";
import type { ReviewBatch, ReviewReport } from "./reviewModel";

const metrics = (clicks: number) => ({
  clicks,
  revenue: clicks * 2,
  orders: clicks,
  dpv: 0,
  atc: 0,
  commission: 0,
});
const offer = {
  merchantId: "101",
  merchantName: "Fixture Merchant",
  category: "Home",
  asins: ["B012345678"],
  priority: "High",
  referenceAov: 120,
  importCount: 1,
  listCount: 1,
  history: [
    {
      id: "fixture",
      name: "Fixture",
      listDate: "2026-09-07",
      importedAt: "2026-09-18T00:00:00Z",
      importedBy: "fixture",
    },
  ],
};
const batch: ReviewBatch = {
  id: "fixture",
  name: "Fixture",
  sourceFile: "fixture.xlsx",
  launchDate: "2026-09-07",
  listDate: "2026-09-07",
  logicalId: "fixture",
  importedAt: null,
  importedBy: null,
  offers: [offer],
};
const fixture: ReviewReport = {
  ok: true,
  currency: "USD",
  recommendationDate: "2026-09-07",
  excludedBatchIds: [],
  offers: [offer],
  dateRange: windowDates("2026-09-07", "2026-09-07", "2026-09-20")!,
  availableThrough: "2026-09-20",
  generatedAt: "2026-09-21",
  clickSource: "fixture",
  supported: {
    clicks: true,
    revenue: true,
    orders: true,
    dpv: true,
    atc: true,
    commission: true,
  },
  merchants: [
    {
      merchantId: "101",
      before: metrics(28),
      after: metrics(14),
      monthly: [],
      daily: [{ date: "2026-09-07", ...metrics(14) }],
    },
  ],
  media: [
    {
      merchantId: "101",
      publisherId: "7",
      publisherName: "Fixture Media",
      before: metrics(28),
      after: metrics(14),
      asin: "",
      purchasedAsin: "",
      linkType: "unknown",
    },
  ],
  links: [
    {
      merchantId: "101",
      publisherId: "7",
      publisherName: "Fixture Media",
      before: metrics(28),
      after: metrics(14),
      asin: "B012345678",
      purchasedAsin: "",
      linkType: "asin",
    },
  ],
};
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => {
  wrappers.forEach((w) => w.unmount());
  wrappers.length = 0;
});
async function setup() {
  const loader = vi.fn().mockResolvedValue(fixture),
    download = vi.fn();
  const wrapper = mount(OfferReviewWorkspace, {
    props: {
      language: "zh",
      catalogLoader: async () => ({ batches: [batch] }),
      reportLoader: loader,
      download,
    },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return { wrapper, loader, download };
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  return wrapper.findAll("button").find((b) => b.text() === text)!;
}
describe("review workspace interactions", () => {
  it("applies full window parameters and marks unapplied date edits", async () => {
    const { wrapper, loader } = await setup();
    await button(wrapper, "应用清单与时间").trigger("click");
    await flushPromises();
    expect(loader.mock.calls[0]![0]).toMatchObject({
      batchIds: ["fixture"],
      launchDate: "2026-09-07",
      beforeEnd: "2026-09-06",
      startDate: "2026-09-07",
      endDate: "2026-09-20",
    });
    expect(wrapper.text()).toContain("所有日期的变化");
    wrapper
      .findAllComponents(DatePicker)[4]!
      .vm.$emit("update:modelValue", "2026-09-21");
    await flushPromises();
    expect(wrapper.text()).toContain("下方仍显示上次应用的结果");
    expect(loader).toHaveBeenCalledTimes(1);
  });
  it("exports full media and ASIN evidence and opens a merchant drawer", async () => {
    const { wrapper, loader, download } = await setup();
    await button(wrapper, "应用清单与时间").trigger("click");
    await flushPromises();
    await button(wrapper, "导出筛选范围完整明细").trigger("click");
    const records = download.mock.calls[0]![0];
    expect(
      new Set(records.map((r: Record<string, unknown>) => r.RecordType)),
    ).toEqual(
      new Set(["merchant", "media", "target", "import-history", "daily"]),
    );
    await button(wrapper, "Fixture Merchant").trigger("click");
    await flushPromises();
    expect(loader.mock.calls[1]![0].merchantId).toBe("101");
    expect(wrapper.find("dialog").attributes("open")).toBeDefined();
    expect(wrapper.find("dialog").text()).toContain("产品表目标");
    await button(wrapper, "关闭").trigger("click");
    expect(wrapper.find("dialog").attributes("open")).toBeUndefined();
  });
});
