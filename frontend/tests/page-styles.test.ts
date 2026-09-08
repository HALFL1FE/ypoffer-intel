import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import TargetsPage from "../src/features/targets/TargetsPage.vue";
import ChatbotPage from "../src/features/chatbot/ChatbotPage.vue";

// Load the actual entry's CSS imports in production order. Component-only tests
// missed the loss of shared styles when the standalone entry replaced the old DOM.
const entry = readFileSync(resolve("src/entry.ts"), "utf8");
const css = [...entry.matchAll(/import\s+"(\.\/[^"\n]+\.css)";/g)]
  .map((match) => readFileSync(resolve("src", match[1]!), "utf8")).join("\n");

describe("Standalone page presentation", () => {
  let style: HTMLStyleElement;
  let host: HTMLDivElement;
  let unmount: (() => void) | undefined;
  beforeEach(() => {
    (window as unknown as { happyDOM: { setViewport(value: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 1600, height: 1000 });
    style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    document.body.dataset.dashTheme = "light";
    host = document.createElement("div");
    host.setAttribute("data-modern-root", "standalone");
    document.body.append(host);
  });
  afterEach(() => {
    unmount?.();
    host.remove();
    style.remove();
    delete document.body.dataset.dashTheme;
  });

  it("keeps report cards in a full-width KPI row and prevents black SVG fills", () => {
    const page = mount(TargetsPage, { attachTo: host, props: {
      language: "en", autoLoad: false,
      reportData: { sheets: [{ name: "Tier 1", rows: [{ "Merchant ID": "test", Revenue: 1000, Clicks: 100, "Order count": 10 }] }] }
    } });
    unmount = () => page.unmount();
    const summary = getComputedStyle(page.get(".tier-summary").element);
    expect(summary.display).toBe("grid");
    expect(summary.gridColumn).toBe("1 / -1");
    expect(getComputedStyle(page.get(".target-kpi-card").element).display).toBe("grid");
    expect(getComputedStyle(page.get(".trend-line").element).getPropertyValue("fill")).toBe("none");
    expect(getComputedStyle(page.get(".target-trend-tooltip").element).visibility).toBe("hidden");
  });

  it("styles chat panels, mode controls, and the report guide without an old body class", () => {
    const page = mount(ChatbotPage, { attachTo: host, props: { language: "en", offers: [], autoFocus: false } });
    unmount = () => page.unmount();
    expect(document.body.classList.contains("dashboard-mode")).toBe(false);
    expect(getComputedStyle(page.get(".chat-panel").element).display).toBe("grid");
    expect(getComputedStyle(page.get(".chat-mode-toggle").element).display).toBe("flex");
    expect(getComputedStyle(page.get(".report-mode-guide").element).display).toBe("flex");
    expect(getComputedStyle(page.get(".chat-input").element).display).toBe("grid");
    expect(parseFloat(getComputedStyle(page.element).minHeight)).toBe(0);
    expect(getComputedStyle(page.element).height).toBe("calc(100dvh - 48px)");
    expect(getComputedStyle(page.get(".insight-panel").element).borderRadius).not.toBe("");
  });

  it("stacks report filters and KPI cards on narrow screens", () => {
    (window as unknown as { happyDOM: { setViewport(value: { width: number; height: number }): void } }).happyDOM.setViewport({ width: 390, height: 844 });
    const page = mount(TargetsPage, { attachTo: host, props: {
      language: "zh", autoLoad: false,
      reportData: { sheets: [{ name: "Tier 1", rows: [{ "Merchant ID": "test", Revenue: 1000 }] }] }
    } });
    unmount = () => page.unmount();
    expect(getComputedStyle(page.element).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(getComputedStyle(page.get(".tier-summary").element).gridTemplateColumns).toBe("minmax(0, 1fr)");
    expect(getComputedStyle(page.get(".sheet-target-filters").element).gridColumn).toBe("1");
  });

  it("does not apply page panel styles outside the modern host", () => {
    const outside = document.createElement("section");
    outside.className = "chat-panel";
    document.body.append(outside);
    try {
      expect(getComputedStyle(outside).display).not.toBe("grid");
      expect(getComputedStyle(outside).borderRadius).toBe("");
    } finally { outside.remove(); }
  });
});
