<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import ChatAnswerActions from "./ChatAnswerActions.vue";
import DeepWindowContextOverview from "./DeepWindowContextOverview.vue";
import ChatbotResultView from "./ChatbotResultView.vue";
import type { ChatbotAnswerFeedbackState, ChatbotFeedback, ChatbotReportViewResult } from "./chatbotViewTypes";
import type { DeepWindowInteraction, DeepWindowSkeletonStep } from "./deepWindowStore";
import type { ReportDocument } from "./report/reportContracts";

type DeepWindowStatus = "loading" | "ready" | "content" | "cancelled" | "error";

const props = withDefaults(defineProps<{
  readonly id?: string;
  readonly mode?: "report" | "chat";
  readonly language: UiLanguage;
  readonly result: ChatbotReportViewResult;
  readonly title?: string;
  readonly summary?: string;
  readonly contentHtml?: string;
  readonly errorMessage?: string;
  readonly skeletonSteps?: readonly DeepWindowSkeletonStep[];
  readonly zIndex?: number;
  readonly minimized: boolean;
  readonly pinned?: boolean;
  readonly overlay?: boolean;
  readonly status?: DeepWindowStatus;
  readonly position?: { readonly x: number; readonly y: number };
  readonly absolutePosition?: boolean;
  readonly canCancel?: boolean;
  readonly canAddMemory?: boolean;
  readonly addedToMemory?: boolean;
  readonly canExport?: boolean;
  readonly canMinimize?: boolean;
  readonly canClose?: boolean;
  readonly feedbackState?: ChatbotAnswerFeedbackState;
  readonly feedback?: ChatbotFeedback | null;
}>(), {
  id: "deep-window",
  mode: "report",
  title: "",
  summary: "",
  contentHtml: "",
  errorMessage: "",
  skeletonSteps: () => [],
  zIndex: 1200,
  pinned: false,
  overlay: false,
  status: "ready",
  position: () => ({ x: 24, y: 24 }),
  absolutePosition: false,
  canCancel: true,
  canAddMemory: true,
  addedToMemory: false,
  canExport: true,
  canMinimize: true,
  canClose: true,
  feedbackState: "unavailable",
  feedback: null
});

const emit = defineEmits<{
  (event: "activate"): void;
  (event: "minimize"): void;
  (event: "restore"): void;
  (event: "close"): void;
  (event: "add-memory"): void;
  (event: "pin"): void;
  (event: "export"): void;
  (event: "clone"): void;
  (event: "overlay"): void;
  (event: "cancel"): void;
  (event: "download", downloadId: string, answerId?: string): void;
  (event: "context-interact", action: string, value?: string): void;
  (event: "trend-interact", action: DeepWindowInteraction, value?: string): void;
  (event: "trend-columns", columns: readonly string[]): void;
  (event: "drop-memory"): void;
  (event: "drop-highlight", active: boolean): void;
  (event: "move", x: number, y: number): void;
}>();

const dragging = ref(false);
const dropTarget = ref(false);
const panelRoot = ref<HTMLElement | null>(null);
let dragOrigin: { x: number; y: number; left: number; top: number } | null = null;
let dragMoved = false;

