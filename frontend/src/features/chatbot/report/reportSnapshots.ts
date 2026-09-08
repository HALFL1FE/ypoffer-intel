import type { ReportBlock, ReportDocument, ReportQuery, ReportSheet, ReportSnapshot } from "./reportContracts";
import type { MemoryRecommendation, ReportRow } from "./reportContracts";
import { rankCategories, rankedRecommendations } from "./recommendationReports";
import { rowMerchantId, rowTier, text, matchesCategory } from "./entityReports";
import { resolveReportQuery } from "./reportQuery";

function safeId(value: unknown): string {
  return text(value).replace(/\.0$/, "");
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  return value;
}

function cloneRows(rows: readonly ReportRow[]): readonly ReportRow[] {
  return rows.map((row) => cloneValue(row) as ReportRow);
}

function cloneBlock(block: ReportBlock): ReportBlock {
  if (block.kind === "notice") return { ...block };
  return {
    ...block,
    rows: cloneRows(block.rows),
    columns: block.columns.map((column) => ({ ...column })),
    ...(block.kind === "trend" ? {
      categoryOptions: [...block.categoryOptions],
      visibleColumns: [...block.visibleColumns]
    } : {})
  };
}

function cloneSheet(sheet: ReportSheet): ReportSheet {
  return { ...sheet, rows: cloneRows(sheet.rows), columns: sheet.columns.map((column) => ({ ...column })) };
}

