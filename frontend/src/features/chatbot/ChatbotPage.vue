<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import ChatbotChatView from "./ChatbotChatView.vue";
import ChatbotOnboarding from "./ChatbotOnboarding.vue";
import ChatbotReportView from "./ChatbotReportView.vue";
import ChatbotUtilityPanels from "./ChatbotUtilityPanels.vue";
import DeepWindow from "./DeepWindow.vue";
import { streamChatbotReply } from "./useChatbotChat";
import { useChatbotReport } from "./useChatbotReport";
import {
  createDeepWindowStore,
  type DeepWindowInteraction,
  type DeepWindowSkeletonStep,
  type DeepWindowState,
  type DeepWindowStore,
  type DeepWindowViewState
} from "./deepWindowStore";
import type {
  ChatbotChatRequest,
  ChatbotChatResult,
  ChatbotChatRunner,
  ChatbotHistoryMessage,
  ChatbotMemoryItem,
  ChatbotMode,
  ChatbotReportProgressStage,
  ChatbotReportHistoryItem,
  ChatbotReportViewResult,
  ChatbotSession,
  ChatbotSessionMessage,
  ChatbotSessionResult,
  ChatbotStarterCard,
  ChatbotUtilityState,
  ChatbotViewState
} from "./chatbotViewTypes";

const props = withDefaults(defineProps<{
  readonly language: UiLanguage;
  readonly offers: readonly Readonly<Record<string, unknown>>[];
  readonly runChat?: ChatbotChatRunner;
  readonly session?: ChatbotSession;
  readonly deepWindows?: DeepWindowStore;
  readonly autoFocus?: boolean;
}>(), {
  runChat: undefined,
  session: undefined,
  deepWindows: undefined,
  autoFocus: true
});

const mode = ref<ChatbotMode>(props.session?.getState().mode || "report");
const report = useChatbotReport(() => props.offers, () => props.language);
const reportPrompt = report.prompt;
const reportResult = report.result;
const reportLoading = report.loading;
const contextTitle = ref("");
const contextSubtitle = ref("");
const contextHtml = ref("");
const supplementalHtml = ref("");
const chatInput = ref("");
const chatLoading = ref(false);
const chatError = ref("");
const chatMessages = ref<Array<ChatbotHistoryMessage & Partial<ChatbotSessionMessage> & { readonly id: string; readonly streaming?: boolean }>>([]);
const reportHistory = ref<ChatbotReportHistoryItem[]>([]);
const chatCurrentResult = ref<ChatbotSessionResult | null>(null);
const starterCards = ref<readonly ChatbotStarterCard[]>([]);
const memory = ref<ChatbotMemoryItem[]>([]);
const memoryDropHighlighted = ref(false);
const utilityState = ref<ChatbotUtilityState>({
  helpOpen: false,
  guideOpen: false,
  helpHtml: "",
  guideHtml: "",
  guideLoading: false,
  onboardingOpen: false,
  onboardingStep: 0,
  onboardingTotal: 0,
  reminderVisible: false,
  reminderCollapsed: false
});
const feedbackRefreshKey = ref(0);
const localDeepWindows = createDeepWindowStore({
  onAddToChat: (window) => addReportToMemory(window.result)
});
const deepWindowController = props.deepWindows || localDeepWindows;
let chatAbortController: AbortController | null = null;
let pendingReportDeepWindowId: string | null = null;
let stopSessionSubscription: (() => void) | null = null;
const deepWindowsState = ref<DeepWindowViewState>(deepWindowController.getState());
let stopDeepWindowSubscription: (() => void) | null = null;
let idCounter = 0;
const MAX_REPORT_HISTORY = 50;

const copy = computed(() => props.language === "zh" ? {
  title: "Chatbot",
  subtitle: "用 Report Mode 查数据，用 Chat Mode 继续追问。",
  report: "报告模式",
  chat: "聊天模式",
  reportError: "报告暂时无法生成，请重试。"
} : {
  title: "Chatbot",
  subtitle: "Use Report Mode for data, then continue in Chat Mode.",
  report: "Report Mode",
  chat: "Chat Mode",
  reportError: "The report is temporarily unavailable. Try again."
});

