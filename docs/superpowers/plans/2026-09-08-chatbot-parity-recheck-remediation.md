# Vue Chatbot 旧版功能对齐复核与剩余缺口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

## Goal

补齐当前 Vue Chatbot Report/Memory/Onboarding 与旧版 Chatbot 的剩余行为差异，并保持独立 Agent 的 v2 工具合同、鉴权、Trace、停止和结构化记忆不回退。

本计划针对 2026-09-08 对当前工作树的重新复核结果。旧计划 `docs/superpowers/plans/2026-09-08-chatbot-function-parity-restoration.md` 保留不改；本文件只描述复核后仍需处理的事项。

完成后，用户应能在 Vue Chatbot 中完成：

- 使用命令或自然语言表达 Category + Tier、排除和替换条件；未知商户不会被静默替换为前 50 条数据。
- 查看 Merchant、ASIN、Keyword 的旧版关键信息，包括产品、月度、流量角度、关键词范围、排序和澄清提示。
- 查看带推荐依据的推荐结果，并继续执行 Top 指标、付款周期 Offer、排除和替换。
- 查看商户、品类和 Tier 的真实月度趋势，识别覆盖不足和估算点，切换指标、品类和列后同步报告与导出。
- 查看 Publisher Records 和 Publisher Profile 的筛选、偏好、市场、AOV、信号和合作商家明细。
- 从完整报告快照中进行单报告 Memory 推荐，并从旧回答对应的 View/Excel 入口下载正确快照。
- 通过首次进入自动引导和真实事件驱动的五步流程完成 Report → Memory → Chat。

## Architecture

保留当前 Vue 的单向数据流，不恢复 `public/app.js`、`frontend/src/legacy/` 或旧运行时开关：

```text
ChatbotPage.vue
  -> chatbotSession.ts
    -> reportQuery.ts                 规范查询、上下文继承、fail-closed
    -> reportDataProvider.ts          cache/bootstrap 与同源 DB 数据
    -> reportEngine.ts                报告路由、实时补充、结构化 blocks/sheets
      -> entityReports.ts             Merchant/ASIN/Keyword/Category/Tier
      -> recommendationReports.ts     推荐候选、排序、解释、排除/替换
      -> paymentReports.ts            付款记录与付款周期
      -> analysisReports.ts           分析、样本门槛、Peer
      -> trendReports.ts              月度聚合、估算和覆盖率
      -> publisherReports.ts          Records/Profile/portfolio
      -> reportSnapshots.ts           Memory 候选快照与过滤
      -> reportExport.ts              View/Excel 同源导出
    -> ChatbotReportBlocks.vue        结构化区块与行操作
    -> ChatbotTrendReport.vue         趋势图、指标、品类、列控制
    -> DeepWindow.vue                 多窗口、拖动、最小化、加入 Memory
    -> ChatbotOnboarding.vue          首次引导与事件状态机
```

LLM 分类只提供受控参数；报告数值、实体解析、排序、状态和来源由本地结构化模型与数据提供器决定。远程数据为空或失败时保留可验证的缓存结果，无法验证时显示 `not_found`、`ambiguous`、`needs_input`、`estimated` 或 `unavailable`，不扩大全量查询。

## Tech Stack

- Vue 3、TypeScript、Vite、Vitest、Vue Test Utils
- 同源 `/api/ui/db/*` 数据接口、现有 `/api/chat/classify` 和 `/api/chat/analyze`
- 现有 `ReportDocument`、`ReportBlock`、`ReportSheet`、`ReportSnapshot` 合同
- 现有 `frontend/src/features/agent/` Agent v2 session、AG-UI、CopilotKit 和 Trace
- BrowserAct 用于真实登录页面验收；不使用 Playwright
- 现有 XLSX 导出工具，不新增导出库

## Global Constraints

- 只在当前 Vue Chatbot 链路内实现，不恢复已删除的旧运行时文件。
- 保留独立 Agent 的 7 个工具：`merchant_analysis`、`category_analysis`、`merchant_comparison`、`tier_analysis`、`category_comparison`、`payment_status`、`trend`。
- 保留 v2 `planProof`、服务端 registry、Trace 白名单、问题日志、反馈和权限边界。
- 任何商户、媒体、ASIN、关键词未匹配时，禁止退化成全量或销售额前 50 条。
- 显式 Tier 4/BLACK TIER 条件优先于默认排除；未显式选择时保持旧版默认范围。
- 估算月度值必须带 `estimated` 标识；部分覆盖必须带覆盖数量或明确说明。
- View 与 Excel 必须消费同一份报告/Memory 快照；不能从自然语言正文重新解析商户。
- 所有新增提交信息使用双语格式：`<English summary> / <中文摘要>`。本计划只定义提交检查点，不执行 commit、push、PR 或 merge。
- 保留工作树中与本任务无关的缓存、认证脚本、截图和文档修改。

