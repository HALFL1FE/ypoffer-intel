<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import DatePicker from "../../shared/components/DatePicker.vue";
import type { UiLanguage } from "../../shared/i18n";
import {
  addDays,
  periodDays,
  windowDates,
  type MediaRow,
  type PerformanceRow,
} from "./performanceModel";
import {
  comparison,
  merchantRows,
  priceBand,
  targetSummary,
  type ReviewBatch,
  type ReviewMedia,
  type ReviewReport,
  type ReviewRequest,
} from "./reviewModel";
import { reviewCatalog, reviewPost, reviewReport } from "./reviewApi";
import ReviewDailyChart from "./ReviewDailyChart.vue";
import "./offerReview.css";

const props = defineProps<{
  language: UiLanguage;
  download?: (rows: Record<string, unknown>[]) => void;
  catalogLoader?: typeof reviewCatalog;
  reportLoader?: typeof reviewReport;
}>();
const t = (zh: string, en: string) => (props.language === "zh" ? zh : en);
const batches = ref<ReviewBatch[]>([]),
  batchIds = ref<string[]>([]),
  report = ref<ReviewReport | null>(null);
const launch = ref(""),
  beforeStart = ref(""),
  beforeEnd = ref(""),
  start = ref(""),
  end = ref(""),
  auto = ref(true);
const loading = ref(false),
  error = ref(""),
  notice = ref(""),
  catalogLoading = ref(true);
const view = ref("merchants"),
  search = ref(""),
  priority = ref("all"),
  price = ref("all"),
  status = ref("all"),
  daily = ref(true),
  mediaId = ref("all");
const detail = ref<ReviewReport | null>(null),
  detailLoading = ref(false),
  detailError = ref(""),
  selected = ref(""),
  drawer = ref<HTMLDialogElement>();
const selectedMedia = ref("all");
const applied = ref<ReviewRequest | null>(null);
let request = 0,
  detailRequest = 0,
  disposed = false;
let abort: AbortController | undefined,
  detailAbort: AbortController | undefined,
  returnFocus: HTMLElement | null = null;
const drafts = ref<
  {
    fileBase64: string;
    sourceFile: string;
    listDate: string;
    logicalId: string;
    batch?: ReviewBatch;
    saved: boolean;
  }[]
>([]);
const importing = ref(false),
  importError = ref("");
const dateRange = computed(() =>
  windowDates(
    launch.value,
    start.value,
    end.value,
    beforeStart.value,
    beforeEnd.value,
  ),
);
const draftExcluded = computed(() =>
  batches.value.filter(
    (b) => batchIds.value.includes(b.id) && b.listDate > launch.value,
  ),
);
const allRows = computed(() =>
  report.value ? merchantRows(report.value) : [],
);
const compare = (before: number | null, after: number | null) =>
  report.value
    ? comparison(
        before,
        after,
        report.value.dateRange,
        report.value.availableThrough,
        daily.value,
      )
    : null;
const rows = computed(() =>
  allRows.value.filter((r) => {
    const click = compare(r.before.clicks, r.after.clicks),
      revenue = compare(r.before.revenue, r.after.revenue);
    return (
      `${r.merchantId} ${r.merchantName}`
        .toLowerCase()
        .includes(search.value.toLowerCase()) &&
      (priority.value === "all" ||
        (r.priority || "未识别 / Unknown") === priority.value) &&
      (price.value === "all" || priceBand(r) === price.value) &&
      (status.value === "all" ||
        (status.value === "inactive" && r.noActivity) ||
        (status.value === "click-up" &&
          ["up", "new"].includes(click?.state || "")) ||
        (status.value === "click-down" &&
          ["down", "zero"].includes(click?.state || "")) ||
        (status.value === "revenue-up" &&
          ["up", "new"].includes(revenue?.state || "")) ||
        (status.value === "revenue-down" &&
          ["down", "zero"].includes(revenue?.state || "")) ||
        (status.value === "missed" &&
          r.targets.targetCount > 0 &&
          r.targets.hitClicks === 0))
    );
  }),
);
const rowIds = computed(() => new Set(rows.value.map((r) => r.merchantId)));
const mediaRows = computed(() =>
  (report.value?.media || [])
    .filter(
      (m) =>
        rowIds.value.has(m.merchantId) &&
        (mediaId.value === "all" || m.publisherId === mediaId.value),
    )
    .sort(
      (a, b) =>
        (compare(a.before.clicks, a.after.clicks)?.delta ?? Infinity) -
        (compare(b.before.clicks, b.after.clicks)?.delta ?? Infinity),
    ),
);
const linkRows = computed(() =>
  (report.value?.links || []).filter(
    (m) =>
      rowIds.value.has(m.merchantId) &&
      (mediaId.value === "all" || m.publisherId === mediaId.value),
  ),
);
const shownLimit = ref(100);
const selectedRow = computed(() =>
  allRows.value.find((r) => r.merchantId === selected.value),
);
const selectedLinks = computed(() =>
  (detail.value?.links || []).filter(
    (m) =>
      selectedMedia.value === "all" || m.publisherId === selectedMedia.value,
  ),
);
const selectedMediaRows = computed(() =>
  (detail.value?.media || []).filter(
    (m) =>
      selectedMedia.value === "all" || m.publisherId === selectedMedia.value,
  ),
);
const detailChartRows = computed<PerformanceRow[]>(() =>
  selectedMedia.value === "all"
    ? detail.value?.merchants || []
    : selectedMediaRows.value.map((m) => ({
        ...m,
        daily: (m as ReviewMedia).daily || [],
        monthly: [],
      })),
);
const priorities = computed(() => [
  ...new Set(allRows.value.map((r) => r.priority || "未识别 / Unknown")),
]);
const prices = computed(() => [...new Set(allRows.value.map(priceBand))]);
const mediaOptions = computed(() => [
  ...new Map(
    (report.value?.media || [])
      .filter((m) => rowIds.value.has(m.merchantId))
      .map((m) => [m.publisherId, m.publisherName]),
  ).entries(),
]);
const dirty = computed(
  () =>
    applied.value &&
    JSON.stringify(applied.value) !== JSON.stringify(currentRequest()),
);
const f = (n: number | null | undefined) =>
  n == null
    ? "—"
    : new Intl.NumberFormat(props.language === "zh" ? "zh-CN" : "en-US", {
        maximumFractionDigits: 2,
      }).format(n);
