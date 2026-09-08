import type { UiLanguage } from "../../../shared/i18n";
import { normalizePaymentRecord } from "../../payments/paymentModel";
import type { PaymentRecord } from "../../../shared/contracts/payment";
import type { OfferRecord } from "../../../shared/contracts/offer";
import type { ReportQuery, ReportRow } from "./reportContracts";
import { matchesCategory, text } from "./entityReports";

export interface PaymentReportPayload {
  readonly rows: readonly PaymentRecord[];
  readonly summary: {
    readonly recordCount: number;
    readonly merchantCount: number;
    readonly paidCount: number;
    readonly pendingCount: number;
    readonly unpaidCount: number;
    readonly overdueCount: number;
    readonly partialCount: number;
    readonly unknownCount: number;
    readonly revenueMade: number;
    readonly commissionMade: number;
    readonly paidAmount: number;
    readonly remainingAmount: number;
  };
  readonly status: "resolved" | "not_found" | "needs_input";
  readonly title: string;
  readonly note?: string;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rawText(value: unknown): string {
  return String(value ?? "").trim();
}

function explicitStatus(value: unknown): PaymentRecord["paymentStatus"] | null {
  const lower = rawText(value).toLowerCase();
  const map: Record<string, PaymentRecord["paymentStatus"]> = {
    paid: "Paid", pending: "Pending", unpaid: "Unpaid", overdue: "Overdue", partial: "Partial", unknown: "Unknown",
    已付款: "Paid", 已支付: "Paid", 待处理: "Pending", 未付款: "Unpaid", 未支付: "Unpaid", 逾期: "Overdue", 部分: "Partial"
  };
  return map[lower] || null;
}

function monthKey(value: unknown): string {
  const raw = rawText(value);
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  if (/^\d{4}[-/]\d{1,2}$/.test(raw)) {
    const [year, month] = raw.split(/[-/]/);
    return `${year}-${String(Number(month)).padStart(2, "0")}`;
  }
  return "";
}

type PaymentCycleOperator = NonNullable<ReportQuery["paymentCycleFilter"]>["operator"];

function compare(value: number, operator: PaymentCycleOperator, target: number): boolean {
  switch (operator) {
    case ">": return value > target;
    case ">=": return value >= target;
    case "<": return value < target;
    case "<=": return value <= target;
    case "=": return value === target;
  }
  return false;
}

function normalizeRows(records: readonly ReportRow[], offers: readonly ReportRow[], today: Date): readonly PaymentRecord[] {
  return records.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const normalized = normalizePaymentRecord(raw, { offers: offers as readonly OfferRecord[], today: today.toISOString().slice(0, 10) });
    if (!normalized) return [];
    if (Boolean(raw.isPlaceholder) || (Number(normalized.revenueMade) === 0 && Number(normalized.commissionMade) === 0)) return [];
    const explicit = explicitStatus(raw.paymentStatus ?? raw.status ?? raw.rawStatus);
    const explicitMonth = monthKey(raw.reportMonthKey ?? raw.reportMonth ?? raw.month);
    return [{
      ...normalized,
      ...(explicit ? { paymentStatus: explicit } : {}),
      ...(explicitMonth ? { reportMonthKey: explicitMonth } : {})
    }];
  });
}

export function paymentReportColumns(language: UiLanguage) {
  return [
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" as const },
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" as const },
    { key: "tier", label: "Tier", format: "text" as const },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" as const },
    { key: "reportMonthKey", label: language === "zh" ? "月份" : "Month", format: "text" as const },
    { key: "paymentStatus", label: language === "zh" ? "付款状态" : "Payment status", format: "text" as const },
    { key: "revenueMade", label: language === "zh" ? "销售额" : "Revenue made", format: "money" as const },
    { key: "commissionMade", label: language === "zh" ? "佣金" : "Commission made", format: "money" as const },
    { key: "paidAmount", label: language === "zh" ? "已付金额" : "Paid amount", format: "money" as const },
    { key: "remainingAmount", label: language === "zh" ? "待付金额" : "Remaining", format: "money" as const },
    { key: "paymentCycle", label: language === "zh" ? "付款周期（天）" : "Payment cycle (days)", format: "integer" as const },
    { key: "expectedPaymentDate", label: language === "zh" ? "预计付款日" : "Expected payment date", format: "text" as const },
    { key: "paymentMadeDate", label: language === "zh" ? "实际付款日" : "Payment made", format: "text" as const },
    { key: "region", label: language === "zh" ? "市场" : "Market", format: "text" as const },
    { key: "network", label: language === "zh" ? "网络" : "Network", format: "text" as const }
  ];
}