## 1. 复核基线

### 1.1 当前工作树

复核时的 Git 状态：

- 分支：`codex/tier-category-visual-polish`
- `HEAD`：`a24cb9a`
- 本地 `origin/main`：`d2b021e`
- Chatbot/Report 相关修改仍在工作树中，包含已跟踪修改和未跟踪的 `frontend/src/features/chatbot/report/` 模块。
- 旧计划文件和认证/缓存/截图修改均不属于本次新计划的可覆盖范围。

### 1.2 已确认保留的能力

- `frontend/src/features/agent/agentSession.ts` 保留 7 个工具、规划证明、工具批处理、重规划、综合、停止、Trace 和结构化记忆。
- `frontend/src/features/chatbot/paymentReports.ts` 已支持付款月份、状态、Tier、品类、商户、付款周期和同一筛选结果的摘要/表格。
- `analysisReports.ts` 已有结构化分析、样本门槛、百分位、Peer 和 LLM 失败时的本地文字降级。
- `reportDataProvider.ts` 已注入 offers、keywords、merchant、search、publishers、portfolio 和 payment 数据提供器。
- `DeepWindow.vue` 与 `deepWindowStore.ts` 已保留多窗口、拖动、最小化、恢复、置顶、clone、overlay、取消和加入 Memory 的基本操作。
- Help、Guide、Logs、反馈、问题日志和基础五步 onboarding UI 已接通。

### 1.3 当前自动化证据

复核时取得以下结果：

- `npm --prefix frontend run test -- --run src/features/chatbot`：32 个文件、117 个用例通过；问题日志测试探测 `127.0.0.1:3000` 时打印连接拒绝，但不改变退出码。
- `npm --prefix frontend run test -- --run`：84 个文件、355 个用例通过。
- `npm --prefix frontend run typecheck`：通过。
- `npm --prefix frontend run build`：现代主包和独立 CopilotKit 包均构建通过。
- `npm run test:copilotkit`：6 个用例通过。
- `npm --prefix frontend run test -- --run src/features/agent`：11 个文件、43 个用例通过。
- `python scripts/test_agent_agui.py`：11 个用例通过。
- Agent v2 contract/planning/synthesis/registry Python 回归：全部通过。
- `test_frontend_migration_inventory.mjs`、`test_frontend_build_contract.mjs`、`test_m4_shell_frontend.mjs`、`test_modern_page_cutover.mjs`：全部通过。

这些结果证明当前构建和既有回归没有回退，不证明下列缺口已经完成。尚未执行真实登录、真实 DB/LLM/SSE 或 BrowserAct 页面验收。

## 2. 复核后仍存在的缺口