const ratio = (n: number, d: number) =>
  d ? `${f((n / d) * 100)}% (${f(n)}/${f(d)})` : `— (${f(n)}/0)`;
function stateLabel(state: string) {
  return (
    (
      {
        up: t("增长", "Growth"),
        down: t("降低", "Decline"),
        zero: t("归零", "Stopped"),
        new: t("新增 / 无基数", "New / no baseline"),
        same: t("持平", "Unchanged"),
        pending: t("观察未完成", "Incomplete"),
      } as Record<string, string>
    )[state] || "—"
  );
}
function movement(
  m: {
    before: { clicks: number | null; revenue: number | null };
    after: { clicks: number | null; revenue: number | null };
  },
  key: "clicks" | "revenue",
) {
  const c = compare(m.before[key], m.after[key]);
  return c
    ? `${stateLabel(c.state)}${c.rate === null ? "" : ` ${c.rate > 0 ? "+" : ""}${f(c.rate * 100)}%`}`
    : "—";
}
const name = (id: string) =>
  allRows.value.find((r) => r.merchantId === id)?.merchantName || id;
const target = (m: MediaRow) =>
  m.asin ||
  (m.linkType === "storefront"
    ? "Storefront"
    : m.linkType === "product"
      ? t("单品 ASIN 未知", "Product ASIN unknown")
      : t("目标未知", "Unknown destination"));
const isRecommended = (m: MediaRow) =>
  allRows.value
    .find((o) => o.merchantId === m.merchantId)
    ?.asins.includes(m.asin);
const isHistoricalTop = (m: MediaRow) =>
  allRows.value
    .find((o) => o.merchantId === m.merchantId)
    ?.top.includes(m.asin) || false;
function linkClicks(
  links: MediaRow[],
  kind: string,
  period: "before" | "after",
) {
  return links
    .filter((l) =>
      kind === "product"
        ? ["asin", "product"].includes(l.linkType)
        : l.linkType === kind,
    )
    .reduce((s, l) => s + (l[period].clicks || 0), 0);
}
function mediaEvidence(m: MediaRow, source = report.value?.links || []) {
  const links = source.filter(
    (l) => l.merchantId === m.merchantId && l.publisherId === m.publisherId,
  );
  return `${t("单品", "Product")} ${f(linkClicks(links, "product", "before"))} → ${f(linkClicks(links, "product", "after"))} · Storefront ${f(linkClicks(links, "storefront", "before"))} → ${f(linkClicks(links, "storefront", "after"))}`;
}
function equalize() {
  if (auto.value && launch.value && start.value && end.value) {
    beforeEnd.value = addDays(launch.value, -1);
    beforeStart.value = addDays(
      launch.value,
      -periodDays(start.value, end.value),
    );
  }
}
function changeLaunch(value: string) {
  const length = Math.max(1, periodDays(start.value, end.value) || 14);
  launch.value = value;
  if (auto.value) {
    start.value = value;
    end.value = addDays(value, length - 1);
    equalize();
  }
}
function currentRequest(): ReviewRequest {
  return {
    temporaryBatches: batches.value.filter((b) => b.temporary),
    batchIds: [...batchIds.value].sort(),
    launchDate: launch.value,
    startDate: start.value,
    endDate: end.value,
    beforeStart: beforeStart.value,
    beforeEnd: beforeEnd.value,
  };
}
async function initialize() {
  catalogLoading.value = true;
  error.value = "";
  try {
    const result = await (props.catalogLoader || reviewCatalog)();
    if (disposed) return;
    batches.value = [
      ...result.batches,
      ...batches.value.filter((b) => b.temporary),
    ];
    if (!launch.value && batches.value.length) {
      const latest = [...batches.value].sort((a, b) =>
        b.listDate.localeCompare(a.listDate),
      )[0]!;
      batchIds.value = [latest.id];
      launch.value = latest.listDate;
      start.value = latest.listDate;
      end.value = addDays(start.value, 13);
      equalize();
    }
  } catch (e) {
    error.value = errorText(e);
  } finally {
    catalogLoading.value = false;
  }
}
const errorText = (e: unknown) =>
  e instanceof Error
    ? e.message
    : t("请求失败，请重试。", "Request failed. Retry.");
