import { renderMarkdownToHtml } from "../../../shared/markdown/markdown";
import type { UiLanguage } from "../../../shared/i18n";
import type { ChatbotReportSummary } from "../chatbotReportModel";
import type { ChatbotDataSource, ChatbotReportViewResult } from "../chatbotViewTypes";
import { mergeChatbotKeywords } from "../chatbotKeywords";
import { buildAnalysisReport, analysisText } from "./analysisReports";
import { buildEntityReport, matchesCategory, normalizeOfferRow, rowMerchantId, rowMerchantName, rowTier } from "./entityReports";
import { buildPaymentReport, paymentReportColumns } from "./paymentReports";
import { buildPublisherProfileReport, buildPublisherRecordsReport } from "./publisherReports";
import { buildRecommendationReport } from "./recommendationReports";
import { getReportHelpMarkdown } from "../chatbotHelp";
import type {
  ReportBlock,
  ReportColumn,
  ReportDocument,
  ReportEngineContext,
  ReportIntent,
  ReportAction,
  ReportQuery,
  ReportRow,
  ReportSheet,
  ReportSource
} from "./reportContracts";
import { reportSource } from "./reportContracts";
import { reportRowsFromPayload } from "./reportDataProvider";
import { buildTrendReport, mergeMerchantMonths } from "./trendReports";

export interface ReportEngineRunOptions extends ReportEngineContext {
  readonly query: ReportQuery;
  readonly language: UiLanguage;
  readonly signal: AbortSignal;
}

