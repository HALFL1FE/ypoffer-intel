import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotTrendReport from "./ChatbotTrendReport.vue";

describe("ChatbotTrendReport", () => {
  it("显示 SVG、可见列和真实交互事件", async () => {
    const wrapper = mount(ChatbotTrendReport, {
      props: {
        language: "zh",
        block: {
          id: "trend",
          kind: "trend",
          title: "月度趋势",
          metric: "revenue",
          categoryOptions: ["Electronics"],
          activeCategory: null,
          visibleColumns: ["month", "value", "deltaPct"],
          rows: [
            { month: "2026-07", value: 100, deltaPct: null },
            { month: "2026-08", value: 120, deltaPct: 0.2 }
          ],
          columns: [
            { key: "month", label: "月份", format: "text" },
            { key: "value", label: "指标值", format: "money" },
            { key: "deltaPct", label: "环比", format: "percentage" }
          ]
        }
      }
    });

    expect(wrapper.find("svg").exists()).toBe(true);
    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.find("[data-trend-summary]").exists()).toBe(true);
    expect(wrapper.findAll("[data-trend-summary-card]")).toHaveLength(1);
    expect(wrapper.find("[data-trend-summary-card]").text()).toContain("+20.0%");
    expect(wrapper.text()).toContain("不可用");
    expect(wrapper.text()).toContain("20.00%");

    await wrapper.get("[data-trend-metric-select]").setValue("epc");
    expect(wrapper.emitted("interact")?.at(-1)).toEqual(["trend-metric", "epc"]);
    await wrapper.get("[data-trend-category-select]").setValue("Electronics");
    expect(wrapper.emitted("interact")?.at(-1)).toEqual(["trend-category", "Electronics"]);
  });

  it("提供核心列、全部列和逐列勾选控制", async () => {
    const wrapper = mount(ChatbotTrendReport, {
      props: {
        language: "zh",
        block: {
          id: "trend",
          kind: "trend",
          title: "月度趋势",
          metric: "revenue",
          categoryOptions: [],
          activeCategory: null,
          visibleColumns: ["month", "value"],
          rows: [{ month: "2026-08", value: 120 }],
          columns: [
            { key: "month", label: "月份", format: "text" },
            { key: "value", label: "值", format: "money" },
            { key: "delta", label: "变化", format: "money" }
          ]
        }
      }
    });

    await wrapper.get("[data-trend-column-toggle]").trigger("click");
    expect(wrapper.find("[data-trend-column-panel]").exists()).toBe(true);
    await wrapper.get("[data-trend-column-all]").trigger("click");
    expect(wrapper.emitted("interact")?.at(-1)).toEqual(["trend-column-all"]);
    await wrapper.get('[data-trend-column-check][value="delta"]').setValue(true);
    expect(wrapper.emitted("interact")?.at(-1)).toEqual(["trend-columns", "month,value,delta"]);
  });
});
