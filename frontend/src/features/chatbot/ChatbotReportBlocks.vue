<script setup lang="ts">
import type { UiLanguage } from "../../shared/i18n";
import type { ReportBlock, ReportColumn, ReportRow } from "./report/reportContracts";
import ChatbotTrendReport from "./ChatbotTrendReport.vue";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly blocks: readonly ReportBlock[];
}>();

const emit = defineEmits<{
  action: [block: ReportBlock];
  interact: [action: string, value?: string];
}>();

function value(row: ReportRow, column: ReportColumn): unknown {
  return row[column.key];
}

function formatValue(raw: unknown, format: ReportColumn["format"]): string {
  if (raw === null || raw === undefined || raw === "") return props.language === "zh" ? "不可用" : "N/A";
  const number = Number(raw);
  if (format === "money" && Number.isFinite(number)) return `$${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (format === "percentage" && Number.isFinite(number)) return `${(number * (Math.abs(number) <= 1 ? 100 : 1)).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
  if (format === "integer" && Number.isFinite(number)) return Math.round(number).toLocaleString();
  if (format === "decimal" && Number.isFinite(number)) return number.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return String(raw);
}

function textValue(row: ReportRow, key: string): string {
  const value = row[key];
  return value === null || value === undefined ? "" : String(value).trim();
}

type RowAction = {
  readonly action: "select-merchant" | "select-publisher" | "exclude-merchant" | "replace-merchant";
  readonly value: string;
  readonly label: string;
};

function rowAction(row: ReportRow): RowAction | null {
  const publisherId = textValue(row, "userId");
  if (publisherId) return { action: "select-publisher", value: publisherId, label: "查看媒体" };
  const merchantId = textValue(row, "merchantId") || textValue(row, "merchant_id") || textValue(row, "Merchant ID");
  return merchantId ? { action: "select-merchant", value: merchantId, label: "查看商户" } : null;
}

function rowActions(block: ReportBlock, row: ReportRow): readonly RowAction[] {
  const view = rowAction(row);
  const merchantId = textValue(row, "merchantId") || textValue(row, "merchant_id") || textValue(row, "Merchant ID");
  if (block.kind === "table" && block.id === "recommendations" && merchantId) {
    return [
      ...(view ? [view] : []),
      { action: "exclude-merchant", value: merchantId, label: "排除" },
      { action: "replace-merchant", value: merchantId, label: "换一个" }
    ];
  }
  return view ? [view] : [];
}

function blockHasRowActions(block: ReportBlock): boolean {
  return block.kind === "metrics" || block.kind === "table"
    ? block.rows.some((row) => rowActions(block, row).length > 0)
    : false;
}
</script>

<template>
  <div class="chatbot-report-blocks" data-chatbot-report-blocks>
    <section
      v-for="block in props.blocks"
      :key="block.id"
      class="chatbot-report-block"
      :data-report-block="block.id"
    >
      <header class="chatbot-report-block-header">
        <h3>{{ block.title }}</h3>
      </header>
      <p v-if="block.kind === 'notice'" class="chatbot-report-notice">{{ block.text }}</p>
      <ChatbotTrendReport
        v-else-if="block.kind === 'trend'"
        :language="language"
        :block="block"
        @interact="(action, value) => emit('interact', action, value)"
      />
      <table v-else>
        <thead>
          <tr>
            <th v-for="column in block.columns" :key="column.key">{{ column.label }}</th>
            <th v-if="blockHasRowActions(block)">{{ language === "zh" ? "操作" : "Action" }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in block.rows" :key="String(row.id || row.merchantId || rowIndex)">
            <td v-for="column in block.columns" :key="column.key">{{ formatValue(value(row, column), column.format) }}</td>
            <td v-if="blockHasRowActions(block)" class="chatbot-report-row-action">
              <button
                v-for="action in rowActions(block, row)"
                :key="action.action"
                type="button"
                class="chatbot-report-row-action-button"
                :data-report-action="action.action"
                :data-value="action.value"
                @click.stop="emit('interact', action.action, action.value)"
              >{{ language === "zh" ? action.label : (action.action === "select-publisher" ? "View publisher" : action.action === "select-merchant" ? "View merchant" : action.action === "exclude-merchant" ? "Exclude" : "Replace") }}</button>
            </td>
          </tr>
          <tr v-if="!block.rows.length">
            <td :colspan="Math.max(1, block.columns.length + (blockHasRowActions(block) ? 1 : 0))">{{ props.language === "zh" ? "暂无数据" : "No data" }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
