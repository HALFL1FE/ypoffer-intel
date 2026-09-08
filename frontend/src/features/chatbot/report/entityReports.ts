import { canonicalChatbotTier, normalizeChatbotText } from "../chatbotModel";
import type { UiLanguage } from "../../../shared/i18n";
import type { ReportQuery, ReportRow } from "./reportContracts";

type RawRecord = Readonly<Record<string, unknown>>;

export interface EntityReportPayload {
  readonly rows: readonly ReportRow[];
  readonly unmatched: readonly string[];
  readonly ambiguous: readonly string[];
  readonly status: "resolved" | "ambiguous" | "not_found" | "needs_input";
  readonly title: string;
  readonly note?: string;
}

const CATEGORY_KEYS = [
  "sheetCategory", "Sheet Category", "mainCategory", "Main Category", "category", "Category",
  "levantaCategory", "Levanta Category", "feishuMainCategory", "Feishu Main Category"
] as const;
const ASIN_KEYS = ["topAsins", "topRankAsins", "productAsins", "asins", "ASIN", "asin"] as const;
const KEYWORD_KEYS = [
  "productNameKeywords", "product_name_keywords", "productKeywords", "product_keywords", "keywords", "keyword",
  "productTitles", "productTitle"
] as const;

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string {
  return String(value ?? "").trim();
}

export function numberValue(row: RawRecord, keys: readonly string[], fallback = 0): number {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

export function nullableNumber(row: RawRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function nullableRatio(row: RawRecord, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = row[key];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,%]/g, "").replace(/,/g, ""));
    if (!Number.isFinite(value)) return null;
    return String(raw).includes("%") || Math.abs(value) > 1 ? value / 100 : value;
  }
  return null;
}

export function rowMerchantId(row: RawRecord): string {
  return text(row.merchantId ?? row.merchant_id ?? row["Merchant ID"] ?? row.MerchantID ?? row.id).replace(/\.0$/, "");
}

export function rowMerchantName(row: RawRecord): string {
  return text(row.brand ?? row.merchantName ?? row.merchant_name ?? row["Merchant Name"] ?? row.Merchant ?? row.name);
}

export function rowTier(row: RawRecord): string {
  return canonicalChatbotTier(row.tier ?? row.Tier);
}

function values(row: RawRecord, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = row[key];
    if (Array.isArray(value)) return value.flatMap((item) => isRecord(item) ? Object.values(item).map(text) : [text(item)]).filter(Boolean);
    if (isRecord(value)) return Object.values(value).map(text).filter(Boolean);
    return text(value) ? [text(value)] : [];
  });
}

export function rowCategories(row: RawRecord): readonly string[] {
  return Array.from(new Set(values(row, CATEGORY_KEYS).filter((value) => normalizeChatbotText(value) !== "uncategorized")));
}

export function rowAsins(row: RawRecord): readonly string[] {
  return Array.from(new Set(values(row, ASIN_KEYS).map((value) => value.toUpperCase()).filter((value) => /^B[0-9A-Z]{9}$/.test(value))));
}

export function rowKeywords(row: RawRecord): readonly string[] {
  return Array.from(new Set(values(row, KEYWORD_KEYS)));
}

