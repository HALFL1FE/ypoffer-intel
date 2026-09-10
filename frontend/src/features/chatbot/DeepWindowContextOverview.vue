<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { UiLanguage } from "../../shared/i18n";
import type { ReportDocument } from "./report/reportContracts";

const props = defineProps<{
  readonly language: UiLanguage;
  readonly document: ReportDocument;
}>();

type Row = Readonly<Record<string, unknown>>;

const notAvailable = computed(() => props.language === "zh" ? "不可用" : "not available in current data");

function asRow(value: unknown): Row | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Row
    : null;
}

function rowsFrom(value: unknown): readonly Row[] {
  return Array.isArray(value) ? value.map(asRow).filter((row): row is Row => Boolean(row)) : [];
}

function text(row: Row, keys: readonly string[], fallback = ""): string {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      const joined = value.map((item) => String(item ?? "").trim()).filter(Boolean).join(", ");
      if (joined) return joined;
    }
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return fallback;
}

function numberValue(row: Row, keys: readonly string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function ratioValue(row: Row, keys: readonly string[]): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    return String(raw).includes("%") || Math.abs(value) > 1 ? value / 100 : value;
  }
  return 0;
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function count(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function percentage(value: number): string {
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
}

function monthKey(row: Row): string {
  return text(row, ["month", "reportMonthKey", "reportMonth", "date"]);
}

function firstPresentValue(row: Row, keys: readonly string[]): unknown | undefined {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function numericValue(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function monthLabel(value: string): string {
  const match = value.match(/^(20\d{2})-(0?[1-9]|1[0-2])$/);
  if (!match) return value;
  const year = match[1];
  const month = Number(match[2]);
  return props.language === "zh"
    ? `${year}年${month}月`
    : `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]} ${year}`;
}

const baseRow = computed<Row>(() => asRow(props.document.rows[0]) || {});

const contextRows = computed<readonly Row[]>(() => {
  const rows = rowsFrom(props.document.rows);
  if (rows.length) return rows;
  return rowsFrom(props.document.rankingOffers);
});

const categoryName = computed(() => {
  const rowCategory = text(contextRows.value[0] || {}, ["category", "sheetCategory", "mainCategory", "Category"]);
  const documentCategory = String(props.document.category ?? "").trim();
  const queryCategory = String(props.document.request?.categories?.[0] ?? "").trim();
  return rowCategory || documentCategory || queryCategory || notAvailable.value;
});

const monthlyRows = computed<readonly Row[]>(() => {
  const merged = new Map<string, Row>();
  for (const key of ["monthly", "monthlyAmazonMetrics", "monthlyAggregateMetrics"]) {
    for (const row of rowsFrom(baseRow.value[key])) {
      const month = monthKey(row);
      if (!month) continue;
      merged.set(month, { ...(merged.get(month) || {}), ...row, month });
    }
  }
  return [...merged.values()].sort((left, right) => monthKey(left).localeCompare(monthKey(right)));
});

const selectedMonth = ref("");
watch(monthlyRows, (rows) => {
  if (!rows.some((row) => monthKey(row) === selectedMonth.value)) selectedMonth.value = monthKey(rows.at(-1) || {});
}, { immediate: true });

const activeRow = computed<Row>(() => monthlyRows.value.find((row) => monthKey(row) === selectedMonth.value) || {});
const active = computed<Row>(() => {
  const month = activeRow.value;
  if (!Object.keys(month).length) return baseRow.value;
  const canonical: Record<string, unknown> = {};
  const aliases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ["salesAmount", ["salesAmount", "revenue", "sales", "Revenue"]],
    ["allCommission", ["allCommission", "payout", "commission", "totalCommission", "totalPayout"]],
    ["affCommission", ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]],
    ["allEpc", ["allEpc", "allEPC", "payoutEpc", "EPC(All)"]],
    ["epc", ["epc", "affEpc", "EPC", "EPC(Aff)"]],
    ["aov", ["aov", "AOV"]],
    ["conversionRate", ["conversionRate", "conversion", "CVR", "Conversion Rate"]],
    ["orders", ["orders", "Order count", "orderCount", "Orders"]],
    ["clicks", ["clicks", "Clicks", "totalClicks"]],
    ["dpv", ["dpv", "DPV", "detailPageViews"]],
    ["atc", ["atc", "ATC", "addToCart"]],
    ["commissionRate", ["commissionRate", "affCommissionRate", "effectiveCommissionRate"]]
  ];
  aliases.forEach(([key, keys]) => {
    const value = firstPresentValue(month, keys);
    if (value !== undefined) canonical[key] = value;
  });
  const clicks = numericValue(firstPresentValue(month, ["clicks", "Clicks", "totalClicks"]));
  const orders = numericValue(firstPresentValue(month, ["orders", "Order count", "orderCount", "Orders"]));
  const sales = numericValue(firstPresentValue(month, ["salesAmount", "revenue", "sales", "Revenue"]));
  const payout = numericValue(firstPresentValue(month, ["allCommission", "payout", "commission", "totalCommission", "totalPayout"]));
  const affiliatePayout = numericValue(firstPresentValue(month, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]));
  if (canonical.aov === undefined && sales !== null && orders) canonical.aov = sales / orders;
  if (canonical.allEpc === undefined && payout !== null && clicks) canonical.allEpc = payout / clicks;
  if (canonical.epc === undefined && affiliatePayout !== null && clicks) canonical.epc = affiliatePayout / clicks;
  if (canonical.conversionRate === undefined && orders !== null && clicks) canonical.conversionRate = orders / clicks;
  return { ...baseRow.value, ...month, ...canonical };
});
const merchantName = computed(() => text(baseRow.value, ["brand", "merchantName", "merchant_name", "name"], notAvailable.value));
const requestedAsin = computed(() => text(baseRow.value, ["asin", "matchedAsins", "matchedAsin", "productAsin", "productAsins"], notAvailable.value));

