import {
  addDays,
  emptyMetrics,
  observedDays,
  periodDays,
  sumMetrics,
  type MediaRow,
  type Metric,
  type PerformanceReport,
  type PerformanceRow,
  type PromotionBatch,
  type PromotionWindow,
  type TrackedOffer,
} from "./performanceModel";

export interface ReviewOffer extends TrackedOffer {
  productAsins?: string[];
  reasonAsins?: string[];
  ambiguousAsins?: string[];
  priority?: string;
  aovRaw?: string;
  listDate?: string;
  batchId?: string;
  listName?: string;
  importCount?: number;
  listCount?: number;
  history?: {
    id: string;
    name: string;
    listDate: string;
    importedAt: string | null;
    importedBy: string | null;
  }[];
}
export interface ReviewBatch extends PromotionBatch {
  temporary?: boolean;
  listDate: string;
  logicalId: string;
  importedAt: string | null;
  importedBy: string | null;
  offers: ReviewOffer[];
  errors?: string[];
  warnings?: string[];
}
export interface ReviewReport extends PerformanceReport {
  offers: ReviewOffer[];
  excludedBatchIds: string[];
  currency: string;
  recommendationDate: string;
}
export interface ReviewRequest {
  temporaryBatches?: ReviewBatch[];
  batchIds: string[];
  launchDate: string;
  startDate: string;
  endDate: string;
  beforeStart: string;
  beforeEnd: string;
  merchantId?: string;
}
export type ReviewMedia = MediaRow & { daily?: PerformanceRow["daily"] };
export function priceBand(offer: ReviewOffer) {
  const aov = offer.referenceAov;
  return !aov || aov <= 0
    ? "未知 / Unknown"
    : aov < 50
      ? "< $50"
      : aov < 100
        ? "$50–<100"
        : aov < 300
          ? "$100–<300"
          : "≥ $300";
}
export function comparison(
  before: number | null,
  after: number | null,
  range: PromotionWindow,
  asOf: string,
  daily = true,
) {
  const bd = observedDays(range.beforeStart, range.beforeEnd, asOf),
    ad = observedDays(range.startDate, range.endDate, asOf);
  const complete =
    bd === periodDays(range.beforeStart, range.beforeEnd) && ad === range.days;
  const b = before === null || !bd ? null : before / (daily ? bd : 1),
    a = after === null || !ad ? null : after / (daily ? ad : 1);
  return {
    before: b,
    after: a,
    complete,
    delta: b === null || a === null ? null : a - b,
    rate: complete && b !== null && b > 0 && a !== null ? (a - b) / b : null,
    state:
      !complete || b === null || a === null
        ? "pending"
        : a > b
          ? b === 0
            ? "new"
            : "up"
          : a < b
            ? a === 0
              ? "zero"
              : "down"
            : "same",
  };
}
export function targetSummary(
  offer: ReviewOffer,
  links: MediaRow[],
  period: "before" | "after" = "after",
) {
  const recommended = new Set(offer.asins);
  const products = links.filter(
    (l) => l.merchantId === offer.merchantId && l.linkType === "asin" && l.asin,
  );
  const total = links
    .filter((l) => l.merchantId === offer.merchantId)
    .reduce((s, l) => s + (l[period].clicks || 0), 0);
  const clicked = products.filter((l) => (l[period].clicks || 0) > 0);
  const hits = clicked.filter((l) => recommended.has(l.asin));
  return {
    total,
    productClicks: clicked.reduce((s, l) => s + (l[period].clicks || 0), 0),
    hitClicks: hits.reduce((s, l) => s + (l[period].clicks || 0), 0),
    hitAsins: new Set(hits.map((l) => l.asin)).size,
    targetCount: recommended.size,
    actualAsins: new Set(clicked.map((l) => l.asin)).size,
  };
}
export function historicalTop(links: MediaRow[], merchantId: string): string[] {
  const totals = new Map<string, { orders: number; revenue: number }>();
  for (const link of links.filter(
    (l) => l.merchantId === merchantId && l.purchasedAsin,
  )) {
    const value = totals.get(link.purchasedAsin) || { orders: 0, revenue: 0 };
    value.orders += link.before.orders || 0;
    value.revenue += link.before.revenue || 0;
    totals.set(link.purchasedAsin, value);
  }
  return [...totals]
    .filter(([, v]) => v.orders > 0)
    .sort(
      (a, b) =>
        b[1].orders - a[1].orders ||
        b[1].revenue - a[1].revenue ||
        a[0].localeCompare(b[0]),
    )
    .slice(0, 3)
    .map(([asin]) => asin);
}
export function reviewDays(
  rows: PerformanceRow[],
  range: PromotionWindow,
  through: string,
  metric: Metric,
) {
  return Array.from(
    { length: periodDays(range.beforeStart, range.endDate) },
    (_, i) => {
      const date = addDays(range.beforeStart, i);
      const period =
        date <= range.beforeEnd
          ? "before"
          : date >= range.startDate
            ? "after"
            : "gap";
      const values = rows.map(
        (row) =>
          row.daily.find((d) => d.date === date)?.[metric] ??
          (period === "gap" || row[period][metric] === null ? null : 0),
      );
      return {
        date,
        period,
        value:
          period === "gap" ||
          date > through ||
          !through ||
          !rows.length ||
          values.some((v) => v === null)
            ? null
            : values.reduce<number>((s, v) => s + (v || 0), 0),
      };
    },
  );
}
export function merchantRows(report: ReviewReport) {
  return report.offers.map((offer) => {
    const stats = report.merchants.find(
      (r) => r.merchantId === offer.merchantId,
    ) || {
      merchantId: offer.merchantId,
      before: emptyMetrics(),
      after: emptyMetrics(),
      daily: [],
      monthly: [],
    };
    const media = (report.media || []).filter(
      (m) => m.merchantId === offer.merchantId,
    );
    return {
      ...offer,
      ...stats,
      activeMedia: media.filter((m) => (m.after.clicks || 0) > 0).length,
      targets: targetSummary(offer, report.links || []),
      top: historicalTop(report.links || [], offer.merchantId),
      noActivity:
        report.availableThrough >= report.dateRange.endDate &&
        stats.before.clicks === 0 &&
        stats.after.clicks === 0 &&
        stats.before.orders === 0 &&
        stats.after.orders === 0 &&
        Object.values(stats.before).every((v) => v === null || v === 0) &&
        Object.values(stats.after).every((v) => v === null || v === 0),
      total: sumMetrics([stats.before, stats.after]),
    };
  });
}