const status = computed(() => props.status === "ready" ? "content" : props.status);
const isLoading = computed(() => status.value === "loading");
const isContent = computed(() => status.value === "content");
const windowTitle = computed(() => props.title || props.result.title || props.result.category || props.result.tier || props.result.intent || "Deep Analysis");
const windowSummary = computed(() => props.summary || props.result.message || "");
const structuredDocument = computed<ReportDocument | null>(() => {
  if (props.result.document) return props.result.document;
  return "documentId" in props.result ? props.result as unknown as ReportDocument : null;
});
const displayResult = computed<ChatbotReportViewResult>(() => ({
  ...props.result,
  ...(props.contentHtml?.trim() ? { contentHtml: props.contentHtml } : {}),
  ...(structuredDocument.value?.contentHtml?.trim() && !props.result.contentHtml?.trim()
    ? { contentHtml: structuredDocument.value.contentHtml }
    : {}),
  ...(structuredDocument.value?.recommendationHtml?.trim() && !props.result.recommendationHtml?.trim()
    ? { recommendationHtml: structuredDocument.value.recommendationHtml }
    : {})
}));
const reportHtml = computed(() => displayResult.value.contentHtml?.trim() || "");
const recommendationHtml = computed(() => displayResult.value.recommendationHtml?.trim() || "");
const hasStructuredDocument = computed(() => Boolean(structuredDocument.value));
const hasTrendBlock = computed(() => Boolean(
  structuredDocument.value?.blocks.some((block) => block.kind === "trend")
));
const hasMerchantOverview = computed(() => Boolean(
  structuredDocument.value
  && structuredDocument.value.rows.length
  && (structuredDocument.value.intent === "merchant" || structuredDocument.value.intent === "asin")
));
const hasCategoryOverview = computed(() => Boolean(
  structuredDocument.value
  && structuredDocument.value.rows.length
  && structuredDocument.value.intent === "category"
));
const showLegacySummary = computed(() => !hasStructuredDocument.value && !reportHtml.value && !recommendationHtml.value);
const contextHeading = computed(() => hasTrendBlock.value
  ? (props.language === "zh" ? "趋势图表" : "Trend chart")
  : (props.language === "zh" ? "概览" : "Overview"));
const steps = computed<readonly DeepWindowSkeletonStep[]>(() => props.skeletonSteps?.length ? props.skeletonSteps : [
  { id: "understand", label: props.language === "zh" ? "理解问题" : "Understanding your question", state: "active" },
  { id: "query", label: props.language === "zh" ? "查询数据" : "Querying data", state: "pending" },
  { id: "report", label: props.language === "zh" ? "生成报告" : "Generating report", state: "pending" }
]);
const activeStepIndex = computed(() => steps.value.findIndex((step) => step.state === "active"));
const activeStepNumber = computed(() => activeStepIndex.value >= 0 ? activeStepIndex.value + 1 : steps.value.length);
const activeStepLabel = computed(() => steps.value[activeStepIndex.value]?.label || (props.language === "zh" ? "报告已完成" : "Report complete"));

function stepStateLabel(state: DeepWindowSkeletonStep["state"]): string {
  if (props.language === "zh") return state === "done" ? "已完成" : state === "active" ? "进行中" : "等待中";
  return state === "done" ? "Complete" : state === "active" ? "In progress" : "Queued";
}

const memoryActionLabel = computed(() => props.addedToMemory
  ? (props.language === "zh" ? "已加入对话" : "Added")
  : (props.language === "zh" ? "加入对话" : "Add to chat"));
const exportLabel = computed(() => props.language === "zh" ? "导出" : "Export");
const stopLabel = computed(() => props.language === "zh" ? "停止" : "Stop");
const closeLabel = computed(() => props.language === "zh" ? "关闭" : "Close");
const restoreLabel = computed(() => props.language === "zh" ? "恢复" : "Restore");
const errorText = computed(() => props.errorMessage || (status.value === "cancelled"
  ? (props.language === "zh" ? "分析已停止。" : "The analysis was stopped.")
  : (props.language === "zh" ? "分析失败，请稍后重试。" : "The analysis failed. Please try again.")));

const DEFAULT_TREND_COLUMNS = new Set([
  "salesAmount", "revenue", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate"
]);

function chartBody(target: HTMLElement): HTMLElement | null {
  const root = target.closest<HTMLElement>("[data-deep-window-content]");
  return root && panelRoot.value?.contains(root) ? root : null;
}

function syncTrendColumnChecks(root: HTMLElement, all: boolean): void {
  const checks = Array.from(root.querySelectorAll<HTMLInputElement>("[data-trend-column-check]"));
  if (!checks.length) return;
  const available = new Set(checks.map((checkbox) => checkbox.value).filter(Boolean));
  const selected = all ? available : new Set([...DEFAULT_TREND_COLUMNS].filter((column) => available.has(column)));
  if (!selected.size) selected.add(checks[0]!.value);
  checks.forEach((checkbox) => { checkbox.checked = selected.has(checkbox.value); });
  emit("trend-columns", checks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value));
}