const stats = computed(() => {
  const row = active.value;
  const clicks = numberValue(row, ["clicks", "Clicks", "totalClicks"]);
  const affCommission = numberValue(row, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]);
  const sales = numberValue(row, ["salesAmount", "revenue", "sales", "Revenue"]);
  const allCommission = numberValue(row, ["allCommission", "allCommissionMade", "totalCommission", "payout", "totalPayout"]);
  const epcAff = numberValue(row, ["epc", "affEpc", "EPC", "EPC(Aff)"]);
  const epcAll = numberValue(row, ["allEpc", "allEPC", "EPC(All)", "allEpcAff", "payoutEpc"])
    || (clicks ? allCommission / clicks : epcAff);
  return [
    { label: props.language === "zh" ? "商户 ID" : "Merchant ID", value: text(row, ["merchantId", "merchant_id", "Merchant ID", "id"], notAvailable.value) },
    { label: "Tier", value: text(row, ["tier", "Tier"], notAvailable.value) },
    { label: props.language === "zh" ? "联盟" : "Network", value: text(row, ["network", "Network"], notAvailable.value) },
    { label: props.language === "zh" ? "品类" : "Category", value: text(row, ["category", "sheetCategory", "mainCategory", "Category"], notAvailable.value) },
    { label: "AOV", value: money(numberValue(row, ["aov", "AOV"])) },
    { label: "EPC (All)", value: money(epcAll) },
    { label: "EPC (Aff)", value: money(epcAff) },
    { label: "CVR", value: percentage(ratioValue(row, ["conversionRate", "conversion", "CVR", "Conversion Rate"])) },
    { label: props.language === "zh" ? "销售额" : "Revenue made", value: money(sales) },
    { label: props.language === "zh" ? "总佣金" : "All Commission", value: money(allCommission) },
    { label: props.language === "zh" ? "联盟佣金" : "Aff Commission", value: money(affCommission) },
    { label: props.language === "zh" ? "订单" : "Orders", value: count(numberValue(row, ["orders", "Order count", "orderCount", "Orders"])) },
    { label: props.language === "zh" ? "点击" : "Clicks", value: count(clicks) },
    { label: "DPV", value: count(numberValue(row, ["dpv", "DPV", "detailPageViews"])) },
    { label: "ATC", value: count(numberValue(row, ["atc", "ATC", "addToCart"])) },
    { label: props.language === "zh" ? "佣金率" : "Commission rate", value: percentage(ratioValue(row, ["commissionRate", "affCommissionRate", "effectiveCommissionRate"])) },
    { label: props.language === "zh" ? "付款状态" : "Payment", value: text(row, ["paymentStatus", "paymentState", "payment"], notAvailable.value) },
    { label: props.language === "zh" ? "链接状态" : "Link status", value: text(row, ["linkStatus", "recommendedLink"], notAvailable.value) }
  ];
});

