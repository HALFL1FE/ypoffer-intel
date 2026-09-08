import {
  canonicalChatbotTier,
  detectChatbotIntent,
  normalizeChatbotText,
  resolveChatbotCategory,
  resolveChatbotMerchant,
  searchChatbotOffers
} from "./chatbotModel";
import type { ChatbotIntent, ChatbotSearchOptions } from "./chatbotTypes";
import { classificationValues, type ChatbotClassification } from "./chatbotClassification";
type ChatbotDataSource = "cache" | "db" | "unavailable";

type OfferRow = Readonly<Record<string, unknown>>;

export interface ChatbotReportData {
  readonly offers: readonly OfferRow[];
}

export interface ChatbotReportSummary {
  readonly offerCount: number;
  readonly clicks: number;
  readonly orders: number;
  readonly revenue: number;
  readonly commission: number;
  readonly conversionRate: number | null;
}

export type ChatbotReportStatus = "resolved" | "ambiguous" | "not_found" | "deferred";

export interface ChatbotReportResult {
  readonly intent: ChatbotIntent;
  readonly status: ChatbotReportStatus;
  readonly query: string;
  readonly source: ChatbotDataSource;
  readonly rows: readonly OfferRow[];
  readonly summary: ChatbotReportSummary;
  readonly message: string;
  readonly category?: string;
  readonly tier?: string;
}

