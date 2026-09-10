import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import DeepWindow from "./DeepWindow.vue";
import type { ChatbotReportViewResult } from "./chatbotViewTypes";
import {
  deepWindowReport,
  errorDeepWindow,
  loadingDeepWindow,
  readyDeepWindow
} from "./deepWindowTestFixtures";

const report: ChatbotReportViewResult = {
  intent: "merchant",
  status: "resolved",
  query: "Tapo",
  source: "db",
  rows: [],
  summary: { offerCount: 0, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
  message: "Tapo report"
};

const structuredMerchantReport = {
  ...deepWindowReport,
  title: "商户报告",
  documentId: "report-deep-merchant",
  rows: [{
    merchantId: "101",
    merchantName: "Alpha",
    tier: "Tier 1",
    category: "Beauty",
    network: "Levanta",
    allEpc: 0.42,
    epc: 0.3,
    aov: 100,
    conversionRate: 0.1,
    salesAmount: 1000,
    allCommission: 120,
    affCommission: 100,
    orders: 10,
    clicks: 100,
    dpv: 200,
    atc: 40,
    commissionRate: 0.1,
    paymentStatus: "Paid",
    linkStatus: "Active",
    cpc: "$0.20",
    dealInfo: "10% off",
    paidInvoiceMonths: ["2026-07"],
    recommendation: "Keep testing",
    products: [{ asin: "B000000001", productName: "Alpha headphones", category: "Beauty" }],
    monthly: [{ month: "2026-08", salesAmount: 1000, orders: 10, clicks: 100, affCommission: 100 }]
  }],
  request: {},
  sourceInfo: { kind: "db", asOf: "2026-09-08", partial: false, estimated: false, covered: 1, requested: 1 },
  blocks: [
    {
      id: "entity-summary",
      kind: "metrics",
      title: "结果汇总",
      rows: [{ offerCount: 1, clicks: 100, orders: 10, revenue: 1000, commission: 100, conversionRate: 0.1 }],
      columns: [{ key: "offerCount", label: "Results", format: "integer" }]
    },
    {
      id: "entity-results",
      kind: "table",
      title: "Merchant report",
      rows: [{
        merchantId: "101",
        merchantName: "Alpha",
        tier: "Tier 1",
        category: "Beauty",
        network: "Levanta",
        allEpc: 0.42,
        epc: 0.3,
        aov: 100,
        conversionRate: 0.1,
        salesAmount: 1000,
        allCommission: 120,
        affCommission: 100,
        orders: 10,
        clicks: 100,
        dpv: 200,
        atc: 40,
        commissionRate: 0.1,
        paymentStatus: "Paid",
        linkStatus: "Active",
        cpc: "$0.20",
        dealInfo: "10% off",
        paidInvoiceMonths: ["2026-07"],
        recommendation: "Keep testing",
        products: [{ asin: "B000000001", productName: "Alpha headphones", category: "Beauty" }],
        monthly: [{ month: "2026-08", salesAmount: 1000, orders: 10, clicks: 100, affCommission: 100 }]
      }],
      columns: [{ key: "merchantName", label: "Merchant", format: "text" }]
    },
    {
      id: "merchant-monthly",
      kind: "table",
      title: "Monthly metrics",
      rows: [{ month: "2026-08", salesAmount: 1000, orders: 10 }],
      columns: [{ key: "month", label: "Month", format: "text" }]
    }
  ],
  sheets: [],
  contentHtml: '<p data-report-narrative>Report narrative</p>',
  recommendationHtml: '<div class="download-card"><button type="button" data-download-id="memory-recommendation">Download recommendation Excel</button></div>'
} as unknown as ChatbotReportViewResult;

describe("DeepWindow", () => {
  it("renders the Legacy skeleton while a report is loading", () => {
    const wrapper = mount(DeepWindow, { props: loadingDeepWindow() });

    expect(wrapper.find(".deep-window").exists()).toBe(true);
    expect(wrapper.find(".deep-window-skeleton").exists()).toBe(true);
    expect(wrapper.findAll("[data-deep-window-step]")).toHaveLength(3);
    expect(wrapper.find('[data-deep-window-action="add-memory"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="stop"]').exists()).toBe(true);
  });

  it("keeps the Legacy Deep Window actions when content is ready", async () => {
    const wrapper = mount(DeepWindow, { props: readyDeepWindow() });

    expect(wrapper.find(".deep-report-title").exists()).toBe(true);
    expect(wrapper.find(".deep-report-summary").exists()).toBe(false);
    expect(wrapper.find(".deep-report-sections").exists()).toBe(true);
    expect(wrapper.find(".deep-window-feedback").exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="add-memory"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="export"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="minimize"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="close"]').exists()).toBe(true);
    expect(wrapper.find('[data-deep-window-action="pin"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="clone"]').exists()).toBe(false);
    expect(wrapper.find('[data-deep-window-action="overlay"]').exists()).toBe(false);
    expect(wrapper.get('[data-deep-window-action="export"]').text()).toBe("导出");
    expect(wrapper.get('[data-deep-window-header]').attributes("data-draggable")).toBe("true");

    await wrapper.get('[data-deep-window-action="export"]').trigger("click");
    await wrapper.get('[data-deep-window-action="add-memory"]').trigger("click");

    expect(wrapper.emitted("export")).toHaveLength(1);
    expect(wrapper.emitted("add-memory")).toHaveLength(1);
  });

  it("keeps structured data, narrative, and recommendation downloads in one legacy-style window", async () => {
    const wrapper = mount(DeepWindow, {
      props: readyDeepWindow({
        result: structuredMerchantReport,
        contentHtml: "",
        summary: "This summary is replaced by the full report data."
      })
    });

    expect(wrapper.find("[data-deep-quick-result]").exists()).toBe(true);
    expect(wrapper.find("[data-deep-context-overview]").exists()).toBe(true);
    expect(wrapper.find("[data-deep-merchant-overview]").exists()).toBe(true);
    expect(wrapper.findAll("[data-deep-context-stat]")).toHaveLength(18);
    expect(wrapper.find("[data-deep-context-stats]").text()).toContain("Levanta");
    expect(wrapper.find("[data-deep-context-stats]").text()).toContain("DPV");
    expect(wrapper.find("[data-merchant-month-picker]").exists()).toBe(true);
    expect(wrapper.find("[data-deep-context-products]").text()).toContain("Alpha headphones");
    expect(wrapper.find("[data-report-narrative]").text()).toBe("Report narrative");
    expect(wrapper.find('[data-download-id="memory-recommendation"]').exists()).toBe(true);
    expect(wrapper.find(".deep-report-summary").exists()).toBe(false);

    await wrapper.get('[data-download-id="memory-recommendation"]').trigger("click");
    expect(wrapper.emitted("download")).toEqual([["memory-recommendation"]]);
  });

  it("切换月份筛选后展示对应月份的商户指标", async () => {
    const monthlyReport = {
      ...structuredMerchantReport,
      rows: [{
        ...structuredMerchantReport.rows[0],
        monthly: [
          { month: "2026-07", revenue: 800, payout: 96, affiliatePayout: 80, aov: 100, epc: 1, affEpc: 1, allEpc: 1.2, conversionRate: 0.1, orders: 8, clicks: 80, dpv: 160, atc: 32 },
          { month: "2026-08", revenue: 1000, payout: 120, affiliatePayout: 100, aov: 100, epc: 1, affEpc: 1, allEpc: 1.2, conversionRate: 0.1, orders: 10, clicks: 100, dpv: 200, atc: 40 }
        ]
      }]
    } as unknown as ChatbotReportViewResult;
    const wrapper = mount(DeepWindow, {
      props: readyDeepWindow({ result: monthlyReport, contentHtml: "", recommendationHtml: "" })
    });

    const picker = wrapper.get("[data-merchant-month-picker]");
    expect(wrapper.findAll("[data-merchant-month-picker] option")).toHaveLength(2);
    expect((picker.element as HTMLSelectElement).value).toBe("2026-08");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("$1,000");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("$120");

    await picker.setValue("2026-07");

    expect((picker.element as HTMLSelectElement).value).toBe("2026-07");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("$800");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("$96");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("$80");
    expect(wrapper.get("[data-deep-context-stats]").text()).toContain("8");
  });

  it("renders the legacy category overview instead of only the generic result table", () => {
    const categoryReport = {
      ...structuredMerchantReport,
      intent: "category",
      category: "Beauty",
      title: "品类报告",
      rows: [
        { ...structuredMerchantReport.rows[0], merchantId: "101", merchantName: "Alpha", salesAmount: 1000, affCommission: 100, clicks: 100, orders: 10, epc: 1 },
        { ...structuredMerchantReport.rows[0], merchantId: "102", merchantName: "Beta", salesAmount: 500, affCommission: 40, clicks: 80, orders: 4, epc: 0.5, tier: "Tier 2" }
      ],
      blocks: [
        {
          id: "entity-results",
          kind: "table",
          title: "品类报告",
          rows: [],
          columns: []
        }
      ]
    } as unknown as ChatbotReportViewResult;
    const wrapper = mount(DeepWindow, {
      props: readyDeepWindow({ result: categoryReport, contentHtml: "", recommendationHtml: "" })
    });

    expect(wrapper.find("[data-deep-category-overview]").exists()).toBe(true);
    expect(wrapper.findAll("[data-deep-category-stat]")).toHaveLength(6);
    expect(wrapper.find("[data-deep-category-overview]").text()).toContain("Beauty");
    expect(wrapper.find("[data-deep-category-mini-table]").exists()).toBe(true);
    expect(wrapper.find("[data-deep-category-insights]").exists()).toBe(true);
  });

  it("保留旧版 ASIN 概览中的产品字段和商户级性能说明", () => {
    const asinReport = {
      ...structuredMerchantReport,
      intent: "asin",
      title: "ASIN 查询",
      rows: [{
        ...structuredMerchantReport.rows[0],
        asin: "B000000001",
        productName: "Alpha headphones",
        productUrl: "https://example.com/alpha",
        dealPrice: 79.99,
        originalPrice: 99.99,
        discountPercent: 20
      }],
      blocks: []
    } as unknown as ChatbotReportViewResult;
    const wrapper = mount(DeepWindow, {
      props: readyDeepWindow({ result: asinReport, contentHtml: "", recommendationHtml: "" })
    });

    const text = wrapper.find("[data-deep-merchant-overview]").text();
    expect(text).toContain("B000000001");
    expect(text).toContain("Alpha headphones");
    expect(text).toContain("https://example.com/alpha");
    expect(text).toContain("$79.99");
    expect(text).toContain("20%");
    expect(text).toContain("ASIN 级表现不可用");
  });

  it("restores a minimized window when its header is clicked without moving it", async () => {
    const wrapper = mount(DeepWindow, {
      props: { language: "en", result: deepWindowReport, minimized: true }
    });

    await wrapper.get("[data-deep-window-header]").trigger("pointerdown", {
      button: 0,
      clientX: 120,
      clientY: 80
    });
    window.dispatchEvent(new Event("pointerup"));

    expect(wrapper.emitted("restore")).toHaveLength(1);
  });

  it("shows the error card and keeps the panel closable", () => {
    const wrapper = mount(DeepWindow, { props: errorDeepWindow() });
    expect(wrapper.find(".deep-window-error").text()).toContain("error");
    expect(wrapper.find('[data-deep-window-action="close"]').exists()).toBe(true);
  });

  it("delegates rich trend-chart controls through explicit events", async () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: {
          ...deepWindowReport,
          contentHtml: `<div class="trend-context-wrap">
            <button type="button" data-trend-metric="revenue">Revenue</button>
            <label><input type="checkbox" value="orders" data-trend-column-check></label>
            <label><input type="checkbox" value="revenue" data-trend-column-check></label>
          </div>`
        },
        minimized: false
      }
    });

    await wrapper.get('[data-trend-metric="revenue"]').trigger("click");
    const checkbox = wrapper.get('[data-trend-column-check][value="orders"]');
    await checkbox.setValue(true);

    expect(wrapper.emitted("trend-interact")).toEqual([["trend-metric", "revenue"]]);
    expect(wrapper.emitted("trend-columns")).toEqual([[['orders']]]);
  });

  it("keeps the column picker usable inside the Vue-owned window", async () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: {
          ...deepWindowReport,
          contentHtml: `<div class="trend-context-wrap">
            <button type="button" data-trend-column-toggle aria-expanded="false">Display</button>
            <div class="trend-column-picker hidden" data-trend-column-panel>
              <button type="button" data-trend-column-core>Default</button>
              <button type="button" data-trend-column-all>All</button>
              <input type="checkbox" value="revenue" data-trend-column-check checked>
              <input type="checkbox" value="orders" data-trend-column-check>
              <input type="checkbox" value="directSales" data-trend-column-check>
            </div>
          </div>`
        },
        minimized: false
      }
    });

    const toggle = wrapper.get("[data-trend-column-toggle]");
    await toggle.trigger("click");
    expect(wrapper.get("[data-trend-column-panel]").classes()).not.toContain("hidden");
    expect(toggle.attributes("aria-expanded")).toBe("true");

    await wrapper.get("[data-trend-column-core]").trigger("click");
    expect((wrapper.get('[data-trend-column-check][value="revenue"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.get('[data-trend-column-check][value="orders"]').element as HTMLInputElement).checked).toBe(true);
    expect((wrapper.get('[data-trend-column-check][value="directSales"]').element as HTMLInputElement).checked).toBe(false);

    await wrapper.get("[data-trend-column-all]").trigger("click");
    expect(wrapper.findAll('[data-trend-column-check]:checked')).toHaveLength(3);
    expect(wrapper.emitted("trend-interact")).toEqual([
      ["trend-column-toggle"],
      ["trend-column-core"],
      ["trend-column-all"]
    ]);
  });

  it("emits a memory-drop action when a panel ends over the memory bar", async () => {
    const memoryBar = document.createElement("div");
    memoryBar.setAttribute("data-chatbot-memory-bar", "true");
    document.body.appendChild(memoryBar);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(memoryBar);
    const wrapper = mount(DeepWindow, {
      props: { language: "en", result: deepWindowReport, minimized: true }
    });

    await wrapper.get('[data-deep-window-header]').trigger("pointerdown", { button: 0, clientX: 10, clientY: 10 });
    window.dispatchEvent(new Event("pointerup"));

    expect(wrapper.emitted("drop-memory")).toHaveLength(1);
    memoryBar.remove();
    vi.restoreAllMocks();
  });

  it("reflects the legacy memory action state", () => {
    const wrapper = mount(DeepWindow, {
      props: {
        language: "en",
        result: deepWindowReport,
        minimized: false,
        canAddMemory: false,
        addedToMemory: true
      }
    });

    const button = wrapper.get('[data-deep-window-action="add-memory"]');
    expect(button.attributes("disabled")).toBeDefined();
    expect(button.text()).toContain("Added");
  });
});
