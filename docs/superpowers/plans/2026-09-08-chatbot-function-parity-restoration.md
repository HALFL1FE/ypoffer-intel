# Chatbot 旧版功能对齐补全 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前 Vue Chatbot 中补全旧版 Report Mode、Chat Mode 报告记忆、Deep Window 与帮助引导的剩余行为，使相同问题、相同数据和相同规则得到一致的查询范围、指标、结果、上下文和导出。

**Architecture:** 保留当前工作树已经建立的 `report/` 结构化报告模块，由 `chatbotSession.ts` 统一编排分类、数据读取、结果更新、取消和逐回答绑定。剩余工作集中在 fail-closed 查询、富实体结果、推荐续问、真实趋势、媒体画像、快照记忆与事件驱动引导；普通 Chat Mode 和独立 Agent v2 协议不重写。

**Tech Stack:** Vue 3、TypeScript、Vitest、现有 Markdown/XLSX 模块、Python 本地服务、Vercel API、BrowserAct；不增加依赖。

> **执行状态（2026-09-08）：** 本计划已经按 T1–T11 落地代码和自动化回归。第 6 节的 BrowserAct 交互、真实 DB/LLM 链路仍保持为独立验收项；详见第 10 节，不能把代码测试结果等同于浏览器或真实服务通过。

## Global Constraints

