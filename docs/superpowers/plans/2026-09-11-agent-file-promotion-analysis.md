# 对话 Agent 文件上传与推广分析实施计划

> **执行记录：** 用户已确认实施。本计划按 `executing-plans` 的顺序在当前工作区执行；由于工作区已有未提交修改，新增功能保持在当前分支并严格限制改动范围。

**目标：** 用户上传商家清单后，Agent 按用户问题查询与推广追踪页面相同的数据，并支持保留附件的连续追问。

**架构：** 共享现有清单读取和推广追踪接口；增加会话级附件快照与 `promotion_analysis` 工具。主运行链路和降级链路使用同一执行器，服务端负责上下文、工具参数和结果契约校验。

**技术栈：** Vue 3、TypeScript、现有电子表格读取器、Vitest、Python、现有 Agent HTTP/AG-UI 协议。

## 全局约束

- 设计依据：[设计文档](2026-09-11-agent-file-promotion-analysis-design.md)。功能入口参考：`docs/chatbot-feature-report.md`。
- 单附件，XLSX/XLS/CSV/TSV，新增大小上限 5 MiB；沿用最多 200 个商家、1–92 天窗口。
- 不新增数据库表或上传存储服务，不新增表格解析依赖，不恢复旧前端运行时。
- 规划请求 64 KiB；合成与 AG-UI 请求 128 KiB。推广工具结果上限 18,000 字节，每页最多 25 行。
- 上传内容是数据，不是指令；经营分析必须确认日期，并校验查询商家属于本次清单。
- 保留现有无附件行为、登录权限、空值和 ASIN 语义；不把观察到的增长写成推广因果归因。
- 每项任务先写针对性失败回归，再实现，再验证；仅执行当前任务需要的检查。
- 保留工作区既有修改，尤其推广追踪上传组件和数据缓存。提交、推送、PR 和部署须另获用户授权，不作为本计划自动执行步骤。

## 文件分工与依赖

下列新文件均为拟新增；其余为现有文件。路径相对仓库根目录 `D:\Code\offer-intelligence-main`。

| 新文件 | 职责 |
| --- | --- |
| `frontend/src/shared/import/merchantWorkbook.ts` | 提取并共享现有文件读取逻辑 |
| `frontend/src/features/agent/agentAttachment.ts` | 附件类型、校验、快照和内存生命周期 |
| `frontend/src/features/agent/agentPromotionTool.ts` | 调用推广追踪接口、聚合、排序和结果投影 |
| `frontend/src/features/agent/AgentAttachment.vue` | 上传、拖放、预览和日期确认 |
| `agent_promotion_contract.py` | 推广摘要、参数范围和结果的专用纯校验 |
| 对应 `.test.ts` 与 `scripts/test_agent_promotion_contract.py` | 各模块回归测试 |

任务顺序：共享文件与附件模型 → 推广工具 → 服务端契约 → 两条运行链路 → 上传界面与生命周期 → 综合验收。界面只消费附件模型，不能自己另建一份商家状态。

## 任务 1：共享读取器与附件模型

**文件**

- 新增：`frontend/src/shared/import/merchantWorkbook.ts`、`merchantWorkbook.test.ts`。
- 新增：`frontend/src/features/agent/agentAttachment.ts`、`agentAttachment.test.ts`。
- 修改：`frontend/src/entry.ts`、`frontend/src/features/offer-performance/performanceModel.ts` 及其现有测试。

**接口**

```ts
readMerchantWorkbook(file: File): Promise<unknown[][][]>;
parseAgentAttachment(tables: unknown[][][], fileName: string): AgentPromotionAttachment;
snapshotAgentAttachment(attachment: AgentPromotionAttachment): AgentPromotionAttachment;
createAgentAttachmentStore(): AgentAttachmentStore;
```

`AgentPromotionAttachment`、`PromotionManifest`、`PromotionWindow` 按设计文档定义。`AgentAttachmentStore` 提供 `get()`、`replace(attachment)`、`clear()`、`subscribe(listener)`；`get()` 无附件时返回 `null`，订阅返回取消函数。解析诊断通过附件的独立 `diagnostics` 字段返回，不发送给规划器。

- [ ] 编写失败测试：四种格式、跨工作表去重、中文列名、缺少名称、无效 ID、200/201 个商家边界、超过 5 MiB、替换失败保留旧值、快照不被后续日期编辑改变。使用测试内构造的文件，不读取用户业务清单。

```ts
it("只把文件解析为清单，不推断推送日期", () => {
  const attachment = parseAgentAttachment(
    [[["Merchant ID", "Merchant Name"], ["101", "商家甲"]]],
    "清单.csv",
  );
  expect(attachment.manifest.merchantCount).toBe(1);
  expect(attachment.manifest.window).toBeNull();
  expect(attachment.offers[0].merchantId).toBe("101");
});
```

