import type { UiLanguage } from "../../../shared/i18n";
import type { ReportQuery, ReportRow } from "./reportContracts";
import { metricValue, normalizeOfferRow, rowCategories, rowMerchantId, rowMerchantName, rowTier, text, matchesCategory } from "./entityReports";

export interface AnalysisRow extends ReportRow {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly category: string;
  readonly tier: string;
  readonly epc: number;
  readonly conversionRate: number;
  readonly commissionRate: number;
  readonly aov: number;
  readonly orders: number;
  readonly clicks: number;
  readonly salesAmount: number;
  readonly affCommission: number;
  readonly sampleGate: string | null;
  readonly percentileEpc: number | null;
  readonly percentileCvr: number | null;
  readonly percentileAov: number | null;
  readonly percentileCommissionRate: number | null;
  readonly epcSignal: "highlight" | "weak" | "normal" | "insufficient";
  readonly cvrSignal: "highlight" | "weak" | "normal" | "insufficient";
}

export interface AnalysisReportPayload {
  readonly rows: readonly AnalysisRow[];
  readonly peers: readonly AnalysisRow[];
  readonly unmatched: readonly string[];
  readonly summary: Readonly<Record<string, unknown>>;
  readonly status: "resolved" | "not_found" | "needs_input";
  readonly title: string;
  readonly note?: string;
}

function percentile(value: number, values: readonly number[]): number | null {
  if (!values.length || !Number.isFinite(value)) return null;
  return Math.round(values.filter((candidate) => candidate <= value).length / values.length * 1000) / 10;
}

function signal(value: number | null): "highlight" | "weak" | "normal" | "insufficient" {
  if (value === null) return "insufficient";
  if (value >= 70) return "highlight";
  if (value <= 30) return "weak";
  return "normal";
}

