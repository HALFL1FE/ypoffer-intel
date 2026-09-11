# Agent ASIN 接入实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 让现代 Agent 将 ASIN 识别为独立的数据查询意图，调用现有 ASIN 数据接口返回产品、商户及月份表现，并在 Agent 结果区、命令菜单和 CopilotKit 工具协议中完整呈现；不改变现有商户、品类、Tier、付款和趋势工具行为。

**架构：** 沿用现有“服务端工具注册表 + 前端 Agent 执行器 + 浏览器安全 DB 接口”的边界。服务端新增 `asin_analysis` 工具契约和参数/结果白名单；前端把 Agent 的 ASIN 调用映射到 `/api/ui/db/asin`，将结果裁剪成有界的汇总行和月份行，再交给现有结果视图与回答合成流程；提示词、斜杠命令和 CopilotKit 工具清单统一使用同一个工具名。

**技术栈：** Python、PyMySQL 数据接口、Vue 3/TypeScript、Vitest、Node 静态契约测试。

## 全局约束

- 只修改 Agent ASIN 接入需要的文件；保留工作区中其他未提交修改。
- ASIN 参数使用当前项目约定的 10 位大写 `B[0-9A-Z]{9}` 格式，单次最多 5 个。
- Agent 只返回数据库接口的有限字段与有限月份数据，不把原始接口响应直接交给模型。
- 继续遵守浏览器安全边界：前端只能调用 `/api/ui/db/asin`，不暴露 DB token。
- 不提交、不推送、不创建 PR；本次只完成代码、文档和验证。
- 每个实现任务先补回归测试并确认失败，再写生产代码并确认通过。

---

## 任务 1：扩展服务端 Agent 工具契约

**文件：** `agent_tool_registry.py`、`scripts/test_agent_tool_registry.py`、必要时 `agent_contract.py`。

- [x] 在 `scripts/test_agent_tool_registry.py` 先把工具数量断言改为 8，并增加 `asin_analysis` 的参数规范与结果白名单测试；参数测试覆盖合法 ASIN、非 ASIN 值和超过 5 个 ASIN。
- [x] 运行 `python scripts/test_agent_tool_registry.py`，确认新增断言因注册表尚无 `asin_analysis` 而失败，记录失败位置。
- [x] 在 `agent_tool_registry.py` 注册 `asin_analysis`，参数定义为 `asins` 数组，限制 1–5 个字符串；校验时统一大写、去重并拒绝不符合当前 B 前缀规则的值。
- [x] 为该工具加入安全结果字段：`asins`、`rows`、`monthly`、`notFound`、`headline`、`note`、`source`、`dataAsOf`，并为含月份明细的 ASIN 结果使用现有较大的结果字节上限。
- [x] 验证 `agent_contract.py` 的工具名、计划证明和工具调用校验自动接纳新增注册项；现有通用逻辑已覆盖，无需额外改动。
- [x] 重新运行 `python scripts/test_agent_tool_registry.py` 及 Agent 合约相关测试，确认全部通过。

## 任务 2：接入前端 Agent ASIN 执行与结果投影

**文件：** `frontend/src/features/agent/agentSession.ts`、`frontend/src/features/agent/agentSession.test.ts`、`frontend/src/shared/contracts/agentResult.ts`（仅在类型需要时）。

