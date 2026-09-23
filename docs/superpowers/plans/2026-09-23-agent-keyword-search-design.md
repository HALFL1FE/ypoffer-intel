# 对话 Agent 关键词商家搜索设计

日期：2026-09-23
状态：代码已实施并通过自动化验证；真实登录页面与实时数据仍待验收

## 1. 问题与目标

用户在对话 Agent 输入 `vacuum cleaner brand recommendation` 时查不到商家；Chatbot Report Mode 在识别出 `keywordSearch` 后可以用关键词目录返回商家。本设计让 Agent 能用同一套关键词数据和匹配口径查找商家，并在“推荐”提问中对已命中的候选商家给出有依据的排序。

验收示例：

- `查找 vacuum cleaner 相关商家`：返回匹配商家、Merchant ID、命中依据及数据来源。
- `vacuum cleaner brand recommendation`：先找候选，再对有商户表现快照的候选排序；说明这是**匹配商家的快照表现排序**，不是 vacuum cleaner 单品销量排行。
- `/keyword vacuum cleaner`：与自然语言搜索走同一工具和结果视图。

本期不新增数据库表、不做联网商品搜索、不推断 ASIN 销量，也不把关键词命中本身当作推荐质量证明。

## 2. 当前代码事实与差距

1. Report Mode 在 `frontend/src/features/chatbot/report/reportQuery.ts` 接收分类器的 `params.keywordSearch`/`params.keyword`，也支持 `/keyword`。`reportEngine.ts` 的关键词分支会按需读取 `provider.keywords()`，调用 `buildEntityReport()`，本地未命中时再尝试通用商户搜索。
2. 关键词目录由 `offer_db.py` 的 `product_keywords_payload()` 提供，通过 `/api/ui/db/keywords` 返回；其中有 Merchant ID、商户名、产品标题、产品关键词和 ASIN 列表。目录可能来自缓存，不能仅凭接口返回就称为“实时数据库”。`public/auth.js` 在页面启动后延迟加载目录，`frontend/src/runtime/modernApp.ts` 更新当前快照。
3. `entityReports.ts` 的 `matchesKeyword()` 和 `buildEntityReport()` 已定义 Report Mode 的匹配、Merchant ID 合并、Tier/品类筛选及去重行为；`chatbotKeywords.ts` 只按 Merchant ID 补充搜索字段，不覆盖商户指标。
4. Agent 的 Python 工具注册表 `agent_tool_registry.py`、前端 `agentSession.ts` 和 `CopilotKitAgentHost.vue` 目前均没有关键词工具。Agent 会话在 `frontend/src/entry.ts` 创建时只接收商户/付款快照，没有关键词目录或其按需加载能力。规划提示词 `chat_agent_http.py` 也没有“产品词先查关键词”的规则。`agentSession.ts` 的数据问题识别目前也没有覆盖 `keyword`/`brand recommendation`；模型不规划工具时，可能把直接生成的文本当成答案。结果是产品词可能被错当商户名/品类名，或完全没有可调用的数据工具。
5. Report Mode 的普通 `recommendation` 分支调用 `buildRecommendationReport(query, offers, ...)`；它不会自动按 `query.keyword` 过滤候选。因此不能直接把原始问题交给该分支，就声称完成关键词品牌推荐。`/api/ui/db/search` 查询的是 `cnpscy_advert` 的商户 ID/名称，不是产品关键词全文索引，不能作为关键词目录的等价替代。

## 3. 方案与数据流

沿用现有“Python 规划与验证、浏览器执行只读工具、Python 综合、Vue 展示”的边界，新增一个 Agent 工具 `keyword_search`。工具执行器通过现有同源浏览器安全接口取得最新可用的商户快照与关键词目录，复用 Report Mode 的关键词匹配函数，再把结果裁剪为 Agent 的有界结构化结果。CopilotKit 主链路和受控会话回退链路使用同一个执行函数。