const reportError = computed(() => report.hasError.value ? copy.value.reportError : "");
const reportAnswerId = computed(() => reportResult.value?.sessionResult?.answerId || null);
const reportAnswerFeedback = computed(() => reportAnswerId.value ? feedbackForAnswer(reportAnswerId.value) : null);

const utilityCopy = computed(() => props.language === "zh" ? {
  help: "使用说明",
  guide: "使用流程",
  logs: "日志",
  questions: "提问记录",
  feedback: "反馈记录"
} : {
  help: "Help",
  guide: "User guide",
  logs: "Logs",
  questions: "Questions",
  feedback: "Feedback"
});

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function reportText(result: ChatbotReportViewResult): string {
  return result.message || `${result.intent} report`;
}

function rememberReportView(view: ChatbotReportViewResult): void {
  const answerId = view.sessionResult?.answerId?.trim() || "";
  const existingIndex = answerId
    ? reportHistory.value.findIndex((item) => item.id === answerId || item.result.sessionResult?.answerId === answerId)
    : reportHistory.value.findIndex((item) => item.result.sessionResult === view.sessionResult);
  if (existingIndex >= 0) {
    reportHistory.value = reportHistory.value.map((item, index) => index === existingIndex
      ? { ...item, query: view.query, result: view }
      : item);
    return;
  }
  reportHistory.value = [...reportHistory.value, {
    id: answerId || nextId("report"),
    query: view.query,
    result: view
  }].slice(-MAX_REPORT_HISTORY);
}

function downloadLogs(kind: "questions" | "feedback", format: "csv" | "jsonl"): void {
  props.session?.downloadLogs?.(kind, format);
}

function downloadRecommendation(downloadId: string, answerId?: string): void {
  if (answerId) props.session?.downloadRecommendation?.(downloadId, answerId);
  else props.session?.downloadRecommendation?.(downloadId);
}

function downloadOverview(): void {
  props.session?.downloadOverview?.();
}

function toggleHelp(): void {
  props.session?.toggleHelp?.();
}

function toggleGuide(): void {
  props.session?.toggleGuide?.();
}

function startOnboarding(): void {
  props.session?.startOnboarding?.();
}

function nextOnboarding(): void {
  props.session?.nextOnboarding?.();
}

function backOnboarding(): void {
  props.session?.backOnboarding?.();
}

function skipOnboarding(): void {
  props.session?.skipOnboarding?.();
}

function clearConversation(): void {
  props.session?.clearConversation();
}

function interactContext(action: string, value?: string): void {
  props.session?.interactContext?.(action, value);
}

function feedbackForAnswer(answerId: string): ReturnType<NonNullable<ChatbotSession["feedbackForAnswer"]>> {
  return props.session?.feedbackForAnswer?.(answerId) || null;
}

function feedbackForDeepWindow(windowId: string): ReturnType<NonNullable<ChatbotSession["feedbackForDeepWindow"]>> {
  return props.session?.feedbackForDeepWindow?.(windowId) || null;
}

function sessionResultToView(result: ChatbotSessionResult, query: string): ChatbotReportViewResult {
  if (result.report) return {
    ...result.report,
    ...(result.document ? { document: result.document } : {}),
    ...(result.contentHtml ? { contentHtml: result.contentHtml } : {}),
    ...(result.recommendationHtml ? { recommendationHtml: result.recommendationHtml } : {}),
    sessionResult: result
  };
  const status: ChatbotReportViewResult["status"] = result.status === "success"
    ? "resolved" : result.status === "stopped" ? "deferred" : "not_found";
  return {
    intent: (result.intent || "analysis") as ChatbotReportViewResult["intent"],
    ...(result.intent ? { title: result.intent } : {}),
    status,
    query,
    source: result.source,
    rows: [],
    summary: {
      offerCount: 0,
      clicks: 0,
      orders: 0,
      revenue: 0,
      commission: 0,
      conversionRate: null
    },
    message: result.response || (result.status === "stopped" ? copy.value.reportError : copy.value.reportError),
    ...(result.contentHtml ? { contentHtml: result.contentHtml } : {}),
    ...(result.recommendationHtml ? { recommendationHtml: result.recommendationHtml } : {}),
    sessionResult: result
  };
}

