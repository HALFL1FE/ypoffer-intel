import type { UiLanguage } from "../../../shared/i18n";
import type { ReportQuery, ReportRow } from "./reportContracts";
import { metricValue, normalizeOfferRow, rowCategories, rowMerchantId, rowMerchantName, rowTier, text, matchesCategory } from "./entityReports";

export interface CategoryRankingRow extends ReportRow {
  readonly category: string;
  readonly score: number;
  readonly offerCount: number;
  readonly salesAmount: number;
  readonly affCommission: number;
  readonly averageAov: number | null;
  readonly blendedEpc: number;
}

export interface RecommendationReportPayload {
  readonly rows: readonly ReportRow[];
  readonly categoryRows: readonly CategoryRankingRow[];
  readonly unmatched: readonly string[];
  readonly status: "resolved" | "not_found" | "needs_input";
  readonly title: string;
  readonly requestedCount: number;
  readonly matchedCount: number;
  readonly gapCount: number;
  readonly note?: string;
}

const TIER_PRIORITY: Record<string, number> = {
  "Tier 1": 0,
  "Tier 2": 1,
  "Tier 3": 2,
  "Tier 4": 3,
  "BLACK TIER": 4
};

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tierPriority(row: ReportRow, includeTier4: boolean, includeBlack: boolean): number {
  const tier = rowTier(row as Readonly<Record<string, unknown>>);
  if (tier === "Tier 4" && !includeTier4) return 99;
  if (tier === "BLACK TIER" && !includeBlack) return 100;
  return TIER_PRIORITY[tier] ?? 50;
}

function hasPaymentRisk(row: ReportRow): boolean {
  return /unpaid|overdue|partial|未付款|逾期|部分/i.test(text((row as Record<string, unknown>).paymentStatus ?? (row as Record<string, unknown>).status));
}

function isOptimizationOnly(row: ReportRow): boolean {
  const source = row as Readonly<Record<string, unknown>>;
  return source.optimizationOnly === true || source.tier2OptimizationOnly === true
    || /optimization only|仅优化/i.test(text(source.highlightStatus ?? source.status ?? source.highlight));
}

function metricSortValue(row: ReportRow, field: string): number {
  return metricValue(row as Readonly<Record<string, unknown>>, field);
}

export function recommendationScore(row: ReportRow, context: Partial<ReportQuery> = {}): number {
  const includeTier4 = Boolean(context.includeTier4);
  const includeBlack = Boolean(context.includeBlack);
  const priority = tierPriority(row, includeTier4, includeBlack);
  if (priority >= 99) return -9999;
  const source = row as Readonly<Record<string, unknown>>;
  if (rowTier(source) === "Tier 2" && isOptimizationOnly(row)) return -9999;
  const clicks = metricSortValue(row, "clicks");
  const orders = metricSortValue(row, "orders");
  const conversion = metricSortValue(row, "conversionRate");
  const epc = metricSortValue(row, "epc");
  const sales = metricSortValue(row, "salesAmount");
  const atc = metricSortValue(row, "atc");
  const confidence = Math.min(1, Math.sqrt(Math.max(clicks, 0) / 250));
  let score = 100 - priority * 14;
  score += Math.log10(orders + 1) * 12;
  score += Math.log10(clicks + 1) * 3;
  score += conversion * 260 * confidence;
  score += Math.min(epc, 5) * 8 * Math.max(confidence, 0.35);
  score += Math.min(sales, 100000) / 12000;
  score += Math.min(atc, 500) / 80;
  score += Boolean(source.hasDiscount) ? 7 : 0;
  score += Boolean(source.hasAsin || (Array.isArray(source.topAsins) && source.topAsins.length)) ? 2 : 0;
  score += Boolean(source.recommendedLink) ? 2 : 0;
  score -= clicks > 0 && clicks < 25 ? 12 : 0;
  score -= orders > 0 && orders < 5 ? 8 : 0;
  score -= hasPaymentRisk(row) ? 32 : 0;
  score -= Boolean(source.trackingIssue) ? 20 : 0;
  score -= rowTier(source) === "Tier 4" ? 40 : 0;
  score -= rowTier(source) === "BLACK TIER" ? 100 : 0;
  if (context.categories?.length && matchesCategory(row, context.categories)) score += 14;
  return Math.round(score * 100) / 100;
}