export function buildPaymentReport(
  query: ReportQuery,
  records: readonly ReportRow[],
  offers: readonly ReportRow[],
  language: UiLanguage,
  today = new Date()
): PaymentReportPayload {
  if (query.resolution === "needs_input") return {
    rows: [],
    summary: { recordCount: 0, merchantCount: 0, paidCount: 0, pendingCount: 0, unpaidCount: 0, overdueCount: 0, partialCount: 0, unknownCount: 0, revenueMade: 0, commissionMade: 0, paidAmount: 0, remainingAmount: 0 },
    status: "needs_input",
    title: language === "zh" ? "付款条件" : "Payment criteria"
  };
  const normalized = normalizeRows(records, offers, today);
  const rows = normalized.filter((row) => {
    if (query.paymentStatus && row.paymentStatus !== query.paymentStatus) return false;
    if (query.month && row.reportMonthKey !== query.month && row.reportMonth !== query.month) return false;
    if (query.tiers.length && !query.tiers.includes(row.tier as ReportQuery["tiers"][number])) return false;
    if (query.categories.length && !matchesCategory(row as unknown as ReportRow, query.categories)) return false;
    if (query.merchantIds.length && !query.merchantIds.includes(row.merchantId)) return false;
    if (query.merchantNames.length && !query.merchantNames.some((name) => row.merchantName.toLowerCase().includes(name.toLowerCase()))) return false;
    if (query.paymentCycleFilter && !compare(row.paymentCycle, query.paymentCycleFilter.operator, query.paymentCycleFilter.days)) return false;
    return true;
  }).sort((left, right) => {
    const statusOrder = ["Overdue", "Unpaid", "Partial", "Unknown", "Pending", "Paid"];
    return statusOrder.indexOf(left.paymentStatus) - statusOrder.indexOf(right.paymentStatus)
      || right.remainingAmount - left.remainingAmount
      || right.reportMonthKey.localeCompare(left.reportMonthKey)
      || left.merchantName.localeCompare(right.merchantName);
  });
  const merchantIds = new Set(rows.map((row) => row.merchantId || row.merchantName).filter(Boolean));
  const summary = {
    recordCount: rows.length,
    merchantCount: merchantIds.size,
    paidCount: rows.filter((row) => row.paymentStatus === "Paid").length,
    pendingCount: rows.filter((row) => row.paymentStatus === "Pending").length,
    unpaidCount: rows.filter((row) => row.paymentStatus === "Unpaid").length,
    overdueCount: rows.filter((row) => row.paymentStatus === "Overdue").length,
    partialCount: rows.filter((row) => row.paymentStatus === "Partial").length,
    unknownCount: rows.filter((row) => row.paymentStatus === "Unknown").length,
    revenueMade: rows.reduce((sum, row) => sum + row.revenueMade, 0),
    commissionMade: rows.reduce((sum, row) => sum + row.commissionMade, 0),
    paidAmount: rows.reduce((sum, row) => sum + row.paidAmount, 0),
    remainingAmount: rows.reduce((sum, row) => sum + row.remainingAmount, 0)
  };
  const note = query.paymentCycleFilter
    ? (language === "zh" ? `已按付款周期 ${query.paymentCycleFilter.operator} ${query.paymentCycleFilter.days} 天筛选。` : `Filtered by payment cycle ${query.paymentCycleFilter.operator} ${query.paymentCycleFilter.days} days.`)
    : undefined;
  return {
    rows,
    summary,
    status: rows.length ? "resolved" : "not_found",
    title: language === "zh" ? "付款记录" : "Payment records",
    ...(note ? { note } : {})
  };
}