function placeholderReportView(query: string, message: string): ChatbotReportViewResult {
  return {
    intent: "analysis",
    status: "deferred",
    query,
    source: "unavailable",
    rows: [],
    summary: {
      offerCount: 0,
      clicks: 0,
      orders: 0,
      revenue: 0,
      commission: 0,
      conversionRate: null
    },
    message,
    title: query
  };
}

function loadingReportView(query: string): ChatbotReportViewResult {
  return placeholderReportView(query, props.language === "zh" ? "正在生成分析报告…" : "Generating analysis report…");
}

function reportSkeletonSteps(): readonly DeepWindowSkeletonStep[] {
  return [
    { id: "understand", label: props.language === "zh" ? "理解问题" : "Understanding your question", state: "active" },
    { id: "query", label: props.language === "zh" ? "查询数据" : "Querying data", state: "pending" },
    { id: "report", label: props.language === "zh" ? "生成报告" : "Generating report", state: "pending" }
  ];
}

function reportSkeletonStepForStage(stage: ChatbotReportProgressStage): number {
  return stage === "understand" ? 1 : stage === "query" ? 2 : 3;
}

const displayedDeepWindows = computed<readonly DeepWindowState[]>(() => (
  deepWindowsState.value.windows.filter((item) => !item.hidden)
));

const activeDisplayedDeepWindow = computed<DeepWindowState | null>(() => {
  const activeId = deepWindowsState.value.activeId;
  return displayedDeepWindows.value.find((item) => item.id === activeId) || displayedDeepWindows.value.at(-1) || null;
});

function syncDeepWindowState(next: DeepWindowViewState = deepWindowController.getState()): void {
  deepWindowsState.value = next;
}

function sessionMemoryToLocal(state: ChatbotViewState): ChatbotMemoryItem[] {
  return state.memory.map((item) => ({
    id: item.id,
    title: item.title,
    text: item.text,
    ...(item.html ? { html: item.html } : {}),
    ...(item.source ? { source: item.source } : {})
  }));
}

function syncSessionState(next: ChatbotViewState = props.session!.getState()): void {
  mode.value = next.mode;
  contextTitle.value = next.contextTitle || "";
  contextSubtitle.value = next.contextSubtitle || "";
  contextHtml.value = next.contextHtml || (next.currentResult?.mode === "report"
    ? next.currentResult.recommendationHtml || ""
    : "");
  supplementalHtml.value = next.supplementalHtml || "";
  utilityState.value = next.utility || utilityState.value;
  chatLoading.value = next.status === "running";
  chatError.value = next.status === "error" ? copy.value.reportError : "";
  memory.value = sessionMemoryToLocal(next);
  starterCards.value = next.starterCards || [];
  chatCurrentResult.value = next.currentResult?.mode === "chat" ? next.currentResult : null;
  const previousMessages = chatMessages.value;
  const lastAssistantIndex = next.messages.reduce(
    (index, message, currentIndex) => message.role === "assistant" ? currentIndex : index,
    -1
  );
  chatMessages.value = next.messages.map((message, messageIndex) => ({
    id: message.id || message.answerId || (previousMessages[messageIndex]?.role === message.role
      ? previousMessages[messageIndex]?.id
      : undefined) || `${message.role}-${messageIndex}`,
    role: message.role,
    content: message.content,
    ...(message.answerId ? { answerId: message.answerId } : {}),
    ...(message.contentHtml ? { contentHtml: message.contentHtml } : {}),
    ...(message.deepWindowId ? { deepWindowId: message.deepWindowId } : {}),
    ...(message.canOpenDeep !== undefined ? { canOpenDeep: message.canOpenDeep } : {}),
    ...(message.feedbackState ? { feedbackState: message.feedbackState } : {}),
    ...(next.status === "running" && message.role === "assistant" && messageIndex === lastAssistantIndex
      ? { streaming: true }
      : {})
  }));
  if (next.currentResult && next.currentResult.mode === "report") {
    const view = sessionResultToView(next.currentResult, reportPrompt.value || reportResult.value?.query || "");
    reportResult.value = view;
    rememberReportView(view);
    report.hasError.value = next.currentResult.ok === false;
    const answerId = next.currentResult.answerId;
    if (answerId) {
      const refreshedView = view;
      deepWindowsState.value.windows
        .filter((item) => item.result.sessionResult?.answerId === answerId)
        .forEach((item) => deepWindowController.updateResult(item.id, refreshedView));
    }
  } else if (!next.currentResult) {
    reportResult.value = null;
    reportHistory.value = [];
    report.hasError.value = false;
  }
}