- 工作目录为 D:/Code/offer-intelligence-main；下文文件路径均相对此目录。
- 保持 M7 现代运行时：frontend/src/runtime/modernApp.ts、frontend/src/entry.ts 和 frontend/src/features/chatbot/。
- 不恢复 public/app.js、frontend/src/legacy/、旧全局 DOM、bridge 或 Legacy 运行时开关。旧提交只用于读取行为和移植纯业务逻辑；回滚使用上一份可部署构建。
- Chatbot 页面是本计划的功能范围；独立 Agent 页保留当前协议和会话。共享组件变更必须验证 Agent 使用方，不借本任务扩充 Agent 工具注册表。
- 后端沿用 /api/chat/classify、/api/chat/analyze、/api/chat/stream 和现有 /api/ui/db/*；本计划不新增 API、数据库表或 Provider。
- 中文优先，保留中英切换；代码注释和实施说明使用中文。恢复的示例、帮助、表头、状态、导出名称均应有双语文案。
- 业务规则依据固定旧版快照和当前有效数据合同；不在迁移中重新定义推荐权重、分析阈值、Tier 决策或佣金口径。
- 数值事实由数据模型计算；LLM 负责分类和解释，不从自由文本反解析商户列表、付款金额或 Excel 内容。
- 保持现有会话认证和页面权限；401/403 不扩大查询范围。OI_AUTH_ENABLED=0 只用于隔离本地验收。
- 不新增原始问答、报告表格、HTML、工具载荷的持久化；日志和反馈仍走现有接口及字段合同。
- 每个功能任务先用固定样本重现差异，再实现并运行对应测试。文案和文档本身不添加镜像式测试。
- 保留执行开始时的已有修改。当前 `frontend/src/features/chatbot/` 与 `frontend/src/entry.ts` 已存在未提交的功能对齐实现，认证脚本、关键词缓存、计划文档和截图也有独立修改；后续执行前重新检查 `git status --short`，不得覆盖或回滚这些内容。
- 本计划不包含 commit、push、PR、merge 或部署操作。
- 文档撰写、代码实现、自动化通过、本地浏览器通过、真实服务验收、部署为不同状态，分别记录。
- 任务中的 commit 步骤仅表示未来执行时的审查检查点；除非用户再次明确授权，不实际提交。

## 1. 基线与审计证据

### 1.1 对照版本

| 基线 | 用途 |
| --- | --- |
| 当前 HEAD：a24cb9a；upstream/main：ff92a16 | 两者的已提交 Chatbot/Agent 路径无差异；当前工作树另有未提交补全实现 |
| 旧版：1a7a6ce，Restore complete static app bundle | 固定旧版 public/app.js 和辅助脚本的业务行为 |
| docs/chatbot-feature-report.md | 功能范围与历史能力清单，特别是 5.3、6.2、15、16 节 |
| docs/chatbot-analysis-comparison-rules.md | 分析公式、百分位、样本量、Peer 和推荐排序的区别 |
| docs/chat-mode-analysis-types.md | 普通 Chat Mode、结构化 Report、Memory 推荐的职责边界 |
| 当前 skills/asin.py、merchant.py、category.py、tier.py、recommendation.py、payment.py、analysis.py | /api/chat/classify 实际返回的 intent/params 合同 |
| 当前付款、媒体、XLSX 模块 | 数据归一化、复用点和导出格式 |

旧文档中出现“Legacy-first”“bridge 转发”“恢复旧 DOM”的步骤属于历史方案，不能直接执行。该计划取代这些历史方案在当前 Chatbot 补全任务中的实施方式，不覆盖历史记录。

### 1.2 当前工作树已经具备的能力

- 分类结果的 `intent/params` 已进入 `resolveReportQuery()`，Report Mode 不再只记录分类结果。
- `reportContracts.ts`、`reportQuery.ts`、`reportDataProvider.ts`、`reportEngine.ts` 及实体、推荐、付款、分析、趋势、媒体、快照、导出模块已存在。
- live offers、keywords、merchant、search、publishers 与 publisher portfolio 已由 `frontend/src/entry.ts` 注入会话数据提供器。
- 付款专用字段与过滤、基础趋势图和交互、Publisher Records/Profile 基础链路、帮助正文、指南、五步状态机已接通。
- 本轮审计通过 TypeScript 检查、84 个 Vitest 文件共 345 个测试、现代前端双构建、M6/M7 静态契约及 Agent HTTP/registry/planning/synthesis/LLM/Trace 回归。

以上能力来自当前未提交工作树，不能视为已经进入 `upstream/main`。

### 1.3 剩余已核实缺口

| 编号 | 当前证据 | 必须补全的行为 | 优先级 |
| --- | --- | --- | --- |
| R01 | `reportQuery.ts` 的明确命令不识别 `categorytier`；排除/替换只读取结构化 params | 命令菜单与解析器一致；自然语言排除/替换继承上一推荐条件 | P0 |
| R02 | 自然语言商户未解析出 ID/名称时，`entityReports.ts` 返回销售额前 50 条 | 未知或歧义实体 fail closed，先走 DB search，再返回候选/未找到 | P0 |
| R03 | Merchant/ASIN/Keyword 使用通用表；Keyword 未应用 Tier、指标过滤和排序 | 恢复商户概览、产品/月度详情、ASIN 流量角度、关键词范围与歧义澄清 | P0 |
| R04 | 推荐行生成 `recommendationReason`、`trafficAngle`，但 `baseColumns()` 不展示；自然语言 Top 指标和付款周期 Offer 路径不等价 | 恢复旧评分调用场景、富结果、Top 指标、付款周期 Offer、组合排除/替换 | P0 |
| R05 | `analysis`/`trend` 只有单个 merchantId 才请求详情；自然语言商户趋势常停留在缓存/估算 | 先解析唯一商户，再加载真实月度；品类/Tier 聚合记录覆盖率和部分失败 | P0 |
| R06 | 品类趋势无条件排除 Tier 4/BLACK，即使用户明确选择；主报告列按钮只循环切换 | 显式 Tier 优先；恢复 Default/All/逐列选择并同步图、表和导出 | P1 |
| R07 | Publisher 仅识别完整 Amazon 域名和 Levanta；Profile 汇总虽含 affinity 数据但未渲染 | 恢复市场别名、动态网络、未识别条件、偏好/AOV/市场/信号区块 | P1 |
| R08 | `createReportSnapshot()` 默认把当前可见行当候选池；Memory 推荐只解析数量与 Tier，并拒绝多个匹配快照 | 保存完整候选池；按类别、指标、排序和来源合并/消歧；View/Excel 绑定 answerId | P0 |
| R09 | 五步引导是手动状态面板，没有首次自动启动、遮罩、高亮、拖动/等待/加入对话事件约束 | 恢复可访问的事件驱动引导，失败/停止不能越过必要步骤 | P1 |
| R10 | 现有 parity 测试只覆盖部分新链路，尚无真实浏览器/数据库/LLM 验收 | 为 R01–R09 建立失败回归、完整行为矩阵和分层验收记录 | P0 |

### 1.4 两个容易误迁移的规则

### 1.3 两个容易误迁移的规则

1. 推荐评分与默认排序不是同一件事。旧版 recommendationScore() 有权重和风险惩罚，但 compareRecommendationOffers() 默认先按 salesAmount、orders、conversionRate、aov、epc 排序，再比较 Tier、佣金、点击和名称。显式 metricSort 会先比较 Tier 优先级，再比较目标指标。每个调用场景须保留自己使用的 comparator，不把所有排序替换成综合分。
2. /api/chat/classify 限制整个 UTF-8 JSON 请求体不超过 2048 字节；/api/chat/analyze 的本地与 Vercel 当前实现均为 16384 字节，旧文档写的 8 KB 已过时。分类参数接线时同步处理请求大小，不能只按 prompt 字符数截断。

## 2. 目标范围与完成标准

### 2.1 必须补全的用户能力

| 能力 | 恢复内容 | 实施任务 |
| --- | --- | --- |
| 意图与安全范围 | `categorytier`、自然语言排除/替换、未知目标 fail closed | T1 |
| 商户与 ASIN | 概览、候选、产品/月度详情、多 ASIN、未匹配项、流量角度、基础追问 | T2 |
| 关键词 | 异步关键词、Tier/BLACK 范围、指标过滤、排序、歧义澄清、匹配品类 | T3 |
| 推荐 | 旧版调用场景、富结果、Top 指标、付款周期 Offer、组合排除/替换 | T4、T5 |
| 趋势 | 唯一商户实时月度、品类/Tier 全量聚合、覆盖率、估算、完整列控制 | T6、T7 |
| 媒体 | Records 过滤语义、Profile affinity/AOV/市场/信号区块与失败降级 | T8 |
| Memory 与导出 | 完整候选池、多报告选择、唯一商户计数、多工作表过滤、answerId 绑定 | T9 |
| 帮助与引导 | 首次进入、五步遮罩高亮、真实事件推进、Escape/焦点/移动端 | T10 |
| 集成验收 | 付款与 Agent 防回归、权限/取消/异步竞态、BrowserAct 与文档状态 | T11 |

基础聊天 SSE、停止、历史、逐回答反馈、日志、Deep Window 操作已有实现；本次要求这些能力在接入完整报告后继续可用，不以存在按钮或方法名作为完成标准。

### 2.2 不扩展的产品范围

不新增聊天会话列表、跨设备记忆、共享链接、定时报告、日粒度趋势、自动升降 Tier 或新模型供应商。旧版已有缺陷不作为目标行为：无匹配不能改查前 50 个商户，部分结果不能描述成全量，估算不能描述成真实月度数据。

## 3. 模块与数据合同

### 3.1 文件责任

| 操作 | 文件 | 责任 |
| --- | --- | --- |
| 修改 | frontend/src/features/chatbot/report/reportContracts.ts | 扩展富区块、快照候选来源和 Memory 查询结果合同 |
| 修改 | frontend/src/features/chatbot/report/reportQuery.ts | `categorytier`、自然语言续问、媒体别名、实体消歧和非法条件 |
| 修改 | frontend/src/features/chatbot/report/reportDataProvider.ts | 商户详情与趋势聚合请求缓存、取消、覆盖率和来源 |
| 修改 | frontend/src/features/chatbot/report/reportEngine.ts | fail-closed 调度、富结果区块、真实趋势和逐报告动作 |
| 修改 | frontend/src/features/chatbot/report/entityReports.ts | 商户、ASIN、关键词详情与候选状态 |
| 修改 | frontend/src/features/chatbot/report/recommendationReports.ts | 旧版评分调用场景、Top 指标、付款周期 Offer 和组合续问 |
| 保持并回归 | frontend/src/features/chatbot/report/paymentReports.ts | 已有付款字段、状态、月份和周期行为不得退化 |
| 修改 | frontend/src/features/chatbot/report/trendReports.ts | 唯一商户、全量品类/Tier 月度聚合与覆盖率 |
| 修改 | frontend/src/features/chatbot/report/publisherReports.ts | 动态过滤、Profile affinity 和降级状态 |
| 修改 | frontend/src/features/chatbot/report/reportSnapshots.ts、reportExport.ts | 完整候选池、多快照选择、过滤工作簿和绑定导出 |
| 修改 | frontend/src/features/chatbot/ChatbotReportBlocks.vue、ChatbotTrendReport.vue、ChatbotResultView.vue | 富实体/推荐/媒体区块和完整趋势控件 |
| 修改 | frontend/src/features/chatbot/chatbotSession.ts、chatbotViewTypes.ts | 上一报告上下文、推荐续问、answerId/snapshotId 生命周期 |
| 修改 | frontend/src/features/chatbot/ChatbotOnboarding.vue、chatbotOnboardingModel.ts、chatbot.css | 首次进入、遮罩高亮、真实事件推进和可访问性 |
| 修改 | frontend/src/entry.ts | 仅在数据提供器签名扩展时调整注入，不新增 API |
| 新增测试支持 | frontend/src/features/chatbot/report/fixtures/parityTestSupport.ts | 统一构造规范查询、报告、月度响应、会话和内存 Storage |
| 扩充测试 | frontend/src/features/chatbot/report/*.test.ts、chatbotParity.test.ts、chatbotSession.test.ts | 以生产 session 和合成数据覆盖剩余差异 |
| 更新文档 | docs/chatbot-feature-report.md、docs/chat-mode-analysis-types.md | 完成后更新当前实现路径与已验证能力 |

复用 frontend/src/features/payments/paymentModel.ts、frontend/src/features/publishers/publisherModel.ts、frontend/src/shared/export/xlsx.ts、frontend/src/shared/markdown/markdown.ts 和 frontend/src/shared/api/client.ts 的公开接口。现有 AgentTrendResult.vue 可提供 SVG 渲染参考，但不能把 Report Mode 请求交给 Agent session 执行；若抽取共同渲染代码，必须同时通过原 Agent 结果测试。

### 3.2 规范查询合同

以下为计划中的完整核心类型，落入 reportContracts.ts；现有 ChatbotIntent 扩展为同一 ReportIntent，避免维护两份不同的意图集合。

~~~ts
import type { UiLanguage } from "../../../shared/i18n";
import type { ChatbotReportResult } from "../chatbotReportModel";

export type ReportRow = Readonly<Record<string, unknown>>;
export type ReportIntent =
  | "merchant" | "asin" | "keyword" | "category" | "tier"
  | "recommendation" | "payment" | "analysis"
  | "publisher" | "publisherprofile" | "help";
export type ReportTier = "Tier 1" | "Tier 2" | "Tier 3" | "Tier 4" | "BLACK TIER";
export type ReportMetric =
  | "aov" | "epc" | "conversionRate" | "orders" | "clicks"
  | "affCommission" | "commissionRate" | "salesAmount" | "dpv" | "atc";
export type ReportOperator = ">" | ">=" | "<" | "<=" | "=";
export type PaymentStatus = "Paid" | "Pending" | "Unpaid" | "Overdue" | "Partial" | "Unknown";
export type TrendMetric = ReportMetric
  | "allEpc" | "payout" | "revenue" | "affiliatePayout"
  | "directSales" | "haloSales";
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
  readonly asins: readonly string[];
  readonly categories: readonly string[];
  readonly tiers: readonly ReportTier[];
  readonly keyword?: string;
  readonly count?: number;
  readonly metricFilters: readonly {
    readonly field: ReportMetric; readonly operator: ReportOperator; readonly value: number;
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

export interface QueryContext {
  readonly language: UiLanguage;
  readonly categories: readonly string[];
  readonly merchantCandidates?: readonly { readonly id: string; readonly name: string }[];
  readonly classification?: unknown;
  readonly previous?: {
    readonly intent?: ReportIntent | string;
    readonly merchantIds?: readonly string[];
    readonly merchantNames?: readonly string[];
    readonly category?: string;
    readonly tier?: string;
  };
  readonly now?: Date;
}
~~~

接口：resolveReportQuery(prompt: string, context: QueryContext): ReportQuery。

优先级：明确命令与上一报告的显式操作 → 有效 LLM 分类 → 本地规则。精确 ID/ASIN 作为实体信息，不能抢走“付款/分析/趋势”的明确意图。不同命令共用同一处理器，兼容菜单现有的 publisher: 文本和 /publisher 文本。服务端目前只返回七类意图，publisher/profile/keyword/help 由前端明确命令和规则解析，不虚构后端已有注册。

参数必须从服务端的 params.category、params.tier、params.asin、params.analysisTargets 等映射到对应数组，兼容旧例子中的标量写法。保留原问题中明确提供的月份、比较符、小数与单位；不得把 0.3 转为 0，或把“CVR > 2%”当作“CVR > 2”。现有 recommendation.py 将 metricFilters.value 声明为 int，前端应保留原问题中明确的小数阈值以纠正这种信息损失；若只有冲突的分类值且不能恢复原条件，返回 invalid_filter，而不猜测阈值。未知实体或非法条件不静默扩大为全量。

Publisher Records 的空过滤是合法请求：默认按 clicks 降序展示前 50 条，limit 可在 1–1000 内指定，合计按完整过滤结果计算。Publisher Profile 才要求媒体 ID 或名称；不要把 Records 的无条件列表误改成“请输入目标”。旧版 Records/Profile 未提供任意日期自然语言筛选，本次复原其原有范围，不因当前 portfolio API 支持日期参数而增加新的命令能力。

### 3.3 报告、来源、快照与动作

~~~ts
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
  | { readonly id: string; readonly kind: "metrics"; readonly title: string;
      readonly rows: readonly ReportRow[]; readonly columns: readonly ReportColumn[] }
  | { readonly id: string; readonly kind: "table"; readonly title: string;
      readonly rows: readonly ReportRow[]; readonly columns: readonly ReportColumn[] }
  | { readonly id: string; readonly kind: "notice"; readonly title: string; readonly text: string }
  | { readonly id: string; readonly kind: "trend"; readonly title: string;
      readonly rows: readonly ReportRow[]; readonly columns: readonly ReportColumn[];
      readonly metric: TrendMetric; readonly categoryOptions: readonly string[];
      readonly activeCategory: string | null; readonly visibleColumns: readonly string[] };

export interface ReportDocument extends ChatbotReportResult {
  readonly documentId: string;
  readonly request: ReportQuery;
  readonly blocks: readonly ReportBlock[];
  readonly sheets: readonly ReportSheet[];
  readonly sourceInfo: ReportSource;
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
    | "select-merchant" | "select-publisher" | "payment-month"
    | "trend-metric" | "trend-category" | "trend-columns"
    | "exclude-merchant" | "replace-merchant";
  readonly value: string | readonly string[];
}
export interface ReportDataProvider {
  offers(signal: AbortSignal): Promise<readonly ReportRow[]>;
  paymentRecords?(signal: AbortSignal): Promise<readonly ReportRow[]>;
  keywords(signal: AbortSignal): Promise<unknown>;
  merchant(merchantId: string, months: number, signal: AbortSignal): Promise<unknown>;
  search(query: string, signal: AbortSignal): Promise<unknown>;
  publishers(signal: AbortSignal): Promise<unknown>;
  publisherPortfolio(userId: string, startDate: string | null, endDate: string | null,
    signal: AbortSignal): Promise<unknown>;
}
export interface ReportEngineContext {
  readonly offers: readonly ReportRow[];
  readonly paymentRecords: readonly ReportRow[];
  readonly productKeywords: unknown;
  readonly provider: ReportDataProvider;
  readonly now: () => Date;
  readonly analyze?: (summary: Readonly<Record<string, unknown>>,
    language: UiLanguage, signal?: AbortSignal) => Promise<string | null>;
}
~~~

reportEngine.ts 输出 executeReport(query, context, signal, onUpdate?)，返回 Promise<ReportDocument>；onUpdate 为 (document: ReportDocument) => void，用于先发本地表格、后发文字或 DB 补充。applyReportAction(document, action, context, signal) 返回 Promise<ReportDocument>，通过相同模型重算。事件先按 documentId 查找报告，禁止默认操作最新回答。

ChatbotReportViewResult 增加可选 document；ChatbotMemoryItem 增加可选 reportSnapshot。Session 的 answerId、documentId、deepWindowId、snapshotId 分开管理：一份报告的多个展示位置共享 documentId，加入记忆形成固定 snapshotId，后续页面取数不改写已有快照。

表格数值用原始数值，格式在渲染/导出时应用；未知数值保留 null。数据源可以分区块说明缓存汇总与 DB 月度数据，顶层 sourceInfo 表示当前报告主来源与覆盖情况，不能用一次成功 DB 请求把所有内容标记为 DB。

### 3.4 生命周期

单次请求捕获 query、language、data revision 和 requestId。停止、切换目标、关闭正在加载的窗口时取消该请求；回包前检查 requestId 与 signal。分类失败走规则，分析文字失败保留结构化表格，DB 失败保留可用缓存并显示来源，全部无可用数据时显示不可用。

保留正在展示的上一份已完成报告，直到新报告的基础结果可用。已关闭窗口不因晚到响应重开；已完成窗口不因页面暂时卸载被清空；登出和会话销毁按现有生命周期释放数据与监听。

## 4. 实施顺序

| 阶段 | 任务 | 阶段可验收结果 |
| --- | --- | --- |
| A | T1 | 所有入口先得到规范查询；未知实体不再扩大为前 50 条 |
| B | T2 → T3 | Merchant、ASIN、Keyword 与基础追问达到旧版数据范围 |
| C | T4 → T5 | 推荐评分、富结果、Top 指标、付款周期和续问闭环 |
| D | T6 → T7 | 真实月度趋势、覆盖率、估算与完整控件闭环 |
| E | T8、T9、T10 | Publisher、Memory/View/Excel 和完整引导闭环 |
| F | T11 | 全量回归、BrowserAct、文档与验收状态一致 |

T2、T3、T8 可在 T1 合同稳定后并行；T4/T5、T6/T7、T9/T10 分别存在顺序依赖。`chatbotSession.ts`、`reportEngine.ts`、`reportContracts.ts` 和 `frontend/src/entry.ts` 由同一整合者顺序修改，避免并发覆盖。

## 5. 逐项任务

### T1：修复规范查询与未知实体 fail-closed

**Files:**
- Modify: `frontend/src/features/chatbot/report/fixtures/parityData.ts`
- Create: `frontend/src/features/chatbot/report/fixtures/parityTestSupport.ts`
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Modify: `frontend/src/features/chatbot/report/reportQuery.ts`
- Modify: `frontend/src/features/chatbot/report/entityReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Test: `frontend/src/features/chatbot/report/reportQuery.test.ts`
- Test: `frontend/src/features/chatbot/report/entityReports.test.ts`
- Test: `frontend/src/features/chatbot/chatbotParity.test.ts`

**Interfaces:**
- Consumes: `resolveReportQuery(prompt, context)`、`ReportDataProvider.search()`、当前 `ReportQuery`。
- Produces: `ReportQuery.entityQuery?: string`、`ReportQuery.listMode: boolean`；`categorytier` 规范化为 `intent: "tier"` 且同时保留 `categories` 与 `tiers`。

- [ ] **Step 1: 固定共享测试支持并写失败测试**

先给 `parityOffers` 的 1001/1002/1003 增加 `region`、`network`、`commissionRate`、`paymentCycle` 和三个月 `monthly`；再新增以下支持文件，后续任务统一导入，禁止各测试自行构造不同默认值：

~~~ts
import type { ChatbotSessionOptions } from "../../chatbotSession";
import { createChatbotSession } from "../../chatbotSession";
import type { ReportBlock, ReportDocument, ReportQuery, ReportRow } from "../reportContracts";
import { parityOffers, parityPaymentRecords } from "./parityData";

export const PARITY_TREND_COLUMNS = ["month", "value", "deltaPct"] as const;

export function makeQuery(patch: Partial<ReportQuery> = {}): ReportQuery {
  return {
    prompt: "",
    language: "zh",
    intent: "merchant",
    parsedBy: "rule",
    resolution: "resolved",
    issues: [],
    merchantIds: [],
    merchantNames: [],
    asins: [],
    categories: [],
    tiers: [],
    metricFilters: [],
    includeTier4: false,
    includeBlack: false,
    recommendCategories: false,
    tierOfferPlan: [],
    excludeMerchantIds: [],
    replaceMerchantIds: [],
    analysisTargets: [],
    publisherFilters: {
      market: null, network: null, manager: null, merchantIds: [], merchantQuery: null,
      sortKey: "clicks", limit: 50, unrecognized: []
    },
    listMode: false,
    ...patch
  };
}

export function makeReportDocument(rows: readonly ReportRow[]): ReportDocument {
  const block: ReportBlock = {
    id: "detail", kind: "table", title: "Recommendations", rows,
    columns: [{ key: "merchantId", label: "Merchant ID", format: "text" }]
  };
  return {
    intent: "recommendation",
    documentId: "report-fixed",
    request: makeQuery({ intent: "recommendation", count: rows.length }),
    blocks: [block],
    sheets: [{ name: "Recommendations", role: "detail", rows, columns: block.columns }],
    sourceInfo: { kind: "cache", asOf: "2026-09-08", estimated: false, partial: false, covered: rows.length, requested: rows.length },
    status: "resolved",
    query: "recommend",
    source: "cache",
    rows,
    summary: { offerCount: rows.length, clicks: 0, orders: 0, revenue: 0, commission: 0, conversionRate: null },
    message: "Recommendations"
  };
}

export function createParitySession(overrides: Partial<ChatbotSessionOptions> = {}) {
  return createChatbotSession({
    offers: parityOffers,
    paymentRecords: parityPaymentRecords,
    language: "zh",
    llmEnabled: false,
    enableQuestionLogging: false,
    ...overrides
  });
}

export function monthlyPayload(merchantId: string) {
  return {
    merchant: { merchantId },
    monthlyAmazonMetrics: [
      { month: "2026-06", clicks: 100, orders: 5, revenue: 500, affiliatePayout: 25 },
      { month: "2026-07", clicks: 120, orders: 6, revenue: 660, affiliatePayout: 30 },
      { month: "2026-08", clicks: 140, orders: 7, revenue: 840, affiliatePayout: 42 }
    ],
    monthlyAggregateMetrics: []
  };
}

export function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, value); }
  };
}
~~~

~~~ts
it("解析 categorytier，并拒绝把未知商户扩大成默认列表", async () => {
  const combined = resolveReportQuery("/categorytier: Electronics Tier 2", {
    language: "zh", categories: ["Electronics"]
  });
  expect(combined).toMatchObject({ intent: "tier", categories: ["Electronics"], tiers: ["Tier 2"] });

  const search = vi.fn(async () => ({ rows: [] }));
  const session = createChatbotSession({
    offers: parityOffers,
    reportProvider: createReportDataProvider({ offers: parityOffers, loadSearch: search }),
    language: "zh", llmEnabled: false, enableQuestionLogging: false
  });
  const result = await session.submit("Unknown Merchant Brand");
  expect(result.report?.rows).toEqual([]);
  expect(result.report?.status).toBe("not_found");
  expect(search).toHaveBeenCalledWith("Unknown Merchant Brand", expect.any(AbortSignal));
  session.dispose?.();
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotParity.test.ts`

Expected: `categorytier` 未被明确解析，或未知商户仍返回前 50 条。

- [ ] **Step 3: 实现最小修复**

~~~ts
export interface ReportQuery {
  readonly entityQuery?: string;
  readonly listMode: boolean;
}

function merchantText(prompt: string): string {
  return prompt
    .replace(/^\s*\/?merchant\s*[:：]?/i, "")
    .replace(/^(?:查询|查看|显示|分析)?\s*(?:商户|商家)\s*/i, "")
    .trim();
}