| 编号 | 证据 | 影响 | 优先级 |
| --- | --- | --- | --- |
| G01 | `reportQuery.ts` 的 `explicitIntent()` 没有 `categorytier`；排除/替换和付款商户名只读取结构化参数，未继承上一推荐条件 | 命令菜单与解析器行为不一致，推荐/付款续问可能落到全量结果 | P0 |
| G02 | `entityReports.ts` 在 Merchant 无 ID/名称时返回销售额前 50 条；因此 `reportEngine.ts` 不会进入远程 search | 未知商户可能展示错误数据，违反 fail-closed | P0 |
| G03 | Entity 结果统一使用 `baseColumns()`；Merchant 月度、ASIN 映射/流量角度、Keyword Tier/指标/排序和 `audio` 澄清未完整呈现 | Merchant/ASIN/Keyword 与旧版结果信息不等价 | P0 |
| G04 | 推荐行虽然生成 `recommendationReason` 与 `trafficAngle`，但 `reportEngine.ts` 的推荐表不展示；自然 Top 指标、付款周期 Offer 和推荐行操作尚未完整接入 | 推荐结果缺少解释，部分旧版入口无法使用 | P0 |
| G05 | `trendReports.ts` 的品类过滤无条件排除 Tier 4/BLACK；品类/Tier 没有按全部商户请求真实月度数据和覆盖统计 | 显式范围错误，趋势可能把缓存估算当成完整聚合 | P0 |
| G06 | `ChatbotTrendReport.vue` 只有一个“切换列”按钮；`DeepWindow.vue` 的旧列控件与现代结构化趋势 block 不完全相连 | 用户不能稳定选择核心列、全部列或单列，导出状态易失配 | P1 |
| G07 | `publisherFilters()` 只识别部分 Amazon 域名和 Levanta，`unrecognized` 固定为空；Profile 的 affinity/AOV/market/signal 数据没有独立 block，portfolio 行缺少市场与份额 | Publisher 查询和画像比旧版信息薄 | P1 |
| G08 | `createReportSnapshot()` 默认以当前可见 `document.rows` 作为候选；Memory 推荐只解析数量/Tier，多快照直接歧义，数量不足返回 `ambiguous`；下载事件使用固定 `memory-recommendation` 且依赖当前结果 | 记忆推荐范围不完整，旧回答下载可能指向新回答 | P0 |
| G09 | `chatbotOnboardingModel.ts` 只是页内面板状态，没有首次自动启动、遮罩、高亮、定位和拖入/最小化事件 | 新用户无法获得旧版引导流程 | P1 |
| G10 | 现有测试覆盖“实现了什么”，没有覆盖上述反例；`docs/chatbot-feature-report.md` 第 18 节和 `docs/chat-mode-analysis-types.md` 的部分“已完成”描述与代码不一致 | CI 绿灯不能代表行为对齐，文档会误导后续开发 | P0 |

## 3. 实施任务

### T1：统一查询解析、推荐续问与实体 fail-closed

#### 修改文件

- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/report/reportQuery.ts`
- `frontend/src/features/chatbot/report/entityReports.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportQuery.test.ts`
- `frontend/src/features/chatbot/report/entityReports.test.ts`
- `frontend/src/features/chatbot/chatbotSession.ts`
- `frontend/src/features/chatbot/chatbotParity.test.ts`

#### 实施步骤

1. 扩展 `ReportQuery` 和 `QueryContext.previous`，保存受控的上一份推荐请求、已选商户 ID、查询 Tier/Category、数量、指标筛选和排序；不保存完整回答正文或原始工具载荷。
2. 让 `explicitIntent()` 识别 `/categorytier` 和 `categorytier:`，统一映射到带 `categories` 与 `tiers` 的 `category` 查询；让 Category entity 路径实际应用 `tiers`；增加无目标 `/merchant` 的 `needs_input`。
3. 增加自然语言排除/替换解析。只接受已解析的 Merchant ID 或唯一商户名称；未知或同名目标返回 `needs_input`/`ambiguous`，不能把原文当作 ID。
4. 续问时从上一推荐请求继承 Category、Tier、数量、指标筛选、排序和 Tier plan；`excludeMerchantIds` 与 `replaceMerchantIds` 只做增量合并。
5. 为未知自然商户增加受控 `lookupText` 或等价字段。`buildEntityReport()` 没有目标时不再返回前 50 条；`runReportEngine()` 先用本地精确/唯一解析，再调用 `provider.search()`，搜索无结果才返回 `not_found`。
6. 对 Payment 请求也使用唯一商户候选解析；`Alpha Audio 未付款` 不能退化为所有未付款记录。
7. `applyReportAction()` 对排除/替换操作进行累积，并保留当前 `documentId` 的绑定检查。

#### 失败回归先行

在实现前向 `reportQuery.test.ts` 和 `chatbotParity.test.ts` 增加以下断言，确认它们在当前代码中失败：

- `/categorytier: Electronics Tier 2` 返回 `intent=category`、`categories=["Electronics"]`、`tiers=["Tier 2"]`。
- `Tier 1 推荐 2 个` 后输入“排除 Alpha Audio，换一个”，保留 Tier 1、数量和排序，并生成 `excludeMerchantIds=["1001"]` 或等价受控动作。
- 输入 `Unknown Brand` 时，实体报告不返回任何本地前 50 条；search 被调用一次，最终状态为 `not_found`。
- 相同名称的两个商户进行排除时返回候选，不自动选择第一项。
- 输入 `Alpha Audio 未付款` 时只保留 Alpha Audio 的付款记录。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/entityReports.test.ts src/features/chatbot/chatbotParity.test.ts
```