function setMode(nextMode: ChatbotMode): void {
  mode.value = nextMode;
  props.session?.setMode(nextMode);
}

async function submitReport(): Promise<void> {
  if (props.session) {
    const query = reportPrompt.value.trim();
    if (!query || reportLoading.value) return;
    reportLoading.value = true;
    report.hasError.value = false;
    chatAbortController = new AbortController();
    const deepWindowId = deepWindowController.open(loadingReportView(query), {
      status: "loading",
      skeletonSteps: reportSkeletonSteps()
    });
    pendingReportDeepWindowId = deepWindowId;
    try {
      deepWindowController.updateSkeleton(deepWindowId, 2);
      const result = await props.session.submit(query, {
        signal: chatAbortController.signal,
        onProgress: (stage) => deepWindowController.updateSkeleton(deepWindowId, reportSkeletonStepForStage(stage))
      });
      deepWindowController.updateSkeleton(deepWindowId, 3);
      const view = sessionResultToView(result, query);
      reportResult.value = view;
      rememberReportView(view);
      report.hasError.value = !result.ok;
      feedbackRefreshKey.value += 1;
      if (result.status === "stopped" || result.stopped) {
        deepWindowController.cancel(deepWindowId);
      } else {
        deepWindowController.updateResult(deepWindowId, { ...view, title: query }, result.ok ? "ready" : "error");
      }
    } catch {
      report.hasError.value = true;
      deepWindowController.updateResult(deepWindowId, placeholderReportView(query, copy.value.reportError), "error");
    } finally {
      if (pendingReportDeepWindowId === deepWindowId) pendingReportDeepWindowId = null;
      chatAbortController = null;
      reportLoading.value = false;
    }
    return;
  }
  const query = reportPrompt.value.trim();
  if (!query || reportLoading.value) return;
  const deepWindowId = deepWindowController.open(loadingReportView(query), {
    status: "loading",
    skeletonSteps: reportSkeletonSteps()
  });
  deepWindowController.updateSkeleton(deepWindowId, 2);
  const result = await report.submit();
  deepWindowController.updateSkeleton(deepWindowId, 3);
  if (result) {
    rememberReportView(result);
    deepWindowController.updateResult(deepWindowId, { ...result, title: query }, "ready");
  } else deepWindowController.updateResult(deepWindowId, placeholderReportView(query, copy.value.reportError), "error");
}

function openDeep(historyId?: string): void {
  const historyItem = historyId ? reportHistory.value.find((item) => item.id === historyId) : null;
  const targetResult = historyItem?.result || reportResult.value;
  if (!targetResult) return;
  const existingId = targetResult.sessionResult?.deepWindowId;
  const answerId = targetResult.sessionResult?.answerId;
  const existing = deepWindowsState.value.windows.find((item) => (
    (existingId && item.id === existingId)
    || (answerId && item.result.sessionResult?.answerId === answerId)
    || (!answerId && item.mode === "report" && item.result.query === targetResult.query)
  ));
  if (existing) {
    deepWindowController.activate(existing.id);
    return;
  }
  if (!historyItem) {
    const sessionId = props.session?.openDeepWindow?.();
    if (sessionId) {
      deepWindowController.activate(sessionId);
      return;
    }
  }
  deepWindowController.open(targetResult);
}