```text
用户问题 / /keyword 命令
  → Python 规划 keyword_search(keyword, mode, limit)
  → Agent 前端执行器取得当前快照；必要时读取 /api/ui/db/keywords 与商户数据
  → 复用 Report Mode 的关键词匹配与 Merchant ID 关联
  → mode=search：显示匹配商家
  → mode=recommendation：仅对有商户表现数据的命中商家复用现有推荐比较器排序
  → 有界工具结果 → Python 综合 + Agent 表格卡片
```

### 3.1 工具契约

`keyword_search` 的输入：

| 参数 | 约束 | 说明 |
| --- | --- | --- |
| `keyword` | 必填，去空格后 2–120 字符 | 产品词组；例如 `vacuum cleaner`，不传整句 `brand recommendation` |
| `mode` | `search` 或 `recommendation`，默认 `search` | 用户明确要求推荐/Top/排名时选 `recommendation` |
| `limit` | 1–20，默认 10 | 限制返回给模型与 UI 的商家行数；无效值拒绝，不静默放大 |

成功结果只包含 `keyword`、`mode`、`rows`、`matchedCount`、`returnedCount`、`truncated`、`unrankedCount`、`headline`、`note` 等白名单字段；每行只投影 `merchantId`、`merchantName`、可用的 `tier`/`category`、命中字段及截断后的匹配片段，以及排序实际用到的商户快照指标。缺失指标保持缺失，不伪装成 0。`source`/`dataAsOf` 按现有 Agent 外层结果契约提供，时间取真实快照或关键词载荷的 `checkedAt`；两者时间不同则分别说明，不合成虚假的统一时间。

注册表对参数、行数、字符串长度、结果字节数做有界校验；不把完整关键词目录、产品标题数组或原始接口载荷传给模型。`matchedCount` 是应用默认可见性/筛选后的数量，`truncated=true` 表示当前只返回前 `limit` 条；这不等于“全数据库仅有这些商家”。

### 3.2 匹配和排序

- 匹配复用 `entityReports.ts` 的 `buildEntityReport()`/`matchesKeyword()`，保留 Report Mode 默认 Tier 4、BLACK TIER 排除规则及 Merchant ID 去重规则；不要在 Agent 中另写一套产品词匹配。需要抽取共享纯函数时，Report Mode 也改为调用同一函数，并用现有测试证明行为未变。
- 关键词目录与商户快照只按 Merchant ID 关联。产品标题/关键词命中、商户名命中和品类命中要在结果中区分；后两者不能表述为“该商户销售该产品”的证据。
- `search` 保留 Report Mode 的匹配结果口径，不暗示名次。`recommendation` 在命中候选中复用 `recommendationReports.ts` 的 `compareRecommendationOffers()` 默认比较顺序及 Tier 可见性；展示实际参与比较的可用商户指标和排序口径。仅存在于关键词目录、缺少商户表现快照的命中商家列为“匹配但未参与排序”，不以零指标参与排名。排名只说明商户总体快照表现，不是该关键词对应 ASIN 的期间收入。
- 若当前 Report Mode 关键词结果与 Agent 结果因数据快照时间、来源或 `limit` 不同而不一致，结果中明确说明；不承诺跨时间点完全一致。

### 3.3 数据加载与失败语义

- Agent 每次关键词查询读取**当前** `getAppSnapshot().value.productKeywords`，避免会话创建早于延迟加载时永久持有空目录；为空时通过现有 `/api/ui/db/keywords` 按需加载，商户快照沿用 Report 数据提供器的现有来源/降级机制。取消时遵守当前 `AbortSignal`，停止后不得提交结果或记忆。
- 目录接口失败但商户快照中已有可搜索字段：可返回部分结果并标注 `partial`/来源；若没有足够搜索数据，则返回“关键词数据不可用”，不能误报“数据库没有相关商家”。完整数据确实无命中才返回 `not_found`。
- `/api/ui/db/search` 只可辅助商户名解析，不能在关键词目录失败时假装完成产品关键词搜索。所有请求维持现有登录校验与同源接口，不把 DB token 放到浏览器。

## 4. 规划、回答与界面

