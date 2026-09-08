import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotReportBlocks from "./ChatbotReportBlocks.vue";

describe("ChatbotReportBlocks", () => {
  it("renders report supplied columns instead of the generic offer table", () => {
    const wrapper = mount(ChatbotReportBlocks, {
      props: {
        language: "en",
        blocks: [{
          id: "payment-1",
          kind: "table",
          title: "Payments",
          rows: [{ merchantId: "1001", paymentStatus: "Unpaid", paymentCycle: 30 }],
          columns: [
            { key: "merchantId", label: "Merchant ID", format: "text" },
            { key: "paymentStatus", label: "Status", format: "text" },
            { key: "paymentCycle", label: "Cycle", format: "integer" }
          ]
        }]
      }
    });

    expect(wrapper.text()).toContain("Status");
    expect(wrapper.text()).toContain("Unpaid");
    expect(wrapper.text()).toContain("Cycle");
    expect(wrapper.text()).not.toContain("EPC");
  });

  it("为商户和媒体行提供带文档上下文的选择动作", async () => {
    const wrapper = mount(ChatbotReportBlocks, {
      props: {
        language: "zh",
        blocks: [
          {
            id: "merchant-results",
            kind: "table",
            title: "商户",
            rows: [{ merchantId: "1001", merchantName: "Alpha Audio" }],
            columns: [{ key: "merchantName", label: "商户", format: "text" }]
          },
          {
            id: "publisher-records",
            kind: "table",
            title: "Publisher Records",
            rows: [{ userId: "p-1", userName: "Media One" }],
            columns: [{ key: "userName", label: "媒体", format: "text" }]
          }
        ]
      }
    });

    await wrapper.get('[data-report-action="select-merchant"]').trigger("click");
    await wrapper.get('[data-report-action="select-publisher"]').trigger("click");

    expect(wrapper.emitted("interact")).toEqual([
      ["select-merchant", "1001"],
      ["select-publisher", "p-1"]
    ]);
  });

  it("为推荐行提供排除和替换动作", async () => {
    const wrapper = mount(ChatbotReportBlocks, {
      props: {
        language: "zh",
        blocks: [{
          id: "recommendations",
          kind: "table",
          title: "推荐结果",
          rows: [{ merchantId: "1001", merchantName: "Alpha Audio" }],
          columns: [{ key: "merchantName", label: "商户", format: "text" }]
        }]
      }
    });

    await wrapper.get('[data-report-action="exclude-merchant"]').trigger("click");
    await wrapper.get('[data-report-action="replace-merchant"]').trigger("click");

    expect(wrapper.emitted("interact")).toEqual([
      ["exclude-merchant", "1001"],
      ["replace-merchant", "1001"]
    ]);
  });
});