预期：新增反例测试先红；实现后全部通过，未知实体不会改变为默认全量查询。

提交检查点：`Fix chatbot query fail-closed behavior / 修复 Chatbot 查询失败关闭行为`。

### T2：恢复 Merchant、ASIN、Keyword 的富结果

#### 修改文件

- `frontend/src/features/chatbot/report/entityReports.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- `frontend/src/features/chatbot/ChatbotResultView.vue`
- `frontend/src/features/chatbot/report/entityReports.test.ts`
- `frontend/src/features/chatbot/report/reportEngine.test.ts`
- `frontend/src/features/chatbot/ChatbotResultView.test.ts`
- `frontend/src/features/chatbot/chatbotParity.test.ts`

#### 实施步骤

1. 为 Merchant 报告增加独立的概览、产品和月度 blocks；Merchant 接口的 Amazon/aggregate 月度数组经 `mergeMerchantMonths()` 合并后按月份展示，空月度显示不可用，不伪造数据。
2. 为 ASIN 报告输出每个请求 ASIN 的匹配 Merchant/产品/品类/流量字段，并保留 `unmatched` notice；多 ASIN 中部分命中时不能丢掉未匹配项。
3. 为 Keyword 报告合并 bootstrap offers 与迟到的 keyword catalog，按 Merchant ID 去重；对 Tier、Category、metricFilters、metricSort 和 Top N 在同一候选集上应用。
4. 恢复旧版 `audio` 单词澄清：明确提示 headphones/earbuds/audio 产品或全部 Electronics，用户没有补充选择时不返回宽泛结果。
5. 为产品、月度、ASIN 流量角度和关键词匹配品类建立专用列定义；空值统一使用中英文不可用文案，导出列与可见报告列使用同一 schema。

#### 失败回归先行

- Merchant fixture 具有 products 和三个月 monthly 时，报告包含产品 block 和月度 block。
- 两个有效 ASIN 加一个未知 ASIN 时，`matchedAsins` 和 `unmatched` 同时保留。
- `headphones Tier 2 EPC >= 0.12 按 EPC 降序` 只返回满足所有条件的 Keyword rows。
- `audio` 只返回澄清状态，不返回所有商户。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/entityReports.test.ts src/features/chatbot/report/reportEngine.test.ts src/features/chatbot/ChatbotResultView.test.ts src/features/chatbot/chatbotParity.test.ts
npm --prefix frontend run typecheck
```

预期：富结果测试、渲染测试和类型检查全部通过；Merchant/ASIN/Keyword 的表格与导出列一致。

提交检查点：`Restore rich merchant ASIN and keyword reports / 恢复 Merchant ASIN 与关键词富报告`。

### T3：补齐推荐解释、Top 指标、付款周期 Offer 与排除替换 UI

#### 修改文件

- `frontend/src/features/chatbot/report/reportQuery.ts`
- `frontend/src/features/chatbot/report/recommendationReports.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- `frontend/src/features/chatbot/ChatbotResultView.vue`
- `frontend/src/features/chatbot/report/recommendationReports.test.ts`
- `frontend/src/features/chatbot/report/reportQuery.test.ts`
- `frontend/src/features/chatbot/report/reportEngine.test.ts`
- `frontend/src/features/chatbot/ChatbotReportBlocks.test.ts`

#### 实施步骤

1. 让自然语言 `Top N AOV/EPC/Commission/Orders/Sales` 进入 `metricSort`，并区分 Top metric 的“字段必须可用”规则与普通推荐的综合评分。
2. 对“付款周期大于 N 天的 Offer/商户”保留 Offer 推荐路径，将 `paymentCycleFilter` 应用到 offers；带月份、状态或付款金额的请求继续进入 Payment records 路径。
3. 推荐结果表增加 `recommendationScore`、`recommendationReason`、`trafficAngle`、排名和可用信号列；不要把综合推荐分改成默认排序规则。
4. 为推荐行提供受控排除/替换操作，动作包含 `documentId`、Merchant ID 和动作类型；替换重新使用原 Tier plan/Category/metric 条件，不跨 Tier 补足。
5. 排除/替换自然语言和按钮动作共用同一个 `candidateOffers()` 路径，避免两套结果。

#### 失败回归先行

- `Top 2 AOV offers` 的排序字段为 AOV，且只保留有可用 AOV 的行。
- `payment cycle > 30 days offers` 返回 paymentCycle 满足条件的 Offer，而不是空的付款记录。
- 推荐表的 columns 包含 score、reason、trafficAngle。
- Tier 1/Tier 2 各取 1 个后排除一项，原 Tier 分组和缺口仍可见，不从其他 Tier 补数。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/recommendationReports.test.ts src/features/chatbot/report/reportQuery.test.ts src/features/chatbot/report/reportEngine.test.ts src/features/chatbot/ChatbotReportBlocks.test.ts
```