const notes = computed(() => [
  { label: "CPC", value: text(active.value, ["cpc", "CPC"], notAvailable.value) },
  { label: props.language === "zh" ? "折扣/促销" : "Discount/deal", value: text(active.value, ["dealInfo", "discountInfo", "deal", "discount"], notAvailable.value) },
  { label: props.language === "zh" ? "按月付款" : "Payment by month", value: text(active.value, ["paymentByMonth"], paymentByMonth(active.value)) },
  { label: props.language === "zh" ? "建议动作" : "Recommended action", value: text(active.value, ["recommendedAction", "recommendation", "reason"], notAvailable.value) },
  { label: props.language === "zh" ? "备注" : "Notes", value: text(active.value, ["notes", "note"], notAvailable.value) }
]);

function paymentByMonth(row: Row): string {
  const paid = text(row, ["paidInvoiceMonths", "invoiceMonths"]);
  const risk = text(row, ["paymentRiskMonths"]);
  const values = [paid ? `Paid: ${paid}` : "", risk ? `Unpaid: ${risk}` : ""].filter(Boolean);
  return values.join("; ") || notAvailable.value;
}

const productRows = computed<readonly Row[]>(() => {
  const block = props.document.blocks.find((item) => item.id === "merchant-products");
  return block && block.kind !== "notice" ? block.rows.map((row) => asRow(row)).filter((row): row is Row => Boolean(row)) : rowsFrom(baseRow.value.products);
});

function displayName(row: Row): string {
  return text(row, ["merchantName", "brand", "merchant_name", "Merchant Name", "name"], notAvailable.value);
}

function hasValue(row: Row, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = row[key];
    return value === true || (value !== undefined && value !== null && String(value).trim() !== "" && String(value).trim() !== "0");
  });
}

function categoryRowScore(row: Row): number {
  return numberValue(row, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]) * 1000
    + numberValue(row, ["epc", "EPC", "EPC(Aff)"]) * 100
    + numberValue(row, ["orders", "Order count", "orderCount"]);
}

const categoryRows = computed<readonly Row[]>(() => [...contextRows.value].sort((left, right) => categoryRowScore(right) - categoryRowScore(left)));

const categoryStats = computed(() => {
  const rows = contextRows.value;
  const totalRevenue = rows.reduce((sum, row) => sum + numberValue(row, ["salesAmount", "revenue", "sales", "Revenue"]), 0);
  const totalCommission = rows.reduce((sum, row) => sum + numberValue(row, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]), 0);
  const totalClicks = rows.reduce((sum, row) => sum + numberValue(row, ["clicks", "Clicks", "totalClicks"]), 0);
  const totalOrders = rows.reduce((sum, row) => sum + numberValue(row, ["orders", "Order count", "orderCount", "Orders"]), 0);
  return [
    { label: props.language === "zh" ? "Offer 数" : "Offers", value: count(rows.length) },
    { label: props.language === "zh" ? "销售额" : "Revenue made", value: money(totalRevenue) },
    { label: props.language === "zh" ? "佣金" : "Commission made", value: money(totalCommission) },
    { label: props.language === "zh" ? "订单" : "Orders", value: count(totalOrders) },
    { label: "Blended EPC", value: money(totalClicks ? totalCommission / totalClicks : 0) },
    { label: props.language === "zh" ? "平均 CVR" : "Average CVR", value: percentage(totalClicks ? totalOrders / totalClicks : 0) }
  ];
});

