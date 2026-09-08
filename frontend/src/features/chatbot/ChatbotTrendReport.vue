<script setup lang="ts">
import { computed, ref } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { ReportBlock, ReportColumn } from "./report/reportContracts";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly block: Extract<ReportBlock, { kind: "trend" }>;
}>();

const emit = defineEmits<{
  interact: [action: string, value?: string];
}>();

const columnPanelOpen = ref(false);

const metricOptions = [
  ["salesAmount", "Sales"], ["revenue", "Revenue"], ["epc", "EPC"], ["allEpc", "All EPC"], ["aov", "AOV"], ["conversionRate", "CVR"],
  ["orders", "Orders"], ["clicks", "Clicks"], ["affiliatePayout", "Affiliate payout"], ["affCommission", "AFF commission"],
  ["payout", "Payout"], ["dpv", "DPV"], ["atc", "ATC"], ["directSales", "Direct sales"], ["haloSales", "Halo sales"]
] as const;

const visibleColumns = computed(() => props.block.columns.filter((column) => props.block.visibleColumns.includes(column.key)));
const chartPoints = computed(() => {
  const rows = props.block.rows;
  if (!rows.length) return "";
  const values = rows.map((row) => Number(row.value) || 0);
  const max = Math.max(...values, 1);
  const width = 640;
  const height = 180;
  return rows.map((row, index) => {
    const x = rows.length === 1 ? width / 2 : index / (rows.length - 1) * width;
    const y = height - ((Number(row.value) || 0) / max) * (height - 20) - 10;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
});

function label(column: ReportColumn): string {
  return column.label;
}

function format(raw: unknown, column: ReportColumn): string {
  if (raw === null || raw === undefined || raw === "") return props.language === "zh" ? "不可用" : "N/A";
  const value = Number(raw);
  if (column.format === "percentage" && Number.isFinite(value)) return `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(2)}%`;
  if (column.format === "integer" && Number.isFinite(value)) return Math.round(value).toLocaleString();
  if (column.format === "money" && Number.isFinite(value)) return `$${value.toFixed(2)}`;
  if (column.format === "decimal" && Number.isFinite(value)) return value.toFixed(4);
  return String(raw);
}

function metricLabel(): string {
  return metricOptions.find(([key]) => key === props.block.metric)?.[1] || props.block.metric;
}

function toggleColumns(): void {
  columnPanelOpen.value = !columnPanelOpen.value;
  emit("interact", "trend-column-toggle");
}

function selectedColumnValue(event: Event, key: string): string {
  const checked = (event.target as HTMLInputElement).checked;
  const selected = new Set(props.block.visibleColumns);
  if (checked) selected.add(key);
  else selected.delete(key);
  if (!selected.size) selected.add(key);
  return props.block.columns.map((column) => column.key).filter((column) => selected.has(column)).join(",");
}
</script>

<template>
  <section class="chatbot-trend-report" data-chatbot-trend-report>
    <div class="chatbot-trend-toolbar">
      <label>
        <span>{{ language === "zh" ? "指标" : "Metric" }}</span>
        <select :value="block.metric" data-trend-metric-select @change="emit('interact', 'trend-metric', ($event.target as HTMLSelectElement).value)">
          <option v-for="option in metricOptions" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
        </select>
      </label>
      <label v-if="block.categoryOptions.length">
        <span>{{ language === "zh" ? "品类" : "Category" }}</span>
        <select :value="block.activeCategory || ''" data-trend-category-select @change="emit('interact', 'trend-category', ($event.target as HTMLSelectElement).value)">
          <option value="">{{ language === "zh" ? "全部" : "All" }}</option>
          <option v-for="category in block.categoryOptions" :key="category" :value="category">{{ category }}</option>
        </select>
      </label>
      <button type="button" data-trend-column-toggle :aria-expanded="columnPanelOpen" @click="toggleColumns">{{ language === "zh" ? "切换列" : "Columns" }}</button>
      <div v-if="columnPanelOpen" class="chatbot-trend-column-panel" data-trend-column-panel>
        <div class="chatbot-trend-column-presets">
          <button type="button" data-trend-column-core @click="emit('interact', 'trend-column-core')">{{ language === "zh" ? "核心列" : "Core" }}</button>
          <button type="button" data-trend-column-all @click="emit('interact', 'trend-column-all')">{{ language === "zh" ? "全部列" : "All" }}</button>
        </div>
        <label v-for="column in block.columns" :key="column.key" class="chatbot-trend-column-option">
          <input
            type="checkbox"
            data-trend-column-check
            :value="column.key"
            :checked="block.visibleColumns.includes(column.key)"
            @change="emit('interact', 'trend-columns', selectedColumnValue($event, column.key))"
          >
          <span>{{ label(column) }}</span>
        </label>
      </div>
      <span class="chatbot-trend-active-metric">{{ metricLabel() }}</span>
    </div>
    <svg v-if="block.rows.length" class="chatbot-trend-svg" viewBox="0 0 640 180" role="img" :aria-label="block.title">
      <polyline :points="chartPoints" fill="none" stroke="currentColor" stroke-width="3" vector-effect="non-scaling-stroke" />
      <circle v-for="(row, index) in block.rows" :key="String(row.month)" :cx="block.rows.length === 1 ? 320 : index / (block.rows.length - 1) * 640" :cy="180 - ((Number(row.value) || 0) / Math.max(...block.rows.map((item) => Number(item.value) || 0), 1)) * 160" r="4" />
    </svg>
    <table v-if="block.rows.length" class="chatbot-trend-table">
      <thead><tr><th v-for="column in visibleColumns" :key="column.key">{{ label(column) }}</th></tr></thead>
      <tbody>
        <tr v-for="row in block.rows" :key="String(row.month)">
          <td v-for="column in visibleColumns" :key="column.key">{{ format(row[column.key], column) }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else class="chatbot-trend-empty">{{ language === "zh" ? "暂无趋势数据" : "No trend data" }}</p>
  </section>
</template>