预期：推荐解释、Top 指标、付款周期和排除/替换回归全部通过，Agent 的推荐范围不受影响。

提交检查点：`Complete chatbot recommendation parity / 补齐 Chatbot 推荐行为对齐`。

### T4：恢复真实聚合趋势、Tier 语义与完整列控制

#### 修改文件

- `frontend/src/features/chatbot/report/trendReports.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportDataProvider.ts`
- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/ChatbotTrendReport.vue`
- `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- `frontend/src/features/chatbot/ChatbotReportView.vue`
- `frontend/src/features/chatbot/ChatbotChatView.vue`
- `frontend/src/features/chatbot/ChatbotPage.vue`
- `frontend/src/features/chatbot/DeepWindow.vue`
- `frontend/src/features/chatbot/report/trendReports.test.ts`
- `frontend/src/features/chatbot/report/reportEngine.test.ts`
- `frontend/src/features/chatbot/ChatbotTrendReport.test.ts`
- `frontend/src/features/chatbot/DeepWindow.test.ts`

#### 实施步骤

1. 增加受控的批量月度加载路径，按 6 个并发请求 Merchant monthly 数据，复用 `reportDataProvider` 的缓存；品类/Tier 趋势使用筛选后的全部商户，不截断前 25/50 条。
2. 合并 Amazon/aggregate 月份的可加字段；对 EPC、All EPC、AOV、CVR 使用月度加权总量计算，不对商户级比率做简单平均。
3. 修正范围逻辑：默认品类趋势排除 Tier 4/BLACK；用户明确传入 Tier 或 include 条件时纳入对应层级。
4. 为趋势结果增加 `requestedEntities`、`coveredEntities`、`partial`、`estimated` 和数据来源说明；缺失商户不能被描述成完整真实聚合。
5. 统一主报告和 Deep Window 的趋势操作合同，支持核心列、全部列和逐列选择；操作后同时更新 block、sheet、View 和 Excel。
6. 指标或品类切换沿用当前 `documentId` 与 revision 保护；旧回包不能覆盖新报告或旧窗口。

#### 失败回归先行

- 明确请求 Tier 4 品类趋势时保留 Tier 4；无显式 Tier 的同一品类仍排除 Tier 4/BLACK。
- 三个商户中一个月度接口失败时，结果标记 partial，covered 不等于 requested，不能标记为完整真实趋势。
- 多商户 monthly 的 Revenue/Clicks/Orders 聚合后，EPC、AOV、CVR 使用总量公式。
- 主报告和 Deep Window 的 core/all/逐列选择同步 `visibleColumns` 与导出 sheet。
- 取消或切换指标后，晚到的旧请求不改变当前 document。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/trendReports.test.ts src/features/chatbot/report/reportEngine.test.ts src/features/chatbot/ChatbotTrendReport.test.ts src/features/chatbot/DeepWindow.test.ts
npm --prefix frontend run typecheck
```

预期：真实月度、部分覆盖、Tier 范围、列控制和取消竞态全部通过。

提交检查点：`Restore aggregated trend coverage and controls / 恢复趋势聚合覆盖与列控制`。

### T5：恢复 Publisher Records/Profile 的查询与画像区块

#### 修改文件

- `frontend/src/features/chatbot/report/reportQuery.ts`
- `frontend/src/features/chatbot/report/publisherReports.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/ChatbotReportBlocks.vue`
- `frontend/src/features/chatbot/report/publisherReports.test.ts`
- `frontend/src/features/chatbot/report/reportEngine.test.ts`
- `frontend/src/features/chatbot/chatbotParity.test.ts`

#### 实施步骤

1. 解析完整 Amazon 市场、常用市场别名、网络、经理、Merchant ID/name、排序字段和 limit；无法识别的筛选词进入 `unrecognized` 并在报告中提示。
2. 根据已加载的 Publishers payload 对网络和市场做二次规范化，避免把固定的 Levanta 列表当成所有网络。
3. Records 保持“前 N 行展示、全筛选集合汇总”，并确保空过滤默认按 Clicks 降序。
4. Profile 增加独立的 KPI、Category affinity、AOV bands、market reach、commission/signal 和 portfolio blocks；唯一媒体 portfolio 失败时保留媒体 KPI 并显示降级提示。
5. Portfolio 行补齐 network/market、AOV、EPC、CVR、佣金率、订单、Sales、AFF Commission 和 Sales share，并按 Sales 降序。
6. 保留当前 `publisherModel.ts` 的 Affiliate Commission 既有口径；本任务不擅自修改业务公式。

#### 失败回归先行

- `US/美国/Amazon.com`、`UK/Amazon.co.uk` 等市场别名映射到同一规范市场。
- 未识别的网络或筛选词出现在 `unrecognized`，不静默丢弃。
- 空 Records 结果前 2 行按 Clicks 降序，汇总使用全部匹配记录。
- 唯一 Profile 的 portfolio payload 包含 affinity、AOV band、market 和 share blocks。
- portfolio 失败时状态仍保留 KPI，rows 为空且有不可用说明。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/publisherReports.test.ts src/features/chatbot/report/reportEngine.test.ts src/features/chatbot/chatbotParity.test.ts
```

