# Agent 批量提取商家 Top ASIN 修复计划

> 执行状态（2026-09-20）：已按授权完成代码修复与自动化验证；原始六商家问题已通过本地真实模型的 modern session 验收。部署环境 CopilotKit 网关与旧查询浏览器冒烟待验收。

**目标：** 正确处理用户提供多个商家 ID 和名称、要求分别提取 Top ASIN 的问题，保留商家归属、排序和数据来源。

**架构：** 扩展现有 `merchant_analysis`，增加按需提取 Top ASIN 的查询模式，复用 Offer 快照已经计算的 `topAsins`。同时修复商家 ID 解析，贯通前端执行、服务端参数与结果契约、规划、综合回答和结构化展示。

**技术栈：** Vue 3、TypeScript、Vitest、Python、现有 Agent v2 / AG-UI 工具链。

**基线：** 本地 `main` 的 `ad2160b`；诊断日期为 2026-09-20。执行前重新检查工作区与相关实现。

## 一、问题与目标行为

原始问题：

```text
406220 AOCHUAN
362448 Midland Radio
380928 DS18
384704 ISOtunes
385315 SABRENT
362602 Productech；以上商家的top asin可以帮我提取吗
```

这属于“按多个商家分别提取商品编号”，不是商家对比，也不是已知 ASIN 的表现分析。

预期输出为六行表格，列为“商家 ID、商家名称、Top ASIN”。默认每家最多五个，保留快照内顺序；说明排序口径、数据日期及覆盖区间。缺失商家或缺失 ASIN 要逐项说明，不得省略整行、串用其他商家的 ASIN 或编造商品编号。

## 二、已验证原因与证据边界

### 2.1 数据已存在，但未进入 Agent 工具结果

- `protected_data/db_offers_cache.json` 的六个商家均存在，每家有五个 `topAsins`；诊断时快照生成日期为 2026-09-19，区间为 2026-09-01 至 2026-09-30，`asinRankingVersion=2`。
- `frontend/src/features/agent/agentSession.ts` 的 `merchantData()` / `executeMerchantAnalysis()` 只返回商家级指标、同行、月度等字段，没有投影 `topAsins`。
- `merchantMonthlyRows()` 请求带有 `minimal=1`；`offer_db.py:merchant_payload()` 的该分支明确返回 `products: []`。
- 直接执行现有商户工具并模拟月度接口，成功匹配的商家结果均不含其缓存 ASIN。月度接口使用模拟响应，该验证不是生产数据库或真实模型回放。

### 2.2 工具契约与规划规则未支持反向查找

- `agent_tool_registry.py` 的 `asin_analysis` 必须输入一至五个有效 ASIN，不能传商家 ID 反查。
- `merchant_analysis` 的结果白名单没有 `topAsins`。直接传入该字段已验证返回 `invalid_tool_result`。
- `chat_agent_http.py` 要求“查询 ASIN 必须调用 asin_analysis”，未区分“已知 ASIN 查表现”和“已知商家找 ASIN”。这会增加错误规划风险，但未取得原始对话日志，不能断言当次模型选择了哪个工具。
- 综合提示要求商户工具有月度数据时逐月展示，即使用户只要求 ASIN，也可能产生无关月度表格。

### 2.3 Midland Radio 名称解析存在确定性错误

`frontend/src/features/chatbot/chatbotModel.ts:merchantIdFromPrompt()` 的 `id` 标记没有词边界，会将 `Midland` 中的 `id` 匹配为标记、`land` 匹配为 ID，并优先于真正的数字 ID。

复现结果：`362448` 成功；`Midland Radio` 和 `362448 Midland Radio` 均未找到。错误 ID 还会在 `resolveChatbotMerchant()` 中过滤掉原本匹配的名称，形成“resolved 但 matches 为空”的不一致状态。

### 2.4 六商家不是超限，但会用满预算

当前总工具预算为六次、AG-UI 每批四次。六个独立商家可以按 4+2 执行；六次全部使用后没有额外重试预算。此次不扩大预算，也不通过新增多阶段查找绕开限制。

## 三、范围与全局约束