function openChatAnswer(answerId: string): void {
  const id = props.session?.openChatAnswer?.(answerId) || null;
  if (id) deepWindowController.activate(id);
}

function setMemoryDropHighlight(active: boolean): void {
  memoryDropHighlighted.value = active;
}

function setStarterPrompt(prompt: string): void {
  chatInput.value = prompt;
}

function addReportToMemory(result = reportResult.value): void {
  if (!result) return;
  if (props.session?.addMemory) {
    props.session.addMemory(result.sessionResult || result);
    setMode("chat");
    return;
  }
  const item: ChatbotMemoryItem = {
    id: nextId("memory"),
    title: result.category || result.tier || result.intent,
    text: reportText(result),
    result
  };
  memory.value = [...memory.value.filter((entry) => entry.result?.query !== result.query), item].slice(-5);
  setMode("chat");
}

function removeMemory(id: string): void {
  props.session?.removeMemory(id);
  memory.value = memory.value.filter((item) => item.id !== id);
}

function addDeepWindowToMemory(id?: string): void {
  const active = id
    ? displayedDeepWindows.value.find((item) => item.id === id)
    : activeDisplayedDeepWindow.value;
  if (!active) return;
  deepWindowController.addToChat(active.id);
}

function activeDeepWindowId(): string | null {
  return activeDisplayedDeepWindow.value?.id || null;
}

function moveDeepWindowById(id: string, x: number, y: number): void {
  deepWindowController.move(id, x, y);
}

function exportDeepWindowById(id: string): void {
  deepWindowController.export(id);
}

function cancelDeepWindowById(id: string): void {
  if (pendingReportDeepWindowId === id) chatAbortController?.abort();
  deepWindowController.cancel(id);
}

function interactDeepWindowById(id: string, action: DeepWindowInteraction, value?: string): void {
  const window = displayedDeepWindows.value.find((item) => item.id === id);
  const current = props.session?.getState().currentResult;
  if (window?.result.sessionResult?.answerId && window.result.sessionResult.answerId === current?.answerId) {
    if (props.session?.interactContext?.(action, value)) return;
  }
  deepWindowController.interact(id, action, value);
}

function interactDeepWindowContext(id: string, action: string, value?: string): void {
  const window = displayedDeepWindows.value.find((item) => item.id === id);
  const current = props.session?.getState().currentResult;
  if (window?.result.sessionResult?.answerId && window.result.sessionResult.answerId === current?.answerId) {
    if (props.session?.interactContext?.(action, value)) return;
  }
  if (["trend-metric", "trend-category", "trend-column-toggle", "trend-column-core", "trend-column-all"].includes(action)) {
    deepWindowController.interact(id, action as DeepWindowInteraction, value);
  }
}

function setDeepWindowTrendColumns(id: string, columns: readonly string[]): void {
  deepWindowController.setTrendColumns(id, columns);
}

function memoryText(): string {
  return memory.value.map((item) => `[报告上下文] ${item.title}: ${item.text.slice(0, 8000)}`).join("\n---\n");
}

function updateStreamingMessage(id: string, content: string): void {
  chatMessages.value = chatMessages.value.map((message) => message.id === id ? { ...message, content, streaming: true } : message);
}

function appendAssistantMessage(content: string, streaming = false): string {
  const id = nextId("assistant");
  chatMessages.value = [...chatMessages.value, { id, role: "assistant", content, ...(streaming ? { streaming: true } : {}) }];
  return id;
}

