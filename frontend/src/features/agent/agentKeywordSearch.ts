import type { UiLanguage } from "../../shared/i18n";
import { normalizeChatbotText } from "../chatbot/chatbotModel";
import { buildEntityReport, metricValue, nullableNumber, rowMerchantId, rowMerchantName } from "../chatbot/report/entityReports";
import { resolveReportQuery } from "../chatbot/report/reportQuery";
import { compareRecommendationOffers } from "../chatbot/report/recommendationReports";
import type { ReportRow } from "../chatbot/report/reportContracts";

type Row = Readonly<Record<string, unknown>>;

function values(row: Row, keys: readonly string[]): string[] {
  return keys.flatMap((key) => (Array.isArray(row[key]) ? row[key] as unknown[] : [row[key]]))
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim()).filter(Boolean);
}

function evidence(row: Row, keyword: string): { matchedField: string; matchedText: string } {
  const groups: Array<[string, readonly string[]]> = [
    ["productTitles", ["productTitles", "productTitle"]],
    ["productKeywords", ["productNameKeywords", "product_name_keywords", "productKeywords", "product_keywords", "keywords", "keyword"]],
    ["merchantName", ["merchantName", "brand", "merchant_name"]],
    ["category", ["sheetCategory", "mainCategory", "category", "levantaCategory", "feishuMainCategory"]]
  ];
  const needle = normalizeChatbotText(keyword);
  for (const [matchedField, keys] of groups) {
    const found = values(row, keys).find((value) => normalizeChatbotText(value).includes(needle));
    if (found) return { matchedField, matchedText: found.slice(0, 80) };
  }
  return { matchedField: "other", matchedText: keyword.slice(0, 80) };
}

function availableMetric(row: Row, aliases: readonly string[], field: string): number | undefined {
  if (nullableNumber(row, aliases) === null) return undefined;
  const value = metricValue(row, field);
  return Number.isFinite(value) ? value : undefined;
}

export interface AgentKeywordMatch {
  readonly merchantId: string;
  readonly merchantName: string;
  readonly tier?: string;
  readonly category?: string;
  readonly matchedField: string;
  readonly matchedText: string;
  readonly rank?: number;
  readonly ranked?: boolean;
  readonly salesAmount?: number;
  readonly orders?: number;
  readonly aov?: number;
  readonly affCommission?: number;
  readonly conversionRate?: number;
  readonly epc?: number;
  readonly clicks?: number;
}

export interface AgentKeywordResult {
  readonly keyword: string;
  readonly mode: "search" | "recommendation";
  readonly rows: readonly AgentKeywordMatch[];
  readonly matchedCount: number;
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly unrankedCount: number;
  readonly headline: string;
  readonly note: string;
  readonly partial: boolean;
}

