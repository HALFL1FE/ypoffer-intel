import {
  canonicalChatbotTier,
  normalizeChatbotText,
  resolveChatbotCategory
} from "../chatbotModel";
import type {
  PaymentStatus,
  PreviousReportContext,
  PublisherQueryFilters,
  QueryContext,
  ReportIntent,
  ReportMetric,
  ReportOperator,
  ReportQuery,
  ReportTier,
  TrendMetric
} from "./reportContracts";

type RecordValue = Readonly<Record<string, unknown>>;

const VALID_INTENTS = new Set<ReportIntent>([
  "asin", "merchant", "keyword", "payment", "recommendation", "tier", "category", "analysis", "publisher", "publisherprofile", "help"
]);
const VALID_METRICS = new Set<ReportMetric>([
  "aov", "epc", "conversionRate", "orders", "clicks", "affCommission", "commissionRate", "salesAmount", "dpv", "atc"
]);
const VALID_TIERS = new Set<ReportTier>(["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]);
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  一月: 1, 二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6, 七月: 7, 八月: 8, 九月: 9, 十月: 10, 十一月: 11, 十二月: 12
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function asRecord(value: unknown): RecordValue | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : null;
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function operator(value: unknown): ReportOperator | null {
  const raw = text(value).toLowerCase();
  if ([">", "gt"].includes(raw)) return ">";
  if ([">=", "gte"].includes(raw)) return ">=";
  if (["<", "lt"].includes(raw)) return "<";
  if (["<=", "lte"].includes(raw)) return "<=";
  if (["=", "eq", "=="].includes(raw)) return "=";
  if (/大于等于/.test(raw)) return ">=";
  if (/小于等于/.test(raw)) return "<=";
  if (/at\s*least|至少|不少于|不低于/.test(raw)) return ">=";
  if (/over|above|greater\s*than|more\s*than|超过|高于/.test(raw)) return ">";
  if (/below|under|less\s*than|少于|低于|不超过/.test(raw)) return "<";
  if (/大于/.test(raw)) return ">";
  if (/小于/.test(raw)) return "<";
  if (/等于/.test(raw)) return "=";
  return null;
}

function metric(value: unknown): ReportMetric | null {
  const raw = text(value);
  const compact = raw.toLowerCase().replace(/[ _\-]/g, "");
  if (["affcomm%", "affcommission%", "commission%"].includes(compact)) return "commissionRate";
  const aliases: Record<string, ReportMetric> = {
    aov: "aov", epc: "epc", cvr: "conversionRate", conversion: "conversionRate", conversionrate: "conversionRate",
    orders: "orders", order: "orders", clicks: "clicks", click: "clicks", affcommission: "affCommission", affcomm: "affCommission",
    commission: "affCommission", commissionrate: "commissionRate", 佣金率: "commissionRate", sales: "salesAmount", salesamount: "salesAmount",
    revenue: "salesAmount", dpv: "dpv", atc: "atc", 加购: "atc", 点击: "clicks", 订单: "orders", 收入: "salesAmount"
  };
  const resolved = aliases[compact.replace(/%/g, "")];
  return resolved && VALID_METRICS.has(resolved) ? resolved : null;
}

function trendMetricValue(value: unknown): TrendMetric | null {
  const raw = text(value).toLowerCase().replace(/[ _-]/g, "");
  const aliases: Record<string, TrendMetric> = {
    revenue: "revenue", sales: "salesAmount", salesamount: "salesAmount", orders: "orders", order: "orders",
    epc: "epc", allepc: "allEpc", aov: "aov", cvr: "conversionRate", conversion: "conversionRate", conversionrate: "conversionRate",
    clicks: "clicks", click: "clicks", affiliatepayout: "affiliatePayout", affcommission: "affCommission", commission: "affCommission",
    payout: "payout", dpv: "dpv", atc: "atc", directsales: "directSales", halosales: "haloSales"
  };
  return aliases[raw] || metric(value);
}

function tier(value: unknown): ReportTier | null {
  const normalized = canonicalChatbotTier(value);
  return VALID_TIERS.has(normalized as ReportTier) ? normalized as ReportTier : null;
}

function extractTiers(prompt: string, params: RecordValue): ReportTier[] {
  const values = [...list(params.tier)];
  const result: ReportTier[] = [];
  for (const value of values) {
    const resolved = tier(value);
    if (resolved && !result.includes(resolved)) result.push(resolved);
  }
  const matches = prompt.match(/(?:black\s*tier|黑名单|黑色\s*tier|tier\s*[1-4]|第[一二三四1-4]\s*[层级档]?)/gi) || [];
  for (const value of matches) {
    const resolved = tier(value);
    if (resolved && !result.includes(resolved)) result.push(resolved);
  }
  return result;
}

function extractAsins(prompt: string, params: RecordValue): string[] {
  const values = [...list(params.asin), ...list(params.asins)];
  const matches = prompt.match(/\bB[0-9A-Z]{9}\b/gi) || [];
  return Array.from(new Set([...values, ...matches].map((value) => value.toUpperCase()).filter((value) => /^B[0-9A-Z]{9}$/.test(value))));
}

function extractMonth(prompt: string, now: Date): string | undefined {
  const iso = prompt.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (iso?.[1] && iso[2]) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const numeric = prompt.match(/(?:^|[^0-9])(1[0-2]|[1-9])\s*(?:月|月份)/);
  if (numeric?.[1]) return `${now.getFullYear()}-${numeric[1].padStart(2, "0")}`;
  const lower = prompt.toLowerCase();
  const month = Object.entries(MONTHS).find(([name]) => lower.includes(name));
  return month ? `${now.getFullYear()}-${String(month[1]).padStart(2, "0")}` : undefined;
}

function normalizeMonthValue(value: unknown, now: Date): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const iso = raw.match(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/);
  if (iso?.[1] && iso[2]) return `${iso[1]}-${iso[2].padStart(2, "0")}`;
  const month = MONTHS[raw.toLowerCase()];
  if (month) return `${now.getFullYear()}-${String(month).padStart(2, "0")}`;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 12
    ? `${now.getFullYear()}-${String(numeric).padStart(2, "0")}`
    : undefined;
}

function monthRange(prompt: string, params: RecordValue, now: Date): { startMonth?: string; endMonth?: string } {
  const start = normalizeMonthValue(params.startMonth || params.start || params.from, now);
  const end = normalizeMonthValue(params.endMonth || params.end || params.to, now);
  const matches = [...prompt.matchAll(/\b(20\d{2})[-/](0?[1-9]|1[0-2])\b/g)].map((match) => `${match[1]}-${match[2]!.padStart(2, "0")}`);
  const values = matches.length >= 2 ? [matches[0]!, matches[1]!] : [];
  return {
    ...(start || values[0] ? { startMonth: start || values[0] } : {}),
    ...(end || values[1] ? { endMonth: end || values[1] } : {})
  };
}

function paymentStatus(prompt: string, params: RecordValue): PaymentStatus | undefined {
  const value = text(params.paymentStatus || params.status).toLowerCase();
  const aliases: Record<string, PaymentStatus> = {
    paid: "Paid", 已付: "Paid", 已支付: "Paid", pending: "Pending", 待处理: "Pending", unpaid: "Unpaid", 未付款: "Unpaid",
    未支付: "Unpaid", overdue: "Overdue", 逾期: "Overdue", partial: "Partial", 部分: "Partial", unknown: "Unknown"
  };
  if (aliases[value]) return aliases[value];
  if (/未到期|not\s*due|pending|待处理|等待/.test(prompt.toLowerCase())) return "Pending";
  if (/overdue|逾期|到期未付款|已到期/.test(prompt.toLowerCase())) return "Overdue";
  if (/unpaid|未付款|未支付|没付/.test(prompt.toLowerCase())) return "Unpaid";
  if (/partial|部分/.test(prompt.toLowerCase())) return "Partial";
  if (/\bpaid\b|已付款|已支付/.test(prompt.toLowerCase())) return "Paid";
  return undefined;
}

function metricFilters(params: RecordValue, prompt: string): ReportQuery["metricFilters"] {
  const values = Array.isArray(params.metricFilters) ? params.metricFilters : [];
  const structured = values.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const field = metric(record.field);
    const op = operator(record.operator);
    const number = Number(record.value);
    if (!field || !op || !Number.isFinite(number)) return [];
    const percent = (field === "conversionRate" || field === "commissionRate") && (prompt.includes("%") || number > 1);
    return [{ field, operator: op, value: percent ? number / 100 : number }];
  });
  const natural = prompt.match(/(?:^|[^A-Za-z0-9])(aov|epc|cvr|conversion(?:\s*rate)?|orders?|clicks?|revenue|sales|commission(?:\s*rate)?|aff\s*comm(?:ission)?%?|佣金率?|收入|订单|点击|客单价|转化率)\s*(>=|<=|>|<|=|大于等于|小于等于|大于|小于|等于)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)(\s*%|\s*百分比)?/gi) || [];
  const naturalFilters = natural.flatMap((item) => {
    const match = item.match(/(aov|epc|cvr|conversion(?:\s*rate)?|orders?|clicks?|revenue|sales|commission(?:\s*rate)?|aff\s*comm(?:ission)?%?|佣金率?|收入|订单|点击|客单价|转化率)\s*(>=|<=|>|<|=|大于等于|小于等于|大于|小于|等于)\s*\$?([0-9][0-9,]*(?:\.[0-9]+)?)(\s*%|\s*百分比)?/i);
    if (!match) return [];
    const field = metric(match[1]);
    const op = operator(match[2]);
    const rawValue = match[3];
    if (!rawValue) return [];
    const rawNumber = Number(rawValue.replace(/,/g, ""));
    if (!field || !op || !Number.isFinite(rawNumber)) return [];
    const percent = (field === "conversionRate" || field === "commissionRate") && (Boolean(match[4]?.trim()) || rawNumber > 1);
    return [{ field, operator: op, value: percent ? rawNumber / 100 : rawNumber }];
  });
  return [...structured, ...naturalFilters];
}

