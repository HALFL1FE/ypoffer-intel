import type { OfferChannel, OfferChannelGrade, OfferChannelSelection, OfferChannelSelections, OfferRecord, OfferTrackerRules, OfferTrackerRow } from '../../shared/contracts/offer';
import { normalizeOfferRecord } from './offerTrackerModel';

export const CHANNELS: readonly OfferChannel[] = ['google', 'deals', 'creators'];
export const CHANNEL_NAMES = { google: ['谷歌广告', 'Google Ads'], deals: ['折扣网站', 'Deal Sites'], creators: ['红人', 'Creators'] } as const;
export const CHANNEL_GRADES: Record<OfferChannelGrade, readonly [string, string]> = {
  high: ['高优先级offer', 'High-priority offer'],
  recommended: ['推荐offer、低单价优选', 'Recommended offer / low-price picks'],
  'low-aov': ['低单价优选', 'Low-price picks'],
};
export const CHANNEL_GRADE_COLORS: Record<OfferChannelGrade, string> = { high: '#D6EEDD', recommended: '#CCFFFF', 'low-aov': '#FFFFFF' };
export const CHANNEL_VERIFICATION = { pending: ['待核实', 'Unverified'], confirmed: ['人工已核实', 'Manually verified'] } as const;
export const CHANNEL_RULE_VERSION = 'channel-candidates-v1';

// Exact IDs only. Keep the first row in the applied order rather than inventing
// aggregates or reranking ASINs across conflicting merchant snapshots.
export function uniqueExportMerchants(rows: readonly OfferRecord[]): OfferRecord[] {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = normalizeOfferRecord(row).merchantId;
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function suggestChannel(source: OfferRecord, channel: OfferChannel, rules?: OfferTrackerRules): OfferChannelSelection {
  return suggestNormalizedChannel(normalizeOfferRecord(source, rules), channel);
}

export function suggestNormalizedChannel(row: OfferTrackerRow, channel: OfferChannel): OfferChannelSelection {
  const ready = Boolean(row.merchantId && row.asins.length && row.commissionRate > 0 && row.tier !== 'BLACK TIER');
  const contentCategory = /beauty|personal care|home|kitchen|sport|outdoor|pet|toys|electronics|clothing|fashion|健康|美妆|家居|厨房|运动|户外|宠物|玩具|电子|服装/i.test(row.category);
  // These are transparent opportunity heuristics, never permissions or proof of fit.
  const matches = channel === 'google' ? row.revenue > 0 : channel === 'deals' ? row.aov > 0 && row.aov <= 100 : contentCategory;
  const reasons = {
    google: '有历史营收及 AFF 佣金，可评估搜索广告测试 / Revenue and commission support evaluating a search test',
    deals: 'AOV ≤ $100，作为低门槛购买候选；尚未验证折扣 / AOV ≤ $100 suggests an accessible purchase; discount unverified',
    creators: '品类具备演示或测评选题线索；尚未验证受众匹配 / Category suggests demonstration or review topics; audience fit unverified',
  };
  const checks = {
    google: '核实 PPC 授权、品牌词/非品牌词、直链、市场、CPC 与转化；BB 偏好不是授权 / Verify PPC, brand/non-brand terms, direct linking, market, CPC and conversion; BB preference is not permission',
    deals: '核实实际售价、到手价、优惠真实性、期限、适用条件和库存；高价大额优惠可人工加入 / Verify price, genuine discount, dates, conditions and stock; high-price deals can be added manually',
    creators: '核实受众、内容卖点、寄样、素材、合作费用和使用体验 / Verify audience, content angle, samples, assets, compensation and experience',
  };
  return {
    included: ready && matches,
    grade: row.priority.key,
    verification: 'pending',
    asins: [...row.asins],
    reason: ready && matches ? reasons[channel] : '未命中自动候选规则，可人工核实后加入 / No automatic candidate signal; review manually',
    asinReason: '暂沿用全站 Top 5；未作渠道单品排名，请按渠道勾选 / Seeded from overall Top 5; select products for this channel',
    checks: (!row.merchantId ? '缺少 Merchant ID / Missing Merchant ID; ' : !row.asins.length ? '缺少 ASIN / Missing ASIN; ' : '') + checks[channel],
  };
}

export function channelSelection(source: OfferRecord, channel: OfferChannel, selections?: OfferChannelSelections, rules?: OfferTrackerRules): OfferChannelSelection {
  const id = normalizeOfferRecord(source).merchantId;
  return selections?.[id]?.[channel] || suggestChannel(source, channel, rules);
}

export function selectedForChannel(source: OfferRecord, channel: OfferChannel, selections?: OfferChannelSelections): boolean {
  const selection = channelSelection(source, channel, selections);
  return Boolean(normalizeOfferRecord(source).merchantId && selection.included && selection.asins.length);
}

export function validateChannelSelections(rows: readonly OfferRecord[], selections?: OfferChannelSelections): string {
  for (const row of rows) for (const channel of CHANNELS) {
    const s = channelSelection(row, channel, selections);
    if (!s.included) continue;
    if (!normalizeOfferRecord(row).merchantId || !s.asins.length || s.asins.some(asin => !/^B[A-Z0-9]{9}$/.test(asin)))
      return '已纳入的商家必须有 Merchant ID 和有效 ASIN / Included merchants require a Merchant ID and valid ASINs';
    if (!s.reason.trim() || !s.asinReason.trim())
      return '请填写商家及 ASIN 推荐理由 / Merchant and ASIN reasons are required';
  }
  return '';
}