export interface ReportEngineResult {
  readonly report: ReportDocument;
  readonly view: ChatbotReportViewResult;
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordList(value: unknown): readonly ReportRow[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Report request aborted", "AbortError");
}

function hasKeywordPayload(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (!isRecord(value) || value.ok === false) return false;
  return ["merchants", "rows", "keywords", "items"].some((key) => Array.isArray(value[key]) && value[key].length > 0)
    || Object.keys(value).some((key) => !["ok", "summary", "checkedAt", "generatedAt", "source", "merchants", "rows", "keywords", "items"].includes(key));
}

function merchantRowsFromPayload(payload: unknown, merchantId: string): readonly ReportRow[] {
  const direct = reportRowsFromPayload(payload);
  if (direct.length) return direct;
  if (!isRecord(payload) || payload.ok === false) return [];
  const merchant = isRecord(payload.merchant) ? { ...payload.merchant } : {};
  const id = text(payload.merchantId || merchant.merchantId || merchant.merchant_id || merchant.id || merchantId);
  const products = recordList(payload.products);
  const amazonMonths = recordList(payload.monthlyAmazonMetrics);
  const aggregateMonths = recordList(payload.monthlyAggregateMetrics);
  const merged = mergeMerchantMonths(payload);
  if (!merged.length && !id && !Object.keys(merchant).length && !products.length && !amazonMonths.length && !aggregateMonths.length) return [];
  const base = merged[0] || { ...merchant, merchantId: id || merchantId };
  return [{
    ...base,
    ...merchant,
    merchantId: text(base.merchantId) || id || merchantId,
    products,
    monthlyAmazonMetrics: amazonMonths,
    monthlyAggregateMetrics: aggregateMonths,
    monthly: merged[0]?.monthly || []
  }];
}

function trendCandidateRows(query: ReportQuery, offers: readonly ReportRow[]): readonly ReportRow[] {
  return offers.filter((raw) => {
    const row = normalizeOfferRow(raw);
    const source = row as Readonly<Record<string, unknown>>;
    if (query.merchantIds.length && !query.merchantIds.includes(rowMerchantId(source))) return false;
    if (query.merchantNames.length && !query.merchantNames.some((name) => rowMerchantName(source).toLowerCase().includes(name.toLowerCase()))) return false;
    if (query.tiers.length && !query.tiers.includes(rowTier(source) as ReportQuery["tiers"][number])) return false;
    if (query.categories.length && !matchesCategory(row, query.categories)) return false;
    if (query.categories.length && !query.tiers.length && (rowTier(source) === "Tier 4" || rowTier(source) === "BLACK TIER")) return false;
    return Boolean(rowMerchantId(source));
  });
}

async function loadTrendDetails(
  options: ReportEngineRunOptions,
  query: ReportQuery,
  offers: readonly ReportRow[]
): Promise<{ readonly offers: readonly ReportRow[]; readonly requested: number; readonly covered: number }> {
  const candidates = trendCandidateRows(query, offers);
  if (!options.provider.merchant || !candidates.length) return { offers, requested: candidates.length, covered: 0 };
  const details: ReportRow[] = [];
  let covered = 0;
  for (let index = 0; index < candidates.length; index += 6) {
    const batch = candidates.slice(index, index + 6);
    const results = await Promise.all(batch.map(async (candidate) => {
      const source = candidate as Readonly<Record<string, unknown>>;
      const merchantId = rowMerchantId(source);
      if (!merchantId) return [] as readonly ReportRow[];
      try {
        const payload = await options.provider.merchant(merchantId, query.months || 3, options.signal);
        abortIfNeeded(options.signal);
        const rows = merchantRowsFromPayload(payload, merchantId);
        if (rows.some((row) => {
          const value = row as Readonly<Record<string, unknown>>;
          return recordList(value.monthly).length > 0 || recordList(value.monthlyAmazonMetrics).length > 0 || recordList(value.monthlyAggregateMetrics).length > 0;
        })) covered += 1;
        return rows;
      } catch (error) {
        if (isRecord(error) && error.name === "AbortError") throw error;
        return [] as readonly ReportRow[];
      }
    }));
    results.forEach((rows) => details.push(...rows));
  }
  return { offers: mergeRows(offers, details), requested: candidates.length, covered };
}

function productRowsFromOffers(rows: readonly ReportRow[]): readonly ReportRow[] {
  return rows.flatMap((row) => {
    const source = row as Readonly<Record<string, unknown>>;
    return recordList(source.products).map((product) => ({
      merchantId: text(source.merchantId),
      merchantName: text(source.merchantName || source.brand),
      ...product
    }));
  });
}

function merchantMonthlyRowsFromOffers(rows: readonly ReportRow[]): readonly ReportRow[] {
  const primary = rows[0] as Readonly<Record<string, unknown>> | undefined;
  if (!primary) return [];
  const direct = recordList(primary.monthly);
  const fallback = direct.length
    ? direct
    : [...recordList(primary.monthlyAmazonMetrics), ...recordList(primary.monthlyAggregateMetrics)];
  const merchantId = text(primary.merchantId || primary.merchant_id || primary.id);
  const merchantName = text(primary.merchantName || primary.brand || primary.name);
  return fallback.map((row) => ({
    ...normalizeOfferRow(row),
    ...(merchantId ? { merchantId } : {}),
    ...(merchantName ? { merchantName } : {})
  }));
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sourceKind(value: ReportSource["kind"] | undefined, fallback: ChatbotDataSource): ReportSource["kind"] {
  return value === "db" || value === "cache" || value === "unavailable" ? value : fallback;
}

function sourceSnapshot(provider: ReportEngineContext["provider"]): { kind: ReportSource["kind"], asOf: string | null } {
  const candidate = provider as ReportEngineContext["provider"] & { snapshot?: () => { source?: ReportSource["kind"], asOf?: string | null } };
  const value = candidate.snapshot?.();
  return { kind: sourceKind(value?.source, "cache"), asOf: value?.asOf || null };
}

function summaryForRows(rows: readonly ReportRow[]): ChatbotReportSummary {
  const metric = (row: ReportRow, key: string): number => {
    const source = row as Readonly<Record<string, unknown>>;
    const keys: Record<string, readonly string[]> = {
      clicks: ["clicks", "Clicks"], orders: ["orders", "Order count", "orderCount"],
      revenue: ["salesAmount", "revenue", "sales", "Revenue"], commission: ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission"]
    };
    for (const field of keys[key] || [key]) {
      const value = number(String(source[field] ?? "").replace(/[$,%]/g, "").replace(/,/g, ""));
      if (source[field] !== undefined && source[field] !== null && Number.isFinite(value)) return value;
    }
    return 0;
  };
  const clicks = rows.reduce((sum, row) => sum + metric(row, "clicks"), 0);
  const orders = rows.reduce((sum, row) => sum + metric(row, "orders"), 0);
  return {
    offerCount: rows.length,
    clicks,
    orders,
    revenue: rows.reduce((sum, row) => sum + metric(row, "revenue"), 0),
    commission: rows.reduce((sum, row) => sum + metric(row, "commission"), 0),
    conversionRate: clicks ? orders / clicks : null
  };
}

function baseColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" },
    { key: "tier", label: "Tier", format: "text" },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "epc", label: "EPC", format: "money" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "conversionRate", label: language === "zh" ? "CVR" : "CVR", format: "percentage" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" },
    { key: "salesAmount", label: language === "zh" ? "销售额" : "Revenue", format: "money" },
    { key: "affCommission", label: language === "zh" ? "AFF 佣金" : "AFF commission", format: "money" },
    { key: "paymentCycle", label: language === "zh" ? "付款周期（天）" : "Payment cycle (days)", format: "integer" },
    { key: "recommendationScore", label: language === "zh" ? "推荐分" : "Recommendation score", format: "decimal" },
    { key: "recommendationReason", label: language === "zh" ? "推荐理由" : "Why recommended", format: "text" },
    { key: "trafficAngle", label: language === "zh" ? "流量角度" : "Traffic angle", format: "text" }
  ];
}

function metricsColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "offerCount", label: language === "zh" ? "结果数" : "Results", format: "integer" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "revenue", label: language === "zh" ? "销售额" : "Revenue", format: "money" },
    { key: "commission", label: language === "zh" ? "佣金" : "Commission", format: "money" },
    { key: "conversionRate", label: language === "zh" ? "CVR" : "CVR", format: "percentage" }
  ];
}

function tableBlock(id: string, title: string, rows: readonly ReportRow[], columns: readonly ReportColumn[]): ReportBlock {
  return { id, kind: "table", title, rows, columns };
}

function metricsBlock(id: string, title: string, rows: readonly ReportRow[], columns: readonly ReportColumn[]): ReportBlock {
  return { id, kind: "metrics", title, rows, columns };
}

function noticeBlock(id: string, title: string, note: string): ReportBlock {
  return { id, kind: "notice", title, text: note };
}

function summaryRow(summary: ChatbotReportSummary): ReportRow {
  return { ...summary };
}