- [x] 执行 `npm --prefix frontend run test -- --run src/shared/import/merchantWorkbook.test.ts src/features/agent/agentAttachment.test.ts`，共享读取器和附件交互回归通过。
- [x] 将 `entry.ts` 内现有 XLSX/XLS 与 CSV/TSV 分支提取为 `readMerchantWorkbook()`，推广追踪工厂改用它；读取前校验格式和大小。
- [x] 在 `performanceModel.ts` 提取日期无关的商家行解析，`parseBatch()` 与 `parseAgentAttachment()` 共用它；保留现有返回契约，为新入口提供诊断计数。
- [x] 实现附件存储和深复制快照；解析成功才替换旧附件。重复 ID 合并遵循现有规则，不按显示名称合并。
- [x] 重跑上述测试及 `npm --prefix frontend run test -- --run src/features/offer-performance`，现有导入行为保持兼容。

**交付门槛：** 两个页面可使用同一个读取器；附件在没有推送日期时仍可有效存在。

## 任务 2：推广分析执行器与数值投影

**文件**

- 新增：`frontend/src/features/agent/agentPromotionTool.ts`、`agentPromotionTool.test.ts`。
- 使用：`performanceApi.ts`、`performanceModel.ts`、`frontend/src/shared/contracts/agentResult.ts`。
- 修改：`frontend/src/features/agent/agentResultRegistry.ts`，仅注册新工具已有类型的结果卡片。

**接口**

```ts
executePromotionTool(
  attachment: AgentPromotionAttachment,
  args: PromotionToolArguments,
  loadReport: typeof import("../offer-performance/performanceApi").loadReport,
  signal: AbortSignal,
): Promise<AgentToolExecutionResponse>;
```

`PromotionToolArguments` 按设计文档定义，`AgentToolExecutionResponse` 使用 `agentSession.ts` 现有类型。执行器先校验快照 ID、商家范围和日期，再查询、聚合、排序、分页并返回 `toolResult` 与 `resultView`。同次运行的报告复用由运行上下文提供，不建立跨会话全局缓存。

- [ ] 构造固定报告测试：商家甲前期销售额 100、后期 150，商家乙前期 50、后期 40；预期总额 150→190、差额 40、增长率为 `40/150`，不能平均两家的增长率。媒体中同一 ID 分属两个商家，预期合并一次；`media` 与 `links` 同时存在时不得叠加。
- [ ] 增加边界测试：`null`、零基期、不完整期间、日期比较窗口、文件 ASIN 与成交 ASIN 不同、没有目标 ASIN 的 product 链接、26 行分页、同值按 ID 稳定排序、附件不匹配以及清单外 ID。
- [x] 执行 `npm --prefix frontend run test -- --run src/features/agent/agentPromotionTool.test.ts`，固定数据聚合、分页、关系和 ASIN 语义通过。
- [x] 实现六种视图的读取路径；`file` 不调用接口，`history` 使用普通报告，媒体与链接使用关系报告。总体指标在分页前计算，增长率复用 `change()` 的适用条件。

```ts
const delta = before === null || after === null ? null : after - before;
const pct = change(before, after, complete);
```

- [x] 输出扁平、有界数据；默认 25 行，文件事实注明 `evidenceOrigin="file"`，数据库结果保留接口来源与水位字段。未查询成功不能标记数据库成功结果。
- [x] 重跑执行器和推广追踪测试；固定数据聚合、关系查询和文件分页通过。

**交付门槛：** 不依赖模型即可得到准确、可分页、有来源的结果。

## 任务 3：服务端附件上下文与工具契约

**文件**

- 新增：`agent_promotion_contract.py`、`scripts/test_agent_promotion_contract.py`。
- 修改：`agent_tool_registry.py`、`agent_contract.py`、`chat_agent_http.py`、`agent_agui.py`。
- 扩展测试：`scripts/test_agent_tool_registry.py`、`scripts/test_agent_planning_contract.py`、`scripts/test_agent_synthesis_contract.py`、`scripts/test_agent_agui.py`。

**接口**

```python
def validate_promotion_context(value):
    """返回 (规范化摘要, 错误)，无摘要返回 (None, None)。"""

def validate_promotion_scope(arguments, context):
    """返回 (规范化参数, 错误)，校验附件、商家和已确认日期。"""

def validate_promotion_result(value):
    """返回 (规范化结果, 错误)，执行专用字段和字节限制。"""
```

返回约定沿用当前契约的 `(value, error)`，错误对象沿用现有 `errorCode` 和字段定位形式。上述为接口声明，校验行为以下列步骤与固定回归为准。

- [ ] 编写失败测试：可选摘要兼容旧请求；有效 200 商家；额外字段、重复 ID、数量不一致、清单外 ID、错误附件 ID、日期缺失、日期范围不一致、超长请求、工具结果超预算及非法指标值。