export function compareRecommendationOffers(left: ReportRow, right: ReportRow, context: Partial<ReportQuery> = {}): number {
  const includeTier4 = Boolean(context.includeTier4);
  const includeBlack = Boolean(context.includeBlack);
  const sort = context.metricSort;
  if (sort) {
    const tierDelta = tierPriority(left, includeTier4, includeBlack) - tierPriority(right, includeTier4, includeBlack);
    if (tierDelta) return tierDelta;
    const metricDelta = metricSortValue(left, sort.field) - metricSortValue(right, sort.field);
    if (metricDelta) return sort.direction === "asc" ? metricDelta : -metricDelta;
  }
  return metricSortValue(right, "salesAmount") - metricSortValue(left, "salesAmount")
    || metricSortValue(right, "orders") - metricSortValue(left, "orders")
    || metricSortValue(right, "conversionRate") - metricSortValue(left, "conversionRate")
    || metricSortValue(right, "aov") - metricSortValue(left, "aov")
    || metricSortValue(right, "epc") - metricSortValue(left, "epc")
    || tierPriority(left, includeTier4, includeBlack) - tierPriority(right, includeTier4, includeBlack)
    || metricSortValue(right, "affCommission") - metricSortValue(left, "affCommission")
    || metricSortValue(right, "clicks") - metricSortValue(left, "clicks")
    || rowMerchantName(left as Readonly<Record<string, unknown>>).localeCompare(rowMerchantName(right as Readonly<Record<string, unknown>>), undefined, { numeric: true, sensitivity: "base" });
}

function metricFilterMatches(row: ReportRow, query: ReportQuery): boolean {
  const source = row as Readonly<Record<string, unknown>>;
  return query.metricFilters.every((filter) => {
    const value = metricValue(source, filter.field);
    switch (filter.operator) {
      case ">": return value > filter.value;
      case ">=": return value >= filter.value;
      case "<": return value < filter.value;
      case "<=": return value <= filter.value;
      case "=": return value === filter.value;
    }
  });
}

function paymentCycleMatches(row: ReportRow, query: ReportQuery): boolean {
  const filter = query.paymentCycleFilter;
  if (!filter) return true;
  const cycle = Number((row as Readonly<Record<string, unknown>>).paymentCycle);
  if (!Number.isFinite(cycle) || cycle <= 0) return false;
  switch (filter.operator) {
    case ">": return cycle > filter.days;
    case ">=": return cycle >= filter.days;
    case "<": return cycle < filter.days;
    case "<=": return cycle <= filter.days;
    case "=": return cycle === filter.days;
  }
}

export function candidateOffers(query: ReportQuery, offers: readonly ReportRow[]): readonly ReportRow[] {
  const normalized = offers.map(normalizeOfferRow);
  const excluded = new Set([...query.excludeMerchantIds, ...query.replaceMerchantIds]);
  const explicitTiers = new Set(query.tiers);
  return normalized
    .filter((row) => {
      const id = rowMerchantId(row as Readonly<Record<string, unknown>>);
      const currentTier = rowTier(row as Readonly<Record<string, unknown>>);
      if (excluded.has(id)) return false;
      if (query.categories.length && !matchesCategory(row, query.categories)) return false;
      if (explicitTiers.size && !explicitTiers.has(currentTier as ReportQuery["tiers"][number])) return false;
      if (!explicitTiers.size && currentTier === "Tier 4" && !query.includeTier4) return false;
      if (!explicitTiers.size && currentTier === "BLACK TIER" && !query.includeBlack) return false;
      return metricFilterMatches(row, query) && paymentCycleMatches(row, query);
    })
    .sort((left, right) => compareRecommendationOffers(left, right, query));
}

export function rankedRecommendations(query: ReportQuery, offers: readonly ReportRow[]): readonly ReportRow[] {
  return candidateOffers(query, offers)
    .map((row) => ({ ...row, recommendationScore: recommendationScore(row, query) }))
    .filter((row) => Number(row.recommendationScore) > -9999)
    .sort((left, right) => compareRecommendationOffers(left, right, query));
}

function categoryScore(rows: readonly ReportRow[]): number {
  const revenue = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "salesAmount"), 0);
  const commission = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "affCommission"), 0);
  const orders = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "orders"), 0);
  const aov = orders ? revenue / orders : 0;
  const clicks = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "clicks"), 0);
  const epc = clicks ? commission / clicks : 0;
  const tierCount = rows.filter((row) => rowTier(row as Readonly<Record<string, unknown>>) === "Tier 1" || rowTier(row as Readonly<Record<string, unknown>>) === "Tier 2").length;
  const riskCount = rows.filter(hasPaymentRisk).length;
  return Math.round((Math.log10(revenue + 1) * 25 + Math.log10(commission + 1) * 20 + Math.log10(rows.length + 1) * 10
    + Math.log10(orders + 1) * 8 + Math.min(aov, 500) / 15 + Math.min(epc, 5) * 20 + tierCount * 3
    - riskCount / Math.max(rows.length, 1) * 15) * 100) / 100;
}