// explicitIntent() 的命令正则加入 categorytier；该命令返回 tier 处理器。
// merchant 只有空 /merchant 命令允许 listMode=true；其他未匹配文本进入 entityQuery。
const listMode = intent === "merchant" && explicit.command && !merchantText(prompt);
const entityQuery = intent === "merchant" && !merchantIds.length && !merchantNames.length
  ? merchantText(prompt)
  : undefined;
~~~

`buildEntityReport()` 仅在 `query.listMode` 时返回默认列表；`query.entityQuery` 存在时先本地匹配，零行后由 `reportEngine.ts` 调用 `provider.search()`。搜索仍无结果时保持 `not_found`，不能调用无条件列表分支。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotParity.test.ts`

Expected: 目标测试全部通过，`Tier 2 未付款` 仍为 payment，`分析 Tier 2` 仍为 analysis。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/fixtures/parityData.ts frontend/src/features/chatbot/report/fixtures/parityTestSupport.ts frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/report/reportQuery.ts frontend/src/features/chatbot/report/entityReports.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/report/reportQuery.test.ts frontend/src/features/chatbot/report/entityReports.test.ts frontend/src/features/chatbot/chatbotParity.test.ts
git commit -m "Fail closed on unresolved chatbot entities / 未解析实体查询安全失败"
~~~

### T2：恢复 Merchant 与 ASIN 富结果和基础追问

**Files:**
- Modify: `frontend/src/features/chatbot/report/entityReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Modify: `frontend/src/features/chatbot/chatbotSession.ts`
- Modify: `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- Test: `frontend/src/features/chatbot/report/entityReports.test.ts`
- Test: `frontend/src/features/chatbot/chatbotSession.test.ts`

**Interfaces:**
- Consumes: T1 的 `entityQuery/listMode`、`provider.merchant()`、`ReportBlock`。
- Produces: `buildMerchantBlocks(rows, language)`、`buildAsinBlocks(rows, unmatched, language)`；唯一商户报告在 `PreviousReportContext` 中保存 ID。

- [ ] **Step 1: 写失败测试**

~~~ts
it("输出商户概览、产品、月度详情和 ASIN 流量角度", async () => {
  const merchant = buildEntityReport(makeQuery({ intent: "merchant", merchantIds: ["1001"] }), parityOffers, {}, "zh");
  expect(merchant.rows[0]).toMatchObject({
    merchantId: "1001", region: "US", paymentCycle: 30, commissionRate: 0.05
  });
  const asin = buildEntityReport(makeQuery({ intent: "asin", asins: ["B000000001", "B999999999"] }), parityOffers, {}, "zh");
  expect(asin.unmatched).toEqual(["B999999999"]);
  expect(asin.rows[0]).toMatchObject({ matchedAsins: ["B000000001"] });
});
~~~

在 session 测试中先查询 `Alpha Audio`，再提交 `EPC 呢`、`AOV 呢`、`订单呢`、`付款呢`；四次结果必须绑定 `merchantId=1001`。多商户结果后追问必须返回 `needs_input`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 通用表缺少概览/月度/流量区块，或追问未绑定唯一商户。

- [ ] **Step 3: 实现最小富结果**

~~~ts
export function merchantOverviewColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" },
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
    { key: "network", label: language === "zh" ? "网络" : "Network", format: "text" },
    { key: "region", label: language === "zh" ? "地区" : "Region", format: "text" },
    { key: "tier", label: "Tier", format: "text" },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "commissionRate", label: language === "zh" ? "佣金率" : "Commission rate", format: "percentage" },
    { key: "paymentCycle", label: language === "zh" ? "付款周期" : "Payment cycle", format: "integer" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "epc", label: "EPC", format: "decimal" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" }
  ];
}

export function asinTrafficAngle(row: ReportRow, language: UiLanguage): string | null {
  const hasAsin = Array.isArray(row.matchedAsins) && row.matchedAsins.length > 0;
  if (!hasAsin) return null;
  return language === "zh" ? "优先使用高意图 ASIN 流量" : "Prioritize high-intent ASIN traffic";
}
~~~

`reportEngine.ts` 为 merchant 产生 Overview、Products、Monthly 三个区块，为 ASIN 产生 Mapping、Merchant Overview、Unmatched 和 Traffic Angle 区块；文本字段由 Vue 转义。session 仅从唯一成功 Merchant/ASIN 报告更新上一商户上下文，`clearConversation()` 清除该上下文。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotSession.test.ts src/features/chatbot/ChatbotReportBlocks.test.ts`