export function createReportSnapshot(document: ReportDocument, rankingOffers?: readonly ReportRow[]): ReportSnapshot {
  const candidates = rankingOffers || document.rankingOffers || document.rows;
  return {
    version: 1,
    snapshotId: `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: document.documentId,
    tier: (document.request.tiers[0] || null) as ReportSnapshot["tier"],
    request: document.request,
    sourceInfo: document.sourceInfo,
    rows: cloneRows(document.rows),
    rankingOffers: cloneRows(candidates),
    blocks: document.blocks.map(cloneBlock),
    sheets: document.sheets.map(cloneSheet)
  };
}

export function filterReportSnapshot(snapshot: ReportSnapshot, merchantIds: readonly string[]): ReportSnapshot {
  const ids = new Set(merchantIds.map(safeId).filter(Boolean));
  const matches = (row: ReportRow): boolean => {
    const source = row as Readonly<Record<string, unknown>>;
    return ids.has(safeId(source.merchantId ?? source["Merchant ID"] ?? source.id));
  };
  const filteredRows = snapshot.rows.filter(matches);
  return {
    ...snapshot,
    rows: filteredRows,
    rankingOffers: snapshot.rankingOffers.filter(matches),
    blocks: snapshot.blocks.map((block) => block.kind === "notice" ? { ...block } : { ...block, rows: block.rows.filter(matches) }),
    sheets: snapshot.sheets.map((sheet) => {
      if (sheet.role !== "category-summary") return { ...sheet, rows: sheet.rows.filter(matches) };
      const categoryRows = rankCategories(filteredRows, true, true).map((row, index) => ({ ...row, rank: index + 1 }));
      return { ...sheet, rows: categoryRows };
    })
  };
}

function requestedCount(prompt: string): number {
  const match = prompt.match(/(?:top|前|推荐|取|选)\s*(\d+)/i) || prompt.match(/\b(\d+)\s*(?:个|家|条)\b/i);
  return Math.max(1, Math.min(1000, Number(match?.[1] || 1)));
}

function tierFromPrompt(prompt: string): string | null {
  const match = prompt.match(/tier\s*[1-4]|black\s*tier|第[一二三四]层|黑名单/i);
  return match ? rowTier({ tier: match[0] }) : null;
}

function categoryFromPrompt(prompt: string, snapshots: readonly ReportSnapshot[]): string | null {
  const values = [...new Set(snapshots.flatMap((snapshot) => snapshot.request.categories))];
  const lower = prompt.toLowerCase();
  return values.find((value) => lower.includes(value.toLowerCase())) || null;
}

function sameMetricFilters(left: ReportQuery, right: ReportQuery): boolean {
  return left.metricFilters.length === right.metricFilters.length
    && left.metricFilters.every((filter) => right.metricFilters.some((candidate) =>
      candidate.field === filter.field && candidate.operator === filter.operator && candidate.value === filter.value));
}

function sameMetricSort(left: ReportQuery, right: ReportQuery): boolean {
  return (!left.metricSort && !right.metricSort)
    || Boolean(left.metricSort && right.metricSort
      && left.metricSort.field === right.metricSort.field
      && left.metricSort.direction === right.metricSort.direction);
}

export function buildMemoryRecommendation(prompt: string, snapshots: readonly ReportSnapshot[]): MemoryRecommendation {
  const count = requestedCount(prompt);
  if (!snapshots.length) return {
    status: "unavailable",
    sourceSnapshotId: null,
    requestedCount: count,
    matchedCount: 0,
    selectedMerchantIds: [],
    selectedRows: [],
    filteredSheets: [],
    partial: true
  };
  const tier = tierFromPrompt(prompt);
  const category = categoryFromPrompt(prompt, snapshots);
  const eligible = snapshots.filter((snapshot) => ["recommendation", "tier", "category"].includes(snapshot.request.intent));
  const matchingSnapshots = eligible.filter((snapshot) => {
    if (tier && snapshot.tier !== tier && !snapshot.request.tiers.includes(tier as ReportQuery["tiers"][number])) return false;
    if (category && !snapshot.request.categories.some((value) => value.toLowerCase() === category.toLowerCase())) return false;
    const parsed = resolveReportQuery(prompt, { language: snapshot.request.language, categories: snapshot.request.categories });
    if (parsed.metricFilters.length && !sameMetricFilters(parsed, snapshot.request)) return false;
    if (parsed.metricSort && !sameMetricSort(parsed, snapshot.request)) return false;
    return true;
  });
  if (!matchingSnapshots.length) return {
    status: "empty",
    sourceSnapshotId: null,
    requestedCount: count,
    matchedCount: 0,
    selectedMerchantIds: [],
    selectedRows: [],
    filteredSheets: [],
    partial: false
  };
  if (matchingSnapshots.length > 1) return {
    status: "ambiguous",
    sourceSnapshotId: null,
    requestedCount: count,
    matchedCount: 0,
    selectedMerchantIds: [],
    selectedRows: [],
    filteredSheets: [],
    partial: true
  };
  const source = matchingSnapshots[0]!;
  const parsed = resolveReportQuery(prompt, { language: source.request.language, categories: source.request.categories });
  const candidates = (source.rankingOffers.length ? source.rankingOffers : source.rows).filter((row) => {
    if (tier && rowTier(row as Readonly<Record<string, unknown>>) !== tier) return false;
    const source = row as Readonly<Record<string, unknown>>;
    return !category || matchesCategory(row, [category]);
  });
  const baseQuery = source.request;
  const query: ReportQuery = {
    ...baseQuery,
    intent: "recommendation",
    count,
    ...(tier ? { tiers: [tier as ReportQuery["tiers"][number]] } : {}),
    ...(category ? { categories: [category] } : {}),
    ...(parsed.metricFilters.length ? { metricFilters: parsed.metricFilters } : {}),
    ...(parsed.metricSort ? { metricSort: parsed.metricSort } : {}),
    includeTier4: Boolean(tier === "Tier 4"),
    includeBlack: Boolean(tier === "BLACK TIER")
  };
  const ranked = rankedRecommendations(query, candidates).slice(0, count);
  const selectedMerchantIds: string[] = [];
  const selectedRows: ReportRow[] = [];
  ranked.forEach((row) => {
    const id = rowMerchantId(row as Readonly<Record<string, unknown>>);
    if (!id || selectedMerchantIds.includes(id)) return;
    selectedMerchantIds.push(id);
    selectedRows.push(row);
  });
  return {
    status: selectedRows.length ? "ready" : "unavailable",
    sourceSnapshotId: source.snapshotId,
    requestedCount: count,
    matchedCount: selectedRows.length,
    selectedMerchantIds,
    selectedRows,
    filteredSheets: filterReportSnapshot(source, selectedMerchantIds).sheets,
    partial: selectedRows.length < count
  };
}
