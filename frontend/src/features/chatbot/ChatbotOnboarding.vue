<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { ChatbotUtilityState } from "./chatbotViewTypes";
import type { UiLanguage } from "../../shared/i18n";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly utility: ChatbotUtilityState;
  readonly available?: boolean;
}>();

const emit = defineEmits<{
  (event: "start"): void;
  (event: "next"): void;
  (event: "back"): void;
  (event: "skip"): void;
}>();

const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const targetRect = ref<{ top: number; left: number; width: number; height: number } | null>(null);
let focusTriggerAfterClose = false;

const copy = computed(() => props.language === "zh" ? {
  start: "新手引导",
  active: "正在进行新手引导",
  step: "第",
  of: "步，共",
  done: "完成",
  layout: "认识 Chatbot 布局：左侧报告，右侧提问。",
  report: "在 Report Mode 输入商户、品类、Tier 或指标问题。",
  wait: "等待报告生成，确认来源、范围和空态。",
  memory: "把确认过的报告加入对话，后续可从 Memory 复用。",
  chat: "切换到 Chat Mode，继续追问、比较和解释。",
  back: "上一步",
  next: "下一步",
  skip: "跳过",
  targetReady: "目标控件已就绪",
  targetWaiting: "等待目标控件出现…"
} : {
  start: "First-time guide",
  active: "Onboarding in progress",
  step: "Step",
  of: "of",
  done: "done",
  layout: "Learn the Chatbot layout: report on the left, prompt on the right.",
  report: "Ask about a merchant, category, tier, or metric in Report Mode.",
  wait: "Wait for the report, then check its source, scope, and empty state.",
  memory: "Add a confirmed report to chat so it can be reused from Memory.",
  chat: "Switch to Chat Mode for follow-up questions, comparisons, and explanations.",
  back: "Back",
  next: "Next",
  skip: "Skip",
  targetReady: "Target is ready",
  targetWaiting: "Waiting for the target control…"
});

const stepCopy = computed(() => [copy.value.layout, copy.value.report, copy.value.wait, copy.value.memory, copy.value.chat]);
const targetSelector = computed(() => [
  '[data-chatbot-mode-button="report"]',
  "[data-chatbot-report-input]",
  "[data-chatbot-result-status]",
  '[data-chatbot-action="add-memory"], [data-deep-window-action="add-memory"]',
  "[data-chatbot-input]"
][props.utility.onboardingStep] || '[data-chatbot-mode-button="report"]');
const targetReady = computed(() => Boolean(targetRect.value));
const targetStyle = computed(() => targetRect.value ? {
  top: `${Math.max(4, targetRect.value.top - 8)}px`,
  left: `${Math.max(4, targetRect.value.left - 8)}px`,
  width: `${targetRect.value.width + 16}px`,
  height: `${targetRect.value.height + 16}px`
} : {});
const popoverStyle = computed(() => {
  const rect = targetRect.value;
  if (!rect || typeof window === "undefined") return { top: "82px", right: "16px" };
  const width = Math.min(320, Math.max(240, window.innerWidth - 32));
  const left = Math.min(Math.max(16, rect.left), Math.max(16, window.innerWidth - width - 16));
  const below = rect.top + rect.height + 18;
  const top = below + 180 <= window.innerHeight ? below : Math.max(16, rect.top - 190);
  return { top: `${top}px`, left: `${left}px`, width: `${width}px` };
});

function syncTarget(): void {
  if (!props.utility.onboardingOpen || typeof document === "undefined") {
    targetRect.value = null;
    return;
  }
  const element = document.querySelector<HTMLElement>(targetSelector.value);
  if (!element) {
    targetRect.value = null;
    return;
  }
  const rect = element.getBoundingClientRect();
  targetRect.value = rect.width > 0 && rect.height > 0
    ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
    : null;
}

function scheduleTargetSync(): void {
  void nextTick().then(syncTarget);
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !props.utility.onboardingOpen) return;
  event.preventDefault();
  focusTriggerAfterClose = true;
  emit("skip");
}

watch(() => [props.utility.onboardingOpen, props.utility.onboardingStep, targetSelector.value], scheduleTargetSync);
watch(() => props.utility.onboardingOpen, (open, wasOpen) => {
  if (!open && wasOpen && focusTriggerAfterClose) {
    focusTriggerAfterClose = false;
    void nextTick().then(() => trigger.value?.focus());
  }
});

onMounted(() => {
  document.addEventListener("keydown", handleKeydown);
  window.addEventListener("resize", syncTarget);
  window.addEventListener("scroll", syncTarget, true);
  scheduleTargetSync();
});

onBeforeUnmount(() => {
  document.removeEventListener("keydown", handleKeydown);
  window.removeEventListener("resize", syncTarget);
  window.removeEventListener("scroll", syncTarget, true);
});

function dismiss(): void {
  focusTriggerAfterClose = true;
  emit("skip");
}
</script>

<template>
  <div ref="root" class="chatbot-onboarding" data-chatbot-onboarding>
    <button v-if="available && !utility.onboardingOpen" ref="trigger" type="button" class="mode-btn mode-onboarding" data-chatbot-action="onboarding" @click="emit('start')">
      <span aria-hidden="true">✦</span>
      <span>{{ copy.start }}</span>
    </button>
    <div v-if="utility.onboardingOpen" class="chatbot-onboarding-overlay" data-chatbot-onboarding-overlay>
      <div class="chatbot-onboarding-scrim" aria-hidden="true"></div>
      <div
        class="chatbot-onboarding-target"
        data-chatbot-onboarding-target
        :data-target-selector="targetSelector"
        :data-target-ready="String(targetReady)"
        :style="targetStyle"
        aria-hidden="true"
      ></div>
      <section class="chatbot-onboarding-status chatbot-onboarding-popover" data-onboarding-status role="dialog" aria-modal="false" aria-live="polite" :style="popoverStyle">
        <div class="chatbot-onboarding-heading">
          <strong>{{ copy.active }}</strong>
          <span data-onboarding-step>{{ copy.step }} {{ utility.onboardingStep + 1 }} {{ copy.of }} {{ utility.onboardingTotal }}</span>
        </div>
        <p>{{ stepCopy[utility.onboardingStep] }}</p>
        <span v-if="targetReady" class="chatbot-onboarding-target-state" data-onboarding-target-state="ready">{{ copy.targetReady }}</span>
        <span v-else class="chatbot-onboarding-target-state is-waiting" data-onboarding-target-state="waiting">{{ copy.targetWaiting }}</span>
        <div class="chatbot-onboarding-progress" aria-hidden="true">
          <span v-for="step in utility.onboardingTotal" :key="step" :class="{ active: step - 1 <= utility.onboardingStep }"></span>
        </div>
        <div class="chatbot-onboarding-actions">
          <button type="button" :disabled="utility.onboardingStep <= 0" @click="emit('back')">{{ copy.back }}</button>
          <button
            type="button"
            :disabled="utility.onboardingStep === 2 || utility.onboardingStep === 3"
            data-onboarding-next
            @click="emit('next')"
          >
            {{ utility.onboardingStep >= utility.onboardingTotal - 1 ? copy.done : copy.next }}
          </button>
          <button type="button" data-onboarding-skip @click="dismiss">{{ copy.skip }}</button>
        </div>
      </section>
    </div>
  </div>
</template>