- 本阶段仅写文档；实施、提交、推送和 PR 需后续明确授权。
- 不新增依赖、数据库表、公开 API 或工具名称；保持现有九工具注册表。
- 保留普通商户分析与已知 ASIN 查询的行为。
- 仅支持当前 Offer 快照的 Top 5 提取，不承诺任意日期区间、任意 Top N、单品营收数值或商品标题。
- 用户明确要求其他日期或超过五个时，说明当前可用范围，不得假称满足该要求；这些扩展能力不纳入本修复。
- 复用现有排序，不在模型或前端依据商家总营收重新排名；不能用关键词目录的顺序冒充 Top ASIN。
- 不将 ASIN 列表写入持久化结构化记忆；仍只保存既有商家身份等安全摘要。
- 所有新增注释和说明使用简体中文，界面与模型规则沿用现有中英双语支持。
- 使用固定数据测试；生产日志、真实 LLM 与浏览器验收分别记录，不互相替代。

## 四、拟定契约与行为

### 4.1 商户工具参数

增加可选参数 `view`，取值 `overview | top_asins`；省略时维持 `overview`。旧调用不要求追加字段。

```json
{
  "merchant": "362448",
  "view": "top_asins"
}
```

规划对六家分别生成上述调用，优先使用显式数字 ID，不把整段多行名单塞进一个 `merchant` 参数。工具描述明确支持“根据商家提取 Top ASIN”；`asin_analysis` 的规则收窄为“用户提供有效 ASIN 并要求分析它”。

### 4.2 Top ASIN 工具结果

沿用 `merchant_analysis` 的标准结果封装，新增白名单字段 `topAsins`、`asinRanking`。仅在 `top_asins` 模式产生专用结果，避免无关月度查询和庞大的 overview 载荷。

```ts
interface AgentAsinRanking {
  status: "available" | "empty" | "unavailable";
  basis: "period_revenue_desc_then_asin" | "unknown";
  limit: 5;
  returned: number;
  startDate: string | null;
  endDate: string | null;
  dataAsOf: string | null;
  version: number | null;
}

interface AgentMerchantTopAsinsData {
  merchant: { id: string; name: string };
  topAsins: string[];
  asinRanking: AgentAsinRanking;
  headline: string;
  note: string;
}
```

行为定义：

- `available`：有有效 ASIN；大写化、过滤无效编号、保持原顺序去重，最多五个。
- `empty`：存在有效数组但为空；明确当前快照未提供该商家的 Top ASIN，不推断商家没有商品。
- `unavailable`：字段缺失、类型错误或非空数组全部无效；不降级到任意商品目录。
- 商家不存在仍返回既有 `not_found`，与“商家存在但无 ASIN 数据”区分。
- `returned` 必须等于列表长度。服务端验证列表上限、ASIN 格式、状态一致性、元数据类型和字段白名单，继续遵守单结果 6000 字节预算。
- 来源采用 `cache`，不能因另一个接口访问数据库就把缓存 ASIN 标成实时数据库结果。
- 只有有可信排序版本信息时声明已知排序口径；缺少版本或日期时填 `null` / `unknown` 并明确缺失，不以当前系统日期补齐。

现有 `offer_asin_rankings()` 的口径是：按期间单品正营收降序，同营收按 ASIN 编码升序；其余零、负或缺失营收商品按编码补齐。因此回答不能声称五个 ASIN 都有成交或都是畅销商品。

### 4.3 快照元数据传递

沿 `public/auth.js` → `AppBootstrapData.chatbotData` → `frontend/src/entry.ts` → `AgentSessionOptions` 传递原始 `asinRankingVersion`、`startDate`、`endDate`、`checkedAt`。

先核对现有 bootstrap 的字段位置，再增加缺失的投影；不能直接读取磁盘缓存供浏览器使用。ASIN 和元数据必须来自同一份快照。现有 `dataAsOf` 可复用，另增加可选 `asinRankingContext` 保存版本和区间；无元数据的旧 fixture 保持可运行，结果标记未知。

### 4.4 ID 解析优先级

显式合法 ID 标记或独立数字 ID优先；没有合法 ID 时按名称解析。ID 标记必须是独立词，不能命中 `Midland` 等名称内部；保留 `ID362448`、`merchantId:362448`、`商家ID：362448` 等输入形式。

