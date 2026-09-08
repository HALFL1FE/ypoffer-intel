import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ChatbotUtilityPanels from "./ChatbotUtilityPanels.vue";

const utility = {
  helpOpen: false,
  guideOpen: false,
  helpHtml: "<p>Help</p>",
  guideHtml: "<p>Guide</p>",
  guideLoading: false,
  onboardingOpen: false,
  onboardingStep: 0,
  onboardingTotal: 5,
  reminderVisible: false,
  reminderCollapsed: false
};

describe("ChatbotUtilityPanels", () => {
  it("在帮助或流程弹层按 Escape 时关闭并把焦点还给入口", async () => {
    const wrapper = mount(ChatbotUtilityPanels, {
      props: { language: "zh", utility: { ...utility, helpOpen: true } },
      attachTo: document.body
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("help")).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.get('[data-chatbot-action="help"]').element);
    wrapper.unmount();
  });

  it("流程弹层按 Escape 走流程关闭事件", async () => {
    const wrapper = mount(ChatbotUtilityPanels, {
      props: { language: "en", utility: { ...utility, guideOpen: true } },
      attachTo: document.body
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted("guide")).toHaveLength(1);
    expect(document.activeElement).toBe(wrapper.get('[data-chatbot-action="guide"]').element);
    wrapper.unmount();
  });
});
