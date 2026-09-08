export type OnboardingFlow = "noReport" | "reportReady" | "memoryReady" | "chatActive";

export interface OnboardingState {
  readonly open: boolean;
  readonly step: 0 | 1 | 2 | 3 | 4;
  readonly flow: OnboardingFlow;
}

export type OnboardingEvent =
  | "start" | "next" | "back" | "report-submitted" | "report-ready"
  | "memory-added" | "chat-submitted" | "skip" | "done" | "clear";

export interface OnboardingStepView {
  readonly index: 1 | 2 | 3 | 4 | 5;
  readonly total: 5;
  readonly title: string;
}

export const ONBOARDING_TOTAL = 5 as const;

export function initialOnboardingState(): OnboardingState {
  return { open: false, step: 0, flow: "noReport" };
}

function clampStep(value: number): OnboardingState["step"] {
  return Math.min(4, Math.max(0, Math.floor(value))) as OnboardingState["step"];
}

export function createOnboardingState(open: boolean, step: number, flow: OnboardingFlow = "noReport"): OnboardingState {
  return { open, step: clampStep(step), flow };
}

export function onboardingStepAt(state: OnboardingState): OnboardingStepView {
  const titles = ["Layout", "Report", "Wait for result", "Add to chat", "Chat follow-up"];
  return { index: (state.step + 1) as OnboardingStepView["index"], total: ONBOARDING_TOTAL, title: titles[state.step] || titles[0]! };
}

export function onboardingTotal(): number {
  return ONBOARDING_TOTAL;
}

function canAdvance(state: OnboardingState): boolean {
  // 等待报告与等待加入是事实状态，只能由真实事件推进，不能靠连续点击跳过。
  if (state.step === 2 || state.step === 3) return false;
  return true;
}

export function progressStep(state: OnboardingState): 0 | 1 | 2 {
  if (state.flow === "chatActive") return 2;
  if (state.flow === "memoryReady") return 1;
  if (state.flow === "reportReady") return 1;
  return 0;
}

export function reduceOnboarding(state: OnboardingState, event: OnboardingEvent): OnboardingState {
  switch (event) {
    case "start": return { ...state, open: true, step: state.step };
    case "next": return canAdvance(state) ? { ...state, open: true, step: clampStep(state.step + 1) } : state;
    case "back": return state.open ? { ...state, open: true, step: clampStep(state.step - 1) } : state;
    case "report-submitted": return state.open ? { ...state, step: Math.max(state.step, 2) as OnboardingState["step"] } : state;
    case "report-ready": return state.open ? { ...state, flow: "reportReady", step: Math.max(state.step, 3) as OnboardingState["step"] } : state;
    case "memory-added": return state.open ? { ...state, flow: "memoryReady", step: Math.max(state.step, 4) as OnboardingState["step"] } : state;
    case "chat-submitted": return state.open ? { ...state, flow: "chatActive", step: 4 } : state;
    case "skip": case "done": return { ...state, open: false };
    case "clear": return initialOnboardingState();
  }
}