针对本例可使用以下标记模式作为实现起点，并通过现有测试确认兼容性：

```ts
const labeled = text(prompt).match(
  /(?:\bmerchant\s*id\b|\bmerchantid\b|商户\s*id|商家\s*id|\bid)\s*[:：#]?\s*(\d+)\b/i
);
```

数字 ID 路径与名称路径分开；显式未知 ID 返回 `not_found`，不得回退命中另一商家名称；任何 `resolved` 都必须至少有一个匹配项。

## 五、文件范围与实施任务

### 任务 1：修复商家识别

文件：`frontend/src/features/chatbot/chatbotModel.ts`、`frontend/src/features/chatbot/chatbotModel.test.ts`。

- [x] 在已有商家 fixture 增加 Midland Radio，先写以下失败用例：

```ts
const fixture = [{ merchantId: "362448", merchantName: "Midland Radio" }];
for (const input of ["362448", "Midland Radio", "362448 Midland Radio", "ID362448", "商家ID：362448"]) {
  const result = resolveChatbotMerchant(input, fixture);
  expect(result.status).toBe("resolved");
  expect(result.matches[0]?.offer.merchantId).toBe("362448");
}
expect(resolveChatbotMerchant("999999 Midland Radio", fixture).status).toBe("not_found");
```

- [x] 运行 `npm --prefix frontend run test -- --run src/features/chatbot/chatbotModel.test.ts`，确认失败来自名称中的 ID 误识别。
- [x] 收紧标记匹配并修复空匹配状态；保留完整名称、唯一子串及同名歧义测试。
- [x] 重跑相同测试，要求新增用例及原有用例全部通过。

### 任务 2：贯通 Top ASIN 查询契约与数据

文件：`agent_tool_registry.py`、`scripts/test_agent_tool_registry.py`、`frontend/src/features/agent/agentSession.ts`、`frontend/src/features/agent/agentSession.test.ts`、`frontend/src/entry.ts`、`public/auth.js`；如 bootstrap 类型需调整，同步 `frontend/src/runtime/contracts.ts`。

- [x] 先为参数和结果新增测试：`view=top_asins` 被接受；未知 view 被拒绝；五个合法 ASIN 通过；六个、重复项、非法编号、未知字段及返回数量不一致被拒绝；旧 overview 仍通过。
- [x] 前端固定数据使用以下刻意非字母序的数组，防止实现把排名重新排序：

```ts
const topAsins = ["B09PFBWV55", "B000000001", "B000000002"];
// executeTool 使用 merchant_analysis 与 view: "top_asins"。
expect(result.toolResult).toMatchObject({
  result: { ok: true, data: { topAsins, asinRanking: { returned: 3, status: "available" } } }
});
expect(fetcher).not.toHaveBeenCalled();
```

- [x] 使用 `python scripts/test_agent_tool_registry.py` 和 Agent session 专项测试确认 RED。
- [x] 实现前述参数枚举、结果白名单与专用字段验证；在 `executeMerchantAnalysis()` 已解析商家后、月度请求前处理 `top_asins` 分支。
- [x] 传递同源快照元数据；补充日期/版本缺失、空数组、无效数组、未知商家测试。
- [x] 运行上述测试及 `npm --prefix frontend run typecheck`，要求通过。确认普通 overview 仍会调用月度接口。

### 任务 3：规划、综合回答和结构化结果

文件：`chat_agent_http.py`、`scripts/test_agent_planning_contract.py`、`scripts/test_agent_synthesis_contract.py`、`frontend/src/features/agent/agentSession.ts`、`frontend/src/features/agent/agentSession.test.ts`。

- [x] 给规划测试加入原始六商家问题和六个 `merchant_analysis(view=top_asins)` 调用，确认参数经过签名和规范化仍完整保留；模拟模型测试仅证明契约，不宣称证明真实模型选择正确。
- [x] 更新中英文规划规则，区分商家反查与已知 ASIN 查询；六家优先用数字 ID，各自独立调用；不使用 `merchant_comparison`。
- [x] 更新综合规则：Top ASIN 结果只按商家列出编号和来源，保留排名；overview 的月度展示要求不得套用到该模式。
- [x] 在结果视图与无模型综合的兜底回答中识别 `topAsins`，复用现有表格组件展示商家与排名，不依赖 `metrics` 字段；新增专用测试，防止综合失败时丢失已查数据。
- [x] 测试失败商家逐项显示、缓存来源不伪装成实时来源、未知日期不补造、ASIN 列表不写入持久化记忆。
- [x] 运行规划、综合和 Agent session 专项测试，要求全部通过。