async function apply() {
  if (!dateRange.value || !batchIds.value.length) {
    error.value = t(
      "请选清单并检查日期：前期结束 < 推荐日 ≤ 后期开始。",
      "Select lists and validate: before end < recommendation ≤ after start.",
    );
    return;
  }
  abort?.abort();
  abort = new AbortController();
  const revision = ++request;
  loading.value = true;
  error.value = "";
  closeDetail();
  const requestBody = currentRequest();
  try {
    const result = await (props.reportLoader || reviewReport)(
      requestBody,
      abort.signal,
    );
    if (revision !== request || disposed) return;
    report.value = result;
    applied.value = requestBody;
    shownLimit.value = 100;
    mediaId.value = "all";
  } catch (e) {
    if (revision === request) error.value = errorText(e);
  } finally {
    if (revision === request) loading.value = false;
  }
}
async function openDetail(id: string) {
  if (!applied.value) return;
  returnFocus = document.activeElement as HTMLElement;
  selected.value = id;
  selectedMedia.value = "all";
  detail.value = null;
  detailError.value = "";
  detailLoading.value = true;
  detailAbort?.abort();
  detailAbort = new AbortController();
  const revision = ++detailRequest;
  await nextTick();
  drawer.value?.showModal();
  try {
    const result = await (props.reportLoader || reviewReport)(
      { ...applied.value, merchantId: id },
      detailAbort.signal,
    );
    if (revision === detailRequest && !disposed) detail.value = result;
  } catch (e) {
    if (revision === detailRequest) detailError.value = errorText(e);
  } finally {
    if (revision === detailRequest) detailLoading.value = false;
  }
}
function closeDetail() {
  detailRequest++;
  detailAbort?.abort();
  drawer.value?.close();
  selected.value = "";
  returnFocus?.focus();
}
async function chooseFiles(event: Event) {
  importError.value = "";
  const files = Array.from((event.target as HTMLInputElement).files || []);
  if (files.length > 10) {
    importError.value = t(
      "每次最多 10 份 XLSX。",
      "Choose up to 10 XLSX files.",
    );
    return;
  }
  drafts.value = [];
  importing.value = true;
  try {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(".xlsx") || file.size > 2_500_000)
        throw new Error(
          t(
            "每个文件需为 XLSX，且不超过 2.5 MB。",
            "Each file must be XLSX and at most 2.5 MB.",
          ),
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      const match = file.name.match(/\((\d{1,2})[-/](\d{1,2})\)/);
      const year = launch.value.slice(0, 4) || String(new Date().getFullYear());
      const suggestion = match
        ? `${year}-${match[1]!.padStart(2, "0")}-${match[2]!.padStart(2, "0")}`
        : launch.value;
      drafts.value.push({
        fileBase64: btoa(binary),
        sourceFile: file.name,
        listDate: suggestion,
        logicalId: "",
        saved: false,
      });
    }
  } catch (e) {
    importError.value = errorText(e);
  } finally {
    importing.value = false;
  }
}
async function previewImport(index: number) {
  const draft = drafts.value[index]!;
  importing.value = true;
  importError.value = "";
  try {
    const result = await reviewPost<{ batch: ReviewBatch }>({
      action: "review-preview",
      ...draft,
      batch: undefined,
    });
    draft.batch = result.batch;
  } catch (e) {
    importError.value = errorText(e);
  } finally {
    importing.value = false;
  }
}
async function saveImport(index: number) {
  const draft = drafts.value[index]!;
  if (
    !draft.batch ||
    draft.batch.errors?.length ||
    draft.batch.listDate !== draft.listDate
  )
    return;
  importing.value = true;
  importError.value = "";
  try {
    const result = await reviewPost<{ batch: ReviewBatch }>({
      action: "review-import",
      ...draft,
      batch: undefined,
    });
    const existing = batches.value.find((b) => b.id === result.batch.id);
    if (existing && existing.listDate !== result.batch.listDate)
      throw new Error(
        t(
          "本次已按其他日期导入此文件；请先移除该临时清单再重新导入。",
          "This file already has a different date; remove its temporary list before re-importing.",
        ),
      );
    if (!existing && batches.value.filter((b) => b.temporary).length >= 30)
      throw new Error(
        t("本次最多 30 份临时清单。", "At most 30 temporary lists."),
      );
    if (!existing) batches.value.push(result.batch);
    draft.saved = true;
    draft.fileBase64 = "";
    if (!batchIds.value.includes(result.batch.id))
      batchIds.value.push(result.batch.id);
    notice.value = existing
      ? t(
          "同文件已导入，未重复计数。",
          "Existing file reused; import count unchanged.",
        )
      : t(
          "已加入本次临时查看，并记录本次导入时间。刷新或离开此视图后清除。",
          "Added to this temporary review with its session import time. Refreshing or leaving this view clears it.",
        );
    await initialize();
  } catch (e) {
    importError.value = errorText(e);
  } finally {
    importing.value = false;
  }
}
function exportRows() {
  if (!report.value || !applied.value) return;
  const r = report.value;
  const params = {
    Recommendation: applied.value.launchDate,
    BeforeStart: r.dateRange.beforeStart,
    BeforeEnd: r.dateRange.beforeEnd,
    AfterStart: r.dateRange.startDate,
    AfterEnd: r.dateRange.endDate,
    AvailableThrough: r.availableThrough,
    Currency: "USD",
    Mode: daily.value ? "daily-average" : "total",
    SelectedLists: applied.value.batchIds.join(","),
    ExcludedLists: r.excludedBatchIds.join(","),
    Evidence:
      "Observed clicks, not publication count; before-after changes are not causal attribution",
  };
  const output: Record<string, unknown>[] = rows.value.map((o) => ({
    ...params,
    RecordType: "merchant",
    MerchantID: o.merchantId,
    Merchant: o.merchantName,
    Priority: o.priority,
    PriceBand: priceBand(o),
    Imports: o.importCount,
    Lists: o.listCount,
    EffectiveList: o.listName,
    BeforeClicks: o.before.clicks,
    AfterClicks: o.after.clicks,
    BeforeRevenue: o.before.revenue,
    AfterRevenue: o.after.revenue,
    ClickChange: movement(o, "clicks"),
    RevenueChange: movement(o, "revenue"),
    TargetClicks: o.targets.hitClicks,
    AllClicks: o.targets.total,
    ProductClicks: o.targets.productClicks,
    TargetASINs: o.asins.join(","),
    HistoricalTopASINs: o.top.join(","),
    Reason: o.notes,
  }));
  for (const m of mediaRows.value)
    output.push({
      ...params,
      RecordType: "media",
      MerchantID: m.merchantId,
      Merchant: name(m.merchantId),
      PublisherID: m.publisherId,
      Publisher: m.publisherName,
      BeforeClicks: m.before.clicks,
      AfterClicks: m.after.clicks,
      BeforeRevenue: m.before.revenue,
      AfterRevenue: m.after.revenue,
      ClickChange: movement(m, "clicks"),
      RevenueChange: movement(m, "revenue"),
      Evidence: mediaEvidence(m),
    });
  for (const m of linkRows.value)
    output.push({
      ...params,
      RecordType: "target",
      MerchantID: m.merchantId,
      PublisherID: m.publisherId,
      Publisher: m.publisherName,
      ASIN: m.asin,
      PurchasedASIN: m.purchasedAsin,
      LinkType: m.linkType,
      Recommended: isRecommended(m),
      HistoricalTop: isHistoricalTop(m),
      BeforeClicks: m.before.clicks,
      AfterClicks: m.after.clicks,
      BeforeRevenue: m.before.revenue,
      AfterRevenue: m.after.revenue,
    });
  for (const o of rows.value) {
    for (const h of o.history || [])
      output.push({
        ...params,
        RecordType: "import-history",
        MerchantID: o.merchantId,
        List: h.name,
        ListDate: h.listDate,
        ImportedAt: h.importedAt,
        ImportedBy: h.importedBy,
      });
    for (const d of o.daily)
      output.push({
        ...params,
        RecordType: "daily",
        MerchantID: o.merchantId,
        Date: d.date,
        Clicks: d.clicks,
        Revenue: d.revenue,
      });
  }
  props.download?.(output);
}
onMounted(initialize);
onBeforeUnmount(() => {
  disposed = true;
  abort?.abort();
  detailAbort?.abort();
  drawer.value?.close();
});
</script>

