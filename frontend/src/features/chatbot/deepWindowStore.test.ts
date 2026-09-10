import { describe, expect, it, vi } from "vitest";

import { createDeepWindowStore, type DeepWindowStore } from "./deepWindowStore";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";

const result = (query: string): ChatbotReportViewResult => ({
  intent: "merchant",
  status: "resolved",
  query,
  source: "cache",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: `${query} report`
});

function store(): DeepWindowStore {
  return createDeepWindowStore();
}

describe("createDeepWindowStore", () => {
  it("keeps the active window and follows the Legacy Deep Window lifecycle", () => {
    const windows = store();
    const first = windows.open(result("Tapo"));
    const second = windows.open(result("Shokz"));

    windows.pin(first);
    windows.move(first, 48, 72);
    windows.minimize(first);
    expect(windows.getState().windows.find((item) => item.id === first)).toMatchObject({
      mode: "report",
      title: "Tapo report",
      summary: "Tapo report",
      pinned: true,
      minimized: true,
      position: { x: Math.max(0, window.innerWidth - 220 - 24), y: Math.max(0, window.innerHeight - 48 - 24) },
      restorePosition: { x: 48, y: 72 },
      hidden: false,
      canExport: true,
      canMinimize: true,
      canClose: true
    });

    windows.restore(first);
    windows.activate(first);
    expect(windows.getState().activeId).toBe(first);
    expect(windows.getState().windows.find((item) => item.id === first)).toMatchObject({
      minimized: false,
      position: { x: 48, y: 72 }
    });
    expect(windows.getState().windows.find((item) => item.id === first)).not.toHaveProperty("restorePosition");
    expect(windows.clone(first)).not.toBeNull();
    expect(windows.getState().windows).toHaveLength(3);
    expect(windows.toggleOverlay(first)).toBe(true);
    expect(windows.export(first)?.query).toBe("Tapo");
    expect(windows.cancel(first)).toBe(false);
    expect(windows.getState().windows.find((item) => item.id === first)?.status).toBe("ready");

    windows.close(second);
    expect(windows.getState().windows.find((item) => item.id === second)).toMatchObject({ hidden: true });
    windows.activate(second);
    expect(windows.getState().windows.find((item) => item.id === second)?.hidden).toBe(false);
  });

  it("notifies subscribers and routes memory drops without exposing raw internals", () => {
    const onAddToChat = vi.fn(() => true);
    const windows = createDeepWindowStore({ onAddToChat });
    const listener = vi.fn();
    const unsubscribe = windows.onChange(listener);
    const id = windows.open(result("Tapo"));

    expect(listener).toHaveBeenCalled();
    expect(windows.addToChat(id)).toBe(true);
    expect(onAddToChat).toHaveBeenCalledWith(expect.objectContaining({ id, result: expect.any(Object) }));
    expect(windows.getState().windows.find((item) => item.id === id)?.addedToMemory).toBe(true);

    unsubscribe();
    windows.close(id);
    expect(windows.getState().windows).toHaveLength(1);
    expect(windows.getState().windows.find((item) => item.id === id)?.hidden).toBe(true);
    windows.activate(id);
    expect(windows.getState().windows.find((item) => item.id === id)?.hidden).toBe(false);
  });

  it("aborts and removes only the selected loading window", () => {
    const controller = new AbortController();
    const windows = createDeepWindowStore({ signal: controller.signal });
    const id = windows.open(result("Tapo"), { status: "loading" });
    const sibling = windows.open(result("Shokz"), { status: "loading" });

    expect(windows.cancel(id)).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === id)).toBeUndefined();
    expect(windows.getState().windows.find((item) => item.id === sibling)).toBeDefined();
    controller.abort();
    expect(windows.getState().windows.find((item) => item.id === sibling)?.status).toBe("cancelled");
  });

  it("按报告阶段推进骨架步骤并保留已完成状态", () => {
    const windows = store();
    const id = windows.open(result("Tapo"), {
      status: "loading",
      skeletonSteps: [
        { id: "understand", label: "理解问题", state: "active" },
        { id: "query", label: "查询数据", state: "pending" },
        { id: "report", label: "生成报告", state: "pending" }
      ]
    });

    expect(windows.updateSkeleton(id, 2)).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === id)?.skeletonSteps?.map((step) => step.state))
      .toEqual(["done", "active", "pending"]);

    expect(windows.updateSkeleton(id, 3)).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === id)?.skeletonSteps?.map((step) => step.state))
      .toEqual(["done", "done", "active"]);
  });

  it("applies trend metric, category, and column controls instead of treating them as no-ops", () => {
    const windows = store();
    const id = windows.open(result("Trend"));

    expect(windows.interact(id, "trend-metric", "revenue")).toBe(true);
    expect(windows.interact(id, "trend-category", "Electronics")).toBe(true);
    expect(windows.interact(id, "trend-column-toggle")).toBe(true);
    expect(windows.interact(id, "trend-column-core")).toBe(true);
    const current = windows.getState().windows.find((item) => item.id === id);
    expect(current).toMatchObject({
      trendMetric: "revenue",
      trendCategory: "Electronics",
      trendColumnsOpen: true,
      trendColumns: ["revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate"]
    });

    expect(windows.interact(id, "trend-column-all")).toBe(true);
    expect(windows.getState().windows.find((item) => item.id === id)?.trendColumns).toEqual([
      "revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate",
      "payout", "directSales", "haloSales"
    ]);
    expect(windows.interact(id, "trend-metric", "")).toBe(false);
    expect(windows.interact(id, "trend-category", "")).toBe(false);
  });
});
