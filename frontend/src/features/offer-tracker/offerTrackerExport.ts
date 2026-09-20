import type { OfferRecord, OfferChannel, OfferChannelSelection, OfferTrackerExportPayload, OfferTrackerOptionalColumn } from "../../shared/contracts/offer";
import { TIER_NAMES } from "../../shared/contracts/tier";
import { normalizeExportColor, type ExportColumn, type ExportSheet } from "../../shared/export/xlsx";
import { aovTypeLabel, bbPolicyLabel, normalizeOfferRecord, offerTrackerExportColumns, priorityLabel } from "./offerTrackerModel";
import { CHANNELS, CHANNEL_NAMES, CHANNEL_GRADES, CHANNEL_GRADE_COLORS, CHANNEL_VERIFICATION, CHANNEL_RULE_VERSION, suggestNormalizedChannel, uniqueExportMerchants, validateChannelSelections } from './offerChannels';

export const EXPORT_PRESETS = ["tier", "blue", "none"] as const;
export type ExportPreset = typeof EXPORT_PRESETS[number];
const tierColors: Readonly<Record<string, string>> = {
  "Tier 1": "#DBEAFE", "Tier 2": "#D1FAE5", "Tier 3": "#FEF3C7",
  "Tier 4": "#FFE4E6", "BLACK TIER": "#E2E8F0"
};

export function exportRowColor(row: OfferRecord, preset: ExportPreset): string {
  if (preset === "none") return "";
  if (preset === "blue") return "#DBEAFE";
  return tierColors[normalizeOfferRecord(row).tier] || "#F1F5F9";
}

export function exportMerchantSummary(rows: readonly OfferRecord[]) {
  const merchants = new Set<string>();
  const tiers = new Map<string, Set<string>>(TIER_NAMES.map((tier) => [tier, new Set<string>()]));
  rows.forEach((source, index) => {
    const row = normalizeOfferRecord(source);
    const identity = row.merchantId || row.merchantName || `row:${index}`;
    merchants.add(identity);
    const tier = row.tier || "Unassigned";
    if (!tiers.has(tier)) tiers.set(tier, new Set());
    tiers.get(tier)!.add(identity);
  });
  return { total: merchants.size, tiers: Array.from(tiers, ([tier, ids]) => ({ tier, count: ids.size })) };
}

export function limitExportMerchants(rows: readonly OfferRecord[], quantities: Readonly<Record<string, number>>): readonly OfferRecord[] {
  const selected = new Map<string, Set<string>>();
  return rows.filter((source, index) => {
    const row = normalizeOfferRecord(source);
    const tier = row.tier || "Unassigned";
    const identity = row.merchantId || row.merchantName || `row:${index}`;
    if (!selected.has(tier)) selected.set(tier, new Set());
    const ids = selected.get(tier)!;
    if (ids.has(identity)) return true;
    const limit = Number.isFinite(quantities[tier]) ? Math.max(0, Math.floor(quantities[tier]!)) : 0;
    if (ids.size >= limit) return false;
    ids.add(identity);
    return true;
  });
}

export function validExportRanges(ranges: NonNullable<OfferTrackerExportPayload["backgroundRanges"]>, rowCount: number): boolean {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  return sorted.every((range, index) => Number.isInteger(range.start) && Number.isInteger(range.end)
    && range.start >= 1 && range.start <= range.end && range.end <= rowCount
    && Boolean(normalizeExportColor(range.color)) && (!index || sorted[index - 1]!.end < range.start));
}

const widths: Readonly<Record<string, number>> = {
  priority: 22, merchantId: 16, merchantName: 28, tier: 14, commission: 16,
  aov: 14, revenue: 16, aovType: 14, bbPolicy: 18, category: 34, recommendation: 54, asins: 42
};

// Both preview and workbook use the business schema, never raw API fields.
export function offerTrackerExportSheet(payload: OfferTrackerExportPayload): ExportSheet {
  const preset = payload.backgroundPreset || "tier";
  const ranges = payload.backgroundRanges || [];
  if (!validExportRanges(ranges, payload.rows.length)) throw new Error("Invalid export background ranges");
  const normalized = new Map(payload.rows.map(row => [row, normalizeOfferRecord(row, payload.rules)]));
  const columns: ExportColumn[] = offerTrackerExportColumns(payload.view)
    .filter(({ key }) => ["priority", "merchantId", "merchantName"].includes(key)
      || payload.visibleColumns?.[(key === "aovType" ? "aov" : key) as OfferTrackerOptionalColumn] !== false)
    .map(({ label, key }): ExportColumn => [label, source => {
      const row = normalized.get(source) || normalizeOfferRecord(source, payload.rules);
      switch (key) {
        case "priority": return priorityLabel(row.priority.key, "en");
        case "commission": return `${row.commissionRate}%`;
        case "aovType": return aovTypeLabel(row.aovType, "en");
        case "bbPolicy": return bbPolicyLabel(row.bbPolicy, "en");
        case "asins": return row.asins.slice(0, 5).join(", ");
        case "recommendation": return row.priority.key === "high" ? "Prioritize outreach and placement"
          : row.priority.key === "low-aov" ? "Good fit for low-AOV testing" : "Keep in the standard opportunity pool";
        default: return row[key as keyof typeof row] ?? "";
      }
    }, widths[key], key === "commission" ? "percentage" : ""]);
  return {
    sheetName: payload.view === "products" ? "Brand Product List" : "List of Offers",
    rows: payload.rows,
    columns,
    referenceStyle: true,
    wrapText: true,
    freezeHeader: true,
    rowBackgroundRanges: [...ranges, ...(preset === "none" ? [] : payload.rows.map((row, index) => ({
      start: index + 1, end: index + 1, color: exportRowColor(row, preset)
    }))) ]
  };
}