async function submitChat(): Promise<void> {
  const prompt = chatInput.value.trim();
  if (!prompt || chatLoading.value) return;
  if (props.session) {
    chatInput.value = "";
    chatError.value = "";
    chatLoading.value = true;
    chatAbortController = new AbortController();
    try {
      const result = await props.session.submit(prompt, {
        signal: chatAbortController.signal,
        onToken: (token) => {
          const previous = chatMessages.value[chatMessages.value.length - 1]?.content || "";
          if (chatMessages.value[chatMessages.value.length - 1]?.role === "assistant") {
            updateStreamingMessage(chatMessages.value[chatMessages.value.length - 1]!.id, previous + token);
          }
        }
      });
      if (!result.ok && result.status !== "stopped") chatError.value = copy.value.reportError;
      if (result.status === "stopped") chatError.value = "";
      chatCurrentResult.value = result.mode === "chat" ? result : null;
      feedbackRefreshKey.value += 1;
    } catch {
      chatError.value = copy.value.reportError;
    } finally {
      chatLoading.value = false;
      chatAbortController = null;
    }
    return;
  }
  const history: ChatbotHistoryMessage[] = chatMessages.value.map(({ role, content }) => ({ role, content }));
  const userId = nextId("user");
  chatMessages.value = [...chatMessages.value, { id: userId, role: "user", content: prompt }];
  chatInput.value = "";
  chatError.value = "";
  chatLoading.value = true;
  chatAbortController = new AbortController();
  const assistantId = appendAssistantMessage("", true);
  const runner = props.runChat || streamChatbotReply;
  const request: ChatbotChatRequest = {
    prompt,
    language: props.language,
    history,
    memoryText: memoryText(),
    signal: chatAbortController.signal
  };
  try {
    const result: ChatbotChatResult = await runner(request, (token) => {
      const previous = chatMessages.value.find((message) => message.id === assistantId)?.content || "";
      updateStreamingMessage(assistantId, previous + token);
    });
    const response = result.response || "";
    chatMessages.value = chatMessages.value.map((message) => message.id === assistantId
      ? { ...message, content: response, streaming: false }
      : message);
    if (result.stopped) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      return;
    }
    if (!result.ok && !response.trim()) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      chatError.value = copy.value.reportError;
    } else if (!result.ok) {
      chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
      chatError.value = copy.value.reportError;
    }
  } catch {
    chatMessages.value = chatMessages.value.filter((message) => message.id !== userId && message.id !== assistantId);
    chatError.value = copy.value.reportError;
  } finally {
    chatLoading.value = false;
    chatAbortController = null;
  }
}

function stopChat(): void {
  chatAbortController?.abort();
}

onMounted(() => {
  if (props.session) {
    syncSessionState();
    stopSessionSubscription = props.session.onChange(syncSessionState);
  }
  syncDeepWindowState();
  stopDeepWindowSubscription = deepWindowController.onChange(syncDeepWindowState);
});

onBeforeUnmount(() => {
  chatAbortController?.abort();
  chatAbortController = null;
  stopSessionSubscription?.();
  stopSessionSubscription = null;
  stopDeepWindowSubscription?.();
  stopDeepWindowSubscription = null;
  if (!props.deepWindows) localDeepWindows.dispose();
});
</script>

