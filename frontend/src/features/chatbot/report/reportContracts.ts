import type { UiLanguage } from "../../../shared/i18n";
import type {
  ChatbotReportResult,
  ChatbotReportSummary,
  ChatbotReportStatus
} from "../chatbotReportModel";

export type ReportRow = Readonly<Record<string, unknown>>;
export type ReportIntent =
  | "merchant"
  | "asin"
  | "keyword"
  | "category"
  | "tier"
  | "recommendation"
  | "payment"
  | "analysis"
  | "publisher"
  | "publisherprofile"
  | "help";
export type ReportTier = "Tier 1" | "Tier 2" | "Tier 3" | "Tier 4" | "BLACK TIER";
export type ReportMetric =
  | "aov"
  | "epc"
  | "conversionRate"
  | "orders"
  | "clicks"
  | "affCommission"
  | "commissionRate"
  | "salesAmount"
  | "dpv"
  | "atc";
export type ReportOperator = ">" | ">=" | "<" | "<=" | "=";
export type PaymentStatus = "Paid" | "Pending" | "Unpaid" | "Overdue" | "Partial" | "Unknown";
export type TrendMetric = ReportMetric | "allEpc" | "payout" | "revenue" | "affiliatePayout" | "directSales" | "haloSales";

export interface PublisherQueryFilters {
  readonly market: string | null;
  readonly network: string | null;
  readonly manager: string | null;
  readonly merchantIds: readonly string[];
  readonly merchantQuery: string | null;
  readonly sortKey: "sales" | "allCommission" | "affCommission" | "orders"
    | "clicks" | "cvr" | "dpv" | "atc" | "grossProfit";
  readonly limit: number;
  readonly unrecognized: readonly string[];
}

export interface ReportQuery {
  readonly prompt: string;
  readonly language: UiLanguage;
  readonly intent: ReportIntent;
  readonly parsedBy: "command" | "llm" | "rule" | "followup";
  readonly resolution: "resolved" | "needs_input" | "invalid_filter";
  readonly issues: readonly string[];
  readonly merchantIds: readonly string[];
  readonly merchantNames: readonly string[];
  /** 未能从本地候选表解析时，交给服务端搜索的原始商户查询文本。 */
  readonly lookupText?: string;
  readonly asins: readonly string[];
  readonly categories: readonly string[];
  readonly tiers: readonly ReportTier[];
  readonly keyword?: string;
  readonly count?: number;
  readonly metricFilters: readonly {
    readonly field: ReportMetric;
    readonly operator: ReportOperator;
    readonly value: number;
  }[];
  readonly metricSort?: { readonly field: ReportMetric; readonly direction: "asc" | "desc" };
  readonly includeTier4: boolean;
  readonly includeBlack: boolean;
  readonly recommendCategories: boolean;
  readonly tierOfferPlan: readonly { readonly tier: ReportTier; readonly count: number }[];
  readonly excludeMerchantIds: readonly string[];
  readonly replaceMerchantIds: readonly string[];
  readonly paymentStatus?: PaymentStatus;
  readonly month?: string;
  readonly paymentCycleFilter?: { readonly operator: ReportOperator; readonly days: number };
  readonly analysisType?: "merchant" | "category" | "tier" | "trend";
  readonly analysisTargets: readonly string[];
  readonly months?: number;
  readonly startMonth?: string;
  readonly endMonth?: string;
  readonly trendMetric?: TrendMetric;
  readonly publisherQuery?: string;
  readonly publisherFilters: PublisherQueryFilters;
}

export interface PreviousReportContext {
  readonly intent?: ReportIntent | string;
  readonly merchantIds?: readonly string[];
  readonly merchantNames?: readonly string[];
  readonly category?: string;
  readonly tier?: string;
  readonly request?: ReportQuery;
}

export interface QueryContext {
  readonly language: UiLanguage;
  readonly categories: readonly string[];
  readonly merchantCandidates?: readonly { readonly id: string; readonly name: string }[];
  readonly classification?: unknown;
  readonly previous?: PreviousReportContext;
  readonly now?: Date;
}

export type ReportFormat = "text" | "integer" | "money" | "decimal" | "percentage";

export interface ReportColumn {
  readonly key: string;
  readonly label: string;
  readonly format: ReportFormat;
  readonly width?: number;
}

export interface ReportSource {
  readonly kind: "cache" | "db" | "unavailable";
  readonly asOf: string | null;
  readonly estimated: boolean;
  readonly partial: boolean;
  readonly covered: number;
  readonly requested: number;
}

