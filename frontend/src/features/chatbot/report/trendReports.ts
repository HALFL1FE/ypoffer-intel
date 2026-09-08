import type { UiLanguage } from "../../../shared/i18n";
import type { ReportQuery, ReportRow, TrendMetric } from "./reportContracts";
import { matchesCategory, metricValue, normalizeOfferRow, rowCategories, rowMerchantId, rowMerchantName, rowTier, text } from "./entityReports";

export interface TrendRow extends ReportRow {
  readonly month: string;
  readonly value: number;
  readonly previousValue: number | null;
  readonly delta: number | null;
  readonly deltaPct: number | null;
  readonly estimated: boolean;
  readonly salesAmount?: number;
  readonly revenue?: number;
  readonly orders?: number;
  readonly epc?: number | null;
  readonly aov?: number | null;
  readonly clicks?: number;
  readonly affiliatePayout?: number;
  readonly affCommission?: number;
  readonly dpv?: number | null;
  readonly atc?: number | null;
  readonly conversionRate?: number | null;
  readonly payout?: number;
  readonly directSales?: number | null;
  readonly haloSales?: number | null;
}

export interface TrendReportPayload {
  readonly rows: readonly TrendRow[];
  readonly metric: TrendMetric;
  readonly estimated: boolean;
  readonly categoryOptions: readonly string[];
  readonly activeCategory: string | null;
  readonly visibleColumns: readonly string[];
  readonly status: "resolved" | "not_found" | "needs_input";
  readonly title: string;
  readonly note: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function monthKey(value: unknown): string {
  const raw = text(value);
  const match = raw.match(/(20\d{2})[-/](0?[1-9]|1[0-2])/);
  return match ? `${match[1]}-${String(Number(match[2])).padStart(2, "0")}` : "";
}

function addMonths(value: string, delta: number): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year || new Date().getUTCFullYear(), (month || 1) - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function trendMetric(query: ReportQuery): TrendMetric {
  if (query.trendMetric) return query.trendMetric;
  const lower = query.prompt.toLowerCase();
  if (/all\s*epc|总s*epc/.test(lower)) return "allEpc";
  if (/revenue|销售额/.test(lower)) return "revenue";
  if (/aov|客单价/.test(lower)) return "aov";
  if (/epc/.test(lower)) return "epc";
  if (/cvr|conversion|转化/.test(lower)) return "conversionRate";
  if (/order|订单/.test(lower)) return "orders";
  if (/click|点击/.test(lower)) return "clicks";
  if (/affiliate\s*payout|联盟支出/.test(lower)) return "affiliatePayout";
  if (/direct\s*sales|直接销售/.test(lower)) return "directSales";
  if (/halo\s*sales|halo/.test(lower)) return "haloSales";
  if (/commission|佣金|payout/.test(lower)) return "affCommission";
  return "salesAmount";
}

function monthlyRows(row: ReportRow): readonly Readonly<Record<string, unknown>>[] {
  const source = row as Readonly<Record<string, unknown>>;
  for (const key of ["monthly", "monthlyMetrics", "monthlyData", "months", "metricsByMonth", "monthlyRows"]) {
    const raw = source[key];
    if (Array.isArray(raw)) return raw.filter(isRecord);
    if (isRecord(raw)) return Object.entries(raw).map(([month, value]) => isRecord(value) ? { month, ...value } : { month, value });
  }
  const month = monthKey(source.reportMonthKey ?? source.reportMonth ?? source.month);
  return month ? [{ month, ...source }] : [];
}

function numeric(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const parsed = Number(String(value).replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumeric(row: Readonly<Record<string, unknown>>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numeric(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function monthlyValue(row: Readonly<Record<string, unknown>>, metric: TrendMetric): number {
  if (metric === "payout") return firstNumeric(row, ["payout", "allCommission", "commission"]) ?? 0;
  if (metric === "revenue") return firstNumeric(row, ["revenue", "salesAmount", "sales"]) ?? 0;
  if (metric === "affiliatePayout") return firstNumeric(row, ["affiliatePayout", "affCommission", "commission"]) ?? 0;
  if (metric === "directSales") return firstNumeric(row, ["directSales", "direct_sales", "directSalesAmount"]) ?? 0;
  if (metric === "haloSales") return firstNumeric(row, ["haloSales", "halo_sales", "haloSalesAmount"]) ?? 0;
  if (metric === "allEpc") {
    const explicit = firstNumeric(row, ["allEpc"]);
    if (explicit !== null) return explicit;
    const clicks = firstNumeric(row, ["clicks"]) ?? 0;
    return clicks > 0 ? (firstNumeric(row, ["allCommission", "payout"]) ?? 0) / clicks : 0;
  }
  if (metric === "salesAmount") return firstNumeric(row, ["salesAmount", "revenue", "sales"]) ?? 0;
  if (metric === "affCommission") return firstNumeric(row, ["affCommission", "affiliatePayout", "commission"]) ?? 0;
  if (metric === "epc") {
    const explicit = firstNumeric(row, ["epc", "affEpc"]);
    if (explicit !== null) return explicit;
    const clicks = firstNumeric(row, ["clicks"]) ?? 0;
    return clicks > 0 ? (firstNumeric(row, ["affCommission", "affiliatePayout"]) ?? 0) / clicks : 0;
  }
  if (metric === "aov") {
    const explicit = firstNumeric(row, ["aov"]);
    if (explicit !== null) return explicit;
    const orders = firstNumeric(row, ["orders", "orderCount"]) ?? 0;
    return orders > 0 ? (firstNumeric(row, ["salesAmount", "revenue", "sales"]) ?? 0) / orders : 0;
  }
  if (metric === "conversionRate") {
    const explicit = firstNumeric(row, ["conversionRate", "cvr"]);
    if (explicit !== null) return explicit;
    const clicks = firstNumeric(row, ["clicks"]) ?? 0;
    return clicks > 0 ? (firstNumeric(row, ["orders", "orderCount"]) ?? 0) / clicks : 0;
  }
  return firstNumeric(row, [metric]) ?? 0;
}

const FULL_TREND_METRICS: readonly TrendMetric[] = [
  "salesAmount", "orders", "epc", "aov", "clicks", "affiliatePayout", "dpv", "atc", "conversionRate", "payout", "directSales", "haloSales"
];

function metricAvailability(row: Readonly<Record<string, unknown>>, metric: TrendMetric): boolean {
  if (metric === "salesAmount" || metric === "revenue") return ["salesAmount", "revenue", "sales"].some((key) => row[key] !== undefined && row[key] !== null);
  if (metric === "affiliatePayout" || metric === "affCommission") return ["affiliatePayout", "affCommission", "commission"].some((key) => row[key] !== undefined && row[key] !== null);
  if (metric === "epc") return ["epc", "affEpc", "affCommission", "affiliatePayout"].some((key) => row[key] !== undefined && row[key] !== null);
  if (metric === "allEpc") return ["allEpc", "allCommission", "payout"].some((key) => row[key] !== undefined && row[key] !== null);
  if (metric === "aov") return ["aov", "salesAmount", "revenue", "orders"].some((key) => row[key] !== undefined && row[key] !== null);
  if (metric === "conversionRate") return ["conversionRate", "cvr", "orders", "clicks"].some((key) => row[key] !== undefined && row[key] !== null);
  return row[metric] !== undefined && row[metric] !== null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clicksFor(metrics: ReadonlyMap<TrendMetric, number>): number {
  return metrics.get("clicks") || 0;
}

function ordersFor(metrics: ReadonlyMap<TrendMetric, number>): number {
  return metrics.get("orders") || 0;
}

function records(value: unknown): readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** 将商户详情接口的 Amazon/aggregate 月度数组合并为稳定的月份行。 */
export function mergeMerchantMonths(payload: unknown): readonly ReportRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload) || payload.ok === false) return [];
  const direct = [payload.rows, payload.offers, payload.merchants].find((value) => Array.isArray(value) && value.length);
  if (Array.isArray(direct)) return direct.filter(isRecord);
  const merchant = isRecord(payload.merchant) ? payload.merchant : {};
  const base = { ...merchant };
  const merchantId = text(payload.merchantId ?? merchant.merchantId ?? merchant.merchant_id ?? merchant.id);
  const monthMap = new Map<string, Readonly<Record<string, unknown>>>();
  [payload.monthlyAmazonMetrics, payload.monthlyAggregateMetrics, payload.monthly, merchant.monthly]
    .flatMap(records)
    .forEach((row) => {
      const month = monthKey(row.month ?? row.reportMonthKey ?? row.reportMonth);
      if (!month) return;
      monthMap.set(month, { ...(monthMap.get(month) || {}), ...row, month });
    });
  if (!Object.keys(base).length && !merchantId && !monthMap.size) return [];
  return [{
    ...base,
    ...(merchantId ? { merchantId } : {}),
    monthly: [...monthMap.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, row]) => row)
  }];
}

function selectedRows(query: ReportQuery, offers: readonly ReportRow[]): readonly ReportRow[] {
  const pairs = offers.map((raw) => ({ raw, row: normalizeOfferRow(raw) }));
  const filtered = pairs.filter(({ row }) => {
    const source = row as Readonly<Record<string, unknown>>;
    if (query.merchantIds.length && !query.merchantIds.includes(rowMerchantId(source))) return false;
    if (query.merchantNames.length && !query.merchantNames.some((name) => rowMerchantName(source).toLowerCase().includes(name.toLowerCase()))) return false;
    if (query.tiers.length && !query.tiers.includes(rowTier(source) as ReportQuery["tiers"][number])) return false;
    if (query.categories.length && !matchesCategory(row, query.categories)) return false;
    if (query.categories.length && !query.tiers.length && (rowTier(source) === "Tier 4" || rowTier(source) === "BLACK TIER")) return false;
    return true;
  });
  if (filtered.length) return filtered.map(({ raw }) => raw);
  const phrase = query.prompt.replace(/趋势|trend|分析|analysis|近\s*\d+\s*个?月|last\s*\d+\s*months?/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return pairs
    .filter(({ row }) => phrase && [rowMerchantId(row as Readonly<Record<string, unknown>>), rowMerchantName(row as Readonly<Record<string, unknown>>), ...rowCategories(row as Readonly<Record<string, unknown>>)].some((value) => value.toLowerCase().includes(phrase)))
    .map(({ raw }) => raw);
}

export function buildTrendReport(query: ReportQuery, offers: readonly ReportRow[], language: UiLanguage, now = new Date()): TrendReportPayload {
  if (query.resolution === "needs_input") return {
    rows: [], metric: trendMetric(query), estimated: false, categoryOptions: [], activeCategory: null, visibleColumns: ["month", "value", "deltaPct"], status: "needs_input",
    title: language === "zh" ? "趋势条件" : "Trend criteria", note: language === "zh" ? "趋势至少需要 2 个月。" : "A trend requires at least two months."
  };
  const metric = trendMetric(query);
  const rows = selectedRows(query, offers);
  const rangeStart = query.startMonth;
  const rangeEnd = query.endMonth;
  const rangeMonths = rangeStart && rangeEnd ? Math.max(1, Math.min(24, monthDistance(rangeStart, rangeEnd) + 1)) : 0;
  if (rangeStart && rangeEnd && rangeMonths < 2) return {
    rows: [], metric, estimated: false, categoryOptions: [], activeCategory: query.categories[0] || null,
    visibleColumns: ["month", "value", "deltaPct"], status: "needs_input",
    title: language === "zh" ? "趋势条件" : "Trend criteria",
    note: language === "zh" ? "趋势至少需要 2 个月。" : "A trend requires at least two months."
  };
  const requestedMonths = Math.max(2, Math.min(24, rangeMonths || query.months || 3));
  const real = new Map<string, number>();
  const realMetrics = new Map<string, Map<TrendMetric, number>>();
  rows.forEach((row) => monthlyRows(row).forEach((month) => {
    const key = monthKey(month.month ?? month.reportMonthKey ?? month.reportMonth);
    if (!key) return;
    if (rangeStart && key < rangeStart) return;
    if (rangeEnd && key > rangeEnd) return;
    if (!metricAvailability(month, metric)) return;
    real.set(key, (real.get(key) || 0) + monthlyValue(month, metric));
    const metrics = realMetrics.get(key) || new Map<TrendMetric, number>();
    FULL_TREND_METRICS.forEach((metricName) => {
      if (!metricAvailability(month, metricName)) return;
      metrics.set(metricName, (metrics.get(metricName) || 0) + monthlyValue(month, metricName));
    });
    realMetrics.set(key, metrics);
  }));
  real.forEach((_value, key) => {
    const metrics = realMetrics.get(key);
    if (!metrics) return;
    const clicks = metrics.get("clicks") || 0;
    const orders = metrics.get("orders") || 0;
    const sales = metrics.get("salesAmount") || 0;
    const affiliatePayout = metrics.get("affiliatePayout") || 0;
    const payout = metrics.get("payout") || 0;
    if (metric === "epc" && metrics.has("affiliatePayout") && metrics.has("clicks")) real.set(key, clicks > 0 ? affiliatePayout / clicks : 0);
    if (metric === "allEpc" && metrics.has("payout") && metrics.has("clicks")) real.set(key, clicks > 0 ? payout / clicks : 0);
    if (metric === "aov" && metrics.has("salesAmount") && metrics.has("orders")) real.set(key, orders > 0 ? sales / orders : 0);
    if (metric === "conversionRate" && metrics.has("orders") && metrics.has("clicks")) real.set(key, clicks > 0 ? orders / clicks : 0);
  });
  const hasAggregateBasis = rows.some((row) => metricAvailability(row as Readonly<Record<string, unknown>>, metric));
  if (!real.size && !hasAggregateBasis) return {
    rows: [], metric, estimated: false,
    categoryOptions: Array.from(new Set(rows.flatMap((row) => rowCategories(row as Readonly<Record<string, unknown>>)))),
    activeCategory: query.categories[0] || null, visibleColumns: ["month", "value", "deltaPct"], status: "not_found",
    title: language === "zh" ? "月度趋势" : "Monthly trend",
    note: language === "zh" ? "当前数据没有可用的月度指标。" : "No monthly metric is available in the current data."
  };
  const estimated = real.size < 2 || real.size < requestedMonths;
  const sortedRealKeys = [...real.keys()].sort();
  const keys = rangeStart && rangeEnd
    ? Array.from({ length: requestedMonths }, (_, index) => addMonths(rangeStart, index))
      : estimated
      ? Array.from({ length: requestedMonths }, (_, index) => addMonths(sortedRealKeys.at(-1) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`, index - requestedMonths + 1))
      : sortedRealKeys.slice(-requestedMonths);
  const aggregateTotal = rows.reduce((sum, row) => sum + monthlyValue(row as Readonly<Record<string, unknown>>, metric), 0);
  const realAverage = real.size ? [...real.values()].reduce((sum, value) => sum + value, 0) / real.size : 0;
  const estimateBase = realAverage || aggregateTotal / requestedMonths;
  const points = keys.map((key, index) => {
    const isEstimatedPoint = !real.has(key);
    const value = real.has(key)
      ? real.get(key) || 0
      : estimateBase * (0.85 + ((index + 1) / requestedMonths) * 0.15);
    const metrics = realMetrics.get(key) || new Map<TrendMetric, number>();
    const metricValues: Record<string, number | null> = {};
    FULL_TREND_METRICS.forEach((metricName) => {
      const available = metrics.has(metricName);
      metricValues[metricName] = available ? Math.round((metrics.get(metricName) || 0) * 10000) / 10000 : null;
    });
    if (metrics.has("affiliatePayout") && metrics.has("clicks")) metricValues.epc = clicksFor(metrics) > 0 ? round4(metrics.get("affiliatePayout")! / clicksFor(metrics)) : 0;
    if (metrics.has("payout") && metrics.has("clicks")) metricValues.allEpc = clicksFor(metrics) > 0 ? round4(metrics.get("payout")! / clicksFor(metrics)) : 0;
    if (metrics.has("salesAmount") && metrics.has("orders")) metricValues.aov = ordersFor(metrics) > 0 ? round4(metrics.get("salesAmount")! / ordersFor(metrics)) : 0;
    if (metrics.has("orders") && metrics.has("clicks")) metricValues.conversionRate = clicksFor(metrics) > 0 ? round4(metrics.get("orders")! / clicksFor(metrics)) : 0;
    if (metric === "revenue") metricValues.salesAmount = round4(value);
    metricValues[metric] = round4(value);
    return { month: key, value: round4(value), estimated: isEstimatedPoint, ...metricValues };
  });
  const trendRows = points.map((point, index) => {
    const previousValue = index ? points[index - 1]!.value : null;
    const delta = previousValue === null ? null : Math.round((point.value - previousValue) * 10000) / 10000;
    const deltaPct = previousValue === null || previousValue === 0 ? null : Math.round((point.value - previousValue) / Math.abs(previousValue) * 10000) / 10000;
    return { ...point, previousValue, delta, deltaPct };
  });
  const note = estimated
    ? (language === "zh" ? "⚡ estimated：当前数据没有足够的真实月度记录，趋势仅用于方向参考。" : "⚡ estimated: insufficient real monthly records; use this trend directionally only.")
    : (language === "zh" ? "真实月度数据：按月份聚合，首月不计算环比。" : "Real monthly data: aggregated by month; the first month has no delta.");
  const categories = Array.from(new Set(rows.flatMap((row) => rowCategories(row as Readonly<Record<string, unknown>>))));
  return {
    rows: trendRows,
    metric,
    estimated,
    categoryOptions: categories,
    activeCategory: query.categories[0] || null,
    visibleColumns: ["month", "value", "delta", "deltaPct"],
    status: trendRows.length >= 2 ? "resolved" : "not_found",
    title: language === "zh" ? "月度趋势" : "Monthly trend",
    note
  };
}

function monthDistance(start: string, end: string): number {
  const [startYear = 0, startMonth = 0] = start.split("-").map(Number);
  const [endYear = 0, endMonth = 0] = end.split("-").map(Number);
  return Math.max(0, (endYear - startYear) * 12 + endMonth - startMonth);
}

export function trendMonthFallback(): string {
  return currentMonth();
}