const windowStyle = computed(() => ({
  left: `${props.position.x}px`,
  top: `${props.position.y}px`,
  right: "auto",
  zIndex: String(props.zIndex)
}));

function setDropTarget(active: boolean): void {
  if (dropTarget.value === active) return;
  dropTarget.value = active;
  emit("drop-highlight", active);
}

function memoryDropTarget(event?: Event): Element | null {
  if (!dragOrigin || !props.minimized) return null;
  const pointer = event as PointerEvent | undefined;
  const memoryBar = document.querySelector<HTMLElement>("[data-chatbot-memory-bar]");
  const panel = panelRoot.value;
  if (memoryBar && panel) {
    const panelRect = panel.getBoundingClientRect();
    const memoryRect = memoryBar.getBoundingClientRect();
    const dx = Number(pointer?.clientX || dragOrigin.x) - dragOrigin.x;
    const dy = Number(pointer?.clientY || dragOrigin.y) - dragOrigin.y;
    const left = panelRect.left + dx;
    const top = panelRect.top + dy;
    const hasOverlap = left < memoryRect.right && left + panelRect.width > memoryRect.left
      && top < memoryRect.bottom && top + panelRect.height > memoryRect.top;
    if (panelRect.width > 0 && panelRect.height > 0 && memoryRect.width > 0 && memoryRect.height > 0) {
      return hasOverlap ? memoryBar : null;
    }
  }
  if (typeof document.elementFromPoint !== "function") return null;
  const x = Number(pointer?.clientX || 0);
  const y = Number(pointer?.clientY || 0);
  return document.elementFromPoint(x, y)?.closest("[data-chatbot-memory-bar]") || null;
}

function pointerMove(event: PointerEvent): void {
  if (!dragOrigin) return;
  if (Math.abs(event.clientX - dragOrigin.x) > 3 || Math.abs(event.clientY - dragOrigin.y) > 3) dragMoved = true;
  const nextLeft = dragOrigin.left + event.clientX - dragOrigin.x;
  const nextTop = dragOrigin.top + event.clientY - dragOrigin.y;
  const panelWidth = panelRoot.value?.getBoundingClientRect().width || 0;
  const panelHeight = panelRoot.value?.getBoundingClientRect().height || 0;
  const maxLeft = Math.max(0, window.innerWidth - panelWidth);
  const maxTop = Math.max(0, window.innerHeight - panelHeight);
  emit("move", Math.min(maxLeft, Math.max(0, nextLeft)), Math.min(maxTop, Math.max(0, nextTop)));
  setDropTarget(Boolean(memoryDropTarget(event)));
}

function pointerUp(event?: Event): void {
  const wasDragging = Boolean(dragOrigin);
  const wasMinimized = props.minimized;
  const droppedOnMemoryBar = wasDragging && Boolean(memoryDropTarget(event));
  const moved = wasDragging && dragMoved;
  dragging.value = false;
  dragOrigin = null;
  dragMoved = false;
  window.removeEventListener("pointermove", pointerMove);
  window.removeEventListener("pointerup", pointerUp);
  setDropTarget(false);
  if (droppedOnMemoryBar) emit("drop-memory");
  else if (wasMinimized && !moved) emit("restore");
}

function startDrag(event: PointerEvent): void {
  if (event.button !== 0) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, input, select, textarea, .deep-window-actions")) return;
  emit("activate");
  dragging.value = true;
  dragMoved = false;
  dragOrigin = { x: event.clientX, y: event.clientY, left: props.position.x, top: props.position.y };
  window.addEventListener("pointermove", pointerMove);
  window.addEventListener("pointerup", pointerUp);
}

function chartTarget(event: Event): HTMLElement | null {
  const target = event.target instanceof HTMLElement ? event.target : null;
  const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
  if (!target || !root) return null;
  const candidate = target.closest<HTMLElement>("[data-trend-metric], [data-trend-category-select], [data-trend-column-toggle], [data-trend-column-core], [data-trend-column-all], [data-trend-column-check], [data-download-id]");
  return candidate && root.contains(candidate) ? candidate : null;
}