function hasInvalidStructuredMetricFilter(params: RecordValue): boolean {
  if (!Array.isArray(params.metricFilters)) return false;
  return params.metricFilters.some((item) => {
    const record = asRecord(item);
    if (!record) return true;
    return !metric(record.field) || !operator(record.operator) || !Number.isFinite(Number(record.value));
  });
}

function parseMetricSort(params: RecordValue): ReportQuery["metricSort"] {
  const record = asRecord(params.metricSort || params.sort);
  if (!record) return undefined;
  const field = metric(record.field);
  const direction = text(record.direction).toLowerCase() === "asc" ? "asc" : text(record.direction) ? "desc" : null;
  return field && direction ? { field, direction } : undefined;
}

function naturalMetricSort(prompt: string): ReportQuery["metricSort"] {
  const match = prompt.match(/(?:按|by|sort(?:ed)?\s+by)\s*(aov|epc|cvr|conversion(?:\s*rate)?|orders?|clicks?|revenue|sales|佣金|收入|订单|点击)(?:\s*(从高到低|从低到高|降序|升序|desc|asc))?/i)
    || prompt.match(/(?:top|highest|largest|best|ranking|排行|排名|最高|最大|最佳|前\s*\d+)\s*(?:\d+\s*)?(?:by\s*)?(aov|epc|cvr|conversion(?:\s*rate)?|orders?|clicks?|revenue|sales|佣金|收入|订单|点击)/i);
  const fieldName = match?.[1];
  if (!fieldName) return undefined;
  const field = metric(fieldName);
  if (!field) return undefined;
  const direction = /低|升序|asc/i.test(match[2] || "") ? "asc" : "desc";
  return { field, direction };
}