const categoryTierBreakdown = computed(() => {
  const counts = new Map<string, number>();
  contextRows.value.forEach((row) => {
    const tier = text(row, ["tier", "Tier"], notAvailable.value);
    counts.set(tier, (counts.get(tier) || 0) + 1);
  });
  return [...counts.entries()].map(([tier, total]) => `${tier}: ${total}`).join(", ") || notAvailable.value;
});

function categoryMetricDescription(row: Row | undefined, keys: readonly string[], formatter: (value: number) => string): string {
  if (!row) return notAvailable.value;
  return `${displayName(row)} (${formatter(numberValue(row, keys))})`;
}

const categoryInsights = computed(() => {
  const rows = contextRows.value;
  const by = (keys: readonly string[]) => rows.reduce<Row | undefined>((best, row) => {
    if (!best || numberValue(row, keys) > numberValue(best, keys)) return row;
    return best;
  }, undefined);
  const paymentRisk = rows.find((row) => /unpaid|partial|overdue|risk/i.test(text(row, ["paymentStatus", "paymentState", "payment"])));
  const caution = rows.find((row) => /caution|monitor|retest|selected/i.test(text(row, ["recommendedAction", "recommendation", "reason"])))
    || rows.find((row) => ratioValue(row, ["conversionRate", "conversion", "CVR", "Conversion Rate"]) < 0.01);
  const zh = props.language === "zh";
  return [
    { label: zh ? "EPC 最佳" : "Best by EPC", value: categoryMetricDescription(by(["epc", "EPC", "EPC(Aff)"]), ["epc", "EPC", "EPC(Aff)"], (value) => money(value)) },
    { label: zh ? "CVR 最佳" : "Best by CVR", value: categoryMetricDescription(by(["conversionRate", "conversion", "CVR"]), ["conversionRate", "conversion", "CVR"], (value) => percentage(value)) },
    { label: zh ? "销售额最高" : "Highest revenue", value: categoryMetricDescription(by(["salesAmount", "revenue", "Revenue"]), ["salesAmount", "revenue", "Revenue"], (value) => money(value)) },
    { label: zh ? "佣金最高" : "Highest commission", value: categoryMetricDescription(by(["affCommission", "affiliatePayout", "commissionMade"]), ["affCommission", "affiliatePayout", "commissionMade"], (value) => money(value)) },
    { label: zh ? "付款风险" : "Payment risk", value: paymentRisk ? `${displayName(paymentRisk)}: ${text(paymentRisk, ["paymentStatus", "paymentState", "payment"], notAvailable.value)}` : (zh ? "本结果中无" : "None in this result") },
    { label: zh ? "需要谨慎" : "Needs caution", value: caution ? `${displayName(caution)}: ${text(caution, ["recommendedAction", "recommendation", "reason"], notAvailable.value)}` : (zh ? "没有标记" : "None flagged") }
  ];
});

const categoryTrafficAngle = computed(() => {
  const row = contextRows.value[0];
  if (!row) return notAvailable.value;
  const category = categoryName.value === notAvailable.value ? (props.language === "zh" ? "该品类" : "the category") : categoryName.value;
  if (hasValue(row, ["hasDiscount", "hasDeal", "dealInfo", "discountInfo", "deal", "discount"])) {
    return props.language === "zh" ? `${category} deal、coupon、对比和测评流量。` : `${category} deal, coupon, comparison, and review traffic.`;
  }
  if (hasValue(row, ["hasAsin", "asin", "ASIN", "topAsins", "productAsins"])) {
    return props.language === "zh" ? `${category} ASIN 测评、对比和购买指南流量。` : `${category} ASIN review, comparison, and buying-guide traffic.`;
  }
  return props.language === "zh" ? `${category} 对比内容和控制测试流量。` : `${category} comparison and controlled test traffic.`;
});