const CATEGORY_KEYS = [
  "sheetCategory", "Sheet Category", "mainCategory", "Main Category", "category", "Category",
  "levantaCategory", "Levanta Category"
] as const;

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberValue(row: OfferRow, keys: readonly string[]): number {
  for (const key of keys) {
    const value = text(row[key]).replace(/[$,%]/g, "").replace(/,/g, "");
    if (!value) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function rowTier(row: OfferRow): string {
  return canonicalChatbotTier(row.tier ?? row.Tier);
}

function rowCategories(row: OfferRow): string[] {
  return CATEGORY_KEYS.flatMap((key) => {
    const value = row[key];
    return Array.isArray(value) ? value.map(text).filter(Boolean) : text(value) ? [text(value)] : [];
  });
}

function rowMatchesCategory(row: OfferRow, category: string): boolean {
  const query = normalizeChatbotText(category);
  return rowCategories(row).some((value) => {
    const normalized = normalizeChatbotText(value);
    return normalized === query || normalized.includes(query) || query.includes(normalized);
  });
}

export function summarizeChatbotOffers(rows: readonly OfferRow[]): ChatbotReportSummary {
  const clicks = rows.reduce((sum, row) => sum + numberValue(row, ["clicks", "Clicks", "totalClicks"]), 0);
  const orders = rows.reduce((sum, row) => sum + numberValue(row, ["orders", "Order count", "orderCount"]), 0);
  const revenue = rows.reduce((sum, row) => sum + numberValue(row, ["salesAmount", "revenue", "Revenue"]), 0);
  const commission = rows.reduce((sum, row) => sum + numberValue(row, ["affCommission", "commissionMade", "AFF Commission"]), 0);
  return {
    offerCount: rows.length,
    clicks,
    orders,
    revenue,
    commission,
    conversionRate: clicks ? orders / clicks : null
  };
}

function categoryValues(rows: readonly OfferRow[]): string[] {
  return Array.from(new Set(rows.flatMap(rowCategories).filter((value) => value.toLowerCase() !== "uncategorized")));
}

function tierFromPrompt(prompt: string): string | null {
  if (/black\s*tier|黑名单|黑色\s*tier|屏蔽|暂停/i.test(prompt)) return "BLACK TIER";
  const match = prompt.match(/tier\s*([1-4])/i) || prompt.match(/(?:第\s*)?([一二三四1-4])\s*(?:层|级|档)/);
  if (!match?.[1]) return null;
  const digit = { 一: "1", 二: "2", 三: "3", 四: "4" }[match[1]] || match[1];
  return `Tier ${digit}`;
}

function localizedMessage(
  language: "zh" | "en",
  intent: ChatbotIntent,
  rows: readonly OfferRow[],
  category?: string,
  tier?: string,
  status: ChatbotReportStatus = "resolved"
): string {
  if (status === "deferred") {
    return language === "zh"
      ? "该问题需要 Chat Mode 调用实时分析或付款接口，请切换到 Chat Mode 继续。"
      : "This question needs the live analysis or payment route. Switch to Chat Mode to continue.";
  }
  if (!rows.length) {
    return language === "zh" ? "当前数据中没有找到匹配结果。" : "No matching results were found in the current data.";
  }
  const label = category || tier || (intent === "merchant" ? text(rows[0]?.brand || rows[0]?.merchantName) : "current query");
  if (language === "zh") return `${label || "当前查询"} 已从缓存数据中找到 ${rows.length.toLocaleString()} 条匹配结果。`;
  return `${label || "Current query"} returned ${rows.length.toLocaleString()} matching results from cached data.`;
}

function withOptions(prompt: string, tier: string | null): ChatbotSearchOptions {
  return {
    tier,
    includeTier4: Boolean(tier === "Tier 4" || /tier\s*4|第四层|第四级|四层|四级/i.test(prompt)),
    includeBlack: Boolean(tier === "BLACK TIER" || /black|blocked|黑名单|黑色|屏蔽|暂停/i.test(prompt))
  };
}

function defaultTierVisible(row: OfferRow): boolean {
  const tier = rowTier(row);
  return tier !== "Tier 4" && tier !== "BLACK TIER";
}

export function buildChatbotReport(
  prompt: string,
  data: ChatbotReportData,
  language: "zh" | "en" = "zh",
  classification: ChatbotClassification | null = null
): ChatbotReportResult {
  const query = text(prompt);
  const offers = data.offers.slice();
  const detected = classification?.intent || detectChatbotIntent(query);
  const params = classification?.params || {};
  const tiers = classificationValues(params.tier).map(canonicalChatbotTier);
  const categories = classificationValues(params.category);
  const tier = tiers[0] || tierFromPrompt(query);
  const category = categories[0] || resolveChatbotCategory(query, categoryValues(offers));
  const merchantQuery = classificationValues(params.merchantId)[0]
    ? `merchant ID: ${classificationValues(params.merchantId)[0]}`
    : classificationValues(params.merchantName)[0] || query;
  const merchant = resolveChatbotMerchant(merchantQuery, offers);

  let intent: ChatbotIntent = detected;
  let rows: OfferRow[] = [];
  let status: ChatbotReportStatus = "resolved";

  if (detected === "payment" || detected === "analysis") {
    status = "deferred";
  } else if (classification) {
    if (detected === "merchant") {
      rows = merchant.matches.map((match) => match.offer);
      status = merchant.status;
      if (status === "not_found" && !params.merchantId && !params.merchantName) {
        rows = searchChatbotOffers(offers, query, withOptions(query, tier)).map((match) => match.offer);
        status = rows.length ? "resolved" : "not_found";
      }
    } else if (detected === "asin") {
      const asin = classificationValues(params.asin)[0] || query;
      rows = searchChatbotOffers(offers, asin, withOptions(query, tier))
        .filter((match) => match.matchType === "asin").map((match) => match.offer);
    } else {
      const selectedTiers = tiers.length ? tiers : tier ? [tier] : [];
      const selectedCategories = categories.length ? categories : category ? [category] : [];
      rows = offers.filter((row) => {
        const value = rowTier(row);
        const tierAllowed = selectedTiers.length ? selectedTiers.includes(value)
          : (value !== "Tier 4" || params.includeTier4 === true)
            && (value !== "BLACK TIER" || params.includeBlack === true);
        return tierAllowed && (!selectedCategories.length || selectedCategories.some((item) => rowMatchesCategory(row, item)));
      });
      if (detected === "recommendation") {
        if (Array.isArray(params.metricFilters)) {
          for (const filter of params.metricFilters) {
            if (!filter || typeof filter !== "object" || typeof filter.field !== "string" || typeof filter.value !== "number") continue;
            rows = rows.filter((row) => {
              const value = numberValue(row, [filter.field]);
              if (filter.operator === ">") return value > filter.value;
              if (filter.operator === ">=") return value >= filter.value;
              if (filter.operator === "<") return value < filter.value;
              if (filter.operator === "<=") return value <= filter.value;
              return true;
            });
          }
        }
        const sort = params.metricSort as { field?: unknown; direction?: unknown } | undefined;
        const field = typeof sort?.field === "string" ? sort.field : "salesAmount";
        const direction = sort?.direction === "asc" ? 1 : -1;
        rows.sort((a, b) => direction * (numberValue(a, [field]) - numberValue(b, [field])));
        if (typeof params.count === "number" && Number.isInteger(params.count) && params.count > 0) {
          rows = rows.slice(0, params.count);
        }
      } else if ((detected === "category" && !selectedCategories.length) || (detected === "tier" && !selectedTiers.length)) {
        rows = [];
      }
    }
  } else if (tier) {
    intent = detected === "recommendation" ? "recommendation" : "tier";
    rows = offers.filter((row) => rowTier(row) === tier && (!category || rowMatchesCategory(row, category)));
  } else if (merchant.status !== "not_found" && (detected === "merchant" || /\bid\s*[:#]?\s*[a-z0-9_-]+/i.test(query))) {
    intent = "merchant";
    rows = merchant.matches.map((match) => match.offer);
    status = merchant.status;
  } else if (category) {
    intent = detected === "recommendation" ? "recommendation" : "category";
    rows = offers.filter((row) => defaultTierVisible(row) && rowMatchesCategory(row, category));
  } else if (detected === "recommendation") {
    const matches = searchChatbotOffers(offers, query, withOptions(query, tier));
    rows = matches.map((match) => match.offer);
  } else if (detected === "asin") {
    const matches = searchChatbotOffers(offers, query, withOptions(query, tier));
    rows = matches.map((match) => match.offer);
  } else {
    rows = searchChatbotOffers(offers, query, withOptions(query, tier)).map((match) => match.offer);
    status = rows.length ? "resolved" : merchant.status;
  }

  if (!rows.length && status === "resolved") status = "not_found";
  return {
    intent,
    status,
    query,
    source: "cache",
    rows,
    summary: summarizeChatbotOffers(rows),
    message: localizedMessage(language, intent, rows, category || undefined, tier || undefined, status),
    ...(category ? { category } : {}),
    ...(tier ? { tier } : {})
  };
}