export function metricValue(row: RawRecord, field: string): number {
  switch (field) {
    case "salesAmount": return numberValue(row, ["salesAmount", "revenue", "Revenue", "sales", "totalSales"]);
    case "affCommission": return numberValue(row, ["affCommission", "affiliatePayout", "commissionMade", "AFF Commission", "commission"]);
    case "commissionRate": {
      const explicit = nullableRatio(row, ["commissionRate", "affCommissionRate", "effectiveCommissionRate"]);
      const sales = metricValue(row, "salesAmount");
      return explicit ?? (sales > 0 ? metricValue(row, "affCommission") / sales : 0);
    }
    case "epc": {
      const explicit = nullableNumber(row, ["epc", "affEpc", "EPC", "EPC(Aff)", "Backend EPC"]);
      const clicks = metricValue(row, "clicks");
      return explicit ?? (clicks > 0 ? metricValue(row, "affCommission") / clicks : 0);
    }
    case "aov": {
      const explicit = nullableNumber(row, ["aov", "AOV"]);
      const orders = metricValue(row, "orders");
      return explicit ?? (orders > 0 ? metricValue(row, "salesAmount") / orders : 0);
    }
    case "conversionRate": {
      const explicit = nullableRatio(row, ["conversionRate", "conversion", "CVR", "Conversion Rate"]);
      const clicks = metricValue(row, "clicks");
      return explicit ?? (clicks > 0 ? metricValue(row, "orders") / clicks : 0);
    }
    case "orders": return numberValue(row, ["orders", "Order count", "orderCount", "Orders"]);
    case "clicks": return numberValue(row, ["clicks", "Clicks", "totalClicks"]);
    case "dpv": return numberValue(row, ["dpv", "DPV", "detailPageViews"]);
    case "atc": return numberValue(row, ["atc", "ATC", "addToCart"]);
    default: return 0;
  }
}

export function normalizeOfferRow(row: ReportRow): ReportRow {
  const source = row as RawRecord;
  const merchantId = rowMerchantId(source);
  const merchantName = rowMerchantName(source);
  const categories = rowCategories(source);
  const tier = rowTier(source);
  return {
    ...source,
    ...(merchantId ? { merchantId } : {}),
    ...(merchantName ? { merchantName, brand: merchantName } : {}),
    ...(categories[0] ? { category: categories[0], categories } : {}),
    ...(tier ? { tier } : {}),
    clicks: metricValue(source, "clicks"),
    orders: metricValue(source, "orders"),
    salesAmount: metricValue(source, "salesAmount"),
    affCommission: metricValue(source, "affCommission"),
    epc: metricValue(source, "epc"),
    aov: metricValue(source, "aov"),
    conversionRate: metricValue(source, "conversionRate")
  };
}

function matchesText(query: string, candidate: string): boolean {
  const normalizedQuery = normalizeChatbotText(query);
  const normalizedCandidate = normalizeChatbotText(candidate);
  return Boolean(normalizedQuery && normalizedCandidate && (
    normalizedCandidate === normalizedQuery
    || normalizedCandidate.includes(normalizedQuery)
    || normalizedQuery.includes(normalizedCandidate)
  ));
}

export function matchesCategory(row: ReportRow, categories: readonly string[]): boolean {
  if (!categories.length) return true;
  const rowValues = rowCategories(row as RawRecord);
  return categories.some((category) => rowValues.some((value) => matchesText(category, value)));
}

export function matchesMerchant(row: ReportRow, ids: readonly string[], names: readonly string[]): boolean {
  const source = row as RawRecord;
  const id = rowMerchantId(source);
  const name = rowMerchantName(source);
  // 同时给出 ID 和名称时，ID 是稳定主键，名称只作为展示信息，不应把正确命中误筛掉。
  if (ids.length) return ids.includes(id);
  if (names.length) return names.some((value) => matchesText(value, name));
  return false;
}

export function matchesAsin(row: ReportRow, asins: readonly string[]): boolean {
  if (!asins.length) return false;
  const rowValues = rowAsins(row as RawRecord);
  return asins.some((asin) => rowValues.includes(asin.toUpperCase()));
}

export function matchesKeyword(row: ReportRow, keyword: string): boolean {
  const source = row as RawRecord;
  const haystack = [rowMerchantName(source), ...rowCategories(source), ...rowKeywords(source), JSON.stringify(source.productTitle || "")]
    .map(normalizeChatbotText).join(" ");
  return Boolean(normalizeChatbotText(keyword) && haystack.includes(normalizeChatbotText(keyword)));
}

function visibleCategoryTier(row: ReportRow, query: ReportQuery): boolean {
  const currentTier = rowTier(row as RawRecord);
  if (query.tiers.length && !query.tiers.includes(currentTier as ReportQuery["tiers"][number])) return false;
  return (query.includeTier4 || currentTier !== "Tier 4")
    && (query.includeBlack || currentTier !== "BLACK TIER");
}

