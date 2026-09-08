import { describe, expect, it } from "vitest";
import { initialOnboardingState, progressStep, reduceOnboarding } from "./chatbotOnboardingModel";

describe("chatbotOnboardingModel", () => {
  it("按真实事件推进五步引导，不允许把等待状态伪装成完成", () => {
    let state = initialOnboardingState();
    state = reduceOnboarding(state, "start");
    state = reduceOnboarding(state, "next");
    expect(state.step).toBe(1);
    expect(state.flow).toBe("noReport");
    state = reduceOnboarding(state, "report-submitted");
    expect(state.step).toBe(2);
    expect(reduceOnboarding(state, "next").step).toBe(2);
    state = reduceOnboarding(state, "report-ready");
    expect(state.step).toBe(3);
    expect(state.flow).toBe("reportReady");
    expect(reduceOnboarding(state, "next").step).toBe(3);
    state = reduceOnboarding(state, "memory-added");
    expect(state.step).toBe(4);
    expect(progressStep(state)).toBe(1);
    state = reduceOnboarding(state, "chat-submitted");
    expect(state.step).toBe(4);
    expect(progressStep(state)).toBe(2);
  });

  it("不会在没有报告或 Memory 时通过按钮跳到后续真实步骤", () => {
    let state = reduceOnboarding(initialOnboardingState(), "start");
    state = reduceOnboarding(state, "next");
    state = reduceOnboarding(state, "report-submitted");
    expect(reduceOnboarding(state, "next").step).toBe(2);
    state = reduceOnboarding(state, "report-ready");
    expect(reduceOnboarding(state, "next").step).toBe(3);
    state = reduceOnboarding(state, "memory-added");
    expect(state.step).toBe(4);
  });
});
