import { describe, expect, it, vi } from "vitest";
import type { OfferRecord } from "../../shared/contracts/offer";
import { useOfferTracker } from "./useOfferTracker";

const defaultDateRange = { startDate: "2026-09-01", endDate: "2026-09-30" };
const offers = [{ merchantId: "1", category: "Beauty", salesAmount: 100 }];
const range = { startDate: "2026-06-01", endDate: "2026-09-30" };

describe("Offer Tracker loaded date ranges", () => {
  it("preserves incomplete date drafts and rejects invalid ranges before loading", async () => {
    const loadRange = vi.fn().mockResolvedValue(offers);
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    for (const startDate of ["2026-", "", "2026-02-30", "2026-10-01", "2025-01-01"]) {
      tracker.setDraftFilters({ ...tracker.draftFilters.value, startDate });
      expect(tracker.draftFilters.value.startDate).toBe(startDate);
      expect(await tracker.applyFilters()).toBe(false);
      expect(tracker.filters.value).toMatchObject(defaultDateRange);
      expect(tracker.sourceRows.value).toEqual(offers);
    }
    expect(loadRange).not.toHaveBeenCalled();
    tracker.setDraftFilters({ ...tracker.draftFilters.value, startDate: "2026-09-02" });
    expect(await tracker.applyFilters()).toBe(true);
    expect(loadRange).toHaveBeenCalledTimes(1);
    expect(tracker.error.value).toBe("");
  });

  it("applies ordinary filters without requesting already loaded dates", async () => {
    const loadRange = vi.fn().mockRejectedValue(new Error("offline"));
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, categories: ["Other"] });
    expect(await tracker.applyFilters()).toBe(true);
    expect(loadRange).not.toHaveBeenCalled();
    expect(tracker.filteredRows.value).toHaveLength(0);
    expect(tracker.error.value).toBe("");
  });

  it("requests changed dates once and reuses them for subsequent filters", async () => {
    const rangedOffers = [{ ...offers[0], salesAmount: 900 }];
    const loadRange = vi.fn().mockResolvedValue(rangedOffers);
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    expect(await tracker.applyFilters()).toBe(true);
    tracker.setDraftFilters({ ...tracker.filters.value, categories: ["Beauty"] });
    expect(await tracker.applyFilters()).toBe(true);
    expect(loadRange).toHaveBeenCalledTimes(1);
    expect(loadRange).toHaveBeenCalledWith(expect.objectContaining(range));
    expect(tracker.sourceRows.value).toEqual(rangedOffers);
    expect(await tracker.resetFilters()).toBe(true);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(loadRange).toHaveBeenCalledTimes(1);
  });

  it("retains the prior rows and applied dates after failure and allows retry", async () => {
    const rangedOffers = [{ ...offers[0], salesAmount: 900 }];
    const loadRange = vi.fn().mockRejectedValueOnce(new Error("query failed")).mockResolvedValueOnce(rangedOffers);
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    expect(await tracker.applyFilters()).toBe(false);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(await tracker.applyFilters()).toBe(true);
    expect(tracker.sourceRows.value).toEqual(rangedOffers);
    expect(tracker.error.value).toBe("");
  });

  it("ignores an older date response after the user resets", async () => {
    let finish!: (rows: readonly OfferRecord[]) => void;
    const loadRange = vi.fn(() => new Promise<readonly OfferRecord[]>((resolve) => { finish = resolve; }));
    const tracker = useOfferTracker({ offers, defaultDateRange, loadRange });
    tracker.setDraftFilters({ ...tracker.filters.value, ...range });
    const pending = tracker.applyFilters();
    expect(await tracker.resetFilters()).toBe(true);
    finish([{ merchantId: "old-request" }]);
    expect(await pending).toBe(false);
    expect(tracker.sourceRows.value).toEqual(offers);
    expect(tracker.filters.value).toMatchObject(defaultDateRange);
    expect(tracker.loading.value).toBe(false);
  });
});


describe("Offer Tracker channel scope", () => {
  it("paginates and selects within the active channel but exports the full filtered master", () => {
    const rows = Array.from({length: 60}, (_, i) => ({ merchantId: String(i), merchantName: `Brand ${i}`, category: 'Beauty', topAsins: ['B000000001'], affCommissionRate: 10, aov: 200, salesAmount: i < 30 ? 100 : 0 }));
    const tracker = useOfferTracker({ offers: rows, defaultDateRange });
    tracker.setTab('google');
    expect(tracker.filteredRows.value).toHaveLength(30);
    tracker.setPage(2);
    expect(tracker.pageRows.value).toHaveLength(5);
    tracker.toggleCurrentPage(true);
    expect(tracker.exportRows(true)).toHaveLength(5);
    expect(tracker.exportRows(false)).toHaveLength(60);
    tracker.setTab('deals');
    expect(tracker.page.value).toBe(1);
    expect(tracker.pageRows.value).toHaveLength(0);
    expect(tracker.exportRows(true)).toHaveLength(0);
    expect(tracker.exportRows(false)).toHaveLength(60);
    tracker.setTab('google');
    tracker.toggleAllFiltered();
    expect(tracker.exportRows(true)).toHaveLength(30);
    tracker.setSearch('Brand 29');
    expect(tracker.exportRows(false)).toHaveLength(1);
  });
});