function handleChartClick(event: MouseEvent): void {
  const target = chartTarget(event);
  if (!target) return;
  const downloadId = target.getAttribute("data-download-id");
  if (downloadId) {
    if (target.closest("[data-chatbot-result]")) return;
    const answerId = props.result.sessionResult?.answerId;
    if (answerId) emit("download", downloadId.slice(0, 120), answerId);
    else emit("download", downloadId.slice(0, 120));
    return;
  }
  if (target.matches("button[data-trend-metric]")) {
    const metric = target.getAttribute("data-trend-metric");
    if (metric) {
      const root = chartBody(target);
      root?.querySelectorAll("[data-trend-metric]").forEach((button) => {
        button.classList.toggle("active", button === target);
      });
      emit("trend-interact", "trend-metric", metric);
    }
  } else if (target.matches("[data-trend-column-toggle]")) {
    const root = chartBody(target);
    const panel = root?.querySelector<HTMLElement>("[data-trend-column-panel]");
    if (panel) {
      const hidden = panel.classList.toggle("hidden");
      target.setAttribute("aria-expanded", String(!hidden));
    }
    emit("trend-interact", "trend-column-toggle");
  } else if (target.matches("[data-trend-column-core]")) {
    const root = chartBody(target);
    if (root) syncTrendColumnChecks(root, false);
    emit("trend-interact", "trend-column-core");
  } else if (target.matches("[data-trend-column-all]")) {
    const root = chartBody(target);
    if (root) syncTrendColumnChecks(root, true);
    emit("trend-interact", "trend-column-all");
  }
}

function handleChartChange(event: Event): void {
  const target = chartTarget(event);
  if (!target) return;
  if (target.matches("[data-trend-category-select]")) {
    emit("trend-interact", "trend-category", (target as HTMLSelectElement).value);
    return;
  }
  if (target.matches("[data-trend-column-check]")) {
    const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const columns = root
      ? Array.from(root.querySelectorAll<HTMLInputElement>("[data-trend-column-check]:checked"), (checkbox) => checkbox.value)
      : [];
    emit("trend-columns", columns);
  }
}

function forwardDownload(downloadId: string, answerId?: string): void {
  if (answerId) emit("download", downloadId, answerId);
  else emit("download", downloadId);
}

watch(() => props.minimized, (minimized) => {
  if (!minimized) setDropTarget(false);
});

onBeforeUnmount(() => pointerUp());

</script>