- 在中英文规划提示词中写明：产品类型/商品词 + `brand recommendation`、`找相关商家`、`哪些品牌做 vacuum cleaner` 等问题，先调用 `keyword_search`；不能把 `vacuum cleaner` 直接交给 `merchant_analysis` 或 `category_analysis`。从问题中去掉“推荐/brand recommendation”等意图词后提取原始产品词组；无法可靠提取时让用户补充关键词，不做全量商户扫描。
- 对这类明确要求数据检索的问题，补齐 Agent 的数据问题守卫：规划失败或模型未调用工具时，即使模型返回了文字，也不能把未经工具验证的品牌名单当作查询结果；应提示未取得可核对数据或请用户补充关键词。普通概念问答仍沿用现有直接回答路径。
- 在中英文综合提示词中写明：引用工具返回的商户、命中依据、排序口径和数据时间；区分“关键词匹配”与“推荐排序”；不能声称关键词商品销量、ASIN 表现或无依据的 Top。工具只返回部分列表时明确说明截断。
- Agent `resultView` 使用现有表格组件，列出商户、Merchant ID、命中依据及推荐模式下的实际排序指标；服务端综合不可用时，本地兜底回答也要保留这些行，而不是只输出 `note`。空结果、不可用、部分结果使用不同状态文案。
- 在 `agentCommands.ts` 增加 `/keyword` 入口和中英文提示；不改 Report Mode 的 `/keyword` 行为。搜索结果不把全量候选或指标写入持久化结构化记忆；如需追问某商家，沿用现有会话历史与明确 Merchant ID 的工具查询。

## 5. 实施顺序与验证

代码实施和自动化验证已完成；真实页面验收待做。关键行为先补失败回归，再改实现。

1. **契约与规划**：修改 `agent_tool_registry.py`、`chat_agent_http.py` 及 `agentSession.ts` 的数据问题守卫，补 `scripts/test_agent_tool_registry.py`、`scripts/test_agent_contract.py`、前端守卫测试和规划提示词/AG-UI 测试。覆盖无效/过长关键词、越界 `limit`、白名单、结果字节上限、`vacuum cleaner brand recommendation` 不误路由，以及模型不调用工具时不编造品牌名单。
2. **匹配与数据加载**：在 `frontend/src/features/chatbot/report/entityReports.ts` 共享关键词匹配入口，在 `frontend/src/features/agent/agentSession.ts` 与 `frontend/src/entry.ts` 接入当前关键词快照和现有数据提供器；补 `entityReports.test.ts`、`agentSession.test.ts`。覆盖延迟目录加载、同 Merchant ID 合并、关键词只有目录行、Tier 默认过滤、目录失败/取消及 Report/Agent 命中集合对齐。
3. **主链路与展示**：更新 `CopilotKitAgentHost.vue` 工具清单、`agentSession.ts` 的结果表和兜底回答、`agentCommands.ts` 的命令；补相应 Vue/Vitest 测试。覆盖 `search` 和 `recommendation`、无指标不参与排序、Top 数量截断、部分结果提示、CopilotKit 与回退链路一致。
4. **文档与端到端验收**：实施后更新 `docs/chatbot-feature-report.md` 的当前工具列表。运行 Python Agent 测试、前端相关 Vitest、TypeScript typecheck 和构建；在本地登录页面分别测试上述三条验收示例、空结果、接口失败与停止。自动化通过与带真实关键词数据的浏览器验收分别记录，不能互相替代。

2026-09-23 自动化验证：前端 Vitest 112 个文件、660 个用例通过；TypeScript typecheck 和生产构建通过；Python AG-UI、工具注册表、Agent 合同测试通过；CopilotKit 运行时 6 个用例通过。当前修改未进行真实登录页面的交互验收，因此三条示例在部署环境中的实际商户结果、接口失败与停止体验仍需单独核对。

## 6. 验收边界

成功标准是 Agent 对示例问题能给出**实际命中的商户列表**、可核对的匹配来源，并在推荐提问中给出明确、有限范围的商户快照排序；Report Mode 同一关键词、同一数据快照下的候选商户集合一致。若真实目录没有 `vacuum cleaner` 命中，正确行为是解释当前数据无命中，而不是生成品牌。产品级 period revenue、ASIN 排名和新的推荐评分模型均不在本次范围内。