```python
def test_reject_merchant_outside_attachment(self):
    context = {
        "attachmentId": "attachment-a",
        "fileName": "清单.csv",
        "merchantCount": 1,
        "merchants": [{"merchantId": "101", "merchantName": "商家甲"}],
        "window": None,
    }
    arguments = {
        "attachmentId": "attachment-a", "view": "file",
        "merchantIds": ["999"], "window": None,
        "metric": "revenue", "sortBy": "after", "direction": "desc",
        "offset": 0, "limit": 25,
    }
    _, error = validate_promotion_scope(arguments, context)
    self.assertIsNotNone(error)
```

- [x] 执行 `python scripts/test_agent_promotion_contract.py`，附件范围、日期窗口、请求上下文和结果预算通过。
- [x] 注册 `promotion_analysis`，定义参数、专用结果字段和 18,000 字节限制；新增 `merchant_media` 视图按商家统计去重后的活跃媒体数量；不整体放宽其他工具的数组、深度或字节校验。
- [x] 在规划请求加入可选 `promotionContext`，在合成上下文中允许同一摘要。校验完成后才构造规划消息；将文件摘要标识为不可信用户数据。无附件时不允许该工具参与规划。
- [x] 参数补全发生在签发 `planProof` 前；服务端和前端均验证最终范围。新增回归覆盖附件外商家和无上下文工具调用。
- [x] 在 `agent_agui.py` 的初次规划、公开状态白名单、工具续跑、重规划和合成输入中保留摘要；禁止连续运行扩大原清单范围。保持现有 `v2` 版本字段及旧工具请求兼容，不另建上传端点。
- [x] 检查序列化后的结果预算；摘要名称做有界投影，结果超限时缩小明细页并保留 `nextOffset`。
- [x] 运行本任务列出的 Python 测试脚本，另运行 `python scripts/test_agent_contract.py` 和 `python scripts/test_agent_http.py`；新契约与旧请求均通过。

**交付门槛：** 服务端只接受合法附件范围内的规划和工具结果；续跑不会丢失附件条件。

## 任务 4：接通主运行与降级运行

**文件**

- 修改：`frontend/src/features/agent/agentSession.ts`、`AgentPage.vue`。
- 修改：`CopilotKitAgentHost.vue`、`CopilotKitAgentRuntime.vue`、`frontend/src/entry.ts`。
- 修改对应测试：`agentSession.test.ts`、`CopilotKitAgentHost.test.ts`、`CopilotKitAgentRuntime.test.ts`、`AgentPage.test.ts`。
- 检查并同步：`agentModel.ts` 的工具名白名单；只有实际消费链路需要时才修改 `copilotkitTransport.ts`。

**接口**

```ts
promotionAttachment?: AgentPromotionAttachment;
```

将该可选字段加入 `AgentRunRequest`、`AgentSessionRequest`、`AgentToolExecutionRequest`。规划只序列化 `promotionAttachment.manifest`；工具执行接收整个本次快照。`entry.ts` 创建并注入同一 `AgentAttachmentStore` 和 `readMerchantWorkbook`。

- [ ] 编写失败测试：附带附件的首次请求、工具调用、追问、重规划、合成失败后降级、主组件加载失败回退，以及无有效运行会话的工具调用。
- [x] 执行 Agent session、Host、Runtime 回归，附件字段与降级传递通过。
- [x] 在发送入口生成一次快照，贯穿当前运行；前端工具分派到 `executePromotionTool()`，无快照返回明确附件错误。保留原问题文本，不能将整个文件拼进 `prompt`。
- [x] 主运行将摘要写入 `offerIntelligence.promotionContext`；降级运行加入共享规划与合成请求。Host 的 `fallbackRun(request)` 收到原附件快照。
- [x] 更新客户端各处工具白名单和注册；工具只在附件有效时启用。附件相关问题的回退不会忽略清单范围。
- [x] 修正主链路前端工具使用当前运行的附件快照；统一使用 `legacyParity` 回退字段，并对首次规划不可用增加一次受控重试。
- [x] `entry.ts` 的正常挂载和异步组件错误分支均注入附件服务；新工具沿用原有结果卡片传递方式。
- [x] 重跑上述测试及 `npm --prefix frontend run typecheck`，两条链路和无附件回归通过。

**交付门槛：** 上传入口尚未接入时，也能通过构造附件请求完成端到端工具调度；不遗漏降级分支。

## 任务 5：上传交互、日期与生命周期

**文件**

- 新增：`frontend/src/features/agent/AgentAttachment.vue`、`AgentAttachment.test.ts`。
- 修改：`AgentPage.vue`、`AgentPage.test.ts`、`agentViewState.ts`、`agentDiagnostics.ts`、`agentDiagnostics.test.ts`。
- 组件样式放在新组件内，沿用现有 Agent 设计变量，不改全局布局。