export function searchAgentKeywords(
  keyword: string,
  mode: "search" | "recommendation",
  limit: number,
  offers: readonly ReportRow[],
  productKeywords: unknown,
  language: UiLanguage,
  partial: boolean
): AgentKeywordResult {
  const query = resolveReportQuery(`/keyword: ${keyword}`, { language, categories: [] });
  const report = buildEntityReport(query, offers, productKeywords, language);
  const offerById = new Map(offers.map((row) => [rowMerchantId(row), row]));
  const matches = report.rows.flatMap((row) => {
    const merchantId = rowMerchantId(row);
    const merchantName = rowMerchantName(row);
    if (!merchantId || !merchantName) return [];
    const offer = offerById.get(merchantId);
    const salesAmount = offer && availableMetric(offer, ["salesAmount", "revenue", "Revenue", "sales", "totalSales"], "salesAmount");
    const orders = offer && availableMetric(offer, ["orders", "orderCount", "Order count", "Orders"], "orders");
    const affCommission = offer && availableMetric(offer, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission", "commission"], "affCommission");
    const clicks = offer && availableMetric(offer, ["clicks", "Clicks", "totalClicks"], "clicks");
    const explicitConversion = offer && availableMetric(offer, ["conversionRate", "conversion", "CVR", "Conversion Rate"], "conversionRate");
    const explicitEpc = offer && availableMetric(offer, ["epc", "affEpc", "EPC", "EPC(Aff)", "Backend EPC"], "epc");
    const explicitAov = offer && availableMetric(offer, ["aov", "AOV"], "aov");
    const conversionRate = explicitConversion ?? (offer && orders !== undefined && clicks !== undefined && clicks > 0 ? metricValue(offer, "conversionRate") : undefined);
    const epc = explicitEpc ?? (offer && affCommission !== undefined && clicks !== undefined && clicks > 0 ? metricValue(offer, "epc") : undefined);
    const aov = explicitAov ?? (offer && salesAmount !== undefined && orders !== undefined && orders > 0 ? metricValue(offer, "aov") : undefined);
    const ranked = Boolean(offer && [salesAmount, orders, aov, affCommission, clicks, conversionRate, epc].some((value) => value !== undefined));
    const match: AgentKeywordMatch = {
      merchantId: merchantId.slice(0, 80), merchantName: merchantName.slice(0, 120),
      ...(typeof row.tier === "string" && row.tier ? { tier: row.tier.slice(0, 40) } : {}),
      ...(typeof row.category === "string" && row.category ? { category: row.category.slice(0, 120) } : {}),
      ...evidence(row, keyword),
      ...(mode === "recommendation" ? { ranked } : {}),
      ...(salesAmount !== undefined ? { salesAmount } : {}),
      ...(orders !== undefined ? { orders } : {}),
      ...(aov !== undefined ? { aov } : {}),
      ...(affCommission !== undefined ? { affCommission } : {}),
      ...(clicks !== undefined ? { clicks } : {}),
      ...(conversionRate !== undefined ? { conversionRate } : {}),
      ...(epc !== undefined ? { epc } : {})
    };
    return [{ match, offer, ranked }];
  });
  const ordered = mode === "recommendation"
    ? [
      ...matches.filter((item) => item.ranked).sort((left, right) => compareRecommendationOffers(left.offer!, right.offer!)),
      ...matches.filter((item) => !item.ranked)
    ]
    : matches;
  let rank = 0;
  const rows = ordered.slice(0, limit).map((item) => item.ranked && mode === "recommendation"
    ? { ...item.match, rank: ++rank }
    : item.match);
  const unrankedCount = mode === "recommendation" ? matches.filter((item) => !item.ranked).length : 0;
  const headline = language === "zh"
    ? `${keyword} ${mode === "recommendation" ? "匹配商家推荐" : "关键词匹配商家"}`
    : `${keyword} ${mode === "recommendation" ? "matched merchant recommendations" : "keyword matches"}`;
  const notes = [
    mode === "recommendation"
      ? (language === "zh" ? "按命中商家的整体快照表现排序，不代表该关键词商品销量。" : "Ranked by matched merchants' overall snapshot performance, not product sales.")
      : (language === "zh" ? "按产品关键词及商户搜索字段匹配，未按表现排序。" : "Matched search fields; not ranked by performance."),
    ...(unrankedCount ? [language === "zh" ? `${unrankedCount} 家仅在关键词目录中命中，未参与排序。` : `${unrankedCount} catalog-only merchants were not ranked.`] : []),
    ...(matches.length > limit ? [language === "zh" ? `仅显示前 ${limit} 家。` : `Showing only the first ${limit} merchants.`] : []),
    ...(partial ? [language === "zh" ? "关键词目录不可用，当前匹配可能不完整。" : "Keyword catalog unavailable; matches may be incomplete."] : []),
    ...(report.status === "needs_input" && report.note ? [report.note] : [])
  ];
  return { keyword, mode, rows, matchedCount: matches.length, returnedCount: rows.length, truncated: matches.length > limit, unrankedCount, headline, note: notes.join(" "), partial };
}
