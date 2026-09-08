import { describe, expect, it } from "vitest";
import { chatbotHelpHtml, chatbotGuideHtml } from "./chatbotHelp";
import { createOnboardingState, onboardingStepAt, onboardingTotal } from "./chatbotOnboardingModel";

describe("chatbot help and onboarding", () => {
  it("提供中英文使用说明和流程指南", () => {
    expect(chatbotHelpHtml("zh")).toContain("Report Mode");
    expect(chatbotHelpHtml("en")).toContain("Report Mode");
    expect(chatbotGuideHtml("zh")).toContain("Publisher Records");
    expect(chatbotGuideHtml("en")).toContain("Memory");
  });

  it("提供五步引导和安全边界内的三步进度", () => {
    expect(onboardingTotal()).toBe(5);
    expect(onboardingStepAt(createOnboardingState(true, 0))).toMatchObject({ index: 1, total: 5 });
    expect(onboardingStepAt(createOnboardingState(true, 9)).index).toBe(5);
  });
});