function metricFilterMatches(row: ReportRow, query: ReportQuery): boolean {
  return query.metricFilters.every((filter) => {
    const current = metricValue(row as RawRecord, filter.field);
    switch (filter.operator) {
      case ">": return current > filter.value;
      case ">=": return current >= filter.value;
      case "<": return current < filter.value;
      case "<=": return current <= filter.value;
      case "=": return current === filter.value;
    }
  });
}

function keywordVisible(row: ReportRow, query: ReportQuery): boolean {
  if (!visibleCategoryTier(row, query)) return false;
  if (query.categories.length && !matchesCategory(row, query.categories)) return false;
  return metricFilterMatches(row, query);
}

function sortKeywordRows(rows: readonly ReportRow[], query: ReportQuery): readonly ReportRow[] {
  if (!query.metricSort) return rows;
  const { field, direction } = query.metricSort;
  return [...rows].sort((left, right) => {
    const delta = metricValue(left as RawRecord, field) - metricValue(right as RawRecord, field);
    return direction === "asc" ? delta : -delta;
  });
}

function keywordCatalogValues(payload: unknown): readonly ReportRow[] {
  if (Array.isArray(payload)) return payload.filter(isRecord).map((row) => ({ ...row }));
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload.merchants)) return payload.merchants.filter(isRecord).map((row) => ({ ...row }));
  if (Array.isArray(payload.rows)) return payload.rows.filter(isRecord).map((row) => ({ ...row }));
  const rows: ReportRow[] = [];
  for (const [keyword, value] of Object.entries(payload)) {
    if (Array.isArray(value)) {
      const asins = value.map(text).filter(Boolean);
      rows.push({ keyword, asins });
    } else if (isRecord(value)) {
      rows.push({ keyword, ...value });
    } else if (text(value)) {
      rows.push({ keyword, value: text(value) });
    }
  }
  return rows;
}

function localizedTitle(intent: ReportQuery["intent"], language: UiLanguage): string {
  const titles: Record<string, [string, string]> = {
    merchant: ["商户报告", "Merchant report"], asin: ["ASIN 查询", "ASIN lookup"], keyword: ["关键词查询", "Keyword lookup"],
    category: ["品类报告", "Category report"], tier: ["Tier 报告", "Tier report"]
  };
  const pair = titles[intent] || ["报告", "Report"];
  return pair[language === "zh" ? 0 : 1];
}