function targetPhrase(query: ReportQuery): string {
  return query.analysisTargets[0]
    || query.merchantNames[0]
    || query.merchantIds[0]
    || query.prompt
      .replace(/分析|趋势|trend|compare|comparison|对比|比较|评估|诊断|商户|merchant|品类|category|tier|报告/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
}

function targetRows(query: ReportQuery, rows: readonly ReportRow[]): readonly ReportRow[] {
  if (query.merchantIds.length) return rows.filter((row) => query.merchantIds.includes(rowMerchantId(row as Readonly<Record<string, unknown>>)));
  if (query.merchantNames.length) return rows.filter((row) => query.merchantNames.some((name) => rowMerchantName(row as Readonly<Record<string, unknown>>).toLowerCase().includes(name.toLowerCase())));
  if (query.tiers.length) return rows.filter((row) => query.tiers.includes(rowTier(row as Readonly<Record<string, unknown>>) as ReportQuery["tiers"][number]));
  if (query.categories.length) return rows.filter((row) => matchesCategory(row, query.categories));
  const phrase = targetPhrase(query).toLowerCase();
  return rows.filter((row) => {
    const source = row as Readonly<Record<string, unknown>>;
    return [rowMerchantId(source), rowMerchantName(source), ...rowCategories(source)].some((value) => value.toLowerCase().includes(phrase));
  });
}

function sampleGate(clicks: number, orders: number): string | null {
  const gates: string[] = [];
  if (clicks < 100) gates.push("clicks>=100");
  if (orders < 10) gates.push("orders>=10");
  return gates.length ? gates.join(", ") : null;
}

function makeRow(row: ReportRow, allRows: readonly ReportRow[]): AnalysisRow {
  const source = row as Readonly<Record<string, unknown>>;
  const clicks = metricValue(source, "clicks");
  const orders = metricValue(source, "orders");
  const epc = metricValue(source, "epc");
  const cvr = metricValue(source, "conversionRate");
  const aov = metricValue(source, "aov");
  const rate = metricValue(source, "commissionRate") * 100;
  const epcValues = allRows.filter((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "clicks") >= 100).map((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "epc"));
  const cvrValues = allRows.filter((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "clicks") >= 100).map((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "conversionRate"));
  const aovValues = allRows.filter((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "orders") >= 10).map((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "aov"));
  const rateValues = allRows.filter((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "orders") >= 10).map((candidate) => metricValue(candidate as Readonly<Record<string, unknown>>, "commissionRate") * 100);
  const gate = sampleGate(clicks, orders);
  const epcPercentile = clicks >= 100 ? percentile(epc, epcValues) : null;
  const cvrPercentile = clicks >= 100 ? percentile(cvr, cvrValues) : null;
  const aovPercentile = orders >= 10 ? percentile(aov, aovValues) : null;
  const ratePercentile = orders >= 10 ? percentile(rate, rateValues) : null;
  return {
    ...row,
    merchantId: rowMerchantId(source),
    merchantName: rowMerchantName(source),
    category: rowCategories(source)[0] || "Uncategorized",
    tier: rowTier(source),
    epc,
    conversionRate: cvr,
    commissionRate: rate,
    aov,
    orders,
    clicks,
    salesAmount: metricValue(source, "salesAmount"),
    affCommission: metricValue(source, "affCommission"),
    sampleGate: gate,
    percentileEpc: epcPercentile,
    percentileCvr: cvrPercentile,
    percentileAov: aovPercentile,
    percentileCommissionRate: ratePercentile,
    epcSignal: clicks >= 100 ? signal(epcPercentile) : "insufficient",
    cvrSignal: clicks >= 100 ? signal(cvrPercentile) : "insufficient"
  };
}

function summary(rows: readonly AnalysisRow[]): Readonly<Record<string, unknown>> {
  const totalClicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
  const totalSales = rows.reduce((sum, row) => sum + row.salesAmount, 0);
  const totalCommission = rows.reduce((sum, row) => sum + row.affCommission, 0);
  return {
    offerCount: rows.length,
    clicks: totalClicks,
    orders: totalOrders,
    salesAmount: totalSales,
    affCommission: totalCommission,
    epc: totalClicks ? totalCommission / totalClicks : 0,
    conversionRate: totalClicks ? totalOrders / totalClicks : 0,
    aov: totalOrders ? totalSales / totalOrders : 0,
    commissionRate: totalSales ? totalCommission / totalSales * 100 : 0
  };
}

export function buildAnalysisReport(query: ReportQuery, offers: readonly ReportRow[], language: UiLanguage): AnalysisReportPayload {
  if (query.resolution === "needs_input") return { rows: [], peers: [], unmatched: [], summary: {}, status: "needs_input", title: language === "zh" ? "分析条件" : "Analysis criteria" };
  const normalized = offers.map(normalizeOfferRow);
  let selected = [...targetRows(query, normalized)];
  if (!selected.length && query.analysisType === "trend") selected = normalized.slice(0, 50);
  const rows = selected.map((row) => makeRow(row, normalized));
  const unmatched = [
    ...query.merchantIds.filter((id) => !rows.some((row) => row.merchantId === id)),
    ...query.merchantNames.filter((name) => !rows.some((row) => row.merchantName.toLowerCase().includes(name.toLowerCase())))
  ];
  const first = rows[0];
  const peers = first
    ? normalized
      .filter((row) => rowMerchantId(row as Readonly<Record<string, unknown>>) !== first.merchantId)
      .filter((row) => rowTier(row as Readonly<Record<string, unknown>>) === first.tier)
      .filter((row) => rowCategories(row as Readonly<Record<string, unknown>>)[0] === first.category)
      .map((row) => makeRow(row, normalized))
      .sort((left, right) => right.affCommission - left.affCommission)
      .slice(0, 3)
    : [];
  const note = unmatched.length
    ? (language === "zh" ? `未找到分析目标：${unmatched.join("、")}。` : `Analysis targets not found: ${unmatched.join(", ")}.`)
    : first?.sampleGate
      ? (language === "zh" ? `样本提示：${first.sampleGate}，低于门槛的百分位不作判断。` : `Sample note: ${first.sampleGate}; percentile signals are withheld below the gate.`)
    : undefined;
  return {
    rows,
    peers,
    unmatched,
    summary: summary(rows),
    status: rows.length ? "resolved" : "not_found",
    title: language === "zh" ? "分析结果" : "Analysis results",
    ...(note ? { note } : {})
  };
}

export function analysisText(payload: AnalysisReportPayload, language: UiLanguage): string {
  if (!payload.rows.length) return language === "zh" ? "当前数据中没有找到可分析的目标。" : "No analyzable target was found in the current data.";
  const row = payload.rows[0]!;
  const core = language === "zh"
    ? `${row.merchantName || row.category}：EPC ${row.epc.toFixed(2)}，CVR ${(row.conversionRate * 100).toFixed(1)}%，AOV $${row.aov.toFixed(2)}，AFF Comm% ${row.commissionRate.toFixed(2)}%。`
    : `${row.merchantName || row.category}: EPC ${row.epc.toFixed(2)}, CVR ${(row.conversionRate * 100).toFixed(1)}%, AOV $${row.aov.toFixed(2)}, AFF Comm% ${row.commissionRate.toFixed(2)}%.`;
  return payload.note ? `${core} ${payload.note}` : core;
}