function firstValue(row: Row, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return null;
}

function moneyOrUnavailable(row: Row, keys: readonly string[]): string {
  const raw = firstValue(row, keys);
  return raw === null ? notAvailable.value : money(Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, "")) || 0);
}

function percentageOrUnavailable(row: Row, keys: readonly string[]): string {
  const raw = firstValue(row, keys);
  if (raw === null) return notAvailable.value;
  const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(value)) return notAvailable.value;
  return percentage(String(raw).includes("%") || Math.abs(value) > 1 ? value / 100 : value);
}
</script>

<template>
  <section v-if="document.intent === 'category'" class="deep-category-focus" data-deep-category-overview>
    <h4>{{ categoryName }}</h4>
    <div class="context-stats deep-context-stats" data-deep-category-stats>
      <article v-for="item in categoryStats" :key="item.label" class="context-stat" data-deep-category-stat>
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </div>
    <div class="context-note deep-context-note">
      <p><strong>{{ language === "zh" ? "最佳流量方向" : "Best traffic angle" }}:</strong> {{ categoryTrafficAngle }}</p>
      <p><strong>{{ language === "zh" ? "Tier 分布" : "Tier breakdown" }}:</strong> {{ categoryTierBreakdown }}</p>
    </div>
    <div class="deep-category-mini-table" data-deep-category-mini-table>
      <h5>{{ language === "zh" ? "推荐商户" : "Recommended offers" }}</h5>
      <div class="deep-context-products-table-wrap">
        <table class="deep-context-products-table">
          <thead><tr>
            <th>{{ language === "zh" ? "商户" : "Merchant" }}</th><th>Tier</th><th>{{ language === "zh" ? "品类" : "Category" }}</th>
            <th>AOV</th><th>EPC (All)</th><th>EPC (Aff)</th><th>CVR</th><th>{{ language === "zh" ? "订单" : "Orders" }}</th>
            <th>{{ language === "zh" ? "销售额" : "Revenue" }}</th><th>{{ language === "zh" ? "总佣金" : "All Commission" }}</th>
            <th>{{ language === "zh" ? "联盟佣金" : "Aff Commission" }}</th><th>{{ language === "zh" ? "付款周期" : "Payment cycle" }}</th>
          </tr></thead>
          <tbody>
            <tr v-for="(row, index) in categoryRows.slice(0, 5)" :key="text(row, ['merchantId', 'id'], String(index))">
              <td><strong>{{ displayName(row) }}</strong><small>{{ text(row, ["merchantId", "merchant_id", "Merchant ID"], notAvailable) }}</small></td>
              <td>{{ text(row, ["tier", "Tier"], notAvailable) }}</td>
              <td>{{ text(row, ["category", "sheetCategory", "mainCategory", "Category"], categoryName) }}</td>
              <td>{{ money(numberValue(row, ["aov", "AOV"])) }}</td>
              <td>{{ money(numberValue(row, ["allEpc", "allEPC", "EPC(All)", "payoutEpc"])) }}</td>
              <td>{{ money(numberValue(row, ["epc", "affEpc", "EPC", "EPC(Aff)"])) }}</td>
              <td>{{ percentage(ratioValue(row, ["conversionRate", "conversion", "CVR", "Conversion Rate"])) }}</td>
              <td>{{ count(numberValue(row, ["orders", "Order count", "orderCount", "Orders"])) }}</td>
              <td>{{ money(numberValue(row, ["salesAmount", "revenue", "Revenue"])) }}</td>
              <td>{{ money(numberValue(row, ["allCommission", "payout", "totalCommission"])) }}</td>
              <td>{{ money(numberValue(row, ["affCommission", "affiliatePayout", "commissionMade"])) }}</td>
              <td>{{ text(row, ["paymentCycle", "payment_cycle"], "-") }}</td>
            </tr>
            <tr v-if="!categoryRows.length"><td colspan="12">{{ language === "zh" ? "暂无匹配商户" : "No matching offers found." }}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
    <div class="context-note deep-context-note" data-deep-category-insights>
      <p v-for="item in categoryInsights" :key="item.label"><strong>{{ item.label }}:</strong> {{ item.value }}</p>
    </div>
  </section>
  <section v-else class="merchant-focus" data-deep-merchant-overview>
    <p v-if="document.intent === 'asin'" class="context-note deep-asin-note">
      <strong>ASIN:</strong> {{ requestedAsin }}<br>
      <strong>{{ language === "zh" ? "产品名称" : "Product name" }}:</strong> {{ text(baseRow, ["productName", "productTitle", "title"], notAvailable) }}<br>
      <strong>{{ language === "zh" ? "产品链接" : "Product URL" }}:</strong> {{ text(baseRow, ["productUrl", "url", "productURL"], notAvailable) }}<br>
      <strong>{{ language === "zh" ? "Deal 价格" : "Deal price" }}:</strong> {{ moneyOrUnavailable(baseRow, ["dealPrice", "deal_price", "salePrice"]) }}<br>
      <strong>{{ language === "zh" ? "原价" : "Original price" }}:</strong> {{ moneyOrUnavailable(baseRow, ["originalPrice", "original_price", "listPrice"]) }}<br>
      <strong>{{ language === "zh" ? "折扣比例" : "Discount %" }}:</strong> {{ percentageOrUnavailable(baseRow, ["discountPercent", "discountPercentage", "discountRate"]) }}<br>
      {{ language === "zh" ? "ASIN 级表现不可用，以下展示关联商户表现。" : "ASIN-level performance is not available. Showing merchant-level performance instead." }}
    </p>
    <h4>{{ merchantName }}</h4>
    <label v-if="monthlyRows.length" class="merchant-month-picker deep-merchant-month-picker">
      <span>{{ language === "zh" ? "月份" : "Month" }}</span>
      <select v-model="selectedMonth" data-merchant-month-picker :aria-label="language === 'zh' ? '选择月份' : 'Select month'">
        <option v-for="row in monthlyRows" :key="monthKey(row)" :value="monthKey(row)">{{ monthLabel(monthKey(row)) }}</option>
      </select>
    </label>
    <div class="context-stats deep-context-stats" data-deep-context-stats>
      <article v-for="item in stats" :key="item.label" class="context-stat" data-deep-context-stat>
        <span>{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
      </article>
    </div>
    <div class="context-note deep-context-note">
      <p v-for="item in notes" :key="item.label"><strong>{{ item.label }}:</strong> {{ item.value }}</p>
    </div>
    <div v-if="productRows.length" class="deep-context-products" data-deep-context-products>
      <h5>{{ language === "zh" ? "产品明细" : "Products" }}</h5>
      <div class="deep-context-products-table-wrap">
        <table class="deep-context-products-table">
          <thead><tr><th>ASIN</th><th>{{ language === "zh" ? "产品" : "Product" }}</th><th>{{ language === "zh" ? "品类" : "Category" }}</th></tr></thead>
          <tbody>
            <tr v-for="(row, index) in productRows" :key="text(row, ['asin', 'id'], String(index))">
              <td>{{ text(row, ["asin", "ASIN"], notAvailable) }}</td>
              <td>{{ text(row, ["productName", "productTitle", "title", "name"], notAvailable) }}</td>
              <td>{{ text(row, ["category", "mainCategory", "sheetCategory"], notAvailable) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>