**组件接口**

输入为 `store: AgentAttachmentStore`、`readFile: typeof readMerchantWorkbook`、`busy: boolean`、`language`；组件调用共享解析器并更新 store。AgentPage 负责发送时快照及日期确认，不让组件直接发起 Agent 请求。

- [x] 编写并通过选择/拖入文件、文本拖拽不拦截、日期确认、移除和缺日期提问回归；多文件/文件夹边界由拖放处理覆盖。
- [x] 执行 AgentAttachment、AgentPage 和集成流程回归，上传生命周期通过。
- [x] 实现上传按钮和拖放事件。仅识别 `DataTransfer` 的文件拖放时阻止默认导航；维护进入层级计数，`drop` 或离开外层时清零；对目录项拒绝解析。
- [x] 实现预览、跳过行诊断、推送日期和自定义观察期控件；文件事实问题允许无日期发送，经营问题在窗口确认后恢复原问题。
- [ ] 使用同一 store 支持页面导航恢复；新会话、登出和整页刷新清除附件。请求取消后用运行 ID 阻止迟到结果写入消息。
- [ ] 诊断序列化不新增二进制、完整表格或完整清单；附件问题回放要求重新上传。提示主动导出诊断可能包含已展示的回答。
- [x] 重跑附件生命周期与 `agentDiagnostics.test.ts`，诊断不包含二进制或完整清单。

**交付门槛：** 用户可在界面完成上传、确认、提问和连续追问，且不会串用附件。

## 任务 6：回归、真实操作验收与文档

**文件**

- 新增：`frontend/src/features/agent/agentPromotionFlow.test.ts`，覆盖上传至回答的集成行为。
- 修改：`.github/workflows/ci.yml`，把新增 Python 回归脚本加入现有测试步骤。
- 修改：`docs/chatbot-feature-report.md`，记录支持文件、日期和数据来源边界；在本计划后记录实际验证结果。

- [ ] 先建立失败的集成断言：同一测试清单和窗口，推广页面与 Agent 的商家总额、媒体总额、链接 ASIN 和历史基线一致；附件更换后的迟到结果不进入当前会话。
- [x] 运行 `npm --prefix frontend run test -- --run src/features/agent/agentPromotionFlow.test.ts`，上传到回答的集成流程通过。
- [x] 运行前端完整回归、类型检查和构建：

```powershell
npm run test:copilotkit
npm --prefix frontend run typecheck
npm --prefix frontend run test -- --run
npm --prefix frontend run build
node scripts/test_frontend_build_contract.mjs
node scripts/test_m6_chatbot_agent_behavior_parity.mjs
node scripts/test_m6_modern_mount.mjs
node scripts/test_m7_modern_entry.mjs
```

- [x] 运行后端相关回归：

```powershell
python scripts/test_agent_promotion_contract.py
python scripts/test_agent_tool_registry.py
python scripts/test_agent_contract.py
python scripts/test_agent_planning_contract.py
python scripts/test_agent_synthesis_contract.py
python scripts/test_agent_http.py
python scripts/test_agent_agui.py
python scripts/test_offer_performance.py
```

- [ ] 先读 `browser-act` 技能再执行浏览器验收。确认浏览器地址由当前工作区构建产物提供；本地可通过 `python server.py` 启动。缺少登录、数据库或模型配置时，分别记录哪些环节未验证。
- [ ] 真实操作验收：从系统文件夹拖入 CSV 和 XLSX；检查文件没有被浏览器直接打开；完成日期确认、商家分析、媒体追问、链接 ASIN 展示、历史趋势、下一页、停止、替换、新会话及刷新。另验证主运行不可用时的降级路径。
- [ ] 使用同一有效业务清单和日期，对照推广追踪页面检查数值。真实模型措辞单独检查来源、范围、空值和因果表述，不把固定数据单测当作线上查询通过。
- [ ] 记录测试命令、通过/失败结果、浏览器地址及运行模式。验收结束只关闭本次启动的本地服务器：先核对监听端口与进程，再终止并确认端口释放。

**交付门槛：** 自动化、构建和浏览器证据分别完整记录；未完成项明确列出，不以“代码完成”代替真实拖拽或经营数据验证。

## 发布与验收记录

当前状态：功能代码已实施；前端完整回归、构建、集成流程和服务端契约回归均已通过。真实浏览器拖拽、登录/数据库/模型环境下的线上数值对照仍待验收。未提交、未推送、未创建 PR。

功能实现后先交付本地结果和验收证据。用户授权发布时，再核对当前分支、工作区差异、远端和 PR 的目标分支，按仓库约定生成中英双语提交与 PR；不自动复用此前任务的 PR 授权。