function naturalTierPlan(prompt: string): readonly { tier: ReportTier; count: number }[] {
  const count = Number(prompt.match(/(?:每个|each)\s*(?:tier|层级)?\s*(?:推荐|取|选)?\s*(\d+)\s*(?:个|家|offers?|each)?/i)?.[1]);
  if (!Number.isFinite(count) || count <= 0 || !/(?:每个|each)\s*(?:tier|层级)/i.test(prompt)) return [];
  const requested = extractTiers(prompt, {});
  const tiers = requested.length ? requested : ["Tier 1", "Tier 2", "Tier 3"] as const;
  return tiers.map((value) => ({ tier: value, count: Math.min(1000, Math.floor(count)) }));
}

function publisherFilters(prompt: string, params: RecordValue): PublisherQueryFilters {
  const lower = prompt.toLowerCase();
  const aliasMatches = (alias: string): boolean => {
    const normalized = alias.toLowerCase();
    if (/^[a-z]{2}$/.test(normalized)) return new RegExp(`(^|[^a-z])${normalized}(?=$|[^a-z])`, "i").test(prompt);
    return lower.includes(normalized);
  };
  const marketAliases = [
    ["amazon.com.mx", ["amazon.com.mx", "墨西哥", "mx", "墨西哥站", "墨西哥市场"]],
    ["amazon.co.uk", ["amazon.co.uk", "英国", "uk", "英国站", "英国市场", "英区"]],
    ["amazon.com", ["amazon.com", "美国", "us", "美国站", "美国市场", "美区"]],
    ["amazon.de", ["amazon.de", "德国", "germany", "de", "德国站", "德国市场", "德区"]],
    ["amazon.fr", ["amazon.fr", "法国", "france", "fr", "法国站", "法国市场"]],
    ["amazon.ca", ["amazon.ca", "加拿大", "canada", "ca", "加拿大站", "加拿大市场"]],
    ["amazon.it", ["amazon.it", "意大利", "italy", "it", "意大利站", "意大利市场"]],
    ["amazon.es", ["amazon.es", "西班牙", "spain", "es", "西班牙站", "西班牙市场"]],
    ["amazon.nl", ["amazon.nl", "荷兰", "netherlands", "nl", "荷兰站", "荷兰市场"]]
  ] as const;
  let market: string | null = null;
  let marketAlias = "";
  for (const [key, aliases] of marketAliases) {
    const matched = [...aliases].sort((left, right) => right.length - left.length).find(aliasMatches);
    if (matched) {
      market = key;
      marketAlias = matched;
      break;
    }
  }
  const networkAliases = [
    ["ShareASale", ["shareasale", "share a sale"]],
    ["Commission Junction", ["commission junction", "cj affiliate", "cj.com"]],
    ["Impact", ["impact.com", "impact"]],
    ["Rakuten", ["rakuten"]],
    ["Awin", ["awin"]],
    ["Partnerize", ["partnerize"]],
    ["Amazon Associates", ["amazon associates", "amazon affiliate"]],
    ["Levanta", ["levanta"]]
  ] as const;
  const requestedNetwork = text(params.network);
  const networkMatch = networkAliases.find(([, aliases]) => aliases.some(aliasMatches));
  const network = requestedNetwork || networkMatch?.[0] || null;
  const networkAlias = requestedNetwork || networkMatch?.[1].find(aliasMatches) || "";
  const managerMatch = prompt.match(/(?:经理|管理员|manager)\s*[:：]?\s*([^\s,，、;；]+)/i);
  const manager = text(params.manager || params.adminName) || text(managerMatch?.[1]) || null;
  const promptMerchantIds = [...prompt.matchAll(/(?:merchant\s*(?:id)?|商户\s*(?:ID|编号)?|媒体\s*(?:ID|编号)?)\s*[:#：]?\s*(\d{3,})/gi)].map((match) => text(match[1]));
  const merchantIds = unique([...list(params.merchantIds || params.merchantId), ...promptMerchantIds]).filter((value) => /^\d+$/.test(value));
  const naturalMerchantMatch = prompt.match(/(?:商家|商户|merchant)\s*[:：]?\s*([^,，、;；]+)/i)
    || prompt.match(/(?:for|partnering\s+with|合作(?:的)?)[\s:：]+([^,，、;；]+)/i);
  const merchantQuery = text(params.merchantQuery || params.merchant || params.merchantName) || text(naturalMerchantMatch?.[1]) || null;
  const sortAliases: Array<[PublisherQueryFilters["sortKey"], RegExp]> = [
    ["sales", /sales|revenue|销售/], ["allCommission", /all\s*comm|总佣金/], ["affCommission", /aff\s*comm|联盟佣金/],
    ["orders", /orders?|订单/], ["cvr", /cvr|转化率/], ["dpv", /dpv|详情页/], ["atc", /atc|加购/], ["grossProfit", /gross\s*profit|毛利/]
  ];
  const sortKey = sortAliases.find(([, pattern]) => pattern.test(lower))?.[0] || "clicks";
  const limitMatch = lower.match(/(?:top|前|最多|只显示|只)\s*(\d{1,4})/) || lower.match(/\b(\d{1,4})\s*(?:publishers?|个|条|名)\b/);
  const limit = Math.max(1, Math.min(1000, Number(limitMatch?.[1] || 50)));
  const stopWords = [
    "媒体", "publisher", "publishers", "列", "列举", "列出", "查", "查询", "找", "一下", "的", "哪些", "有哪些", "有",
    "看", "看看", "展示", "显示", "输出", "列表", "记录", "业绩", "数据", "排序", "排名", "市场", "站点", "联盟", "商家",
    "商户", "合作", "经理", "管理员", "前", "个", "条", "名", "最", "最高", "最大", "list", "show", "give", "find",
    "lookup", "for", "with", "in", "and", "the", "top", "only", "by"
  ];
  const recognized = [marketAlias, networkAlias, manager || "", merchantQuery || "", ...merchantIds]
    .flatMap((value) => value.split(/[\s,，、;；:：]+/).map((item) => item.trim().toLowerCase()).filter(Boolean));
  const unrecognized = unique(prompt.split(/[\s,，、;；:：]+/).map((token) => token.trim()).filter((token) => {
    const value = token.toLowerCase();
    if (!value || /^\d+$/.test(value) || !/[a-z一-龥]/i.test(value)) return false;
    if (stopWords.some((word) => word.length >= 2 ? value.includes(word.toLowerCase()) : value === word)) return false;
    if (recognized.includes(value)) return false;
    return true;
  }));
  return { market, network, manager, merchantIds, merchantQuery, sortKey, limit, unrecognized };
}

function classificationData(value: unknown): { intent: ReportIntent | null; params: RecordValue } {
  const record = asRecord(value);
  const intent = record && VALID_INTENTS.has(text(record.intent).toLowerCase() as ReportIntent)
    ? text(record.intent).toLowerCase() as ReportIntent
    : null;
  const params = asRecord(record?.params) || {};
  return { intent, params };
}

function explicitIntent(prompt: string): { intent: ReportIntent | null; command: boolean; commandName?: string; target?: string; publisherQuery?: string } {
  const trimmed = prompt.trim();
  const match = trimmed.match(/^\/(publisherprofile|publisher|keyword|keywords|asin|merchant|payment|recommendation|tier|categorytier|category\s*(?:\+|&)\s*tier|category|trend|analysis|help|品类\s*(?:\+|和|与)\s*tier)\s*[:：]?\s*(.*)$/i)
    || trimmed.match(/^(publisherprofile|publisher|keyword|keywords|asin|merchant|payment|recommendation|tier|categorytier|category\s*(?:\+|&)\s*tier|category|trend|analysis|help|品类\s*(?:\+|和|与)\s*tier)\s*[:：]\s*(.*)$/i);
  if (!match) return { intent: null, command: false };
  const raw = text(match[1]).toLowerCase();
  const compact = raw.replace(/\s+/g, "");
  const commandName = /^(?:category[+&]tier|品类[+和与]tier)$/i.test(compact) ? "categorytier" : raw;
  const intent = commandName === "keywords" ? "keyword" : commandName === "trend" ? "analysis" : commandName === "categorytier" ? "category" : commandName as ReportIntent;
  return {
    intent,
    command: true,
    commandName,
    target: text(match[2]),
    publisherQuery: commandName === "publisherprofile" ? text(match[2]) : undefined
  };
}

function inferPublisherTarget(prompt: string): string {
  const cleaned = prompt
    .replace(/^\s*\/?(?:publisher\s*profile|publisherprofile|媒体画像|媒体偏好|查看媒体|显示媒体|show\s+publisher)\s*[:：]?/i, "")
    .replace(/(?:的)?\s*(?:画像|profile)\s*$/i, "")
    .replace(/[“”"']/g, "")
    .trim();
  return cleaned;
}

function ruleIntent(prompt: string): ReportIntent {
  const lower = prompt.toLowerCase();
  if (/^\s*\/?(?:help|帮助|使用说明|怎么用|如何使用|what\s+can\s+you\s+do)\b/i.test(lower)) return "help";
  if (/publisher\s*profile|publisherprofile|媒体画像|媒体偏好|媒体画像/.test(lower)) return "publisherprofile";
  if (/publisher\s*records?|publishers?|媒体记录|媒体列表|媒体数据/.test(lower)) return "publisher";
  if (/(?:payment|pay)\s*cycle|付款周期|支付周期|结算周期|回款周期/.test(lower)
    && !/\bunpaid\b|\bpaid\b|\boverdue\b|\bpending\b|未付款|已付款|逾期|待处理/.test(lower)) return "recommendation";
  if (/payment|paid|unpaid|overdue|pending|commission due|付款|支付|结算|逾期|未付款|待处理/.test(lower)) return "payment";
  if (/分析|趋势|trend|compare|comparison|对比|比较|why|为什么|表现|评估|诊断/.test(lower)) return "analysis";
  if (/recommend|recommendation|top\s*\d+|best|排行|排名|推荐|优先|选品|前\s*\d+/.test(lower)) return "recommendation";
  if (/\bb[0-9a-z]{9}\b|\basin\b|商品编号/i.test(lower)) return "asin";
  if (/keyword|product\s*(?:name|title)|关键词|产品名|商品名/.test(lower)) return "keyword";
  if (/\btier\s*[1-4]\b|black\s*tier|分层|层级|档位|黑名单/.test(lower)) return "tier";
  if (/category\s*-?\s*tier|品类\s*(?:和|加|与)?\s*tier|类目\s*(?:和|加|与)?\s*层级/.test(lower)) return "category";
  if (/category|categories|品类|类别|类目|分类/.test(lower)) return "category";
  return "merchant";
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function queryWithDefaults(prompt: string, language: QueryContext["language"], intent: ReportIntent, parsedBy: ReportQuery["parsedBy"], params: RecordValue, context: QueryContext, publisherQuery?: string, commandTarget?: string, commandName?: string): ReportQuery {
  const now = context.now || new Date();
  const parsePrompt = commandTarget !== undefined ? commandTarget : prompt;
  const tiers = extractTiers(parsePrompt, params);
  const categoriesFromParams = list(params.category || params.categories);
  const categories = unique(categoriesFromParams.length ? categoriesFromParams : [resolveChatbotCategory(parsePrompt, context.categories) || ""]);
  const merchantPrompt = parsePrompt;
  const promptIds = intent === "publisher" || intent === "publisherprofile"
    ? []
    : [...merchantPrompt.matchAll(/(?:merchant\s*(?:id)?|商户\s*(?:ID|编号)?)\s*[:#：]?\s*(\d{3,})/gi)].map((match) => text(match[1]));
  const bareId = /^\s*\d{3,}\s*$/.test(merchantPrompt) ? [merchantPrompt.trim()] : [];
  const merchantIds = unique([...list(params.merchantId), ...list(params.merchantIds), ...promptIds, ...bareId]).filter((value) => /^\d+$/.test(value));
  const merchantNames = unique([...list(params.merchantName), ...list(params.merchantNames), ...list(params.analysisTarget)]).filter((value) => !/^\d+$/.test(value));
  if ((intent === "merchant" || intent === "analysis" || intent === "payment") && !merchantIds.length && !merchantNames.length && context.merchantCandidates?.length) {
    const normalizedPrompt = normalizeChatbotText(merchantPrompt);
    const matches = context.merchantCandidates.filter((candidate) => {
      const normalizedName = normalizeChatbotText(candidate.name);
      const directMatch = normalizedPrompt.length >= 2 && normalizedName.length >= 2 && (
        normalizedPrompt === normalizedName
        || normalizedPrompt.includes(normalizedName)
        || normalizedName.includes(normalizedPrompt)
      );
      const promptTokens = normalizedPrompt.split(/\s+/).filter((token) => token.length >= 3);
      const nameTokens = normalizedName.split(/\s+/).filter((token) => token.length >= 3);
      const commandTokenMatch = commandTarget !== undefined && promptTokens.some((promptToken) => nameTokens.some((nameToken) => (
        promptToken === nameToken || promptToken.includes(nameToken) || nameToken.includes(promptToken)
      )));
      return directMatch || commandTokenMatch;
    });
    if (matches.length === 1) merchantIds.push(text(matches[0]!.id));
    if (matches.length > 1) {
      const names = matches.map((candidate) => normalizeChatbotText(candidate.name));
      const hasDuplicateName = names.some((name, index) => names.indexOf(name) !== index);
      if (!hasDuplicateName) merchantIds.push(...matches.map((candidate) => text(candidate.id)));
      else merchantNames.push(...matches.map((candidate) => text(candidate.name)));
    }
  }
  const asins = extractAsins(parsePrompt, params);
  const analysisCommandTarget = commandTarget && intent === "analysis" && !merchantIds.length && !merchantNames.length && !tiers.length && !categories.length && !asins.length
    ? [commandTarget]
    : [];
  const analysisTargets = unique([...list(params.analysisTargets), ...list(params.analysisTarget), ...merchantIds, ...merchantNames, ...analysisCommandTarget]);
  const explicitAnalysisType = text(params.analysisType).toLowerCase();
  const analysisType = commandName === "trend"
    ? "trend"
    : ["merchant", "category", "tier", "trend"].includes(explicitAnalysisType)
    ? explicitAnalysisType as ReportQuery["analysisType"]
    : intent === "analysis"
      ? commandName === "trend" || /趋势|trend|近\s*\d+\s*个月|last\s*\d+\s*months?/i.test(parsePrompt)
        ? "trend"
        : tiers.length
          ? "tier"
          : categories.length
            ? "category"
            : "merchant"
      : undefined;
  const countNumber = Number(params.count || params.limit || parsePrompt.match(/(?:top|前|最多|取|推荐)\s*(\d{1,4})/i)?.[1] || parsePrompt.match(/\b(\d{1,4})\s*(?:个|家|条|名)\b/i)?.[1]);
  const count = Number.isFinite(countNumber) && countNumber > 0 ? Math.floor(countNumber) : undefined;
  const plans = Array.isArray(params.tierOfferPlan) ? params.tierOfferPlan.flatMap((item) => {
    const record = asRecord(item);
    const resolved = record ? tier(record.tier) : null;
    const amount = record ? Number(record.count) : 0;
    return resolved && Number.isFinite(amount) && amount > 0 ? [{ tier: resolved, count: Math.floor(amount) }] : [];
  }) : [...naturalTierPlan(parsePrompt)];
  const filters = metricFilters(params, parsePrompt);
  const status = paymentStatus(parsePrompt, params);
  const month = normalizeMonthValue(params.month || params.reportMonth, now) || extractMonth(parsePrompt, now);
  const range = monthRange(parsePrompt, params, now);
  const cycleRecord = asRecord(params.paymentCycleFilter);
  const cycleOperator = operator(cycleRecord?.operator);
  const cycleDays = Number(cycleRecord?.days ?? cycleRecord?.value);
  const cycleMatch = parsePrompt.match(/(?:payment\s*cycle|付款周期|付款周期为|周期)\s*(>=|<=|>|<|=|over|above|greater\s*than|more\s*than|at\s*least|below|under|less\s*than|大于等于|小于等于|大于|小于|等于|至少|超过|高于|低于|少于|不超过)?\s*(\d+)\s*(?:days?|天)?/i);
  const cycle = cycleOperator && Number.isFinite(cycleDays) ? { operator: cycleOperator, days: cycleDays } : cycleMatch?.[2]
    ? { operator: operator(cycleMatch[1]) || ">", days: Number(cycleMatch[2]) }
    : undefined;
  const issues: string[] = [];
  const analysisTargetText = parsePrompt
    .replace(/^\s*\/?(?:analysis|分析|trend|趋势)\s*[:：]?\s*/i, "")
    .replace(/近\s*\d+\s*个?月|last\s*\d+\s*months?/gi, "")
    .replace(/趋势|trend|整体|全局|全量|所有商户|all\s+merchants?|overall|global/gi, "")
    .trim();
  if (intent === "publisherprofile" && !publisherQuery && !merchantNames.length && !merchantIds.length) issues.push(language === "zh" ? "请提供媒体名称或媒体 ID。" : "Provide a publisher name or ID.");
  if (intent === "analysis" && !merchantIds.length && !merchantNames.length && !tiers.length && !categories.length && !asins.length
    && !analysisTargetText) {
    issues.push(language === "zh" ? "请提供要分析的商户、品类或 Tier 目标。" : "Provide a merchant, category, or tier target to analyze.");
  }
  if (intent === "tier" && !tiers.length) issues.push(language === "zh" ? "请提供 Tier 目标。" : "Provide a tier target.");
  if (intent === "category" && !categories.length && params.recommendCategories !== true) issues.push(language === "zh" ? "请提供品类目标。" : "Provide a category target.");
  const includeTier4 = params.includeTier4 === true || tiers.includes("Tier 4");
  const includeBlack = params.includeBlack === true || tiers.includes("BLACK TIER");
  const keyword = text(params.keywordSearch || params.keyword)
    || (intent === "keyword" && commandTarget !== undefined ? commandTarget : "")
    || undefined;
  const lookupText = intent === "merchant" && !merchantIds.length && !merchantNames.length
    ? merchantPrompt.replace(/^\s*\/?merchant\s*[:：]?\s*/i, "").trim()
    : "";
  if (intent === "merchant" && !lookupText && !merchantIds.length && !merchantNames.length) {
    issues.push(language === "zh" ? "请提供商户名称或商户 ID。" : "Provide a merchant name or ID.");
  }
  if (hasInvalidStructuredMetricFilter(params)) issues.push(language === "zh" ? "存在无法识别的指标筛选条件。" : "One or more metric filters are invalid.");
  return {
    prompt,
    language,
    intent,
    parsedBy,
    resolution: issues.length ? "needs_input" : "resolved",
    issues,
    merchantIds,
    merchantNames,
    ...(lookupText ? { lookupText } : {}),
    asins,
    categories,
    tiers,
    ...(keyword ? { keyword } : {}),
    ...(count ? { count } : {}),
    metricFilters: filters,
    metricSort: parseMetricSort(params) || naturalMetricSort(parsePrompt),
    includeTier4,
    includeBlack,
    recommendCategories: params.recommendCategories === true || /推荐品类|recommended categories|best categories|品类排名/i.test(parsePrompt),
    tierOfferPlan: plans,
    excludeMerchantIds: unique(list(params.excludeMerchantIds || params.excludeMerchantId)),
    replaceMerchantIds: unique(list(params.replaceMerchantIds || params.replaceMerchantId)),
    ...(status ? { paymentStatus: status } : {}),
    ...(month ? { month } : {}),
    ...range,
    ...(cycle ? { paymentCycleFilter: cycle } : {}),
    ...(analysisType ? { analysisType } : {}),
    analysisTargets,
    ...(Number(params.months) >= 2 ? { months: Math.min(24, Math.floor(Number(params.months))) } : /近\s*(\d+)\s*个月|last\s*(\d+)\s*months?/i.test(parsePrompt) ? { months: Math.min(24, Math.max(2, Number(parsePrompt.match(/(?:近|last\s*)(\d+)/i)?.[1] || 3))) } : {}),
    ...((params.trendMetric && trendMetricValue(params.trendMetric)) || naturalMetricSort(parsePrompt)?.field ? { trendMetric: (trendMetricValue(params.trendMetric) || naturalMetricSort(parsePrompt)?.field) as TrendMetric } : {}),
    ...(publisherQuery !== undefined ? { publisherQuery } : {}),
    publisherFilters: publisherFilters(parsePrompt, params)
  };
}

function actionMerchantIds(prompt: string, candidates: QueryContext["merchantCandidates"]): readonly string[] {
  const ids = [...prompt.matchAll(/(?:merchant\s*(?:id)?|商户\s*(?:ID|编号)?)\s*[:#：]?\s*(\d{3,})/gi)].map((match) => text(match[1]));
  const bareIds = [...prompt.matchAll(/\b\d{3,}\b/g)].map((match) => text(match[0]));
  const normalizedPrompt = normalizeChatbotText(prompt);
  const names = (candidates || []).filter((candidate) => {
    const normalizedName = normalizeChatbotText(candidate.name);
    return normalizedName.length >= 2 && normalizedPrompt.includes(normalizedName);
  }).map((candidate) => text(candidate.id));
  return unique([...ids, ...bareIds, ...names]).filter((value) => /^\d+$/.test(value));
}

function recommendationActionQuery(input: string, context: QueryContext): ReportQuery | null {
  const previous = context.previous?.request;
  if (!previous || previous.intent !== "recommendation") return null;
  if (!/(排除|exclude|remove|替换|replace|换一个|换一家|换掉)/i.test(input)) return null;
  const ids = actionMerchantIds(input, context.merchantCandidates);
  const replacement = /(替换|replace|换一个|换一家|换掉)/i.test(input);
  const excluded = ids.length ? unique([...previous.excludeMerchantIds, ...ids]) : previous.excludeMerchantIds;
  const replaced = replacement && ids.length ? unique([...previous.replaceMerchantIds, ...ids]) : previous.replaceMerchantIds;
  const issues = ids.length ? [] : [context.language === "zh" ? "请提供要排除或替换的商户名称或 ID。" : "Provide the merchant name or ID to exclude or replace."];
  return {
    ...previous,
    prompt: input,
    parsedBy: "followup",
    intent: "recommendation",
    resolution: issues.length ? "needs_input" : "resolved",
    issues,
    excludeMerchantIds: excluded,
    replaceMerchantIds: replaced
  };
}

export function resolveReportQuery(prompt: string, context: QueryContext): ReportQuery {
  const input = text(prompt);
  const actionQuery = recommendationActionQuery(input, context);
  if (actionQuery) return actionQuery;
  const explicit = explicitIntent(input);
  const classification = classificationData(context.classification);
  const lower = input.toLowerCase();
  const followup = /^(?:epc|aov|cvr|conversion|orders?|clicks?|佣金|收入|订单|点击|付款|支付|多少钱|怎么样)\s*(?:呢|吗|如何)?[?？]?$/i.test(input);
  if (followup && context.previous?.merchantIds?.length === 1) {
    return queryWithDefaults(input, context.language, "merchant", "followup", {
      merchantId: context.previous.merchantIds[0]
    }, context);
  }
  const rule = ruleIntent(input);
  const explicitStrong = explicit.intent === "payment" || explicit.intent === "analysis" || explicit.intent === "recommendation" || explicit.intent === "publisher" || explicit.intent === "publisherprofile" || explicit.intent === "keyword" || explicit.intent === "help";
  const naturalStrong = rule === "payment" || rule === "analysis" || rule === "publisher" || rule === "publisherprofile" || rule === "help";
  const intent = explicit.intent || (explicitStrong || naturalStrong ? rule : classification.intent || rule);
  const parsedBy: ReportQuery["parsedBy"] = explicit.command ? "command" : classification.intent && intent === classification.intent ? "llm" : "rule";
  const params = classification.params;
  const categoryCandidate = resolveChatbotCategory(input, context.categories);
  const categoryOnly = !explicit.command
    && intent === "merchant"
    && Boolean(categoryCandidate)
    && normalizeChatbotText(input) === normalizeChatbotText(categoryCandidate || "");
  const effectiveIntent: ReportIntent = categoryOnly ? "category" : intent;
  const effectiveParsedBy: ReportQuery["parsedBy"] = categoryOnly && parsedBy === "rule" ? "rule" : parsedBy;
  const publisherTarget = explicit.publisherQuery || (!explicit.command && effectiveIntent === "publisherprofile" ? inferPublisherTarget(input) : undefined);
  const commandTarget = explicit.command ? explicit.target : undefined;
  const query = queryWithDefaults(input, context.language, effectiveIntent, effectiveParsedBy, params, context, publisherTarget, commandTarget, explicit.commandName);
  if (intent === "publisherprofile" && !query.publisherQuery) {
    return { ...query, publisherQuery: query.merchantNames[0] || query.merchantIds[0] || "" };
  }
  if (intent === "keyword" && !query.keyword) {
    const stripped = input.replace(/^\/?keywords?\s*[:：]?/i, "").replace(/关键词|product\s*(?:name|title)/i, "").trim();
    return { ...query, keyword: stripped || undefined, resolution: stripped ? query.resolution : "needs_input", issues: stripped ? query.issues : [context.language === "zh" ? "请提供关键词。" : "Provide a keyword."] };
  }
  if (intent === "asin" && !query.asins.length && /asin|商品编号/i.test(lower)) {
    return { ...query, resolution: "needs_input", issues: [context.language === "zh" ? "请提供有效的 ASIN。" : "Provide a valid ASIN."] };
  }
  return query;
}