export function rankCategories(offers: readonly ReportRow[], includeTier4 = false, includeBlack = false): readonly CategoryRankingRow[] {
  const visibleOffers = offers.filter((row) => {
    const currentTier = rowTier(row as Readonly<Record<string, unknown>>);
    return (includeTier4 || currentTier !== "Tier 4") && (includeBlack || currentTier !== "BLACK TIER");
  });
  const categories = new Set(visibleOffers.flatMap((row) => rowCategories(row as Readonly<Record<string, unknown>>)));
  return [...categories].filter((category) => category && category.toLowerCase() !== "uncategorized").map((category) => {
    const rows = visibleOffers.filter((row) => matchesCategory(row, [category]));
    const salesAmount = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "salesAmount"), 0);
    const affCommission = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "affCommission"), 0);
    const orders = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "orders"), 0);
    const clicks = rows.reduce((sum, row) => sum + metricValue(row as Readonly<Record<string, unknown>>, "clicks"), 0);
    return {
      category,
      score: categoryScore(rows),
      offerCount: rows.length,
      salesAmount,
      affCommission,
      averageAov: orders ? salesAmount / orders : null,
      blendedEpc: clicks ? affCommission / clicks : 0
    };
  }).sort((left, right) => right.score - left.score || left.category.localeCompare(right.category));
}

function reason(row: ReportRow, language: UiLanguage): string {
  const epc = metricSortValue(row, "epc").toFixed(2);
  const cvr = `${(metricSortValue(row, "conversionRate") * 100).toFixed(1)}%`;
  return language === "zh"
    ? `EPC ${epc}，CVR ${cvr}，结合订单、销售额与 Tier 优先级综合排序。`
    : `EPC ${epc}, CVR ${cvr}; ranked using orders, sales, and tier priority.`;
}

function trafficAngle(row: ReportRow, language: UiLanguage): string {
  const source = row as Readonly<Record<string, unknown>>;
  if (Boolean(source.hasAsin || (Array.isArray(source.topAsins) && source.topAsins.length))) return language === "zh" ? "优先使用高意图 ASIN 流量" : "Prioritize high-intent ASIN traffic";
  if (metricSortValue(row, "conversionRate") >= 0.02) return language === "zh" ? "适合转化导向的内容或再营销" : "Suitable for conversion-led content or retargeting";
  return language === "zh" ? "先积累点击并验证素材" : "Build click volume and validate creative first";
}

export function buildRecommendationReport(query: ReportQuery, offers: readonly ReportRow[], language: UiLanguage): RecommendationReportPayload {
  const requestedCount = query.tierOfferPlan.length
    ? query.tierOfferPlan.reduce((sum, plan) => sum + plan.count, 0)
    : query.count || 5;
  if (query.resolution === "needs_input") return { rows: [], categoryRows: [], unmatched: [], status: "needs_input", title: language === "zh" ? "推荐条件" : "Recommendation criteria", requestedCount, matchedCount: 0, gapCount: requestedCount };
  if (query.recommendCategories) {
    const categoryRows = rankCategories(offers, query.includeTier4, query.includeBlack).slice(0, query.count || 5);
    return {
      rows: categoryRows.map((row, index) => ({ ...row, rank: index + 1 })),
      categoryRows,
      unmatched: [],
      status: categoryRows.length ? "resolved" : "not_found",
      title: language === "zh" ? "推荐品类排名" : "Recommended category ranking",
      requestedCount: query.count || 5,
      matchedCount: categoryRows.length,
      gapCount: Math.max(0, (query.count || 5) - categoryRows.length)
    };
  }
  let rows: ReportRow[] = [];
  if (query.tierOfferPlan.length) {
    const selected = new Set<string>();
    for (const plan of query.tierOfferPlan) {
      const planQuery: ReportQuery = { ...query, tiers: [plan.tier], includeTier4: true, includeBlack: true };
      rankedRecommendations(planQuery, offers).slice(0, plan.count).forEach((row) => {
        const id = rowMerchantId(row as Readonly<Record<string, unknown>>);
        if (!id || selected.has(id)) return;
        selected.add(id);
        rows.push(row);
      });
    }
  } else {
    rows = rankedRecommendations(query, offers).slice(0, query.count || 5);
  }
  rows = rows.map((row) => ({
    ...row,
    recommendationReason: reason(row, language),
    trafficAngle: trafficAngle(row, language)
  }));
  const notes: string[] = [];
  if (query.excludeMerchantIds.length || query.replaceMerchantIds.length) notes.push(language === "zh" ? "已排除指定商户并从候选池重新排序。" : "Excluded merchants were removed and the candidate pool was re-ranked.");
  if (rows.length < requestedCount) notes.push(language === "zh" ? `请求 ${requestedCount} 个，实际命中 ${rows.length} 个，缺口 ${requestedCount - rows.length} 个。` : `Requested ${requestedCount}, matched ${rows.length}; ${requestedCount - rows.length} remain unavailable.`);
  const note = notes.join(" ") || undefined;
  return {
    rows,
    categoryRows: [],
    unmatched: [],
    status: rows.length ? "resolved" : "not_found",
    title: language === "zh" ? "推荐结果" : "Recommendations",
    requestedCount,
    matchedCount: rows.length,
    gapCount: Math.max(0, requestedCount - rows.length),
    ...(note ? { note } : {})
  };
}