<template>
  <main class="chatbot-modern-page" data-page="chatbot">
    <ChatbotOnboarding
      v-if="session"
      class="chatbot-page-onboarding"
      :language="language"
      :utility="utilityState"
      :available="Boolean(session.startOnboarding)"
      @start="startOnboarding"
      @next="nextOnboarding"
      @back="backOnboarding"
      @skip="skipOnboarding"
    />
    <ChatbotReportView
      v-if="mode === 'report'"
      :language="language"
      :prompt="reportPrompt"
      :result="reportResult"
      :history="reportHistory"
      :context-title="contextTitle"
      :context-subtitle="contextSubtitle"
      :context-html="contextHtml"
      :loading="reportLoading"
      :error="reportError"
      :auto-focus="autoFocus"
      :feedback="session?.feedback"
      :feedback-refresh-key="feedbackRefreshKey"
      :answer-id="reportAnswerId"
      :feedback-state="reportResult?.sessionResult?.feedbackState"
      :answer-feedback="reportAnswerFeedback"
      :supplemental-html="supplementalHtml"
      @update:prompt="reportPrompt = $event"
      @submit="submitReport"
      @open-deep="openDeep"
      @open-answer="openChatAnswer"
      @context-interact="interactContext"
      @add-memory="addReportToMemory()"
      @download-overview="downloadOverview"
      @download="downloadRecommendation"
    >
      <template #mode-controls>
        <button
          type="button"
          class="mode-btn mode-deep active"
          data-chatbot-mode-button="report"
          aria-selected="true"
          @click="setMode('report')"
        >
          <span class="mode-indicator"></span>
          <span>{{ copy.report }}</span>
        </button>
        <button
          type="button"
          class="mode-btn mode-fast"
          data-chatbot-mode-button="chat"
          aria-selected="false"
          @click="setMode('chat')"
        >
          <span class="mode-indicator"></span>
           <span>{{ copy.chat }}</span>
         </button>
        <ChatbotUtilityPanels
          v-if="session"
          :language="language"
          :utility="utilityState"
          :logs-available="Boolean(session.downloadLogs)"
          :clear-available="Boolean(session.clearConversation)"
          @help="toggleHelp"
          @guide="toggleGuide"
          @logs="downloadLogs"
          @clear="clearConversation"
        />
        <button v-if="false && session?.toggleHelp" type="button" class="mode-btn mode-help" data-chatbot-action="help" @click="toggleHelp">
          <span class="mode-help-icon">📖</span>
          <span>{{ utilityCopy.help }}</span>
        </button>
        <button v-if="false && session?.toggleGuide" type="button" class="mode-btn mode-user-guide" data-chatbot-action="guide" @click="toggleGuide">
          <span class="mode-help-icon" aria-hidden="true">i</span>
          <span>{{ utilityCopy.guide }}</span>
        </button>
        <div v-if="false && session?.downloadLogs" class="chat-logs-control">
          <details class="chatbot-modern-logs" data-chatbot-logs>
            <summary class="mode-btn mode-logs" data-chatbot-action="logs">
              <span class="mode-logs-icon" aria-hidden="true">↓</span>
              <span>{{ utilityCopy.logs }}</span>
            </summary>
            <div class="chat-logs-menu chatbot-modern-logs-menu">
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.questions }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
                </div>
              </div>
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.feedback }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </template>
    </ChatbotReportView>

    <ChatbotChatView
      v-else
      :language="language"
      :messages="chatMessages"
      :context-title="contextTitle"
      :context-subtitle="contextSubtitle"
      :context-html="contextHtml"
      :utility="utilityState"
      :memory="memory"
      :input="chatInput"
      :loading="chatLoading"
      :error="chatError"
      :feedback="session?.feedback"
      :feedback-refresh-key="feedbackRefreshKey"
      :feedback-for-answer="feedbackForAnswer"
      :drop-highlighted="memoryDropHighlighted"
      :supplemental-html="supplementalHtml"
      :starter-cards="starterCards"
      :current-result="chatCurrentResult"
      @update:input="chatInput = $event"
      @submit="submitChat"
      @stop="stopChat"
      @remove-memory="removeMemory"
      @starter-prompt="setStarterPrompt"
      @open-answer="openChatAnswer"
      @context-interact="interactContext"
      @download="downloadRecommendation"
    >
      <template #mode-controls>
        <button
          type="button"
          class="mode-btn mode-deep"
          data-chatbot-mode-button="report"
          aria-selected="false"
          @click="setMode('report')"
        >
          <span class="mode-indicator"></span>
          <span>{{ copy.report }}</span>
        </button>
        <button
          type="button"
          class="mode-btn mode-fast active"
          data-chatbot-mode-button="chat"
          aria-selected="true"
          @click="setMode('chat')"
        >
          <span class="mode-indicator"></span>
           <span>{{ copy.chat }}</span>
         </button>
        <ChatbotUtilityPanels
          v-if="session"
          :language="language"
          :utility="utilityState"
          :logs-available="Boolean(session.downloadLogs)"
          :clear-available="Boolean(session.clearConversation)"
          @help="toggleHelp"
          @guide="toggleGuide"
          @logs="downloadLogs"
          @clear="clearConversation"
        />
        <button v-if="false && session?.toggleHelp" type="button" class="mode-btn mode-help" data-chatbot-action="help" @click="toggleHelp">
          <span class="mode-help-icon">📖</span>
          <span>{{ utilityCopy.help }}</span>
        </button>
        <button v-if="false && session?.toggleGuide" type="button" class="mode-btn mode-user-guide" data-chatbot-action="guide" @click="toggleGuide">
          <span class="mode-help-icon" aria-hidden="true">i</span>
          <span>{{ utilityCopy.guide }}</span>
        </button>
        <div v-if="false && session?.downloadLogs" class="chat-logs-control">
          <details class="chatbot-modern-logs" data-chatbot-logs>
            <summary class="mode-btn mode-logs" data-chatbot-action="logs">
              <span class="mode-logs-icon" aria-hidden="true">↓</span>
              <span>{{ utilityCopy.logs }}</span>
            </summary>
            <div class="chat-logs-menu chatbot-modern-logs-menu">
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.questions }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="questions-csv" @click="downloadLogs('questions', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="questions-jsonl" @click="downloadLogs('questions', 'jsonl')">JSONL</button>
                </div>
              </div>
              <div class="chat-log-group" role="group">
                <span class="chat-log-group-title">{{ utilityCopy.feedback }}</span>
                <div class="chat-log-group-actions">
                  <button type="button" data-chatbot-log="feedback-csv" @click="downloadLogs('feedback', 'csv')">CSV</button>
                  <button type="button" data-chatbot-log="feedback-jsonl" @click="downloadLogs('feedback', 'jsonl')">JSONL</button>
                </div>
              </div>
            </div>
          </details>
        </div>
      </template>
    </ChatbotChatView>

    <DeepWindow
      v-for="window in displayedDeepWindows"
      :key="window.id"
      :id="window.id"
      :mode="window.mode"
      :language="language"
      :result="window.result"
      :minimized="window.minimized"
      :status="window.status"
      :position="window.position"
      :title="window.title"
      :summary="window.summary"
      :content-html="window.contentHtml"
      :error-message="window.errorMessage"
      :skeleton-steps="window.skeletonSteps"
      :z-index="window.zIndex"
      :can-cancel="window.canCancel"
      :can-add-memory="window.canAddMemory"
      :added-to-memory="window.addedToMemory"
      :can-export="window.canExport"
      :can-minimize="window.canMinimize"
      :can-close="window.canClose"
      :feedback-state="window.feedbackState"
      :feedback="feedbackForDeepWindow(window.id)"
      @activate="deepWindowController.activate(window.id)"
      @minimize="deepWindowController.minimize(window.id)"
      @restore="deepWindowController.restore(window.id)"
      @close="deepWindowController.close(window.id)"
      @add-memory="addDeepWindowToMemory(window.id)"
      @move="(x, y) => moveDeepWindowById(window.id, x, y)"
      @export="exportDeepWindowById(window.id)"
      @cancel="cancelDeepWindowById(window.id)"
      @download="downloadRecommendation"
      @context-interact="(action, value) => interactDeepWindowContext(window.id, action, value)"
      @trend-interact="(action, value) => interactDeepWindowById(window.id, action, value)"
      @trend-columns="(columns) => setDeepWindowTrendColumns(window.id, columns)"
      @drop-memory="addDeepWindowToMemory(window.id)"
      @drop-highlight="setMemoryDropHighlight"
    />
  </main>
</template>