function messageFor(query: ReportQuery, status: string, rows: readonly ReportRow[], language: UiLanguage, note?: string): string {
  if (query.resolution === "needs_input" || status === "needs_input") return query.issues.join(" ") || (language === "zh" ? "请补充查询条件。" : "Please provide more query details.");
  if (status === "unavailable") return language === "zh" ? "当前数据源暂时不可用，请稍后重试。" : "The current data source is temporarily unavailable. Try again later.";
  if (!rows.length) return note || (language === "zh" ? "当前数据中没有找到匹配结果。" : "No matching results were found in the current data.");
  const result = language === "zh" ? `已找到 ${rows.length.toLocaleString()} 条结果。` : `Found ${rows.length.toLocaleString()} results.`;
  return note ? `${result} ${note}` : result;
}

function resultStatus(value: string): "resolved" | "ambiguous" | "not_found" | "deferred" {
  if (value === "resolved" || value === "ambiguous" || value === "deferred") return value;
  return "not_found";
}

function resultSource(info: ReportSource): ChatbotDataSource {
  return info.kind;
}

function makeSheets(blocks: readonly ReportBlock[], language: UiLanguage): readonly ReportSheet[] {
  return blocks.flatMap((block) => block.kind === "notice" ? [] : [{
    name: block.title.slice(0, 31),
    role: block.kind === "metrics" ? "category-summary" as const : "detail" as const,
    rows: block.rows,
    columns: block.columns
  }]);
}

function publisherColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "rank", label: "#", format: "integer" },
    { key: "userId", label: language === "zh" ? "媒体 ID" : "Publisher ID", format: "text" },
    { key: "userName", label: language === "zh" ? "媒体名称" : "Publisher", format: "text" },
    { key: "adminName", label: language === "zh" ? "经理" : "Manager", format: "text" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" },
    { key: "conversionRate", label: "CVR", format: "percentage" },
    { key: "dpv", label: "DPV", format: "integer" },
    { key: "atc", label: "ATC", format: "integer" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "sales", label: language === "zh" ? "销售额" : "Sales", format: "money" },
    { key: "allCommission", label: language === "zh" ? "总佣金" : "All commission", format: "money" },
    { key: "affCommission", label: language === "zh" ? "AFF 佣金" : "AFF commission", format: "money" },
    { key: "grossProfit", label: language === "zh" ? "毛利" : "Gross profit", format: "money" }
  ];
}

function publisherPortfolioColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" },
    { key: "market", label: language === "zh" ? "市场" : "Market", format: "text" },
    { key: "network", label: language === "zh" ? "联盟" : "Network", format: "text" },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "tier", label: "Tier", format: "text" },
    { key: "salesShare", label: language === "zh" ? "销售占比" : "Sales share", format: "percentage" },
    { key: "epc", label: "AFF EPC", format: "decimal" },
    { key: "cvr", label: "CVR", format: "percentage" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "sales", label: language === "zh" ? "销售额" : "Sales", format: "money" },
    { key: "affCommission", label: language === "zh" ? "AFF 佣金" : "AFF commission", format: "money" }
  ];
}

function publisherAffinityColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "merchantCount", label: language === "zh" ? "商户数" : "Merchants", format: "integer" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "sales", label: language === "zh" ? "销售额" : "Sales", format: "money" },
    { key: "salesShare", label: language === "zh" ? "销售占比" : "Sales share", format: "percentage" }
  ];
}

function publisherAovBandColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "label", label: language === "zh" ? "AOV 区间" : "AOV band", format: "text" },
    { key: "merchantCount", label: language === "zh" ? "商户数" : "Merchants", format: "integer" },
    { key: "sales", label: language === "zh" ? "销售额" : "Sales", format: "money" },
    { key: "salesShare", label: language === "zh" ? "销售占比" : "Sales share", format: "percentage" }
  ];
}

function publisherMarketColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "market", label: language === "zh" ? "市场" : "Market", format: "text" },
    { key: "sales", label: language === "zh" ? "销售额" : "Sales", format: "money" },
    { key: "salesShare", label: language === "zh" ? "销售占比" : "Sales share", format: "percentage" }
  ];
}

function publisherSignalRows(summary: Readonly<Record<string, unknown>>, language: UiLanguage): readonly ReportRow[] {
  const categories = recordList(summary.categories);
  const aovBands = recordList(summary.aovBands);
  const markets = recordList(summary.markets);
  const topCategory = categories[0];
  const topAovBand = aovBands[0];
  const topMarket = markets[0];
  return [
    { signal: language === "zh" ? "主导品类" : "Leading category", value: text(topCategory?.category) || "—", detail: topCategory ? `${number(topCategory.salesShare) * 100}% sales` : "" },
    { signal: language === "zh" ? "主导 AOV" : "Leading AOV band", value: text(topAovBand?.label) || "—", detail: topAovBand ? `${number(topAovBand.salesShare) * 100}% sales` : "" },
    { signal: language === "zh" ? "主导市场" : "Leading market", value: text(topMarket?.market) || "—", detail: topMarket ? `${number(summary.sales) ? Math.round(number(topMarket.sales) / number(summary.sales) * 100) : 0}% sales` : "" },
    { signal: language === "zh" ? "有效 AFF 佣金率" : "Effective AFF rate", value: summary.commissionRate === null || summary.commissionRate === undefined ? "—" : `${number(summary.commissionRate)}%`, detail: language === "zh" ? "按实际销售额加权" : "Weighted by realized sales" }
  ];
}

function analysisColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" },
    { key: "tier", label: "Tier", format: "text" },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "epc", label: "EPC", format: "decimal" },
    { key: "conversionRate", label: "CVR", format: "percentage" },
    { key: "commissionRate", label: language === "zh" ? "AFF Comm%" : "AFF Comm%", format: "percentage" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" },
    { key: "percentileEpc", label: language === "zh" ? "EPC 百分位" : "EPC percentile", format: "decimal" },
    { key: "percentileCvr", label: language === "zh" ? "CVR 百分位" : "CVR percentile", format: "decimal" }
  ];
}

function trendColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "month", label: language === "zh" ? "月份" : "Month", format: "text" },
    { key: "value", label: language === "zh" ? "指标值" : "Value", format: "decimal" },
    { key: "previousValue", label: language === "zh" ? "上月" : "Previous", format: "decimal" },
    { key: "delta", label: language === "zh" ? "变化" : "Delta", format: "decimal" },
    { key: "deltaPct", label: language === "zh" ? "环比" : "MoM", format: "percentage" },
    { key: "estimated", label: language === "zh" ? "估算" : "Estimated", format: "text" },
    { key: "salesAmount", label: language === "zh" ? "销售额" : "Revenue", format: "money" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "epc", label: "EPC", format: "decimal" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" },
    { key: "affiliatePayout", label: language === "zh" ? "联盟支出" : "Affiliate payout", format: "money" },
    { key: "dpv", label: "DPV", format: "integer" },
    { key: "atc", label: "ATC", format: "integer" },
    { key: "conversionRate", label: "CVR", format: "percentage" },
    { key: "payout", label: language === "zh" ? "总支出" : "Payout", format: "money" },
    { key: "directSales", label: language === "zh" ? "直接销售" : "Direct sales", format: "money" },
    { key: "haloSales", label: "Halo sales", format: "money" }
  ];
}

function entityColumns(intent: ReportIntent, language: UiLanguage): readonly ReportColumn[] {
  if (intent === "asin") {
    return [
      { key: "asin", label: "ASIN", format: "text" },
      { key: "matchedAsins", label: language === "zh" ? "匹配 ASIN" : "Matched ASINs", format: "text" },
      { key: "productName", label: language === "zh" ? "产品" : "Product", format: "text" },
      ...baseColumns(language)
    ];
  }
  if (intent === "keyword") {
    return [
      { key: "keyword", label: language === "zh" ? "关键词" : "Keyword", format: "text" },
      { key: "productNameKeywords", label: language === "zh" ? "产品关键词" : "Product keywords", format: "text" },
      ...baseColumns(language)
    ];
  }
  return baseColumns(language);
}

function monthlyColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "month", label: language === "zh" ? "月份" : "Month", format: "text" },
    { key: "salesAmount", label: language === "zh" ? "销售额" : "Revenue", format: "money" },
    { key: "affCommission", label: language === "zh" ? "AFF 佣金" : "AFF commission", format: "money" },
    { key: "epc", label: "EPC", format: "decimal" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "conversionRate", label: "CVR", format: "percentage" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "clicks", label: language === "zh" ? "点击" : "Clicks", format: "integer" }
  ];
}

function paymentSummaryRow(summary: Readonly<Record<string, unknown>>): ReportRow {
  return {
    offerCount: summary.recordCount || 0,
    clicks: 0,
    orders: 0,
    revenue: summary.revenueMade || 0,
    commission: summary.commissionMade || 0,
    conversionRate: null,
    ...summary
  };
}

function mergeRows(base: readonly ReportRow[], extra: readonly ReportRow[]): readonly ReportRow[] {
  const byId = new Map(base.map((row) => [text((row as Record<string, unknown>).merchantId), row]));
  extra.forEach((row) => {
    const id = text((row as Record<string, unknown>).merchantId);
    if (id && byId.has(id)) byId.set(id, { ...byId.get(id), ...row });
    else base.length === 0 || !id ? byId.set(`${byId.size}`, row) : byId.set(id, row);
  });
  return [...byId.values()];
}

function requestTitle(query: ReportQuery, language: UiLanguage): string {
  const labels: Record<ReportIntent, [string, string]> = {
    merchant: ["商户报告", "Merchant report"], asin: ["ASIN 报告", "ASIN report"], keyword: ["关键词报告", "Keyword report"],
    category: ["品类报告", "Category report"], tier: ["Tier 报告", "Tier report"], recommendation: ["推荐结果", "Recommendations"],
    payment: ["付款记录", "Payment records"], analysis: ["分析报告", "Analysis report"], publisher: ["Publisher Records", "Publisher Records"], publisherprofile: ["Publisher Profile", "Publisher Profile"], help: ["使用说明", "Report Mode help"]
  };
  return labels[query.intent]?.[language === "zh" ? 0 : 1] || (language === "zh" ? "报告" : "Report");
}

