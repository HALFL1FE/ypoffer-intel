import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import ChatAnswerActions from "./ChatAnswerActions.vue";
import type { ChatbotFeedback } from "./chatbotViewTypes";

describe("ChatAnswerActions", () => {
  function dialog(): DOMWrapper<Element> {
    return new DOMWrapper(document.querySelector('[data-answer-feedback-dialog]')!);
  }
  it("opens a view and submits feedback for one answer", async () => {
    const submit = vi.fn(async () => ({ ok: true as const }));
    const feedback: ChatbotFeedback = {
      isAvailable: () => true,
      submit
    };
    const wrapper = mount(ChatAnswerActions, {
      props: {
        language: "en",
        answerId: "answer-1",
        canOpenDeep: true,
        feedbackState: "available",
        feedback
      }
    });

    expect(wrapper.get("[data-chat-answer-actions]").attributes("data-chat-answer-id")).toBe("answer-1");
    expect(wrapper.get('[data-chatbot-action="feedback"]').text()).toBe("👎Dissatisfied with this reply");
    await wrapper.get('[data-chatbot-action="open-chat-deep"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);

    await wrapper.get('[data-chatbot-action="feedback"]').trigger("click");
    await dialog().get('[data-feedback-reason="unclear"]').setValue(true);
    await dialog().get("[data-feedback-detail]").setValue("Needs more context");
    await dialog().get("form").trigger("submit");
    await flushPromises();

    expect(submit).toHaveBeenCalledWith("unclear", "Needs more context");
    expect(wrapper.get('[data-chatbot-action="feedback"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-chatbot-action="feedback"]').attributes("data-feedback-status")).toBe("submitted");
    expect(wrapper.text()).toContain("Feedback sent");
    wrapper.unmount();
  });

  it("restores focus to the feedback trigger after closing the dialog", async () => {
    const feedback: ChatbotFeedback = {
      isAvailable: () => true,
      submit: async () => ({ ok: true as const })
    };
    const wrapper = mount(ChatAnswerActions, {
      attachTo: document.body,
      props: { language: "en", answerId: "answer-focus", feedbackState: "available", feedback }
    });
    const trigger = wrapper.get('[data-chatbot-action="feedback"]');

    await trigger.trigger("click");
    await dialog().get('[data-feedback-action="close"]').trigger("click");

    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it("uses the requested Chinese dislike label and reason dialog", async () => {
    const feedback: ChatbotFeedback = { isAvailable: () => true, submit: async () => ({ ok: true }) };
    const wrapper = mount(ChatAnswerActions, {
      props: { language: "zh", answerId: "answer-zh", feedbackState: "available", feedback }
    });
    const trigger = wrapper.get('[data-chatbot-action="feedback"]');
    expect(trigger.text()).toBe("👎不满意该回复");
    await trigger.trigger("click");
    expect(dialog().text()).toContain("哪里不满意？");
    expect(document.querySelector('[data-answer-feedback-backdrop]')?.parentElement).toBe(document.body);
    expect(dialog().findAll('[data-feedback-reason]')).toHaveLength(5);
    wrapper.unmount();
  });
});