- [x] 先在 `agentSession.test.ts` 增加失败回归：执行 `asin_analysis` 时必须请求 `/api/ui/db/asin?asins=...`，结果必须保留 `rows`/`monthly`，结果视图必须显示 ASIN 或产品行。
- [x] 运行该测试，确认当前执行器将 `asin_analysis` 视为未知工具或无法解析商户而失败。
- [x] 在 Agent 工具名联合类型、工具清单和数据问题识别中加入 `asin_analysis` 与 ASIN 识别；裸 ASIN 和包含 ASIN 的问题都走工具规划，不再落入普通闲聊。
- [x] 实现 ASIN 参数规范化、请求 `/api/ui/db/asin`、成功/未匹配/接口失败三类结果处理；请求只使用同源浏览器安全接口。
- [x] 将接口结果投影为有界结构：产品/商户汇总 `rows`、按 ASIN/商户/月展开的扁平 `monthly`、`notFound` 和来源时间字段；数值统一沿用现有 Agent 格式化逻辑，避免长小数直接展示。
- [x] 为 `asin_analysis` 增加步骤标签、工具目标文本、结果表格标签和回答兜底文本；结果视图至少能展示 ASIN、商户、月份以及订单、销售额、佣金、EPC、AOV、CVR 等可用字段。
- [x] 保持记忆边界：不把 ASIN 月度数值写入持久化记忆；只沿用现有的最后工具/查询上下文记录机制。
- [x] 重新运行 `npm --prefix frontend run test -- --run frontend/src/features/agent/agentSession.test.ts` 和相关 Agent 测试，确认通过。

## 任务 3：统一 Agent 入口与 CopilotKit 工具清单

**文件：** `frontend/src/features/agent/agentCommands.ts`、`frontend/src/features/agent/AgentPage.vue`、`frontend/src/features/agent/AgentPage.test.ts`、`frontend/src/features/agent/CopilotKitAgentHost.vue`。

- [x] 先增加命令解析和工具清单回归：`/asin B0D2HKCMBP` 应生成 ASIN 查询提示，Agent 页面能力说明/示例应包含 ASIN，CopilotKit 工具名应包含 `asin_analysis`；运行对应测试确认当前实现失败。
- [x] 增加 `/asin` 斜杠命令及中英文提示，保留输入中展示为 `asin:` 的统一命令语义。
- [x] 更新 Agent 页面占位文案、能力说明和示例气泡，使用户能发现 ASIN 查询能力，不改变现有命令行为。
- [x] 将 `asin_analysis` 加入 CopilotKit Agent Host 的工具清单，确保模型可规划该工具。
- [x] 重新运行 Agent 页面、命令和 CopilotKit 相关测试，确认通过。

## 任务 4：更新规划/合成提示词与项目文档

**文件：** `chat_agent_http.py`、`docs/chatbot-feature-report.md`。

- [x] 先在现有 HTTP Agent 合约测试中加入 ASIN 规划和月份结果提示词断言，确认当前提示词缺少 ASIN 规则而失败。
- [x] 在中英文规划提示词中明确：ASIN/产品编号问题必须调用 `asin_analysis`，传入 `asins`；不能把 ASIN 当商户名；多个 ASIN 可一次调用。
- [x] 在中英文合成提示词中明确使用 `rows` 展示产品/商户汇总、使用 `monthly` 展示真实月份明细，并引用工具返回值，不臆造数据库数据。
- [x] 更新 `docs/chatbot-feature-report.md` 的当前 Agent 工具数量、工具列表和 ASIN 支持边界，保留历史阶段描述的时间语义。
- [x] 运行相关 Python Agent HTTP/合约测试，确认通过。

## 任务 5：全量验证与交付记录

**文件：** 本计划文档及测试输出，不新增无关改动。

- [x] 运行 Python Agent 注册表、HTTP、AG-UI/工具行为及 ASIN 数据回归测试。
- [x] 运行 `npm --prefix frontend run typecheck`、前端全量 Vitest、`npm --prefix frontend run build` 和 `npm run test:copilotkit`。
- [x] 运行现代前端挂载、Agent 行为契约和相关 CI 静态检查，确认没有破坏现有 7 个 Agent 工具及 Chatbot ASIN 功能。
- [x] 检查 `git diff --check` 与 `git status --short`，确认没有意外修改、凭据或构建产物被纳入本次改动。
- [x] 最终报告区分“代码/自动化测试已验证”和“需要带数据库登录的浏览器验收”，不宣称未实际验证的部署或页面效果。
