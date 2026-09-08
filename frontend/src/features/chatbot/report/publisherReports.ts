import type { UiLanguage } from "../../../shared/i18n";
import {
  aggregatePublisherMetrics,
  filteredPublishers,
  normalizePublisherPortfolioPayload,
  normalizePublishersPayload,
  portfolioRowsForState,
  publisherAffinitySummary,
  publisherMetricConversionRate,
  publisherTableRows,
  type PublisherPortfolioRow,
  type PublisherMerchantLike,
  type PublisherRecord
} from "../../publishers/publisherModel";
import type { ReportQuery, ReportRow } from "./reportContracts";

export interface PublisherReportPayload {
  readonly rows: readonly ReportRow[];
  readonly summary: Readonly<Record<string, unknown>>;
  readonly status: "resolved" | "ambiguous" | "not_found" | "needs_input" | "unavailable";
  readonly title: string;
  readonly asOf?: string | null;
  readonly note?: string;
  readonly portfolioRows?: readonly ReportRow[];
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function payloadUnavailable(payload: unknown): boolean {
  return payload === null || payload === undefined || (
    typeof payload === "object" && payload !== null && !Array.isArray(payload) &&
    (payload as Readonly<Record<string, unknown>>).ok === false
  );
}

function rowForPublisher(record: PublisherRecord, market: string): ReportRow {
  const metric = market !== "all" ? record.markets[market] || record.total : record.total;
  return {
    userId: record.userId,
    userName: record.userName,
    adminName: record.adminName,
    market: market === "all" ? "all" : market,
    clicks: metric.clicks,
    dpv: metric.dpv,
    atc: metric.atc,
    orders: metric.orders,
    sales: metric.sales,
    allCommission: metric.allCommission,
    affCommission: metric.affCommission,
    cvr: publisherMetricConversionRate(metric),
    conversionRate: publisherMetricConversionRate(metric),
    grossProfit: metric.allCommission - metric.affCommission,
    merchantCount: record.merchantIds.length,
    networks: record.networks.join(", "),
    merchantIds: record.merchantIds.join(", ")
  };
}

function normalizedNetwork(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

function resolvedNetwork(query: ReportQuery, networks: readonly string[]): string {
  const requested = query.publisherFilters.network;
  if (!requested) return networks
    .slice()
    .sort((left, right) => right.length - left.length)
    .find((candidate) => query.prompt.toLowerCase().includes(candidate.toLowerCase())) || "all";
  return networks.find((candidate) => normalizedNetwork(candidate) === normalizedNetwork(requested)) || requested;
}

function recordFilters(query: ReportQuery, networks: readonly string[]) {
  return {
    market: query.publisherFilters.market || "all",
    network: resolvedNetwork(query, networks),
    linkType: "all",
    merchantSearch: query.publisherFilters.merchantQuery || "",
    merchantSelectedId: query.publisherFilters.merchantIds[0] || "",
    productSearch: "",
    managerSearch: query.publisherFilters.manager || "",
    siteSearch: "",
    trackSearch: ""
  } as const;
}

function matchesPublisher(record: PublisherRecord, queryText: string, ids: readonly string[]): boolean {
  if (ids.length && !ids.includes(record.userId)) return false;
  const query = text(queryText).toLowerCase();
  return !query || record.userId.toLowerCase().includes(query) || record.userName.toLowerCase().includes(query);
}

function sortKey(query: ReportQuery): "rank" | "clicks" | "sales" | "orders" | "allCommission" | "affCommission" | "conversionRate" | "dpv" | "atc" | "grossProfit" {
  const value = query.publisherFilters.sortKey;
  return value === "cvr" ? "conversionRate" : value === "grossProfit" ? "grossProfit" : value;
}

export function buildPublisherRecordsReport(query: ReportQuery, payload: unknown, language: UiLanguage): PublisherReportPayload {
  if (payloadUnavailable(payload)) return { rows: [], summary: {}, status: "unavailable", title: language === "zh" ? "Publisher Records" : "Publisher Records" };
  const data = normalizePublishersPayload(payload);
  const filtered = filteredPublishers(data, recordFilters(query, data.networks));
  const market = query.publisherFilters.market || "all";
  const totals = aggregatePublisherMetrics(filtered, market);
  const rows = publisherTableRows(filtered, market, totals, { key: sortKey(query), direction: "desc" }).map((row) => ({
    ...row,
    userName: row.userName || "Unknown",
    cvr: row.conversionRate
  }));
  const summary = {
    publisherCount: filtered.length,
    clicks: totals.clicks,
    dpv: totals.dpv,
    atc: totals.atc,
    orders: totals.orders,
    sales: totals.sales,
    allCommission: totals.allCommission,
    affCommission: totals.affCommission,
    cvr: totals.conversionRate,
    grossProfit: totals.grossProfit
  };
  const note = filtered.length > query.publisherFilters.limit
    ? (language === "zh" ? `展示前 ${query.publisherFilters.limit} 条，合计按 ${filtered.length} 条完整筛选结果计算。` : `Showing the first ${query.publisherFilters.limit}; totals use all ${filtered.length} filtered records.`)
    : undefined;
  return {
    rows: rows.slice(0, query.publisherFilters.limit),
    summary,
    status: "resolved",
    title: language === "zh" ? "Publisher Records" : "Publisher Records",
    asOf: data.generatedAt || null,
    ...(note ? { note } : {})
  };
}

function publisherCandidates(query: ReportQuery, payload: unknown): { data: ReturnType<typeof normalizePublishersPayload>; matches: readonly PublisherRecord[] } {
  const data = normalizePublishersPayload(payload);
  const queryText = query.publisherQuery || query.merchantNames[0] || "";
  const matches = data.publishers.filter((publisher) => matchesPublisher(publisher, queryText, query.publisherFilters.merchantIds));
  return { data, matches };
}

function profileSummary(publisher: PublisherRecord, portfolioRows: readonly PublisherPortfolioRow[]): Readonly<Record<string, unknown>> {
  if (portfolioRows.length) {
    const summary = publisherAffinitySummary(portfolioRows);
    return {
      merchantCount: summary.merchantCount,
      clicks: summary.clicks,
      dpv: summary.dpv,
      atc: summary.atc,
      orders: summary.orders,
      sales: summary.sales,
      allCommission: summary.allCommission,
      affCommission: summary.affCommission,
      aov: summary.aov,
      cvr: summary.clicks ? summary.orders / summary.clicks : 0,
      commissionRate: summary.effectiveCommissionRate,
      categories: summary.categories,
      aovBands: summary.aovBands,
      markets: summary.markets
    };
  }
  const metric = publisher.total;
  return {
    merchantCount: publisher.merchantIds.length,
    clicks: metric.clicks,
    dpv: metric.dpv,
    atc: metric.atc,
    orders: metric.orders,
    sales: metric.sales,
    allCommission: metric.allCommission,
    affCommission: metric.affCommission,
    aov: metric.aov,
    cvr: metric.conversionRate,
    commissionRate: metric.effectiveCommissionRate,
    categories: [],
    aovBands: [],
    markets: Object.entries(publisher.markets).map(([market, value]) => ({ market, sales: value.sales }))
  };
}

export function buildPublisherProfileReport(
  query: ReportQuery,
  payload: unknown,
  portfolioPayload: unknown,
  language: UiLanguage
): PublisherReportPayload {
  if (query.resolution === "needs_input" || !query.publisherQuery && !query.publisherFilters.merchantIds.length) return {
    rows: [], summary: {}, status: "needs_input", title: language === "zh" ? "Publisher Profile" : "Publisher Profile",
    note: language === "zh" ? "请提供媒体名称或媒体 ID。" : "Provide a publisher name or ID."
  };
  if (payloadUnavailable(payload)) return {
    rows: [], summary: {}, status: "unavailable", title: language === "zh" ? "Publisher Profile" : "Publisher Profile",
    note: language === "zh" ? "媒体数据源暂时不可用，请稍后重试。" : "Publisher data is temporarily unavailable. Try again later."
  };
  const { data, matches } = publisherCandidates(query, payload);
  if (!matches.length) return {
    rows: [], summary: {}, status: "not_found", title: language === "zh" ? "Publisher Profile" : "Publisher Profile",
    note: language === "zh" ? `没有找到媒体“${query.publisherQuery || query.publisherFilters.merchantIds[0]}”。` : `No publisher matched “${query.publisherQuery || query.publisherFilters.merchantIds[0]}”.`
  };
  if (matches.length > 1) return {
    rows: matches.map((publisher) => rowForPublisher(publisher, query.publisherFilters.market || "all")),
    summary: { candidateCount: matches.length },
    status: "ambiguous",
    title: language === "zh" ? "选择媒体画像" : "Choose a publisher profile",
    note: language === "zh" ? "匹配到多个媒体，请使用完整名称或 ID。" : "Multiple publishers matched; use the full name or ID."
  };
  const publisher = matches[0]!;
  const portfolio = normalizePublisherPortfolioPayload(portfolioPayload);
  const portfolioRows = portfolioRowsForState(portfolio.merchants as readonly PublisherMerchantLike[], {
    market: query.publisherFilters.market || "all",
    network: query.publisherFilters.network || "all",
    merchantSearch: "",
    merchantSelectedId: "",
    portfolioSearch: "",
    portfolioCategory: "all",
    portfolioTier: "all",
    portfolioSort: "sales"
  }, false);
  const summary = profileSummary(publisher, portfolioRows);
  const totalSales = Number(summary.sales) || 0;
  const rows = portfolioRows.map(({ merchant, metrics }) => ({
    merchantId: merchant.merchantId,
    merchantName: merchant.merchantName,
    category: merchant.category,
    tier: merchant.tier,
    network: merchant.network,
    market: query.publisherFilters.market && query.publisherFilters.market !== "all"
      ? query.publisherFilters.market
      : Object.keys(merchant.markets).join(", ") || "all",
    clicks: metrics.clicks,
    dpv: metrics.dpv,
    atc: metrics.atc,
    orders: metrics.orders,
    sales: metrics.sales,
    affCommission: metrics.affCommission,
    affCommissionRate: metrics.effectiveCommissionRate,
    epc: metrics.affEpc,
    cvr: metrics.conversionRate,
    aov: metrics.aov,
    salesShare: totalSales > 0 ? metrics.sales / totalSales : 0
  }));
  return {
    rows,
    portfolioRows: rows,
    summary,
    status: "resolved",
    title: language === "zh" ? `${publisher.userName} 媒体画像` : `${publisher.userName} publisher profile`,
    asOf: data.generatedAt || null,
    ...(rows.length ? {} : { note: language === "zh" ? "媒体 KPI 可用，但当前日期范围没有商家明细。" : "Publisher KPIs are available, but no merchant detail is available for the current range." })
  };
}