### 任务 4：六商家端到端契约与验收

文件：`scripts/test_agent_agui.py`、`frontend/src/features/agent/agentSession.test.ts`、`docs/chatbot-feature-report.md`。

- [x] 用六个固定商家和各自不同的 ASIN 列表构造模拟运行；校验六个调用按预算执行，AG-UI 4+2 两批完成，综合收到完整六家结果。
- [x] 同时覆盖 CopilotKit 调用入口和受控 modern session，确认复用同一工具语义。
- [x] 补充部分缺失用例：一商家未知、一商家为空时，其他商家仍返回且答案明确标识缺失。
- [x] 运行以下验证命令，预期全部退出码为零：

```text
npm --prefix frontend run test -- --run src/features/chatbot/chatbotModel.test.ts src/features/agent/agentSession.test.ts
python scripts/test_agent_tool_registry.py
python scripts/test_agent_planning_contract.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_contract.py
python scripts/test_agent_agui.py
npm --prefix frontend run typecheck
npm --prefix frontend run build
node scripts/test_frontend_build_contract.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
git diff --check
```

- [x] 在本地具备模型服务的环境用 BrowserAct 提交原始问题；六家完整、Midland Radio 命中、没有无关月度表格，排名与同一快照一致。
- [ ] 在部署环境用 BrowserAct 再验证一个已知 ASIN 查询和一个普通商户分析没有退化；本地 CopilotKit 网关未启动，完整网关链路仍待部署验收。
- [x] 记录真实模型实际工具选择、结果和最终输出；缺少运行环境时将此项标记待验收，不用模拟测试代替。
- [x] 更新 Chatbot 档案，注明新参数、Top 5 范围、排序及来源语义；若启动本地服务，验收结束后关闭本次服务。

## 六、完成标准与后续边界

完成标准是：原始六商家输入能得到六家分别对应的 Top ASIN 或明确缺失状态；商家识别、工具签名与结果校验通过；显示与综合一致；来源和日期真实；旧商户/ASIN 查询回归通过。

本修复不扩展任意 Top N、历史区间重排、批量下载或开放式多轮取数。后续若用户需要这些能力，再设计支持日期及单品指标的查询接口。本次已执行代码修复，提交与发布通过当前 PR 流程完成。

## 七、实施与验证记录（2026-09-20）

- 分支：`codex/agent-merchant-top-asins-fix`；保留原有 stash 与数据缓存，不修改缓存、不触碰原有 stash。
- 自动化：完整前端 111 个文件、618 个用例通过；registry 11、planning 3、synthesis 8、contract 10、AG-UI 14 个用例通过。类型检查、双 bundle 构建、构建契约、M6 行为契约与 `node --check public/auth.js` 通过。
- 回归覆盖：Midland 名称与数字 ID、未知商家、空缺与非法 ASIN、排序及 Top 5 上限、元数据缺失、参数签名、六商家 4+2 批处理、综合失败保留结果、原始 ASIN 不写入持久化记忆。普通商家和已知 ASIN 的自动化回归通过。
- BrowserAct：使用本地 loopback 服务、固定现有缓存、真实 DeepSeek 模型和受控 modern session 提交原始六商家问题。实际规划为六个独立的 `merchant_analysis(view=top_asins)`，分别传入六个数字 ID；最终回答与六张结果表的 30 个 ASIN 全部逐商家、逐顺序匹配同一快照；显示快照日期，没有无关月度不可用提示。问题与 Trace 持久化请求在本次页面中拦截，未写入测试日志。
- 验收边界：本地 Python 服务的 `/api/copilotkit/info` 返回 404，因此未验证真实 Node CopilotKit 网关；对应工具入口和综合失败路径已有自动化测试。已知 ASIN 与普通商家查询的浏览器冒烟及生产登录仍待部署环境验收，不以单元测试代替。