<template>
  <aside
    ref="panelRoot"
    class="deep-window"
    :class="{ minimized, 'source-chat': mode === 'chat', 'source-report': mode === 'report', 'is-minimized': minimized, dragging, 'is-dragging': dragging, 'drop-target': dropTarget, generating: isLoading }"
    :style="windowStyle"
    data-deep-window
    :data-deep-window-id="id"
    :data-status="status"
    :aria-label="language === 'zh' ? '深度报告' : 'Deep report'"
    @pointerdown="emit('activate')"
  >
    <header class="deep-window-header" data-deep-window-header data-draggable="true" @pointerdown="startDrag">
      <div class="deep-window-heading">
        <h2 class="deep-window-title">{{ windowTitle }}</h2>
      </div>
      <div class="deep-window-actions">
        <button v-if="minimized" class="deep-window-minimize" type="button" :aria-label="restoreLabel" data-deep-window-action="restore" @click="emit('restore')">▢</button>
        <template v-else-if="!isLoading">
          <button v-if="isContent && canExport" type="button" data-deep-window-action="export" @click="emit('export')">{{ exportLabel }}</button>
          <button v-if="isContent" class="deep-window-chat-add" type="button" data-deep-window-action="add-memory" :disabled="!canAddMemory || addedToMemory" @click="emit('add-memory')">{{ memoryActionLabel }}</button>
        </template>
        <button v-if="isLoading && canCancel" class="deep-window-stop" type="button" data-deep-window-action="stop" @click="emit('cancel')">{{ stopLabel }}</button>
        <button v-if="!minimized && canMinimize && !isLoading" class="deep-window-minimize" type="button" data-deep-window-action="minimize" aria-label="Minimize" @click="emit('minimize')">—</button>
        <button v-if="canClose && !isLoading" class="deep-window-close" type="button" data-deep-window-action="close" :aria-label="closeLabel" @click="emit('close')">×</button>
      </div>
    </header>

    <div v-if="!minimized" class="deep-window-body" data-deep-window-content @click="handleChartClick" @change="handleChartChange">
      <section v-if="isLoading" class="deep-window-skeleton" aria-live="polite" data-deep-window-skeleton>
        <div class="deep-skeleton-progress" data-deep-window-progress>
          <div class="deep-skeleton-progress-copy">
            <span class="deep-skeleton-kicker">{{ language === "zh" ? "报告生成进度" : "Report progress" }}</span>
            <strong>{{ activeStepLabel }}</strong>
          </div>
          <span class="deep-skeleton-progress-count">{{ activeStepNumber }} / {{ steps.length }}</span>
        </div>
        <div
          v-for="step in steps"
          :key="step.id"
          class="deep-skeleton-step"
          :class="step.state"
          data-deep-window-step
          :data-step-id="step.id"
          :data-step-state="step.state"
          :aria-current="step.state === 'active' ? 'step' : undefined"
        >
          <span class="deep-skeleton-spinner" aria-hidden="true"></span>
          <span class="deep-skeleton-step-label">{{ step.label }}</span>
          <span class="deep-skeleton-step-status" data-deep-window-step-status>{{ stepStateLabel(step.state) }}</span>
        </div>
      </section>

      <section v-else-if="isContent" class="deep-window-content" data-deep-window-report>
        <h2 class="deep-report-title">{{ windowTitle }}</h2>
        <p v-if="windowSummary && showLegacySummary" class="deep-report-summary">{{ windowSummary }}</p>
        <div class="deep-report-sections" data-deep-window-sections>
          <div class="deep-quick-result" data-deep-quick-result>
            <div v-if="hasStructuredDocument && hasTrendBlock" class="deep-context-chart" data-deep-context-chart>
              <h3 class="deep-chart-heading">{{ contextHeading }}</h3>
              <ChatbotResultView
                :language="language"
                :result="displayResult"
                compact
                @download="forwardDownload"
                @context-interact="(action, value) => emit('context-interact', action, value)"
              />
            </div>
            <div v-else-if="hasStructuredDocument" class="deep-context-overview" data-deep-context-overview>
              <h3 class="deep-overview-heading">{{ contextHeading }}</h3>
              <DeepWindowContextOverview
                v-if="hasMerchantOverview || hasCategoryOverview"
                :language="language"
                :document="structuredDocument!"
              />
              <ChatbotResultView
                v-if="(!hasMerchantOverview && !hasCategoryOverview) || reportHtml || recommendationHtml"
                :language="language"
                :result="displayResult"
                compact
                :render-structured="!hasMerchantOverview"
                @download="forwardDownload"
                @context-interact="(action, value) => emit('context-interact', action, value)"
              />
            </div>
            <ChatbotResultView
              v-else
              :language="language"
              :result="displayResult"
              compact
              @download="forwardDownload"
              @context-interact="(action, value) => emit('context-interact', action, value)"
            />
          </div>
        </div>
        <div class="deep-window-feedback" data-deep-window-feedback>
          <ChatAnswerActions
            :language="language"
            :answer-id="id"
            :can-open-deep="false"
            :feedback-state="feedbackState"
            :feedback="feedback"
          />
        </div>
      </section>

      <section v-else class="deep-window-error" role="alert" data-deep-window-error>
        <strong>{{ language === 'zh' ? '深度分析失败' : 'Deep analysis failed' }}</strong>
        <p>{{ errorText }}</p>
      </section>
    </div>
  </aside>
</template>