预期：Records/Profile 数据、筛选、排序、画像和降级回归全部通过。

提交检查点：`Restore publisher records and profile parity / 恢复 Publisher Records 与 Profile 对齐`。

### T6：修复完整报告快照、Memory 推荐与 answerId 导出绑定

#### 修改文件

- `frontend/src/features/chatbot/report/reportContracts.ts`
- `frontend/src/features/chatbot/report/reportEngine.ts`
- `frontend/src/features/chatbot/report/reportSnapshots.ts`
- `frontend/src/features/chatbot/report/reportExport.ts`
- `frontend/src/features/chatbot/chatbotSession.ts`
- `frontend/src/features/chatbot/chatbotTypes.ts`
- `frontend/src/features/chatbot/chatbotViewTypes.ts`
- `frontend/src/features/chatbot/ChatbotResultView.vue`
- `frontend/src/features/chatbot/ChatbotReportView.vue`
- `frontend/src/features/chatbot/DeepWindow.vue`
- `frontend/src/features/chatbot/report/reportSnapshots.test.ts`
- `frontend/src/features/chatbot/report/reportExport.test.ts`
- `frontend/src/features/chatbot/chatbotSession.test.ts`
- `frontend/src/features/chatbot/ChatbotResultView.test.ts`

#### 实施步骤

1. 在 `ReportDocument` 中保存非展示用的完整 `rankingOffers`/candidate pool；推荐、Tier、Category 报告创建 snapshot 时使用完整候选，而不是只使用当前可见 Top rows。
2. Memory item 保存原始 `ReportSnapshot` 引用或等价深拷贝，不能在每次 Chat 提问时从可见结果重新创建新 snapshot。
3. Memory 推荐解析 Category、Tier、指标筛选、排序和数量，先按明确条件唯一选择一个报告，再在该快照内按唯一 Merchant ID 分组；不跨报告合并。
4. 无匹配返回 `empty`，多报告无法消歧返回 `ambiguous`，无快照返回 `unavailable`；匹配不足仍返回 `ready + partial=true`，只在 `ready` 注册 View-only 下载。
5. 下载 artifact 绑定 `answerId`/`documentId`，`ChatbotResultView`、Deep Window 和旧回答重新打开时传递对应 ID；不能使用固定的 `memory-recommendation` 去读取当前结果。
6. `filterReportSnapshot()` 保留重复源行、工作表顺序、隐藏列状态和 Category Summary 重算；Notes 中记录 source/asOf/estimated/partial/covered/requested。

#### 失败回归先行