export interface ReportSheet {
  readonly name: string;
  readonly role: "detail" | "category-summary" | "notes";
  readonly rows: readonly ReportRow[];
  readonly columns: readonly ReportColumn[];
}

export type ReportBlock =
  | {
      readonly id: string;
      readonly kind: "metrics";
      readonly title: string;
      readonly rows: readonly ReportRow[];
      readonly columns: readonly ReportColumn[];
    }
  | {
      readonly id: string;
      readonly kind: "table";
      readonly title: string;
      readonly rows: readonly ReportRow[];
      readonly columns: readonly ReportColumn[];
    }
  | {
      readonly id: string;
      readonly kind: "notice";
      readonly title: string;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: "trend";
      readonly title: string;
      readonly rows: readonly ReportRow[];
      readonly columns: readonly ReportColumn[];
      readonly metric: TrendMetric;
      readonly categoryOptions: readonly string[];
      readonly activeCategory: string | null;
      readonly visibleColumns: readonly string[];
    };

export interface ReportDocument extends ChatbotReportResult {
  readonly intent: ReportIntent;
  readonly title?: string;
  readonly documentId: string;
  readonly request: ReportQuery;
  /** 报告当前展示结果之外的完整候选池，供 Memory/后续排序复用。 */
  readonly rankingOffers?: readonly ReportRow[];
  readonly blocks: readonly ReportBlock[];
  readonly sheets: readonly ReportSheet[];
  readonly sourceInfo: ReportSource;
  readonly contentHtml?: string;
  readonly recommendationHtml?: string;
}

export interface ReportSnapshot {
  readonly version: 1;
  readonly snapshotId: string;
  readonly documentId: string;
  readonly tier: ReportTier | null;
  readonly request: ReportQuery;
  readonly sourceInfo: ReportSource;
  readonly rows: readonly ReportRow[];
  readonly rankingOffers: readonly ReportRow[];
  readonly sheets: readonly ReportSheet[];
  readonly blocks: readonly ReportBlock[];
}

export interface MemoryRecommendation {
  readonly status: "ready" | "empty" | "ambiguous" | "unavailable";
  readonly sourceSnapshotId: string | null;
  readonly requestedCount: number;
  readonly matchedCount: number;
  readonly selectedMerchantIds: readonly string[];
  readonly selectedRows: readonly ReportRow[];
  readonly filteredSheets: readonly ReportSheet[];
  readonly partial: boolean;
}

export interface ReportAction {
  readonly documentId: string;
  readonly blockId?: string;
  readonly type:
    | "select-merchant"
    | "select-publisher"
    | "payment-month"
    | "trend-metric"
    | "trend-category"
    | "trend-columns"
    | "exclude-merchant"
    | "replace-merchant";
  readonly value: string | readonly string[];
}

export interface ReportDataProvider {
  offers(signal: AbortSignal): Promise<readonly ReportRow[]>;
  paymentRecords?(signal: AbortSignal): Promise<readonly ReportRow[]>;
  keywords(signal: AbortSignal): Promise<unknown>;
  merchant(merchantId: string, months: number, signal: AbortSignal): Promise<unknown>;
  search(query: string, signal: AbortSignal): Promise<unknown>;
  publishers(signal: AbortSignal): Promise<unknown>;
  publisherPortfolio(userId: string, startDate: string | null, endDate: string | null, signal: AbortSignal): Promise<unknown>;
}

export interface ReportEngineContext {
  readonly offers: readonly ReportRow[];
  readonly paymentRecords: readonly ReportRow[];
  readonly productKeywords: unknown;
  readonly provider: ReportDataProvider;
  readonly now: () => Date;
  readonly analyze?: (summary: Readonly<Record<string, unknown>>, language: UiLanguage, signal?: AbortSignal) => Promise<string | null>;
}

export function reportBlockRows(block: ReportBlock): readonly ReportRow[] {
  return block.kind === "notice" ? [] : block.rows;
}

export function reportBlockColumns(block: ReportBlock): readonly ReportColumn[] {
  return block.kind === "notice" ? [] : block.columns;
}

export function reportSource(
  kind: ReportSource["kind"],
  options: Partial<Omit<ReportSource, "kind">> = {}
): ReportSource {
  return {
    kind,
    asOf: options.asOf ?? null,
    estimated: options.estimated ?? false,
    partial: options.partial ?? false,
    covered: options.covered ?? 0,
    requested: options.requested ?? 0
  };
}

export type ReportResultStatus = ChatbotReportStatus;
export type ReportResultSummary = ChatbotReportSummary;