<template>
  <div class="offer-review">
    <section class="promotion-panel review-setup">
      <div class="review-toolbar">
        <div>
          <h3>
            {{
              t(
                "清单 × 媒体 · 推荐前后复盘",
                "Lists × publishers · Before and after review",
              )
            }}
          </h3>
          <p>
            {{
              t(
                "选择一份或多份清单，以推荐日期冻结目标，再查看真实媒体活动。",
                "Select lists, freeze targets as of the recommendation date, then review publisher activity.",
              )
            }}
          </p>
        </div>
        <button @click="initialize" :disabled="catalogLoading">
          {{ t("刷新清单", "Refresh lists") }}
        </button>
      </div>
      <p v-if="catalogLoading" role="status">
        {{ t("正在读取清单…", "Loading lists…") }}
      </p>
      <p class="review-warning">
        {{
          t(
            "临时查看：导入内容仅保留在本页面内存，刷新或离开复盘视图即清除。本次导入次数不代表历史导入次数，请用 Excel 导出保留分析。",
            "Temporary review: imports live only in page memory and clear on refresh or leaving this view. Session counts are not lifetime counts. Export Excel to retain your analysis.",
          )
        }}
      </p>
      <div class="review-lists">
        <label
          v-for="b in batches"
          :key="b.id"
          :class="{ 'review-future': b.listDate > launch }"
          ><input
            v-model="batchIds"
            type="checkbox"
            :value="b.id"
            :disabled="loading"
          />
          <span
            ><strong>{{ b.name }}</strong
            ><small
              >{{ b.listDate }} · {{ b.offers.length }}
              {{ t("商家", "merchants") }} ·
              {{
                b.importedAt
                  ? t("本次临时导入", "Temporary session import")
                  : t("历史导入时间未记录", "Historical import time unknown")
              }}</small
            ></span
          ></label
        >
      </div>
      <div class="review-tabs">
        <button
          v-for="b in batches.filter((b) => b.temporary)"
          :key="b.id"
          @click="
            batches = batches.filter((x) => x.id !== b.id);
            batchIds = batchIds.filter((id) => id !== b.id);
          "
        >
          {{ t("移除临时清单", "Remove temporary list") }} · {{ b.name }}
        </button>
      </div>
      <div class="review-date-grid">
        <label
          >{{
            t("推荐日期（分析锚点）", "Recommendation date (analysis anchor)")
          }}<DatePicker
            :model-value="launch"
            @update:model-value="changeLaunch"
            :language="language"
            :label="t('推荐日期', 'Recommendation date')"
        /></label>
        <label
          >{{ t("推荐前开始", "Before start")
          }}<DatePicker
            v-model="beforeStart"
            :disabled="auto"
            :language="language"
            :label="t('推荐前开始', 'Before start')" /></label
        ><label
          >{{ t("推荐前结束", "Before end")
          }}<DatePicker
            v-model="beforeEnd"
            :disabled="auto"
            :language="language"
            :label="t('推荐前结束', 'Before end')"
        /></label>
        <label
          >{{ t("推荐后开始", "After start")
          }}<DatePicker
            :model-value="start"
            @update:model-value="
              (v) => {
                start = v;
                equalize();
              }
            "
            :language="language"
            :label="t('推荐后开始', 'After start')" /></label
        ><label
          >{{ t("截止日期", "Cutoff date")
          }}<DatePicker
            :model-value="end"
            @update:model-value="
              (v) => {
                end = v;
                equalize();
              }
            "
            :language="language"
            :label="t('截止日期', 'Cutoff date')"
        /></label>
      </div>
      <div class="review-toolbar">
        <label
          ><input v-model="auto" type="checkbox" @change="equalize" />
          {{ t("前期自动等长", "Match before period length") }}</label
        ><button
          class="primary"
          :disabled="loading || catalogLoading"
          @click="apply"
        >
          {{
            loading
              ? t("正在复盘…", "Loading review…")
              : t("应用清单与时间", "Apply lists and dates")
          }}
        </button>
      </div>
      <p v-if="draftExcluded.length" class="review-warning">
        {{
          t(
            "按当前推荐日屏蔽未来清单：",
            "Future lists excluded as of this recommendation: ",
          )
        }}{{ draftExcluded.map((b) => b.name).join("、") }}
      </p>
      <p v-if="dirty" class="review-warning">
        {{
          t(
            "筛选日期或清单已修改，下方仍显示上次应用的结果。",
            "Draft dates or lists changed. Results still show the last applied scope.",
          )
        }}
      </p>
      <details class="review-import">
        <summary>
          {{
            t(
              "导入一份或多份 Offer（XLSX）",
              "Import one or more offer lists (XLSX)",
            )
          }}
        </summary>
        <p>
          {{
            t(
              "清单日期与推荐日独立。文件名中的日期仅作建议，请核对年份。原表颜色等级和推荐理由保留在本次临时分析中。",
              "List date is separate from recommendation date. Filename dates are suggestions: verify the year. Source color priorities and reasons remain in this temporary review.",
            )
          }}
        </p>
        <input
          type="file"
          multiple
          accept=".xlsx"
          :disabled="importing"
          @change="chooseFiles"
          :aria-label="t('选择 Offer 文件', 'Choose offer files')"
        />
        <div v-for="(d, i) in drafts" :key="i" class="review-import-file">
          <strong>{{ d.sourceFile }}</strong
          ><DatePicker
            v-model="d.listDate"
            :language="language"
            :disabled="d.saved || importing"
            :label="t('清单日期', 'List date')"
          /><label
            >{{
              t(
                "修订哪份清单（可选）",
                "Revision of an existing list (optional)",
              )
            }}<select v-model="d.logicalId" :disabled="d.saved || importing">
              <option value="">
                {{ t("新的逻辑清单", "New logical list") }}
              </option>
              <option v-for="b in batches" :key="b.id" :value="b.logicalId">
                {{ b.name }}
              </option>
            </select></label
          ><button :disabled="d.saved || importing" @click="previewImport(i)">
            {{ t("解析并预览", "Parse and preview") }}
          </button>
          <div v-if="d.batch">
            <p>
              {{ d.batch.offers.length }}
              {{ t("去重商家", "unique merchants") }} · {{ d.batch.listDate }}
            </p>
            <p
              v-for="warning in d.batch.warnings"
              :key="warning"
              class="review-warning"
            >
              {{ warning }}
            </p>
            <p v-for="problem in d.batch.errors" :key="problem" role="alert">
              {{ problem }}
            </p>
            <details>
              <summary>
                {{
                  t(
                    "核对所有商家、等级和目标",
                    "Inspect all merchants, priorities and targets",
                  )
                }}
              </summary>
              <div class="promotion-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Merchant ID</th>
                      <th>
                        {{ t("商家 / 原表等级", "Merchant / source priority") }}
                      </th>
                      <th>{{ t("产品表 ASIN", "Product-list ASINs") }}</th>
                      <th>
                        {{
                          t("理由 ASIN / 原文", "Reason ASINs / source text")
                        }}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="o in d.batch.offers" :key="o.merchantId">
                      <td>{{ o.merchantId }}</td>
                      <td>
                        {{ o.merchantName }}<small>{{ o.priority }}</small>
                      </td>
                      <td>{{ o.productAsins?.join(", ") }}</td>
                      <td>
                        {{ o.reasonAsins?.join(", ")
                        }}<small>{{ o.notes }}</small>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </details>
            <button
              class="primary"
              :disabled="
                d.saved ||
                importing ||
                Boolean(d.batch.errors?.length) ||
                d.batch.listDate !== d.listDate
              "
              @click="saveImport(i)"
            >
              {{
                d.saved
                  ? t("已加入本次查看", "Added to this review")
                  : t("确认加入临时查看", "Add to temporary review")
              }}
            </button>
          </div>
        </div>
        <p v-if="importError" role="alert">{{ importError }}</p>
        <p role="status">{{ notice }}</p>
      </details>
    </section>
    <p v-if="error" class="review-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div class="review-data-note">
        <strong
          >{{ report.dateRange.beforeStart }} —
          {{ report.dateRange.beforeEnd }} → {{ report.dateRange.startDate }} —
          {{ report.dateRange.endDate }}</strong
        ><span
          >{{ t("数据最近日期", "Latest source date") }}:
          {{ report.availableThrough }} · USD</span
        >
        <p>
          {{
            t(
              "媒体推广量以点击记录为证据，不等于发帖数。最新记录日期不保证每天完整回传；前后变化不能单独证明推荐的因果效果。",
              "Promotion volume uses click evidence, not post counts. The latest source date does not prove complete ingestion. Before/after changes alone do not establish causation.",
            )
          }}
        </p>
      </div>
      <div class="review-cards">
        <button
          v-for="card in [
            { id: 'all', zh: '全部商家', en: 'All merchants' },
            {
              id: 'inactive',
              zh: '两期未见活动',
              en: 'No activity in either window',
            },
            { id: 'click-up', zh: '媒体点击增长', en: 'Click growth' },
            { id: 'click-down', zh: '媒体点击降低', en: 'Click decline' },
            { id: 'revenue-up', zh: '收入上升', en: 'Revenue growth' },
            { id: 'revenue-down', zh: '收入下降', en: 'Revenue decline' },
          ]"
          :key="card.id"
          :aria-pressed="status === card.id"
          @click="
            status = card.id;
            view = card.id === 'inactive' ? 'followup' : 'merchants';
          "
        >
          <span>{{ t(card.zh, card.en) }}</span
          ><strong>{{
            allRows.filter(
              (r) =>
                card.id === "all" ||
                (card.id === "inactive" && r.noActivity) ||
                (card.id === "click-up" &&
                  ["up", "new"].includes(
                    compare(r.before.clicks, r.after.clicks)?.state || "",
                  )) ||
                (card.id === "click-down" &&
                  ["down", "zero"].includes(
                    compare(r.before.clicks, r.after.clicks)?.state || "",
                  )) ||
                (card.id === "revenue-up" &&
                  ["up", "new"].includes(
                    compare(r.before.revenue, r.after.revenue)?.state || "",
                  )) ||
                (card.id === "revenue-down" &&
                  ["down", "zero"].includes(
                    compare(r.before.revenue, r.after.revenue)?.state || "",
                  )),
            ).length
          }}</strong>
        </button>
      </div>
      <section class="promotion-panel">
        <div class="review-toolbar">
          <input
            v-model="search"
            :placeholder="
              t('搜索商家 / Merchant ID', 'Search merchant / Merchant ID')
            "
            :aria-label="t('搜索商家', 'Search merchants')"
          /><select
            v-model="priority"
            :aria-label="t('原表等级', 'Source priority')"
          >
            <option value="all">
              {{ t("所有原表等级", "All source priorities") }}
            </option>
            <option v-for="p in priorities" :key="p">{{ p }}</option></select
          ><select v-model="price" :aria-label="t('客单价分层', 'AOV band')">
            <option value="all">
              {{ t("所有价格层", "All price bands") }}
            </option>
            <option v-for="p in prices" :key="p">{{ p }}</option></select
          ><select
            v-model="status"
            :aria-label="t('变化状态', 'Change status')"
          >
            <option value="all">{{ t("所有状态", "All states") }}</option>
            <option value="inactive">
              {{ t("两期未见活动", "No activity") }}
            </option>
            <option value="click-up">
              {{ t("点击增长", "Click growth") }}
            </option>
            <option value="click-down">
              {{ t("点击降低", "Click decline") }}
            </option>
            <option value="revenue-up">
              {{ t("收入上升", "Revenue growth") }}
            </option>
            <option value="revenue-down">
              {{ t("收入下降", "Revenue decline") }}
            </option>
            <option value="missed">
              {{ t("推荐目标零点击", "No recommended-target clicks") }}
            </option></select
          ><label
            ><input v-model="daily" type="checkbox" />
            {{ t("按日均比较", "Compare daily averages") }}</label
          ><button :disabled="!download" @click="exportRows">
            {{ t("导出筛选范围完整明细", "Export full filtered details") }}
          </button>
        </div>
        <small>{{
          t(
            "原表等级独立于网站 Tier；价格层使用原表 AOV 作为代理，不代表每个单品售价。",
            "Source priority is separate from website Tier. Price bands use source AOV as a proxy, not individual product price.",
          )
        }}</small>
      </section>
      <ReviewDailyChart
        :rows="rows"
        :range="report.dateRange"
        :through="report.availableThrough"
        :recommendation="report.recommendationDate"
        :language="language"
      />
      <section class="promotion-panel">
        <nav class="review-tabs" :aria-label="t('复盘视图', 'Review views')">
          <button
            v-for="tab in [
              { id: 'merchants', zh: '商家总览', en: 'Merchants' },
              { id: 'media', zh: '媒体变化', en: 'Publishers' },
              { id: 'targets', zh: '单品与推荐命中', en: 'Targets & coverage' },
              { id: 'followup', zh: '待跟进', en: 'Follow-up' },
              { id: 'history', zh: '清单与导入记录', en: 'Import history' },
            ]"
            :key="tab.id"
            :aria-pressed="view === tab.id"
            @click="
              view = tab.id;
              shownLimit = 100;
            "
          >
            {{ t(tab.zh, tab.en) }}
          </button>
        </nav>
        <label v-if="['media', 'targets'].includes(view)"
          >{{ t("媒体", "Publisher") }}
          <select v-model="mediaId">
            <option value="all">{{ t("所有媒体", "All publishers") }}</option>
            <option
              v-for="[id, publisher] in mediaOptions"
              :key="id"
              :value="id"
            >
              {{ publisher || t("未知媒体", "Unknown publisher") }} · {{ id }}
            </option>
          </select></label
        >
        <div v-if="view === 'merchants'" class="promotion-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t("商家 / 有效清单", "Merchant / effective list") }}</th>
                <th>{{ t("等级 / 价格", "Priority / price") }}</th>
                <th>
                  {{ t("本次导入 / 清单次数", "Session imports / lists") }}
                </th>
                <th>{{ t("活动媒体", "Active publishers") }}</th>
                <th>{{ t("点击 前 → 后", "Clicks before → after") }}</th>
                <th>{{ t("推荐占比", "Recommended share") }}</th>
                <th>Revenue USD {{ t("前 → 后", "before → after") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in rows" :key="r.merchantId">
                <td>
                  <button @click="openDetail(r.merchantId)">
                    {{ r.merchantName }}</button
                  ><small
                    >{{ r.merchantId }} · {{ r.listDate }}<br />{{
                      r.listName
                    }}</small
                  >
                </td>
                <td>
                  {{ r.priority || t("未识别", "Unknown")
                  }}<small>{{ priceBand(r) }}</small>
                </td>
                <td>{{ r.importCount }} / {{ r.listCount }}</td>
                <td>{{ r.activeMedia }}</td>
                <td>
                  {{ f(compare(r.before.clicks, r.after.clicks)?.before) }} →
                  {{ f(compare(r.before.clicks, r.after.clicks)?.after)
                  }}<small>{{ movement(r, "clicks") }}</small
                  ><small
                    >{{ t("总量", "Totals") }} {{ f(r.before.clicks) }} →
                    {{ f(r.after.clicks) }}</small
                  >
                </td>
                <td>
                  {{ ratio(r.targets.hitClicks, r.targets.total)
                  }}<small
                    >{{ t("命中 ASIN / 推荐目标", "Hit ASINs / targets") }}
                    {{ r.targets.hitAsins }}/{{ r.targets.targetCount }}</small
                  >
                </td>
                <td>
                  {{ f(compare(r.before.revenue, r.after.revenue)?.before) }} →
                  {{ f(compare(r.before.revenue, r.after.revenue)?.after)
                  }}<small>{{ movement(r, "revenue") }}</small
                  ><small
                    >{{ t("总量", "Totals") }} {{ f(r.before.revenue) }} →
                    {{ f(r.after.revenue) }}</small
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else-if="view === 'media'" class="promotion-scroll">
          <p>
            {{
              t(
                "按点击变化从低到高排序。收入下降是媒体归因变化，不自动解释为媒体少发帖；请结合点击、店铺/单品结构和媒体反馈核查。",
                "Sorted by click change. Attributed revenue decline does not prove fewer posts; inspect clicks, target mix and publisher feedback.",
              )
            }}
          </p>
          <table>
            <thead>
              <tr>
                <th>{{ t("商家", "Merchant") }}</th>
                <th>{{ t("媒体", "Publisher") }}</th>
                <th>{{ t("点击 前 → 后", "Clicks before → after") }}</th>
                <th>{{ t("收入 前 → 后", "Revenue before → after") }}</th>
                <th>
                  {{
                    t(
                      "单品 / Storefront 总点击",
                      "Product / storefront total clicks",
                    )
                  }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="m in mediaRows.slice(0, shownLimit)"
                :key="`${m.merchantId}-${m.publisherId}`"
              >
                <td>
                  <button @click="openDetail(m.merchantId)">
                    {{ name(m.merchantId) }}
                  </button>
                </td>
                <td>
                  {{ m.publisherName || t("未知媒体", "Unknown publisher")
                  }}<small>{{ m.publisherId }}</small>
                </td>
                <td>
                  {{ f(compare(m.before.clicks, m.after.clicks)?.before) }} →
                  {{ f(compare(m.before.clicks, m.after.clicks)?.after)
                  }}<small>{{ movement(m, "clicks") }}</small>
                </td>
                <td>
                  {{ f(compare(m.before.revenue, m.after.revenue)?.before) }} →
                  {{ f(compare(m.before.revenue, m.after.revenue)?.after)
                  }}<small>{{ movement(m, "revenue") }}</small>
                </td>
                <td>{{ mediaEvidence(m) }}</td>
              </tr>
            </tbody>
          </table>
          <button
            v-if="shownLimit < mediaRows.length"
            @click="shownLimit += 100"
          >
            {{ t("加载更多", "Show more") }} ({{ mediaRows.length }})
          </button>
        </div>
        <div v-else-if="view === 'targets'" class="promotion-scroll">
          <p>
            {{
              t(
                "“历史 Top 3”仅按推荐前 USD 购买次数排名（收入次序打破并列）；与清单推荐目标分别标记。购买 ASIN 不是推广链接目标。",
                "Historical Top 3 ranks pre-period USD purchase counts, then revenue. It is separate from recommended targets. Purchased ASIN is not promoted destination.",
              )
            }}
          </p>
          <table>
            <thead>
              <tr>
                <th>{{ t("商家 / 媒体", "Merchant / publisher") }}</th>
                <th>{{ t("推广目标", "Promoted destination") }}</th>
                <th>
                  {{ t("推荐 / 历史 Top", "Recommended / historical Top") }}
                </th>
                <th>
                  {{ t("点击总量 前 → 后", "Total clicks before → after") }}
                </th>
                <th>
                  {{
                    t(
                      "购买 ASIN（独立证据）",
                      "Purchased ASIN (separate evidence)",
                    )
                  }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(m, i) in linkRows.slice(0, shownLimit)" :key="i">
                <td>
                  <button @click="openDetail(m.merchantId)">
                    {{ name(m.merchantId) }}</button
                  ><small>{{ m.publisherName }} · {{ m.publisherId }}</small>
                </td>
                <td>{{ target(m) }}</td>
                <td>
                  {{
                    isRecommended(m)
                      ? t("清单推荐", "Recommended")
                      : t("清单外 / 未知", "Outside list / unknown")
                  }}<small>{{
                    isHistoricalTop(m) ? "Historical Top 3" : "—"
                  }}</small>
                </td>
                <td>{{ f(m.before.clicks) }} → {{ f(m.after.clicks) }}</td>
                <td>{{ m.purchasedAsin || "—" }}</td>
              </tr>
            </tbody>
          </table>
          <button
            v-if="shownLimit < linkRows.length"
            @click="shownLimit += 100"
          >
            {{ t("加载更多", "Show more") }} ({{ linkRows.length }})
          </button>
        </div>
        <div v-else-if="view === 'followup'" class="review-followup">
          <p>
            {{
              t(
                "“两期未见活动”仅限当前查询区间，不能断言商家历史上从未被推广。以下是待核实的问题，不是已确认原因。",
                "No activity refers only to these queried windows, not lifetime history. These questions require investigation; they are not established causes.",
              )
            }}
          </p>
          <article
            v-for="r in rows.filter(
              (r) =>
                r.noActivity ||
                ['down', 'zero'].includes(
                  compare(r.before.clicks, r.after.clicks)?.state || '',
                ) ||
                ['down', 'zero'].includes(
                  compare(r.before.revenue, r.after.revenue)?.state || '',
                ) ||
                (r.targets.targetCount > 0 && r.targets.hitClicks === 0),
            )"
            :key="r.merchantId"
          >
            <button @click="openDetail(r.merchantId)">
              {{ r.merchantName }} · {{ r.merchantId }}
            </button>
            <p>
              {{
                r.noActivity
                  ? t(
                      "两期未见点击或订单：是否收到推荐、排期未开始、追踪链接未启用？",
                      "No clicks or orders in either window: was the recommendation received, scheduled or linked?",
                    )
                  : t(
                      "请核查减少的媒体、点击结构、价格库存及转化情况；媒体减少投放的原因需反馈确认。",
                      "Check declining publishers, click mix, price, stock and conversion. Publisher feedback is needed to confirm why volume decreased.",
                    )
              }}
            </p>
            <small
              >{{ movement(r, "clicks") }} · {{ movement(r, "revenue") }} ·
              {{ t("推荐命中", "Target coverage") }}
              {{ ratio(r.targets.hitClicks, r.targets.total) }}</small
            >
          </article>
        </div>
        <div v-else class="promotion-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ t("商家", "Merchant") }}</th>
                <th>{{ t("清单 / 日期", "List / date") }}</th>
                <th>{{ t("本次导入时间 UTC", "Session import time UTC") }}</th>
                <th>{{ t("导入人", "Imported by") }}</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="r in rows" :key="r.merchantId"
                ><tr v-for="h in r.history" :key="`${r.merchantId}-${h.id}`">
                  <td>{{ r.merchantName }} · {{ r.merchantId }}</td>
                  <td>
                    {{ h.name }}<small>{{ h.listDate }}</small>
                  </td>
                  <td>
                    {{
                      h.importedAt ||
                      t("历史未记录", "Not historically recorded")
                    }}
                  </td>
                  <td>{{ h.importedBy || "—" }}</td>
                </tr></template
              >
            </tbody>
          </table>
        </div>
        <p v-if="!rows.length">
          {{ t("当前筛选没有商家。", "No merchants match the filters.") }}
        </p>
      </section>
    </template>
    <dialog
      ref="drawer"
      class="review-drawer"
      @cancel.prevent="closeDetail"
      @click="
        (e) => {
          if (e.target === drawer) closeDetail();
        }
      "
    >
      <div v-if="selectedRow" class="review-drawer-content">
        <div class="review-toolbar">
          <div>
            <h3>
              {{ selectedRow.merchantName }} · {{ selectedRow.merchantId }}
            </h3>
            <small
              >{{ selectedRow.listName }} · {{ selectedRow.listDate }}</small
            >
          </div>
          <button @click="closeDetail">{{ t("关闭", "Close") }}</button>
        </div>
        <h4>{{ t("推荐理由原文", "Original recommendation reason") }}</h4>
        <p class="review-reason">
          {{ selectedRow.notes || t("未提供", "Not provided") }}
        </p>
        <p>
          {{ t("产品表目标", "Product-list targets") }}:
          {{
            (selectedRow.productAsins || selectedRow.asins).join(", ") || "—"
          }}
        </p>
        <p>
          {{ t("理由明确 ASIN", "Reason ASINs") }}:
          {{ selectedRow.reasonAsins?.join(", ") || "—" }}
        </p>
        <p>
          {{ t("历史销量 Top 3", "Historical purchase Top 3") }}:
          {{ selectedRow.top.join(", ") || "—" }}
        </p>
        <p v-if="detailLoading" role="status">
          {{ t("正在读取媒体证据…", "Loading publisher evidence…") }}
        </p>
        <p v-if="detailError" role="alert">{{ detailError }}</p>
        <template v-if="detail"
          ><label
            >{{ t("选择媒体下钻", "Drill into a publisher")
            }}<select v-model="selectedMedia">
              <option value="all">{{ t("所有媒体", "All publishers") }}</option>
              <option
                v-for="m in detail.media"
                :key="m.publisherId"
                :value="m.publisherId"
              >
                {{ m.publisherName || t("未知媒体", "Unknown publisher") }} ·
                {{ m.publisherId }}
              </option>
            </select></label
          ><ReviewDailyChart
            :rows="detailChartRows"
            :range="detail.dateRange"
            :through="detail.availableThrough"
            :recommendation="detail.recommendationDate"
            :language="language"
          />
          <div class="review-coverage">
            <p>
              {{ t("推荐点击 / 全部点击", "Recommended / all clicks") }}:
              {{
                ratio(
                  targetSummary(selectedRow, selectedLinks).hitClicks,
                  targetSummary(selectedRow, selectedLinks).total,
                )
              }}
            </p>
            <p>
              {{
                t(
                  "推荐点击 / 有效单品点击",
                  "Recommended / identified product clicks",
                )
              }}:
              {{
                ratio(
                  targetSummary(selectedRow, selectedLinks).hitClicks,
                  targetSummary(selectedRow, selectedLinks).productClicks,
                )
              }}
            </p>
            <p>
              {{
                t("命中 ASIN / 推荐目标数", "Hit ASINs / recommended targets")
              }}:
              {{
                ratio(
                  targetSummary(selectedRow, selectedLinks).hitAsins,
                  targetSummary(selectedRow, selectedLinks).targetCount,
                )
              }}
            </p>
            <p>
              {{
                t(
                  "命中 ASIN / 实际推广 ASIN 数",
                  "Hit ASINs / actual promoted ASINs",
                )
              }}:
              {{
                ratio(
                  targetSummary(selectedRow, selectedLinks).hitAsins,
                  targetSummary(selectedRow, selectedLinks).actualAsins,
                )
              }}
            </p>
          </div>
          <div class="promotion-scroll">
            <table>
              <thead>
                <tr>
                  <th>{{ t("媒体", "Publisher") }}</th>
                  <th>{{ t("点击 / 收入变化", "Click / revenue change") }}</th>
                  <th>{{ t("方向变化证据", "Target-mix evidence") }}</th>
                  <th>
                    {{
                      t("推荐点击 前 → 后", "Recommended clicks before → after")
                    }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="m in selectedMediaRows" :key="m.publisherId">
                  <td>
                    <button @click="selectedMedia = m.publisherId">
                      {{
                        m.publisherName || m.publisherId || t("未知", "Unknown")
                      }}
                    </button>
                  </td>
                  <td>
                    {{ movement(m, "clicks")
                    }}<small>{{ movement(m, "revenue") }}</small>
                  </td>
                  <td>{{ mediaEvidence(m, detail.links) }}</td>
                  <td>
                    {{
                      targetSummary(
                        selectedRow,
                        (detail.links || []).filter(
                          (l) => l.publisherId === m.publisherId,
                        ),
                        "before",
                      ).hitClicks
                    }}
                    →
                    {{
                      targetSummary(
                        selectedRow,
                        (detail.links || []).filter(
                          (l) => l.publisherId === m.publisherId,
                        ),
                      ).hitClicks
                    }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>
            {{
              t(
                "单品或 Storefront 占比变化只能说明行为方向；是否因推荐而调整，需要发送时间与媒体确认记录。",
                "Product or storefront mix changes show observed direction; adoption caused by a recommendation requires delivery timing and publisher confirmation.",
              )
            }}
          </p>
          <div class="promotion-scroll">
            <table>
              <thead>
                <tr>
                  <th>{{ t("媒体 / 推广目标", "Publisher / destination") }}</th>
                  <th>{{ t("点击 前 → 后", "Clicks before → after") }}</th>
                  <th>{{ t("清单目标", "Recommended") }}</th>
                  <th>Historical Top 3</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(m, i) in selectedLinks" :key="i">
                  <td>
                    {{ m.publisherName }}<small>{{ target(m) }}</small>
                  </td>
                  <td>{{ f(m.before.clicks) }} → {{ f(m.after.clicks) }}</td>
                  <td>{{ isRecommended(m) ? "✓" : "—" }}</td>
                  <td>{{ isHistoricalTop(m) ? "✓" : "—" }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </dialog>
  </div>
</template>