export async function runReportEngine(options: ReportEngineRunOptions): Promise<ReportEngineResult> {
  const { query, language, signal } = options;
  let offers: readonly ReportRow[] = options.offers.slice();
  let source = sourceSnapshot(options.provider);
  let trendCoverage: { readonly requested: number; readonly covered: number } | null = null;
  try {
    const providerOffers = await options.provider.offers(signal);
    abortIfNeeded(signal);
    if (providerOffers.length) offers = providerOffers;
  } catch {
    // 保留 bootstrap 快照，报告仍可在缓存数据上完成。
  }
  if (signal.aborted) throw new DOMException("Report request aborted", "AbortError");

  let productKeywords = options.productKeywords;
  if (query.intent === "keyword" && !hasKeywordPayload(productKeywords)) {
    try {
      productKeywords = await options.provider.keywords(signal);
      abortIfNeeded(signal);
    } catch (error) {
      if (isRecord(error) && error.name === "AbortError") throw error;
      productKeywords = {};
    }
  }
  let paymentRecords = options.paymentRecords;
  if (query.intent === "payment" && options.provider.paymentRecords) {
    try {
      paymentRecords = await options.provider.paymentRecords(signal);
      abortIfNeeded(signal);
    } catch (error) {
      if (isRecord(error) && error.name === "AbortError") throw error;
    }
  }
  if ((query.intent === "merchant" || query.intent === "analysis") && query.merchantIds.length === 1) {
    try {
      const payload = await options.provider.merchant(query.merchantIds[0]!, query.months || 3, signal);
      abortIfNeeded(signal);
      const rows = merchantRowsFromPayload(payload, query.merchantIds[0]!);
      offers = mergeRows(offers, rows);
      if (rows.length && sourceSnapshot(options.provider).kind === "db") source = { ...source, kind: "db" };
    } catch (error) {
      if (isRecord(error) && error.name === "AbortError") throw error;
      // DB 补充失败时继续使用本地快照，并在来源中保留 cache。
    }
  }
  if (query.intent === "analysis" && query.analysisType === "trend" && (query.categories.length || query.tiers.length) && !query.merchantIds.length) {
    const detailResult = await loadTrendDetails(options, query, offers);
    offers = detailResult.offers;
    trendCoverage = { requested: detailResult.requested, covered: detailResult.covered };
    const detailSource = sourceSnapshot(options.provider);
    if (detailSource.kind === "db") source = { ...source, kind: "db", asOf: detailSource.asOf || source.asOf };
  }

  let rows: readonly ReportRow[] = [];
  let blocks: ReportBlock[] = [];
  let note: string | undefined;
  let status: "resolved" | "ambiguous" | "not_found" | "needs_input" | "unavailable" = "not_found";
  let title = requestTitle(query, language);
  let contentHtml: string | undefined;
  let reportSummary: ChatbotReportSummary = summaryForRows([]);

  if (query.intent === "publisher" || query.intent === "publisherprofile") {
    let publisherPayload: unknown = null;
    try {
      publisherPayload = await options.provider.publishers(signal);
      abortIfNeeded(signal);
      const publisherSource = sourceSnapshot(options.provider);
      source = { ...source, kind: publisherSource.kind, asOf: publisherSource.asOf || source.asOf };
    } catch (error) {
      if (isRecord(error) && error.name === "AbortError") throw error;
      publisherPayload = null;
    }
    if (query.intent === "publisher") {
      const payload = buildPublisherRecordsReport(query, publisherPayload, language);
      rows = payload.rows;
      status = payload.status;
      title = payload.title;
      note = payload.note;
      const summary = payload.summary;
      reportSummary = { offerCount: number(summary.publisherCount), clicks: number(summary.clicks), orders: number(summary.orders), revenue: number(summary.sales), commission: number(summary.affCommission), conversionRate: number(summary.cvr) };
      blocks.push(metricsBlock("publisher-summary", language === "zh" ? "媒体汇总" : "Publisher summary", [paymentSummaryRow({ ...summary, revenue: summary.sales, commission: summary.affCommission })], metricsColumns(language)));
      blocks.push(tableBlock("publisher-records", title, rows, publisherColumns(language)));
    } else {
      let portfolioPayload: unknown = null;
      try {
        const raw = publisherPayload as Record<string, unknown> | null;
        const publishers = Array.isArray(raw?.publishers) ? raw.publishers : [];
        const queryText = query.publisherQuery || query.merchantNames[0] || query.publisherFilters.merchantIds[0] || "";
        const matched = publishers.find((item) => {
          if (!item || typeof item !== "object") return false;
          const value = item as Record<string, unknown>;
          return text(value.userId) === queryText || text(value.userName).toLowerCase().includes(queryText.toLowerCase());
        }) as Record<string, unknown> | undefined;
        const userId = text(matched?.userId || queryText);
        if (userId) {
          portfolioPayload = await options.provider.publisherPortfolio(userId, null, null, signal);
          abortIfNeeded(signal);
        }
      } catch (error) {
        if (isRecord(error) && error.name === "AbortError") throw error;
        portfolioPayload = null;
      }
      const payload = buildPublisherProfileReport(query, publisherPayload, portfolioPayload, language);
      rows = payload.rows;
      status = payload.status;
      title = payload.title;
      note = payload.note;
      const summary = payload.summary;
      reportSummary = { offerCount: number(summary.merchantCount), clicks: number(summary.clicks), orders: number(summary.orders), revenue: number(summary.sales), commission: number(summary.affCommission), conversionRate: number(summary.cvr) };
      blocks.push(metricsBlock("publisher-profile-summary", language === "zh" ? "媒体 KPI" : "Publisher KPIs", [paymentSummaryRow({ ...summary, revenue: summary.sales, commission: summary.affCommission })], metricsColumns(language)));
      blocks.push(tableBlock("publisher-portfolio", title, rows, publisherPortfolioColumns(language)));
      const categories = recordList(summary.categories);
      const aovBands = recordList(summary.aovBands);
      const marketRows = recordList(summary.markets).map((row) => ({
        ...row,
        salesShare: number(summary.sales) > 0 ? number(row.sales) / number(summary.sales) : 0
      }));
      blocks.push(tableBlock("publisher-affinity", language === "zh" ? "品类倾向" : "Category affinity", categories, publisherAffinityColumns(language)));
      blocks.push(tableBlock("publisher-aov-bands", language === "zh" ? "AOV 区间" : "AOV bands", aovBands, publisherAovBandColumns(language)));
      blocks.push(tableBlock("publisher-markets", language === "zh" ? "市场分布" : "Market distribution", marketRows, publisherMarketColumns(language)));
      blocks.push(tableBlock("publisher-signals", language === "zh" ? "倾向信号" : "Affinity signals", publisherSignalRows(summary, language), [
        { key: "signal", label: language === "zh" ? "信号" : "Signal", format: "text" },
        { key: "value", label: language === "zh" ? "结论" : "Finding", format: "text" },
        { key: "detail", label: language === "zh" ? "说明" : "Detail", format: "text" }
      ]));
    }
  } else if (query.intent === "help") {
    status = "resolved";
    title = language === "zh" ? "使用说明" : "Report Mode help";
    const help = getReportHelpMarkdown(language);
    contentHtml = renderMarkdownToHtml(help);
    blocks.push(noticeBlock("report-help", title, language === "zh"
      ? "支持商户、ASIN、关键词、品类、Tier、付款、趋势和媒体查询；可打开 Deep Window、加入 Memory 并导出报告。"
      : "Supports merchant, ASIN, keyword, category, tier, payment, trend, and publisher queries. Reports can open in Deep Window, join Memory, and export."));
  } else if (query.intent === "payment") {
    const payload = buildPaymentReport(query, paymentRecords, offers, language, options.now());
    rows = payload.rows;
    status = payload.status;
    title = payload.title;
    note = payload.note;
    reportSummary = { offerCount: payload.summary.recordCount, clicks: 0, orders: 0, revenue: payload.summary.revenueMade, commission: payload.summary.commissionMade, conversionRate: null };
    blocks.push(metricsBlock("payment-summary", language === "zh" ? "付款汇总" : "Payment summary", [paymentSummaryRow(payload.summary)], metricsColumns(language)));
    blocks.push(tableBlock("payment-records", title, rows, paymentReportColumns(language)));
  } else if (query.intent === "recommendation") {
    const payload = buildRecommendationReport(query, offers, language);
    rows = payload.rows;
    status = payload.status;
    title = payload.title;
    note = payload.note;
    reportSummary = summaryForRows(rows);
    const isCategory = payload.categoryRows.length > 0;
    blocks.push(metricsBlock("recommendation-summary", language === "zh" ? "推荐汇总" : "Recommendation summary", [{
      ...summaryRow(reportSummary), requestedCount: payload.requestedCount, matchedCount: payload.matchedCount, gapCount: payload.gapCount
    }], [...metricsColumns(language),
      { key: "requestedCount", label: language === "zh" ? "请求数" : "Requested", format: "integer" },
      { key: "matchedCount", label: language === "zh" ? "命中数" : "Matched", format: "integer" },
      { key: "gapCount", label: language === "zh" ? "缺口" : "Gap", format: "integer" }
    ]));
    blocks.push(tableBlock("recommendations", title, rows, isCategory ? [
      { key: "rank", label: "#", format: "integer" }, { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
      { key: "score", label: language === "zh" ? "综合分" : "Score", format: "decimal" }, { key: "offerCount", label: language === "zh" ? "Offer 数" : "Offers", format: "integer" },
      { key: "salesAmount", label: language === "zh" ? "销售额" : "Revenue", format: "money" }, { key: "blendedEpc", label: "EPC", format: "decimal" }
    ] : baseColumns(language)));
  } else if (query.intent === "analysis" && query.analysisType !== "trend") {
    const payload = buildAnalysisReport(query, offers, language);
    rows = payload.rows;
    status = payload.status;
    title = payload.title;
    note = payload.note;
    reportSummary = summaryForRows(rows);
    blocks.push(metricsBlock("analysis-summary", language === "zh" ? "分析汇总" : "Analysis summary", [summaryRow(reportSummary)], metricsColumns(language)));
    blocks.push(tableBlock("analysis-results", title, rows, analysisColumns(language)));
    if (payload.peers.length) blocks.push(tableBlock("analysis-peers", language === "zh" ? "Peer 对比" : "Peer comparison", payload.peers, analysisColumns(language)));
    if (payload.unmatched.length) blocks.push(noticeBlock("analysis-unmatched", language === "zh" ? "未匹配目标" : "Unmatched targets", payload.unmatched.join(language === "zh" ? "、" : ", ")));
    const localText = analysisText(payload, language);
    try {
      const explanation = options.analyze ? await options.analyze({ ...payload.summary, rows: rows.slice(0, 50), query: query.prompt }, language, signal) : null;
      const finalText = explanation || localText;
      if (finalText) contentHtml = renderMarkdownToHtml(finalText);
    } catch {
      contentHtml = renderMarkdownToHtml(localText);
    }
  } else if (query.intent === "analysis" && query.analysisType === "trend") {
    const payload = buildTrendReport(query, offers, language, options.now());
    rows = payload.rows;
    status = payload.status;
    title = payload.title;
    note = payload.note;
    reportSummary = summaryForRows(rows);
    blocks.push({ id: "trend", kind: "trend", title, rows, columns: trendColumns(language), metric: payload.metric, categoryOptions: payload.categoryOptions, activeCategory: payload.activeCategory, visibleColumns: payload.visibleColumns });
  } else if (query.intent === "tier" || query.intent === "category" || query.intent === "merchant" || query.intent === "asin" || query.intent === "keyword") {
    const payload = buildEntityReport(query, offers, productKeywords, language);
    rows = payload.rows;
    status = payload.status;
    title = payload.title;
    note = payload.note;
    let unmatched = payload.unmatched;
    if (!rows.length && query.intent === "merchant" && query.lookupText && hasKeywordPayload(productKeywords)) {
      const keywordQuery: ReportQuery = {
        ...query,
        intent: "keyword",
        keyword: query.lookupText,
        merchantIds: [],
        merchantNames: [],
        lookupText: undefined
      };
      const keywordPayload = buildEntityReport(keywordQuery, mergeChatbotKeywords(offers, productKeywords), {}, language);
      if (keywordPayload.rows.length) {
        rows = keywordPayload.rows;
        status = keywordPayload.status;
        note = keywordPayload.note;
      }
    }
    if (!rows.length && payload.status !== "needs_input" && (query.intent === "merchant" || query.intent === "keyword" || query.intent === "asin")) {
      try {
        const searchPayload = await options.provider.search(query.lookupText || query.keyword || query.publisherQuery || query.prompt, signal);
        abortIfNeeded(signal);
        const remoteRows = reportRowsFromPayload(searchPayload);
        if (remoteRows.length) {
          const remoteQuery = query.intent === "merchant" && query.lookupText && !query.merchantIds.length && !query.merchantNames.length
            ? { ...query, merchantNames: [query.lookupText] }
            : query;
          const fallback = buildEntityReport(remoteQuery, remoteRows, productKeywords, language);
          rows = fallback.rows;
          status = fallback.status;
          note = fallback.note;
          unmatched = fallback.unmatched;
          source = { ...source, kind: "db" };
        }
      } catch (error) {
        if (isRecord(error) && error.name === "AbortError") throw error;
        // 保持 not_found，不把未知实体扩大为全量。
      }
    }
    reportSummary = summaryForRows(rows);
    blocks.push(metricsBlock("entity-summary", language === "zh" ? "结果汇总" : "Result summary", [summaryRow(reportSummary)], metricsColumns(language)));
    blocks.push(tableBlock("entity-results", title, rows, entityColumns(query.intent, language)));
    if (query.intent === "asin" && unmatched.length) {
      blocks.push(noticeBlock("asin-unmatched", language === "zh" ? "未匹配 ASIN" : "Unmatched ASINs", language === "zh"
        ? `以下 ASIN 未在当前数据中找到：${unmatched.join("、")}`
        : `These ASINs were not found in the current data: ${unmatched.join(", ")}`));
    }
    if (query.intent === "merchant") {
      const monthly = merchantMonthlyRowsFromOffers(rows);
      if (monthly.length) blocks.push(tableBlock("merchant-monthly", language === "zh" ? "月度指标" : "Monthly metrics", monthly, monthlyColumns(language)));
      const products = productRowsFromOffers(rows);
      if (products.length) blocks.push(tableBlock("merchant-products", language === "zh" ? "产品明细" : "Products", products, [
        { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
        { key: "asin", label: "ASIN", format: "text" },
        { key: "productName", label: language === "zh" ? "产品" : "Product", format: "text" },
        { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
        { key: "price", label: language === "zh" ? "价格" : "Price", format: "money" },
        { key: "commissionRate", label: language === "zh" ? "佣金率" : "Commission rate", format: "percentage" },
        { key: "updatedAt", label: language === "zh" ? "更新时间" : "Updated", format: "text" }
      ]));
    }
  }

  if (note) blocks.push(noticeBlock("report-note", language === "zh" ? "说明" : "Notes", note));
  if (!blocks.length) blocks.push(noticeBlock("report-empty", language === "zh" ? "报告" : "Report", language === "zh" ? "当前问题暂时无法生成报告。" : "The report could not be generated for this query."));
  const providerSource = sourceSnapshot(options.provider);
  const effectiveSource: ReportSource["kind"] = status === "unavailable"
    ? "unavailable"
    : source.kind === "db" || providerSource.kind === "db"
      ? "db"
      : sourceKind(source.kind, offers.length ? "cache" : providerSource.kind);
  const reportSourceInfo = reportSource(effectiveSource, {
    asOf: providerSource.asOf || source.asOf,
    partial: Boolean(note && /partial|部分|不可用|estimated|估算/i.test(note)) || Boolean(trendCoverage && trendCoverage.covered < trendCoverage.requested),
    estimated: Boolean(note && /estimated|估算/i.test(note)),
    covered: trendCoverage ? trendCoverage.covered : rows.length,
    requested: trendCoverage ? trendCoverage.requested : query.count || rows.length
  });
  const reportStatus = resultStatus(status);
  const message = messageFor(query, status, rows, language, note);
  const documentId = `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const document: ReportDocument = {
    intent: query.intent,
    title,
    status: reportStatus,
    query: query.prompt,
    source: resultSource(reportSourceInfo),
    rows,
    summary: reportSummary,
    message,
    ...(query.categories[0] ? { category: query.categories[0] } : {}),
    ...(query.tiers[0] ? { tier: query.tiers[0] } : {}),
    documentId,
    request: query,
    ...((query.intent === "recommendation" || query.intent === "tier" || query.intent === "category") && offers.length
      ? { rankingOffers: offers }
      : {}),
    blocks,
    sheets: makeSheets(blocks, language),
    sourceInfo: reportSourceInfo,
    ...(contentHtml ? { contentHtml } : {})
  };
  return {
    report: document,
    view: document as ChatbotReportViewResult
  };
}

function actionText(value: ReportAction["value"]): string {
  return typeof value === "string" ? value.trim() : "";
}

function actionTextList(value: ReportAction["value"]): readonly string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : actionText(value) ? [actionText(value)] : [];
}

function reportWithTrendColumns(document: ReportDocument, blockId: string | undefined, values: readonly string[]): ReportDocument {
  const trendIndex = document.blocks.findIndex((block) => block.kind === "trend" && (!blockId || block.id === blockId));
  if (trendIndex < 0) return document;
  const trendBlock = document.blocks[trendIndex];
  if (!trendBlock || trendBlock.kind !== "trend") return document;
  const available = new Set(trendBlock.columns.map((column) => column.key));
  const selected = Array.from(new Set(values.filter((value) => available.has(value))));
  const visibleColumns = selected.length ? selected : trendBlock.columns.slice(0, 3).map((column) => column.key);
  const blocks = document.blocks.map((block, index) => index === trendIndex ? { ...block, visibleColumns } : block);
  const sheetIndex = document.blocks.slice(0, trendIndex).filter((block) => block.kind !== "notice").length;
  const sheets = document.sheets.map((sheet, index) => index === sheetIndex
    ? { ...sheet, columns: sheet.columns.filter((column) => visibleColumns.includes(column.key)) }
    : sheet);
  return { ...document, blocks, sheets };
}

function queryForAction(document: ReportDocument, action: ReportAction): ReportQuery | null {
  const value = actionText(action.value);
  switch (action.type) {
    case "trend-metric": {
      const allowed = new Set([
        "salesAmount", "orders", "epc", "aov", "clicks", "affCommission", "commissionRate", "conversionRate", "dpv", "atc",
        "allEpc", "payout", "revenue", "affiliatePayout", "directSales", "haloSales"
      ]);
      return value && allowed.has(value)
        ? { ...document.request, intent: "analysis", analysisType: "trend", trendMetric: value as ReportQuery["trendMetric"] }
        : null;
    }
    case "trend-category":
      return { ...document.request, intent: "analysis", analysisType: "trend", categories: value ? [value] : [] };
    case "payment-month":
      return value ? { ...document.request, intent: "payment", month: value } : null;
    case "select-merchant":
      return value ? { ...document.request, intent: "merchant", merchantIds: [value], merchantNames: [] } : null;
    case "select-publisher":
      return value ? { ...document.request, intent: "publisherprofile", publisherQuery: value } : null;
    case "exclude-merchant":
      return {
        ...document.request,
        intent: "recommendation",
        excludeMerchantIds: Array.from(new Set([...document.request.excludeMerchantIds, ...actionTextList(action.value)]))
      };
    case "replace-merchant":
      return {
        ...document.request,
        intent: "recommendation",
        replaceMerchantIds: Array.from(new Set([...document.request.replaceMerchantIds, ...actionTextList(action.value)])),
        excludeMerchantIds: Array.from(new Set([...document.request.excludeMerchantIds, ...actionTextList(action.value)]))
      };
    case "trend-columns":
      return null;
    default:
      return null;
  }
}

/**
 * 对外提供统一报告执行入口，便于页面、Deep Window 和行为测试共享同一份模型。
 */
export async function executeReport(
  query: ReportQuery,
  context: ReportEngineContext,
  signal: AbortSignal,
  onUpdate?: (document: ReportDocument) => void
): Promise<ReportDocument> {
  const result = await runReportEngine({ ...context, query, language: query.language, signal });
  onUpdate?.(result.report);
  return result.report;
}

/**
 * 只允许对 documentId 指定的报告应用动作，避免旧回答的控件误操作当前最新报告。
 */
export async function applyReportAction(
  document: ReportDocument,
  action: ReportAction,
  context: ReportEngineContext,
  signal: AbortSignal,
  onUpdate?: (document: ReportDocument) => void
): Promise<ReportDocument> {
  if (action.documentId !== document.documentId) throw new Error("Report action does not match document");
  if (action.type === "trend-columns") {
    const next = reportWithTrendColumns(document, action.blockId, actionTextList(action.value));
    onUpdate?.(next);
    return next;
  }
  const query = queryForAction(document, action);
  if (!query) throw new Error("Report action value is invalid");
  return executeReport(query, context, signal, onUpdate);
}