export function offerTrackerExportSheets(payload: OfferTrackerExportPayload, validate = true): readonly ExportSheet[] {
  const rows = uniqueExportMerchants(payload.rows);
  const error = validateChannelSelections(rows, payload.channelSelections);
  if (validate && error) throw new Error(error);
  const base = offerTrackerExportSheet({ ...payload, rows, view: 'offers', backgroundPreset: 'none', backgroundRanges: [] });
  const normalized = new Map(rows.map(row => [row, normalizeOfferRecord(row, payload.rules)]));
  // Resolve each merchant/channel once; getters and sorting reuse the same snapshot.
  const decisions = new Map(rows.map(row => [row, Object.fromEntries(CHANNELS.map(channel => [channel,
    payload.channelSelections?.[normalized.get(row)!.merchantId]?.[channel] || suggestNormalizedChannel(normalized.get(row)!, channel),
  ])) as Record<OfferChannel, OfferChannelSelection>]));
  const decision = (row: OfferRecord, channel: OfferChannel) => decisions.get(row)![channel];
  const membership = new Map(rows.map(row => [row, CHANNELS.filter(channel => {
    const s = decision(row, channel);
    return Boolean(normalized.get(row)!.merchantId && s.included && s.asins.length);
  })]));
  const common: ExportColumn[] = [...(base.columns || []),
    ['Top Rank ASINs', row => normalized.get(row)!.asins.join('\n'), 42],
  ];
  const metadata: ExportColumn[] = [
    ['Data Start', () => payload.dateRange?.startDate || '未提供 / Not provided', 16],
    ['Data End', () => payload.dateRange?.endDate || '未提供 / Not provided', 16],
    ['Classification Rules', () => CHANNEL_RULE_VERSION, 26],
    ['Metric Scope', () => '全站商家指标；非渠道业绩 / Overall merchant metrics, not channel attribution', 40],
  ];
  const kinds = [null, ...CHANNELS] as const;
  return kinds.map(channel => {
    const grade = (row: OfferRecord) => channel ? decision(row, channel).grade : normalized.get(row)!.priority.key;
    const gradeOrder = { high: 0, recommended: 1, 'low-aov': 2 };
    // Sort a copy per sheet; stable ties retain the source order within each grade.
    const selected = (channel ? rows.filter(row => membership.get(row)!.includes(channel)) : [...rows])
      .sort((a, b) => gradeOrder[grade(a)] - gradeOrder[grade(b)]);
    const columns: ExportColumn[] = [...common.map(column => column[0] === 'Priority' ? ['Priority', (row: OfferRecord) => CHANNEL_GRADES[grade(row)].join(' / '), 42] as ExportColumn : column[0] === 'Recommendation' && channel ? ['Recommendation', (row: OfferRecord) => decision(row, channel).reason, 54] as ExportColumn : column),
      ['Channel', row => channel ? CHANNEL_NAMES[channel].join(' / ') : membership.get(row)!.map(c => CHANNEL_NAMES[c].join(' / ')).join('\n'), 30],
      ['Channel Priority', row => channel ? CHANNEL_GRADES[decision(row, channel).grade].join(' / ') : membership.get(row)!.map(c => `${CHANNEL_NAMES[c][0]}: ${CHANNEL_GRADES[decision(row, c).grade][0]}`).join('\n'), 32],
      ['Channel ASINs', row => channel ? [...new Set(decision(row, channel).asins)].join('\n') : '', 42],
      ['Channel Reason', row => channel ? decision(row, channel).reason : '', 55],
      ['ASIN Reason', row => channel ? decision(row, channel).asinReason : '', 55],
      ['Verification Status', row => channel ? CHANNEL_VERIFICATION[decision(row, channel).verification].join(' / ') : membership.get(row)!.map(c => `${CHANNEL_NAMES[c][0]}: ${CHANNEL_VERIFICATION[decision(row, c).verification][0]}`).join('\n'), 30],
      ['To Verify', row => channel ? decision(row, channel).checks : '', 55],
      ['Selection Source', row => channel ? payload.channelSelections?.[normalized.get(row)!.merchantId]?.[channel] ? '人工调整 / Manually adjusted' : '自动候选，未核实 / Automatic, unverified' : '', 32],
      ...metadata,
    ];
    return { ...base, sheetName: channel ? CHANNEL_NAMES[channel][0] : '全部商家汇总', rows: selected, columns,
      rowBackgroundRanges: selected.map((row, index) => ({ start: index + 1, end: index + 1,
        color: CHANNEL_GRADE_COLORS[grade(row)] })),
      legend: Object.entries(CHANNEL_GRADES).map(([key, labels]) => ({ label: labels[0], color: CHANNEL_GRADE_COLORS[key as keyof typeof CHANNEL_GRADES] })),
      autoFilter: true,
    };
  });
}