export function buildEntityReport(
  query: ReportQuery,
  offers: readonly ReportRow[],
  productKeywords: unknown,
  language: UiLanguage
): EntityReportPayload {
  const normalized = offers.map(normalizeOfferRow);
  let rows: ReportRow[] = [];
  const unmatched: string[] = [];
  const ambiguous: string[] = [];

  if (query.intent === "merchant") {
    if (query.merchantIds.length || query.merchantNames.length) {
      rows = normalized.filter((row) => matchesMerchant(row, query.merchantIds, query.merchantNames));
      if (query.merchantIds.some((id) => !rows.some((row) => rowMerchantId(row as RawRecord) === id))) unmatched.push(...query.merchantIds.filter((id) => !rows.some((row) => rowMerchantId(row as RawRecord) === id)));
      if (query.merchantNames.some((name) => !rows.some((row) => matchesMerchant(row, [], [name])))) unmatched.push(...query.merchantNames);
      const names = query.merchantNames.filter((name) => normalized.filter((row) => matchesMerchant(row, [], [name])).length > 1);
      ambiguous.push(...names);
    }
  } else if (query.intent === "asin") {
    rows = normalized.filter((row) => matchesAsin(row, query.asins)).map((row) => ({ ...row, matchedAsins: rowAsins(row as RawRecord).filter((asin) => query.asins.includes(asin)) }));
    unmatched.push(...query.asins.filter((asin) => !rows.some((row) => rowAsins(row as RawRecord).includes(asin))));
  } else if (query.intent === "keyword") {
    const keyword = query.keyword || "";
    if (normalizeChatbotText(keyword) === "audio") {
      return {
        rows: [],
        unmatched: [],
        ambiguous: [],
        status: "needs_input",
        title: localizedTitle(query.intent, language),
        note: language === "zh"
          ? "你是指 headphones/earbuds/audio 产品，还是想查看全部 electronics offers？"
          : "Do you mean headphones/earbuds/audio products, or do you want all electronics offers?"
      };
    }
    const catalog = keywordCatalogValues(productKeywords);
    const catalogMatches = catalog.filter((row) => matchesKeyword(row, keyword) || matchesText(keyword, text(row.keyword)));
    const visibleCatalog = catalogMatches.filter((row) => keywordVisible(row, query));
    const fieldValues = (record: RawRecord, key: string): string[] => {
      const value = record[key];
      return (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);
    };
    const mergeSearchFields = (base: ReportRow, catalogRow: ReportRow): ReportRow => {
      const baseRecord = base as RawRecord;
      const searchFields: Record<string, readonly string[]> = {};
      for (const key of KEYWORD_KEYS) {
        const values = Array.from(new Set([...fieldValues(baseRecord, key), ...fieldValues(catalogRow as RawRecord, key)]));
        if (values.length) searchFields[key] = values;
      }
      return { ...baseRecord, ...searchFields };
    };
    const catalogByMerchant = new Map<string, ReportRow>();
    for (const catalogRow of visibleCatalog) {
      const merchantId = rowMerchantId(catalogRow as RawRecord);
      if (!merchantId) continue;
      const existing = catalogByMerchant.get(merchantId);
      catalogByMerchant.set(merchantId, existing ? mergeSearchFields(existing, catalogRow) : catalogRow);
    }
    const enriched = normalized.map((row) => {
      const catalogRow = catalogByMerchant.get(rowMerchantId(row as RawRecord));
      return catalogRow ? mergeSearchFields(row, catalogRow) : row;
    });
    rows = enriched.filter((row) => matchesKeyword(row, keyword) && keywordVisible(row, query));
    const mergedRows: ReportRow[] = [...rows];
    const rowIndexes = new Map<string, number>();
    mergedRows.forEach((row, index) => {
      const merchantId = rowMerchantId(row as RawRecord);
      if (merchantId && !rowIndexes.has(merchantId)) rowIndexes.set(merchantId, index);
    });
    for (const catalogRow of visibleCatalog) {
      const merchantId = rowMerchantId(catalogRow as RawRecord);
      const existingIndex = merchantId ? rowIndexes.get(merchantId) : undefined;
      if (existingIndex !== undefined) {
        mergedRows[existingIndex] = mergeSearchFields(mergedRows[existingIndex]!, catalogRow);
      } else if (!mergedRows.some((existing) => JSON.stringify(existing) === JSON.stringify(catalogRow))) {
        if (merchantId) rowIndexes.set(merchantId, mergedRows.length);
        mergedRows.push(catalogRow);
      }
    }
    rows = mergedRows;
    rows = [...sortKeywordRows(rows, query)];
  } else if (query.intent === "category") {
    rows = normalized.filter((row) => visibleCategoryTier(row, query) && matchesCategory(row, query.categories));
  } else if (query.intent === "tier") {
    rows = normalized.filter((row) => query.tiers.includes(rowTier(row as RawRecord) as ReportQuery["tiers"][number]));
    rows = query.categories.length ? rows.filter((row) => matchesCategory(row, query.categories)) : rows;
  }

  const status = query.resolution === "needs_input"
    ? "needs_input"
    : ambiguous.length || (query.merchantNames.length && !rows.length && !unmatched.length) ? "ambiguous"
      : rows.length ? "resolved" : "not_found";
  const note = unmatched.length
    ? (language === "zh" ? `未找到：${unmatched.join("、")}` : `Not found: ${unmatched.join(", ")}`)
    : undefined;
  return {
    rows,
    unmatched,
    ambiguous,
    status,
    title: localizedTitle(query.intent, language),
    ...(note ? { note } : {})
  };
}