Expected: 目标测试全部通过，零值不被显示成不可用。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/entityReports.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/chatbotSession.ts frontend/src/features/chatbot/ChatbotReportBlocks.vue frontend/src/features/chatbot/report/entityReports.test.ts frontend/src/features/chatbot/chatbotSession.test.ts
git commit -m "Restore merchant and ASIN report detail / 恢复商户和ASIN报告明细"
~~~

### T3：恢复 Keyword 范围、筛选、排序和澄清

**Files:**
- Modify: `frontend/src/features/chatbot/report/entityReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/report/reportQuery.ts`
- Test: `frontend/src/features/chatbot/report/entityReports.test.ts`
- Test: `frontend/src/features/chatbot/chatbotParity.test.ts`

**Interfaces:**
- Consumes: `query.keyword`、`query.tiers`、`includeTier4/includeBlack`、`metricFilters/metricSort`、异步 keywords provider。
- Produces: `KeywordReportPayload` 的 `matchedCategories`、`needsClarification` 和完整排序结果。

- [ ] **Step 1: 写失败测试**

~~~ts
it("关键词查询应用 Tier、指标和排序，并澄清 audio", () => {
  const filtered = buildEntityReport(makeQuery({ intent: "keyword", keyword: "headphones",
    tiers: ["Tier 2"], metricFilters: [{ field: "aov", operator: ">", value: 100 }],
    metricSort: { field: "epc", direction: "desc" }
  }), parityOffers, { rows: [{ merchantId: "1001", productKeywords: ["headphones"] }] }, "zh");
  expect(filtered.rows.map((row) => row.merchantId)).toEqual(["1003"]);
  expect(filtered.matchedCategories).toEqual(["Electronics"]);

  const ambiguous = buildEntityReport(makeQuery({ intent: "keyword", keyword: "audio" }), parityOffers, {}, "zh");
  expect(ambiguous.status).toBe("needs_input");
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotParity.test.ts`

Expected: 当前关键词结果仍包含不满足 Tier/指标的行，`audio` 没有澄清状态。

- [ ] **Step 3: 实现最小修复**

~~~ts
function keywordNeedsClarification(keyword: string): boolean {
  return normalizeChatbotText(keyword) === "audio";
}

function keywordRows(query: ReportQuery, offers: readonly ReportRow[]): ReportRow[] {
  return offers
    .filter((row) => matchesKeyword(row, query.keyword || ""))
    .filter((row) => !query.tiers.length || query.tiers.includes(rowTier(row) as ReportTier))
    .filter((row) => query.includeTier4 || rowTier(row) !== "Tier 4")
    .filter((row) => query.includeBlack || rowTier(row) !== "BLACK TIER")
    .filter((row) => metricFilterMatches(row, query.metricFilters))
    .sort((left, right) => compareRecommendationOffers(left, right, query));
}
~~~

合并 keyword catalog 后按 `merchantId + keyword/productName/asin` 去重；报告增加匹配品类提示和完整导出 sheet。澄清响应固定为 headphones/earbuds/audio 与全部 electronics 两个选择，不自动扩大范围。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotParity.test.ts src/features/chatbot/report/reportExport.test.ts`

Expected: 目标测试全部通过，晚到 keywords 仍只加载一次。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/entityReports.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/report/reportQuery.ts frontend/src/features/chatbot/report/entityReports.test.ts frontend/src/features/chatbot/chatbotParity.test.ts
git commit -m "Restore scoped keyword reports / 恢复带范围条件的关键词报告"
~~~

### T4：恢复推荐规则与富结果展示

**Files:**
- Modify: `frontend/src/features/chatbot/report/recommendationReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- Test: `frontend/src/features/chatbot/report/recommendationReports.test.ts`
- Test: `frontend/src/features/chatbot/ChatbotReportBlocks.test.ts`

**Interfaces:**
- Consumes: 固定旧提交 `1a7a6ce` 中 `tierPriority`、`tier2PublisherStrategy`、`recommendationScore`、`compareRecommendationOffers`、`rankedRecommendations`、`categoryRankingScore`。
- Produces: 保持默认 comparator 与评分分离的候选行；每行可见 `recommendationReason`、`trafficAngle`、`recommendationScore`。

- [ ] **Step 1: 写失败测试**

~~~ts
it("保持旧版排序并展示推荐依据和流量角度", () => {
  const report = buildRecommendationReport(makeQuery({ intent: "recommendation", count: 2 }), parityOffers, "zh");
  expect(report.rows.map((row) => row.merchantId)).toEqual(["1001", "1003"]);
  expect(report.rows[0]).toMatchObject({
    recommendationReason: expect.stringContaining("EPC"),
    trafficAngle: expect.any(String)
  });
  expect(recommendationColumns("zh").map((column) => column.key)).toEqual(expect.arrayContaining([
    "recommendationReason", "trafficAngle"
  ]));
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/recommendationReports.test.ts src/features/chatbot/ChatbotReportBlocks.test.ts`

Expected: 数据中虽有依据字段，实际报告 columns 未包含这两个字段；旧版策略 fixture 至少一项排序不一致。

- [ ] **Step 3: 移植固定规则并接入列**

Run: `git show 1a7a6ce:public/app.js`

Run: `git show 1a7a6ce:public/tier2_recommendation_rules.js`

只移植上述六个纯规则及其直接依赖，不恢复 DOM/IIFE。保留当前已验证的默认顺序：`salesAmount → orders → conversionRate → aov → epc → tier → affCommission → clicks → name`；显式 `metricSort` 仍先比较 Tier，再比较目标指标。

~~~ts
export function recommendationColumns(language: UiLanguage): readonly ReportColumn[] {
  return [
    { key: "merchantId", label: language === "zh" ? "商户 ID" : "Merchant ID", format: "text" },
    { key: "merchantName", label: language === "zh" ? "商户" : "Merchant", format: "text" },
    { key: "tier", label: "Tier", format: "text" },
    { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
    { key: "epc", label: "EPC", format: "decimal" },
    { key: "aov", label: "AOV", format: "money" },
    { key: "conversionRate", label: "CVR", format: "percentage" },
    { key: "orders", label: language === "zh" ? "订单" : "Orders", format: "integer" },
    { key: "salesAmount", label: language === "zh" ? "销售额" : "Revenue", format: "money" },
    { key: "recommendationScore", label: language === "zh" ? "推荐分" : "Score", format: "decimal" },
    { key: "recommendationReason", label: language === "zh" ? "推荐依据" : "Reason", format: "text" },
    { key: "trafficAngle", label: language === "zh" ? "流量建议" : "Traffic angle", format: "text" }
  ];
}
~~~

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/recommendationReports.test.ts src/features/chatbot/ChatbotReportBlocks.test.ts`

Expected: 默认、显式指标、品类排行、Tier 2 optimization-only、付款风险和 Google/Publisher 场景均与固定 fixture 一致。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/recommendationReports.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/ChatbotReportBlocks.vue frontend/src/features/chatbot/report/recommendationReports.test.ts frontend/src/features/chatbot/ChatbotReportBlocks.test.ts
git commit -m "Restore recommendation parity and rationale / 恢复推荐规则和推荐依据"
~~~

### T5：恢复推荐续问、Top 指标与付款周期 Offer

**Files:**
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Modify: `frontend/src/features/chatbot/report/reportQuery.ts`
- Modify: `frontend/src/features/chatbot/report/recommendationReports.ts`
- Modify: `frontend/src/features/chatbot/chatbotSession.ts`
- Test: `frontend/src/features/chatbot/report/reportQuery.test.ts`
- Test: `frontend/src/features/chatbot/report/recommendationReports.test.ts`
- Test: `frontend/src/features/chatbot/chatbotSession.test.ts`

**Interfaces:**
- Consumes: T4 的完整候选池和上一推荐 `ReportDocument`。
- Produces: `ReportQuery.recommendationMode`，取值 `default | top-metric | payment-cycle | continuation`；续问通过明确 merchant ID 修改上一查询。

- [ ] **Step 1: 写失败测试**

~~~ts
it("排除和替换继承上一推荐条件", async () => {
  const session = createParitySession();
  const first = await session.submit("Electronics 中 Tier 1、Tier 2 各推荐 1 个");
  const excluded = await session.submit(`排除 ${first.report?.rows[0]?.merchantId}`);
  expect(excluded.report?.request.tierOfferPlan).toEqual([
    { tier: "Tier 1", count: 1 }, { tier: "Tier 2", count: 1 }
  ]);
  expect(excluded.report?.rows.some((row) => row.merchantId === first.report?.rows[0]?.merchantId)).toBe(false);

  const top = await session.submit("Top 2 AOV offers");
  expect(top.report?.rows.map((row) => row.merchantId)).toEqual(["1003", "1001"]);
  session.dispose?.();
});
~~~

~~~ts
const cycle = await session.submit("付款周期大于 30 天的 offers");
expect(cycle.intent).toBe("recommendation");
expect(cycle.report?.request.recommendationMode).toBe("payment-cycle");
expect(cycle.report?.rows.every((row) => Number(row.paymentCycle) > 30)).toBe(true);
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/recommendationReports.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 排除/替换没有继承条件，Top 指标被 Tier 优先级改变全局顺序，或付款周期进入 payment records。

- [ ] **Step 3: 实现续问和专用模式**

~~~ts
export type RecommendationMode = "default" | "top-metric" | "payment-cycle" | "continuation";

function merchantIdsMentionedIn(prompt: string, rows: readonly ReportRow[]): string[] {
  const normalized = normalizeChatbotText(prompt);
  return rows.flatMap((row) => {
    const id = rowMerchantId(row);
    const name = normalizeChatbotText(rowMerchantName(row));
    return id && (normalized.includes(id) || name && normalized.includes(name)) ? [id] : [];
  }).filter((id, index, values) => values.indexOf(id) === index);
}

function continuationQuery(prompt: string, previous: ReportDocument): ReportQuery | null {
  if (previous.intent !== "recommendation") return null;
  const ids = merchantIdsMentionedIn(prompt, previous.rows);
  if (/排除|不要|移除|exclude|remove|skip/i.test(prompt) && ids.length) {
    return { ...previous.request, recommendationMode: "continuation", excludeMerchantIds: ids };
  }
  if (/替换|换一个|replace|swap|another/i.test(prompt) && ids.length) {
    return { ...previous.request, recommendationMode: "continuation", replaceMerchantIds: ids };
  }
  return null;
}
~~~

`top-metric` 全局按指定指标降序，再使用 conversion/Tier/name 兜底；`payment-cycle` 从 offers 的周期字段筛选。两者输出独立标题、条件说明和完整 Excel，不借用付款记录的状态汇总。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/recommendationReports.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 排除后不跨 Tier 补数；无可替换项明确显示缺口；Top AOV/EPC/Commission 和付款周期结果符合 fixture。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/report/reportQuery.ts frontend/src/features/chatbot/report/recommendationReports.ts frontend/src/features/chatbot/chatbotSession.ts frontend/src/features/chatbot/report/reportQuery.test.ts frontend/src/features/chatbot/report/recommendationReports.test.ts frontend/src/features/chatbot/chatbotSession.test.ts
git commit -m "Restore recommendation follow-ups and offer filters / 恢复推荐续问和Offer筛选"
~~~

### T6：恢复真实月度趋势和覆盖率

**Files:**
- Modify: `frontend/src/features/chatbot/report/reportDataProvider.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/report/trendReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Test: `frontend/src/features/chatbot/report/reportDataProvider.test.ts`
- Test: `frontend/src/features/chatbot/report/trendReports.test.ts`
- Test: `frontend/src/features/chatbot/chatbotSession.test.ts`

**Interfaces:**
- Consumes: `provider.merchant(merchantId, months, signal)`、唯一商户解析、月度归一化。
- Produces: `loadTrendSources(query, offers, provider, signal)`，返回 `{ rows, source, covered, requested, partial }`。

- [ ] **Step 1: 写失败测试**

~~~ts
it("命名商户趋势加载真实月度，品类趋势记录覆盖率", async () => {
  const merchant = vi.fn(async (id: string) => monthlyPayload(id));
  const session = createParitySession({
    reportProvider: createReportDataProvider({ offers: parityOffers, loadMerchant: merchant })
  });
  const result = await session.submit("Alpha Audio 近 3 个月 EPC 趋势");
  expect(merchant).toHaveBeenCalledWith("1001", 3, expect.any(AbortSignal));
  expect(result.report?.sourceInfo).toMatchObject({ kind: "db", estimated: false, covered: 1, requested: 1 });
  session.dispose?.();
});
~~~

品类 fixture 让两个商户成功、一个失败，断言 `covered=2`、`requested=3`、`partial=true`。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportDataProvider.test.ts src/features/chatbot/report/trendReports.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 命名商户未转换为 ID，或来源仍为 cache/estimated；品类趋势没有覆盖率。

- [ ] **Step 3: 实现有界并发聚合**

~~~ts
export interface TrendSources {
  readonly rows: readonly ReportRow[];
  readonly kind: ReportSource["kind"];
  readonly covered: number;
  readonly requested: number;
  readonly partial: boolean;
}

function uniqueMerchantIds(rows: readonly ReportRow[]): string[] {
  return Array.from(new Set(rows.map((row) => rowMerchantId(row)).filter(Boolean)));
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>
): Promise<readonly ({ readonly ok: true; readonly value: R } | { readonly ok: false })[]> {
  const results: ({ ok: true; value: R } | { ok: false })[] = new Array(values.length);
  let cursor = 0;
  async function run(): Promise<void> {
    while (cursor < values.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(values[index]!) }; }
      catch { results[index] = { ok: false }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

export async function loadTrendSources(
  query: ReportQuery,
  offers: readonly ReportRow[],
  provider: ReportDataProvider,
  signal: AbortSignal
): Promise<TrendSources> {
  const merchantIds = uniqueMerchantIds(selectedRows(query, offers));
  const settled = await mapWithConcurrency(merchantIds, 6, (id) => provider.merchant(id, query.months || 3, signal));
  const rows = settled.flatMap((item) => item.ok ? mergeMerchantMonths(item.value) : []);
  const covered = settled.filter((item) => item.ok).length;
  return { rows, kind: covered ? "db" : "cache", covered, requested: merchantIds.length, partial: covered < merchantIds.length };
}
~~~

`mapWithConcurrency` 在 25 秒总预算或 `signal.aborted` 后停止派发；比率字段按分子/分母重算。只有存在有效缓存汇总时才估算，并明确 `estimated=true`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportDataProvider.test.ts src/features/chatbot/report/trendReports.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 商户、品类、Tier 的真实/部分/估算/不可用四种状态均通过。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/reportDataProvider.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/report/trendReports.ts frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/report/reportDataProvider.test.ts frontend/src/features/chatbot/report/trendReports.test.ts frontend/src/features/chatbot/chatbotSession.test.ts
git commit -m "Restore database-backed chatbot trends / 恢复数据库月度趋势"
~~~

### T7：补全趋势 Tier 语义和列控件

**Files:**
- Modify: `frontend/src/features/chatbot/report/trendReports.ts`
- Modify: `frontend/src/features/chatbot/ChatbotTrendReport.vue`
- Modify: `frontend/src/features/chatbot/DeepWindow.vue`
- Modify: `frontend/src/features/chatbot/deepWindowStore.ts`
- Test: `frontend/src/features/chatbot/ChatbotTrendReport.test.ts`
- Test: `frontend/src/features/chatbot/DeepWindow.test.ts`
- Test: `frontend/src/features/chatbot/deepWindowStore.test.ts`

**Interfaces:**
- Consumes: T6 的趋势 `ReportDocument` 与 `applyReportAction()`。
- Produces: `trend-columns` 动作携带精确列数组；主报告与 Deep Window 共用列选择语义。

- [ ] **Step 1: 写失败测试**

~~~ts
it("显式 Tier 4 品类趋势可见，并支持默认、全部和逐列选择", async () => {
  const payload = buildTrendReport(makeQuery({
    prompt: "Electronics Tier 4 trend", intent: "analysis", analysisType: "trend",
    categories: ["Electronics"], tiers: ["Tier 4"]
  }), parityOffers, "zh");
  expect(payload.status).toBe("resolved");
  const wrapper = mount(ChatbotTrendReport, { props: { language: "zh", block: {
    id: "trend", kind: "trend", title: payload.title, rows: payload.rows,
    columns: PARITY_TREND_COLUMNS.map((key) => ({ key, label: key, format: key === "month" ? "text" : "decimal" })),
    metric: payload.metric, categoryOptions: payload.categoryOptions,
    activeCategory: payload.activeCategory, visibleColumns: [...PARITY_TREND_COLUMNS]
  } } });
  await wrapper.get("[data-trend-column-all]").trigger("click");
  expect(wrapper.emitted("interact")?.at(-1)?.[0]).toBe("trend-columns");
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/ChatbotTrendReport.test.ts src/features/chatbot/DeepWindow.test.ts src/features/chatbot/deepWindowStore.test.ts`

Expected: Tier 4 被品类过滤排除，或主报告只有单个循环按钮。

- [ ] **Step 3: 实现显式 Tier 优先和列面板**

~~~ts
function excludeRiskTier(query: ReportQuery, row: ReportRow): boolean {
  const current = rowTier(row);
  if (query.tiers.includes(current as ReportTier)) return false;
  return query.categories.length > 0 && (current === "Tier 4" || current === "BLACK TIER");
}

const CORE_TREND_COLUMNS = ["month", "value", "deltaPct"] as const;
const ALL_TREND_COLUMNS = [
  "month", "value", "deltaPct", "salesAmount", "orders", "epc", "aov", "clicks",
  "affiliatePayout", "dpv", "atc", "conversionRate", "payout", "directSales", "haloSales"
] as const;
~~~

Vue 面板渲染 Default、All 和每列 checkbox；每次操作发送完整列数组，`reportEngine.ts` 同步更新 block 与对应 sheet，窗口之间按 documentId 隔离。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/ChatbotTrendReport.test.ts src/features/chatbot/DeepWindow.test.ts src/features/chatbot/deepWindowStore.test.ts src/features/chatbot/report/trendReports.test.ts`

Expected: 两种视图的指标、品类、列和导出一致，两个窗口互不串扰。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/trendReports.ts frontend/src/features/chatbot/ChatbotTrendReport.vue frontend/src/features/chatbot/DeepWindow.vue frontend/src/features/chatbot/deepWindowStore.ts frontend/src/features/chatbot/ChatbotTrendReport.test.ts frontend/src/features/chatbot/DeepWindow.test.ts frontend/src/features/chatbot/deepWindowStore.test.ts
git commit -m "Complete chatbot trend controls / 补全Chatbot趋势控件"
~~~

### T8：恢复 Publisher 过滤语义和富画像

**Files:**
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Modify: `frontend/src/features/chatbot/report/reportQuery.ts`
- Modify: `frontend/src/features/chatbot/report/publisherReports.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- Test: `frontend/src/features/chatbot/report/reportQuery.test.ts`
- Test: `frontend/src/features/chatbot/report/publisherReports.test.ts`

**Interfaces:**
- Consumes: `normalizePublishersPayload()`、`normalizePublisherPortfolioPayload()`、当前 publisher fixtures。
- Produces: `QueryContext.publisherMarkets/publisherNetworks`；Profile 输出 identity、KPI、category affinity、AOV bands、markets、signals、portfolio 区块。

- [ ] **Step 1: 写失败测试**

~~~ts
it("识别市场别名和动态网络并渲染画像偏好", () => {
  const query = resolveReportQuery("publisherprofile: Media One 德国 Impact", {
    language: "zh", categories: [], publisherMarkets: ["amazon.de"], publisherNetworks: ["Impact"]
  });
  expect(query.publisherFilters).toMatchObject({ market: "amazon.de", network: "Impact", unrecognized: [] });
  const profile = buildPublisherProfileReport(query, parityPublishers, {
    merchants: [{
      merchantId: "1001", merchantName: "Alpha Audio", category: "Electronics", tier: "Tier 1",
      market: "amazon.de", network: "Impact", clicks: 1000, orders: 50, sales: 5000,
      affCommission: 250, aov: 100
    }]
  }, "zh");
  expect(profile.summary).toMatchObject({ categories: expect.any(Array), aovBands: expect.any(Array), markets: expect.any(Array) });
});
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/publisherReports.test.ts`

Expected: `德国` 或 `Impact` 未被识别，Profile 只出现通用 KPI/portfolio 表。

- [ ] **Step 3: 实现别名和结构化画像区块**

~~~ts
const MARKET_ALIASES: Readonly<Record<string, string>> = {
  德国: "amazon.de", de: "amazon.de", 英国: "amazon.co.uk", uk: "amazon.co.uk",
  美国: "amazon.com", us: "amazon.com", 加拿大: "amazon.ca", ca: "amazon.ca"
};

export function publisherProfileBlocks(summary: PublisherProfileSummary, language: UiLanguage): ReportBlock[] {
  const table = (id: string, title: string, rows: readonly ReportRow[], columns: readonly ReportColumn[]): ReportBlock => ({
    id, kind: "table", title, rows, columns
  });
  return [
    { id: "publisher-kpi", kind: "metrics", title: language === "zh" ? "媒体 KPI" : "Publisher KPIs", rows: [summary.kpis], columns: [
      { key: "clicks", label: "Clicks", format: "integer" },
      { key: "orders", label: "Orders", format: "integer" },
      { key: "sales", label: "Sales", format: "money" },
      { key: "cvr", label: "CVR", format: "percentage" }
    ] },
    table("publisher-categories", language === "zh" ? "品类偏好" : "Category affinity", summary.categories, [
      { key: "category", label: language === "zh" ? "品类" : "Category", format: "text" },
      { key: "share", label: language === "zh" ? "占比" : "Share", format: "percentage" }
    ]),
    table("publisher-aov", language === "zh" ? "AOV 分布" : "AOV bands", summary.aovBands, [
      { key: "band", label: "AOV", format: "text" }, { key: "share", label: language === "zh" ? "占比" : "Share", format: "percentage" }
    ]),
    table("publisher-markets", language === "zh" ? "市场覆盖" : "Market reach", summary.markets, [
      { key: "market", label: language === "zh" ? "市场" : "Market", format: "text" }, { key: "sales", label: "Sales", format: "money" }
    ]),
    table("publisher-signals", language === "zh" ? "偏好信号" : "Preference signals", summary.signals, [
      { key: "label", label: language === "zh" ? "信号" : "Signal", format: "text" }, { key: "value", label: language === "zh" ? "值" : "Value", format: "text" }
    ])
  ];
}
~~~

动态网络只接受 payload 中真实存在的名称；剩余不可识别 token 进入 `unrecognized` 并返回明确提示。portfolio 失败时保留 identity/KPI，详情标记 unavailable。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/publisherReports.test.ts src/features/publishers/publisherModel.test.ts src/features/chatbot/ChatbotReportBlocks.test.ts`

Expected: Records 空条件仍合法；Profile 的唯一/多匹配/零匹配/portfolio 失败均符合固定状态。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/report/reportQuery.ts frontend/src/features/chatbot/report/publisherReports.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/ChatbotReportBlocks.vue frontend/src/features/chatbot/report/reportQuery.test.ts frontend/src/features/chatbot/report/publisherReports.test.ts
git commit -m "Restore publisher filters and rich profiles / 恢复媒体筛选和丰富画像"
~~~

### T9：恢复完整快照、Memory 推荐和按回答导出

**Files:**
- Modify: `frontend/src/features/chatbot/report/reportContracts.ts`
- Modify: `frontend/src/features/chatbot/report/reportSnapshots.ts`
- Modify: `frontend/src/features/chatbot/report/reportEngine.ts`
- Modify: `frontend/src/features/chatbot/report/reportExport.ts`
- Modify: `frontend/src/features/chatbot/chatbotSession.ts`
- Modify: `frontend/src/features/chatbot/deepWindowStore.ts`
- Test: `frontend/src/features/chatbot/report/reportSnapshots.test.ts`
- Test: `frontend/src/features/chatbot/report/reportExport.test.ts`
- Test: `frontend/src/features/chatbot/chatbotSession.test.ts`

**Interfaces:**
- Consumes: 结构化报告、完整推荐候选池、`answerId/documentId/snapshotId`。
- Produces: `createReportSnapshot(document, rankingOffers)` 强制显式候选池；`selectMemoryRecommendations(query, snapshots)` 支持类别、Tier、指标和排序。

- [ ] **Step 1: 写失败测试**

~~~ts
it("Memory 推荐使用完整候选池并保持旧回答导出绑定", async () => {
  const snapshot = createReportSnapshot(makeReportDocument(parityOffers.slice(0, 1)), parityOffers.slice(0, 3));
  const selected = selectMemoryRecommendations(memoryQuery({ category: "Electronics", count: 2 }), [snapshot]);
  expect(selected.selectedMerchantIds).toEqual(["1001", "1003"]);
  expect(selected.filteredSheets[0]?.rows.map((row) => row.merchantId)).toEqual(["1001", "1003"]);
});
~~~

~~~ts
expect(selectMemoryRecommendations(memoryQuery({ tier: "Tier 2", count: 2 }), [tier2SnapshotA, tier2SnapshotB]).status).toBe("ready");
expect(selectMemoryRecommendations(memoryQuery({ count: 2 }), [tier1Snapshot, categorySnapshot]).status).toBe("ambiguous");
expect(selectMemoryRecommendations(memoryQuery({ count: 1 }), [duplicateProductRowsSnapshot]).selectedMerchantIds).toHaveLength(1);

await session.openChatAnswer(oldAnswerId);
await session.submit("生成一份新报告");
session.downloadRecommendation();
expect(downloadReport).toHaveBeenCalledWith(expect.objectContaining({ snapshotId: oldSnapshotId }));
~~~

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportSnapshots.test.ts src/features/chatbot/report/reportExport.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 当前快照只含可见行、只解析数量/Tier，或旧下载回退到 currentResult。

- [ ] **Step 3: 实现完整快照和选择器**

~~~ts
export function createReportSnapshot(
  document: ReportDocument,
  rankingOffers: readonly ReportRow[]
): ReportSnapshot {
  return {
    version: 1,
    snapshotId: `snapshot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: document.documentId,
    tier: document.request.tiers[0] || null,
    request: cloneValue(document.request) as ReportQuery,
    sourceInfo: { ...document.sourceInfo },
    rows: cloneRows(document.rows),
    rankingOffers: cloneRows(rankingOffers),
    blocks: document.blocks.map(cloneBlock),
    sheets: document.sheets.map(cloneSheet)
  };
}
~~~

选择器先按显式报告引用、Tier、Category 筛出兼容快照；兼容快照合并候选并按 merchantId 去重，冲突范围返回 ambiguous。指标过滤与排序复用 recommendation 模块。导出从回答保存的 snapshot 读取，不允许 fallback 到当前报告。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/report/reportSnapshots.test.ts src/features/chatbot/report/reportExport.test.ts src/features/chatbot/chatbotSession.test.ts src/features/chatbot/deepWindowStore.test.ts src/shared/export/xlsx.test.ts`

Expected: View、回答文本、selected IDs 和 Excel 的商户集合一致；多 sheet 顺序、列和数字类型保持。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/report/reportContracts.ts frontend/src/features/chatbot/report/reportSnapshots.ts frontend/src/features/chatbot/report/reportEngine.ts frontend/src/features/chatbot/report/reportExport.ts frontend/src/features/chatbot/chatbotSession.ts frontend/src/features/chatbot/deepWindowStore.ts frontend/src/features/chatbot/report/reportSnapshots.test.ts frontend/src/features/chatbot/report/reportExport.test.ts frontend/src/features/chatbot/chatbotSession.test.ts
git commit -m "Restore report memory and bound exports / 恢复报告记忆和绑定导出"
~~~

### T10：恢复首次进入与事件驱动五步引导

**Files:**
- Modify: `frontend/src/features/chatbot/chatbotOnboardingModel.ts`
- Modify: `frontend/src/features/chatbot/ChatbotOnboarding.vue`
- Modify: `frontend/src/features/chatbot/ChatbotPage.vue`
- Modify: `frontend/src/features/chatbot/chatbotSession.ts`
- Modify: `frontend/src/features/chatbot/chatbot.css`
- Test: `frontend/src/features/chatbot/chatbotOnboardingModel.test.ts`
- Test: `frontend/src/features/chatbot/ChatbotPage.test.ts`
- Test: `frontend/src/features/chatbot/ChatbotUtilityPanels.test.ts`

**Interfaces:**
- Consumes: 当前五步 reducer、Report/Memory/Chat 真实事件和浏览器 storage。
- Produces: `shouldAutoStartOnboarding(storage)`、`OnboardingTarget` 和 Vue 遮罩/高亮状态；存储键 `oi_chatbot_onboarding_v2`。

- [ ] **Step 1: 写失败测试**

~~~ts
it("首次进入自动启动，必要步骤只能由真实事件推进", () => {
  const storage = memoryStorage();
  expect(shouldAutoStartOnboarding(storage)).toBe(true);
  let state = reduceOnboarding(createOnboardingState(true, 0), "next");
  expect(state.step).toBe(1);
  state = reduceOnboarding(state, "next");
  expect(state.step).toBe(1);
  state = reduceOnboarding(state, "report-ready");
  expect(state.step).toBe(2);
  state = reduceOnboarding(state, "memory-added");
  expect(state.step).toBe(3);
});
~~~

组件测试验证 Escape 关闭并把焦点还给启动按钮；390×844 下 popover 不超出视口。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/chatbotOnboardingModel.test.ts src/features/chatbot/ChatbotPage.test.ts src/features/chatbot/ChatbotUtilityPanels.test.ts`

Expected: 当前初始状态始终关闭，且没有遮罩、目标高亮或焦点恢复。

- [ ] **Step 3: 实现 Vue 内事件驱动引导**

~~~ts
export const ONBOARDING_STORAGE_KEY = "oi_chatbot_onboarding_v2";

export function shouldAutoStartOnboarding(storage: Storage | null): boolean {
  if (!storage) return false;
  return storage.getItem(ONBOARDING_STORAGE_KEY) !== "done";
}

export function completeOnboarding(storage: Storage | null): void {
  storage?.setItem(ONBOARDING_STORAGE_KEY, "done");
}

export type OnboardingTarget = "layout" | "report-input" | "report-result" | "add-memory" | "chat-input";
~~~

`ChatbotOnboarding.vue` 使用 Vue Teleport 渲染四块遮罩和高亮框，不恢复旧全局脚本。目标变化、窗口滚动和 resize 时重新计算位置；步骤 2 等待 `report-ready`，步骤 3 等待 `memory-added`，步骤 4 等待 `chat-submitted`。失败/停止不发送成功事件。

- [ ] **Step 4: 运行测试并确认通过**

Run: `npm --prefix frontend run test -- --run src/features/chatbot/chatbotOnboardingModel.test.ts src/features/chatbot/ChatbotPage.test.ts src/features/chatbot/ChatbotUtilityPanels.test.ts src/features/chatbot/chatbotSession.test.ts`

Expected: 首次、完成后重进、跳过、失败后重试、Escape、焦点和移动端测试全部通过。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/chatbotOnboardingModel.ts frontend/src/features/chatbot/ChatbotOnboarding.vue frontend/src/features/chatbot/ChatbotPage.vue frontend/src/features/chatbot/chatbotSession.ts frontend/src/features/chatbot/chatbot.css frontend/src/features/chatbot/chatbotOnboardingModel.test.ts frontend/src/features/chatbot/ChatbotPage.test.ts frontend/src/features/chatbot/ChatbotUtilityPanels.test.ts
git commit -m "Restore guided chatbot onboarding / 恢复Chatbot交互式新手引导"
~~~

### T11：集成回归、BrowserAct 验收和文档收口

**Files:**
- Modify: `frontend/src/features/chatbot/chatbotParity.test.ts`
- Modify: `frontend/src/features/chatbot/chatbotSession.test.ts`
- Modify: `scripts/test_m6_chatbot_agent_behavior_parity.mjs`
- Modify: `docs/chatbot-feature-report.md`
- Modify: `docs/chat-mode-analysis-types.md`
- Modify only if required: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: T1–T10 的生产 session、报告模型、组件和验收矩阵。
- Produces: A01–A40 的代码/浏览器/真实服务证据状态；不新增产品能力。

- [ ] **Step 1: 补齐真实 session 集成测试**

~~~ts
describe("Chatbot 旧版功能对齐集成", () => {
  it.each([
    ["/categorytier: Electronics Tier 2", "tier"],
    ["Tier 2 未付款", "payment"],
    ["分析 Alpha Audio", "analysis"],
    ["publisherprofile: Media One", "publisherprofile"]
  ])("%s 路由到 %s", async (prompt, intent) => {
    const session = createParitySession();
    const result = await session.submit(prompt);
    expect(result.intent).toBe(intent);
    session.dispose?.();
  });
});
~~~

测试必须从 `createChatbotSession()` 输入问题，不注入最终 UI state。覆盖 401/403/503、停止、晚到响应、旧回答 View、两窗口状态和语言切换。

- [ ] **Step 2: 运行完整代码验证**

Run: 使用第 7.2 节全部命令。

Expected: 所有命令 exit code 0；没有 skip 被误报为 pass；`git diff --check` 无输出。

- [ ] **Step 3: 执行 BrowserAct 本地验收**

使用第 7.3 节启动与清理流程，执行 A02、A07、A08、A09、A17、A18、A21、A22、A24–A39 的浏览器项。每条记录：构建 commit/worktree、语言、视口、样本来源、操作、预期、实际、截图路径。真实 DB/LLM 不可用时保留“待真实服务验收”，不能改写为通过。

- [ ] **Step 4: 更新权威文档和计划状态**

`docs/chatbot-feature-report.md` 只把已有代码与实际通过项写成当前能力；Legacy 章节继续标记历史。第 6 节矩阵逐项标记 `代码通过`、`浏览器通过`、`真实服务待验` 或 `失败`，不使用笼统“已完成”。

- [ ] **Step 5: 建立未来提交检查点**

~~~powershell
git add frontend/src/features/chatbot/chatbotParity.test.ts frontend/src/features/chatbot/chatbotSession.test.ts scripts/test_m6_chatbot_agent_behavior_parity.mjs docs/chatbot-feature-report.md docs/chat-mode-analysis-types.md docs/superpowers/plans/2026-09-08-chatbot-function-parity-restoration.md
git commit -m "Complete chatbot legacy behavior parity / 完成Chatbot旧版行为对齐"
~~~

## 6. 验收矩阵

样本中的名称和 ID 为合成数据。自动化测试固定日期，mock 的是分类/API/流式边界，执行的必须是生产 session 和报告模型。浏览器先跑固定样本或隔离缓存，再跑具备授权和配置的真实服务。

| 编号 | 输入或操作 | 可观察的通过条件 | 主要层级 |
| --- | --- | --- | --- |
| A01 | classify 返回 Tier 1、count=1 | 结果确实筛到 1001；响应参数参与路由 | session |
| A02 | /publisher、publisher:；空 /publisherprofile | 前两者显示相同默认 Records 列表；空 Profile 显示用法 | session+浏览器 |
| A03 | 分析 Tier 2；Tier 2 未付款 | 分别进入 analysis/payment，不被 tier 列表覆盖 | session |
| A04 | 多品类、多 Tier、每 Tier 各 N 个 | 条件全部保留，数量按分组计算 | 模型 |
| A05 | EPC > 0.3、CVR > 2% | 小数和比率单位正确 | 模型 |
| A06 | 分类超时/null/超请求预算 | 本地规则仍执行，输入目标不被截断误解析 | session |
| A07 | 1001、Alpha Audio | 同一商户概览，指标与产品明细完整 | session+浏览器 |
| A08 | 同名商户 | 展示候选并可选择，不自动选第一项 | session+浏览器 |
| A09 | 两个有效 ASIN 加一个未知 ASIN | 两个映射与一个未匹配项均可见 | 模型+浏览器 |
| A10 | headphones，关键词晚于页面加载 | 等待后命中关键词关联，后续可复用 | session |
| A11 | 查商户后追问 EPC/AOV/订单/付款 | 使用上一唯一商户；清空后不再沿用 | session |
| A12 | Electronics，默认设置 | 排除 Tier 4/BLACK，保持旧列表排序 | 模型 |
| A13 | 推荐品类排名 | 输出品类排行和依据，不输出普通商户查找失败 | session |
| A14 | Tier 1、Tier 2 各 1 个，再排除/替换 | 保留原条件，不跨 Tier 补足缺口 | session |
| A15 | 2026-08 未付款、四月、April、未到期 | 月份归一化与五种状态匹配正确 | 模型 |
| A16 | 付款周期大于 30 天 | 按周期数值筛选，不把条件当名称 | 模型 |
| A17 | 切付款月份并下载 | 摘要、表格、导出来自同一筛选快照 | session+浏览器 |
| A18 | 分析商户/品类/Tier | 先有结构化表，再补文字；无 LLM 仍可用 | session+浏览器 |
| A19 | 对比两个商户/品类/Tier | 两侧指标、范围和未匹配项完整 | 模型 |
| A20 | 99/100 clicks、9/10 orders | 样本门槛、百分位和亮点/短板一致 | 模型 |
| A21 | 近三个月商户/品类/Tier 趋势 | 真实月份及环比，聚合范围覆盖全部命中商户 | 模型+浏览器 |
| A22 | 趋势切指标/品类/列 | 图、表、当前报告与导出同步改变 | 浏览器 |
| A23 | 趋势部分商户失败/全部无月度 | 标记 partial/estimated/unavailable，不伪装全量真实值 | session |
| A24 | 媒体名称/ID/过滤 Records | 请求和过滤正确，显示媒体字段与 KPI | session+浏览器 |
| A25 | Profile 多匹配/唯一/portfolio 失败 | 候选可选，唯一时加载，失败保留 KPI | session+浏览器 |
| A26 | 加入同一报告两次 | 不重复 Memory；第一次自动切 Chat | session+浏览器 |
| A27 | 从单个 Tier 记忆推荐 2 家 | 候选不越出该快照，唯一 ID 计数正确 | session |
| A28 | 多报告歧义/无快照/零匹配/不足 N | 返回对应状态；只有 ready 提供 View 下载 | session |
| A29 | 重复源行、多表、隐藏列、Summary | 导出保留源行与列状态，并重算 Summary | 模型+浏览器 |
| A30 | 打开旧回答后生成新报告再下载旧 View | 仍下载旧 answerId 的快照 | session+浏览器 |
| A31 | 两个窗口拖动、最小化、恢复、置顶、clone/overlay | 位置/内容/指标互不串扰，两个方向拖动均有效 | 浏览器 |
| A32 | 无有效拖动起点直接释放指针 | 不移动窗口、不误加入 Memory | 组件+浏览器 |
| A33 | 查询中停止/关闭/换页，旧回包晚到 | 不重开窗口、不覆盖新结果、不写入成功历史 | session+浏览器 |
| A34 | 使用说明/使用流程/图片/Escape | 正文存在，语言正确，图片打开关闭和焦点正常 | session+浏览器 |
| A35 | 首次引导完整五步、跳过、重启、失败后重试 | 步骤从真实事件推进，三步进度正确，无 2/1 等编号 | 状态机+浏览器 |
| A36 | 中文/英文切换与 1440×900、390×844 | 命令、表头、示例、引导可见且可操作 | 浏览器 |
| A37 | 普通 Chat SSE、停止、失败、反馈、日志 | 已有行为保留；日志失败不阻断回答 | session+浏览器 |
| A38 | 401/403/503、登出 | 沿用权限处理，无越权数据或上一会话内容遗留 | 集成 |
| A39 | 切到独立 Agent 执行既有固定样本 | 共享结果组件/菜单修改不破坏 Agent | 现有测试+浏览器 |
| A40 | 构建产物与旧运行时检查 | 现代入口可运行，无恢复 public/app.js/legacy/依赖 | 静态+构建 |

## 7. 验证命令与本地验收

### 7.1 阶段验证

每个任务运行自己列出的目标测试，首次执行确认因目标行为缺失失败，而不是依赖缺失、语法或测试装载失败。代码不变且已通过的检查不重复刷跑。依赖已安装则直接使用；缺依赖时按锁文件执行项目现有安装命令。

### 7.2 最终代码检查

~~~powershell
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
npm run test:copilotkit
node --check public/auth.js
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_m4_shell_frontend.mjs
node scripts/test_modern_page_cutover.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
python scripts/test_agent_agui.py
python scripts/test_payment_placeholders.py
git diff --check
~~~

预期为所有适用检查通过。测试如因缺 fixture 跳过，记录具体原因与对应待验项；不能把跳过记成通过。本计划原则上不修改 Python 协议；若实施时确认必须修改某个共享 HTTP 合同，应先记录具体原因并补齐本地/Vercel 对等回归。

### 7.3 BrowserAct 本地流程

构建后由 Python 服务 public/assets/modern/。使用未占用的隔离端口；8767 为本计划示例，启动前确认空闲，不能占用或关闭他人已有服务。

~~~powershell
Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue
$env:PORT = "8767"
$env:OI_AUTH_ENABLED = "0"
$env:OI_LLM_ENABLED = "0"
$env:OI_CHATBOT_QUESTION_LOGGING = "0"
python server.py
~~~

访问 http://127.0.0.1:8767/，通过工作台 → Chatbot 进入页面。先在规则模式验证基本功能和降级；LLM 分类/流式真实链路在存在合法配置的环境单独验证，固定测试文本不携带凭据。BrowserAct 使用本任务独立会话，记录构建版本与浏览器证据路径，结束后关闭该会话。

本任务启动的服务使用 Ctrl+C 关闭，再执行以下检查确认端口已释放；若使用后台进程，停止前读取监听 PID 和进程命令确认归属。

~~~powershell
Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue
Remove-Item Env:PORT -ErrorAction SilentlyContinue
Remove-Item Env:OI_AUTH_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:OI_LLM_ENABLED -ErrorAction SilentlyContinue
Remove-Item Env:OI_CHATBOT_QUESTION_LOGGING -ErrorAction SilentlyContinue
~~~

## 8. 风险与实施决策

| 风险 | 本计划的具体处理 |
| --- | --- |
| 旧函数依赖 IIFE 状态和 DOM | 只迁移参数明确的纯逻辑；语言、数据、时钟、筛选作为输入，DOM 改为 ReportBlock |
| 文档与代码历史不一致 | 固定 1a7a6ce 行为样本，并在每项 fixture 标出来源；当前接口预算和权限以当前代码为准 |
| 推荐评分被误用作列表排序 | 分开移植 score/comparator/rankedRecommendations，用旧样本锁定每个调用场景 |
| 当前解析忽略条件导致越范围结果 | 完整规范查询；非法条件或歧义明确返回，禁止自动查全量 |
| 月度聚合慢或不完整 | 全量候选去重、最多 6 并发、缓存、25 秒预算、取消和覆盖标记 |
| 多窗口或异步回包串结果 | requestId/documentId/answerId/snapshotId 分层绑定，更新前确认归属与取消状态 |
| 记忆推荐下载与回答不一致 | 本地受控推荐固定到本轮快照，下载不依赖当前结果或 LLM 名称解析 |
| 富 HTML 增加错误渲染风险 | 结构化 Vue 区块优先；帮助/叙述仅使用现有 Markdown renderer，外部字段按文本处理 |
| 真实 LLM/DB 验收环境不可用 | 完成固定数据、代码和本地浏览器验证，单独记录受阻的真实接口案例，不能宣称全场景通过 |

## 9. 完成交付清单

- [x] G01–G12 的代码路径均有对应生产实现和行为回归；T1–T11 的代码适用项完成。
- [x] 所有 Report 路由已接入规范查询、来源、空态、错误和降级处理，菜单中的可用命令均有处理器。
- [x] 结构化报告、Context、Deep Window、Memory、View 与 Excel 使用同一份报告/快照模型。
- [x] Report Memory 推荐保持单报告范围、唯一商户计数、重复行、多工作表与 View-only 下载规则。
- [ ] 使用说明、指南和五步引导已完成代码与组件测试；实际登录 session 的浏览器验收待执行。
- [x] 普通 Chat 和独立 Agent 的已有行为通过相关回归。
- [ ] 第 6 节浏览器必验路径尚无本轮 BrowserAct 记录；代码、模拟接口与真实接口边界已在第 10 节注明。
- [x] 当前功能文档反映实际 Vue 路径与验收状态，已移除的旧 runtime 未恢复。
- [x] 本轮未启动本地服务或浏览器会话；已有工作区修改得到保留。

## 10. 执行记录（2026-09-08）

### 10.1 代码落地

- T1–T3：完成规范查询、分类参数预算、未知实体 fail-closed、Merchant/ASIN 富结果、关键词异步数据与基础追问。
- T4–T5：完成推荐评分与默认排序分离、品类/Tier 计划、排除/替换、Top 指标、付款状态/月/周期筛选和结果交互。
- T6–T7：完成商户/品类/Tier 趋势、月度聚合合并、真实值/估算值/部分覆盖标记、Tier 排除语义、指标/品类/列控件和导出同步。
- T8：完成 Publisher Records 默认筛选、排序、完整筛选汇总、Publisher Profile 候选与 portfolio 明细；HTTP 200 `ok=false` 保持不可用态。
- T9：完成结构化报告快照、重复行/多 sheet 筛选、Category Summary 重算、唯一 ID 计数和仅 `ready` 状态允许 View-only 下载。
- T10：完成五步 onboarding 状态机、真实事件推进、失败/无报告阻塞、Help/Guide/Logs、Escape 关闭和触发焦点恢复。
- T11：完成 session 级路由/远程数据/取消与旧回包隔离、Agent/AG-UI 回归以及当前文档收口。

核心实现入口为 `frontend/src/features/chatbot/report/`、`frontend/src/features/chatbot/chatbotSession.ts`、`frontend/src/features/chatbot/DeepWindow.vue`、`frontend/src/features/chatbot/deepWindowStore.ts`、`frontend/src/features/chatbot/ChatbotReportBlocks.vue`、`frontend/src/features/chatbot/ChatbotTrendReport.vue` 和 `frontend/src/features/chatbot/ChatbotOnboarding.vue`。实现沿用现有 API、认证和 M7 Vue runtime，没有恢复 `public/app.js` 或 `frontend/src/legacy/`。

### 10.2 自动化验证

以下结果均在当前工作树取得：

- `npm --prefix frontend run test -- --run src/features/chatbot`：32 个文件、116 个用例通过。
- `npm --prefix frontend run test -- --run`：84 个文件、354 个用例通过。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run build`：主现代包和 CopilotKit 独立包均构建通过。
- `npm run test:copilotkit`：6 个用例通过。
- `python scripts/test_agent_agui.py`：11 个用例通过。
- 静态入口、迁移清单、构建合同、M4/M6/M7 检查通过。
- `python scripts/test_payment_placeholders.py`：脚本退出成功，但因 `output/payment_records.json` 不存在而跳过真实付款记录集成；该项不等同于真实付款数据验收。

测试中偶发的 `ECONNREFUSED 127.0.0.1:3000` 来自问题日志测试探测的未启动本地日志服务，不影响上述测试退出码；日志失败仍按设计不阻断回答。

### 10.3 尚待真实环境验收

- 尚未用 BrowserAct 执行第 6 节 A02、A07、A08、A09、A17、A18、A21、A22、A24–A39 的登录页面交互和截图记录；本轮 CLI 启动在 `browser-act get-skills core --skill-version 2.0.2` 处返回 `uv trampoline failed to canonicalize script path`，因此不计为浏览器通过。
- 尚未在具备合法 DB、LLM、SSE 配置的环境验证远程数据、真实分类/分析、月度趋势和生产权限边界。
- 本轮未执行 commit、push、PR、merge 或部署；本地 npm 根依赖只为验证 `test:copilotkit` 安装，临时缓存已清理。