- 推荐报告有 100 个候选但只展示前 5 个时，Memory 推荐仍能从 100 个候选中选取。
- 两份 Memory 报告中只有一份匹配明确 Tier 时，自动选中该快照；无明确条件时返回 ambiguous。
- 请求 5 个但只命中 2 个时返回 `ready`、`partial=true`，View 下载仍可用。
- 生成回答 A 后再生成回答 B，打开 A 的 View/Deep Window 点击下载时使用 A 的 snapshot。
- 重复源行、多 sheet、隐藏列和 Category Summary 过滤后的 rows 与摘要正确。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/report/reportSnapshots.test.ts src/features/chatbot/report/reportExport.test.ts src/features/chatbot/chatbotSession.test.ts src/features/chatbot/ChatbotResultView.test.ts
```

预期：候选范围、报告消歧、partial 下载和旧回答导出绑定全部通过。

提交检查点：`Bind chatbot memory exports to report snapshots / 将 Chatbot Memory 导出绑定到报告快照`。

### T7：恢复首次进入和事件驱动 onboarding

#### 修改文件

- `frontend/src/features/chatbot/chatbotOnboardingModel.ts`
- `frontend/src/features/chatbot/ChatbotOnboarding.vue`
- `frontend/src/features/chatbot/ChatbotPage.vue`
- `frontend/src/features/chatbot/chatbotSession.ts`
- `frontend/src/features/chatbot/chatbotViewTypes.ts`
- `frontend/src/features/chatbot/chatbot.css`
- `frontend/src/features/chatbot/chatbotOnboardingModel.test.ts`
- `frontend/src/features/chatbot/chatbotHelp.test.ts`
- `frontend/src/features/chatbot/ChatbotPage.test.ts`

#### 实施步骤

1. 使用现有 session storage 能力保存 `oi_onboarding_done`；首次进入且未完成/跳过时自动打开，引导按钮仍可手动重播。
2. 将五步状态机绑定到明确 DOM 目标：布局/模式按钮、Report 输入与提交、Deep Window 等待与加入 Memory、Memory bar、Chat 输入与提交。
3. 在现代页面渲染可访问遮罩、高亮、定位气泡、当前步骤和键盘操作；目标暂未出现时显示等待态，不把步骤推进到错误目标。
4. “等待报告”“加入 Memory”“进入 Chat”只能由真实 session/Deep Window 事件推进；失败、停止、取消、无报告不推进。
5. 保留拖动/最小化作为高级路径，但主引导必须能够通过“Report 提问 → 加入对话 → Chat 提问”完成；Escape、Skip、Done 恢复焦点。
6. 适配 1440×900 和 390×844，尊重 `prefers-reduced-motion`，不遮挡提交控件或造成键盘焦点陷阱。

#### 失败回归先行

- 未完成状态首次创建 session 自动打开；完成或跳过后刷新不自动打开，手动重播仍可用。
- 报告失败/停止时步骤停留在等待报告，不进入加入 Memory。
- 未加入 Memory 时不能进入 Chat 步骤；加入后才能进入 Chat 提问。
- Escape 关闭引导并将焦点返回触发按钮，Skip 不伪造完成事件。
- 五步编号始终为 1–5，进度状态与实际事件一致。

#### 验收

```text
npm --prefix frontend run test -- --run src/features/chatbot/chatbotOnboardingModel.test.ts src/features/chatbot/chatbotHelp.test.ts src/features/chatbot/ChatbotPage.test.ts
npm --prefix frontend run typecheck
```

预期：状态机、首次打开、事件守卫、焦点和响应式组件测试全部通过。

提交检查点：`Restore event-driven chatbot onboarding / 恢复事件驱动的 Chatbot 新手引导`。

### T8：补回归、修正文档并完成分层验收

#### 修改文件

- `frontend/src/features/chatbot/chatbotParity.test.ts`
- `frontend/src/features/chatbot/report/*.test.ts`
- `frontend/src/features/chatbot/*.test.ts`
- `scripts/test_m6_chatbot_agent_behavior_parity.mjs`
- `docs/chatbot-feature-report.md`
- `docs/chat-mode-analysis-types.md`
- `docs/chatbot-analysis-comparison-rules.md`

#### 实施步骤

1. 将 A01–A40 中与当前 Vue Chatbot 相关的场景映射到 session/model/component 测试；每个反例至少有一个确定性断言。
2. 为支付、Agent、AG-UI、问题日志、反馈、取消竞态和权限路径保留现有回归，不把 Report 对齐改动带入 Agent v2 合同。
3. 更新 `docs/chatbot-feature-report.md` 第 18 节，只记录真实通过的代码/测试证据；将未完成的真实 DB/LLM/SSE/BrowserAct 项标成待验收。
4. 同步修正 `docs/chat-mode-analysis-types.md` 和比较规则中与当前 Vue 渲染不一致的描述，例如底部 Top/Bottom、Trend Tier 范围和 Profile 可见字段。
5. 使用 BrowserAct 做登录后的页面验收，覆盖中英文、1440×900/390×844、Merchant/ASIN/Keyword、推荐/付款、趋势控件、Publisher Profile、Memory 下载、Deep Window 和 onboarding；记录截图与实际数据源。
6. 真实服务不可用时只报告自动化通过和真实链路待验收，不以 fixture/mock 代替生产链路证明。

#### 最终验证命令

```text
npm ci
npm run test:copilotkit
npm --prefix frontend ci
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node --check public/auth.js
node scripts/test_frontend_migration_inventory.mjs
node scripts/test_frontend_build_contract.mjs
node scripts/test_m4_shell_frontend.mjs
node scripts/test_modern_page_cutover.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
python scripts/test_agent_agui.py
python scripts/test_agent_contract.py
python scripts/test_agent_planning_contract.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_tool_registry.py
git diff --check
```

预期：所有命令退出码为 0；Chatbot 专项测试包含新增反例，Agent 既有测试保持通过，构建产物可由现代入口加载。

提交检查点：`Verify chatbot parity and modern runtime / 验证 Chatbot 对齐与现代运行时`。

## 4. 验收矩阵

| 场景 | 代码证据 | 页面证据 |
| --- | --- | --- |
| Category + Tier、排除、替换 | `reportQuery.test.ts`、`recommendationReports.test.ts` | 推荐条件和缺口文案正确 |
| 未知/同名 Merchant | `entityReports.test.ts`、`chatbotParity.test.ts` | 候选/未找到提示，不出现无关前 50 条 |
| Merchant/ASIN/Keyword 富结果 | entity/engine/render tests | 产品、月度、匹配/未匹配、澄清和筛选可见 |
| Top 指标与付款周期 Offer | query/recommendation/payment tests | 排序字段、条件和表格一致 |
| 商户/品类/Tier 趋势 | `trendReports.test.ts`、engine tests | 真实/估算/部分覆盖和范围标签正确 |
| 趋势指标/品类/列控制 | component/DeepWindow tests | 图表、表格、View、Excel 同步 |
| Publisher Records/Profile | `publisherReports.test.ts`、engine tests | 筛选、汇总、画像 block 和 portfolio 正确 |
| Memory 推荐和旧回答导出 | snapshots/export/session tests | A/B 两个回答分别下载各自快照 |
| 五步 onboarding | model/page tests | 首次自动打开、真实事件推进、Escape/Skip/焦点正确 |
| Agent 防回归 | Agent/Vercel/AG-UI tests | Agent 页面仍可执行既有固定样本 |

## 5. 执行顺序与依赖

按以下顺序执行：

1. T1 先建立查询合同和 fail-closed 基础。
2. T2 使用 T1 的实体解析完成 Merchant/ASIN/Keyword。
3. T3 使用 T1 的上一请求继承和 T2 的行模型完成推荐续问。
4. T4 使用统一 provider 与报告动作合同完成趋势。
5. T5 完成独立 Publisher 数据模型和画像 blocks。
6. T6 在所有报告结构稳定后固定完整快照与导出绑定。
7. T7 在 session 事件稳定后接入 onboarding 视觉层。
8. T8 最后更新文档并执行全量、真实页面和 Agent 防回归验收。

每个任务先写失败测试，再实现最小变更，再运行任务级测试和类型检查，最后在对应检查点提交双语 commit。不得在未完成前把 `docs/chatbot-feature-report.md` 的“已实现”字样提前改绿。

## 6. 完成标准

- G01–G09 的反例和正常路径均有自动化回归，G10 文档状态与证据一致。
- Vue Chatbot 专项、全量前端、构建、Agent v2、AG-UI 和现代入口检查全部通过。
- BrowserAct 已记录关键登录页面交互；无法连接真实 DB/LLM/SSE 的项目明确保留待验收状态。
- 没有恢复旧运行时，没有扩大 API 或数据库权限，没有把原始 prompt、完整回答、工具载荷或秘钥写入不该写入的持久化存储。
- 提交前执行 `git diff --check`，确认本任务 diff 不包含无关缓存、认证脚本、截图或旧计划文件的覆盖修改。

## 执行方式

计划已按当前工作树复核结果拆分为独立任务。执行时有两种方式：

1. **Subagent-Driven Development（推荐）**：按 T1–T8 分派独立任务，每个任务完成后先审查 diff 和测试，再进入下一个任务。
2. **Inline Execution**：在当前工作树按依赖顺序逐项实现，每个任务完成后执行对应验证和双语提交检查点。
