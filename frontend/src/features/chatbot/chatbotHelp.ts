import type { UiLanguage } from "../../shared/i18n";
import { renderMarkdownToHtml } from "../../shared/markdown/markdown";

const REPORT_HELP_ZH = `# Report Mode 使用说明

Report Mode 用于查询商户、ASIN、关键词、品类、Tier、付款、趋势和 Publisher Records。数据报告先由确定性规则和数据模型生成，LLM 只用于意图分类与文字解释。

示例：

- 查询 Alpha Audio 的 EPC、AOV 和订单
- 推荐 Electronics 中 EPC 大于 0.3 的 2 个商户
- 查询 2026-08 Tier 2 未付款记录
- 查看 Publisher Records，或输入 /publisherprofile: Media One 查看媒体画像
- 查看 headphones 关键词关联的商品

结果可以打开 Deep Window、加入 Chat Mode 记忆，并从同一份报告快照导出。估算趋势会明确标记 estimated。`;

const REPORT_HELP_EN = `# Report Mode help

Report Mode queries merchants, ASINs, keywords, categories, tiers, payments, trends, and Publisher Records. Deterministic rules and data models produce the facts; the LLM is used only for intent classification and narrative explanation.

Examples:

- Look up EPC, AOV, and orders for Alpha Audio
- Recommend 2 Electronics merchants with EPC above 0.3
- Show unpaid Tier 2 records for 2026-08
- Show Publisher Records, or use /publisherprofile: Media One for a profile
- Find offers associated with the headphones keyword

Reports can open in a Deep Window, be added to Chat Mode memory, and export from the same report snapshot. Estimated trends are explicitly marked estimated.`;

const GUIDE_ZH = `# Chatbot 使用流程

1. 先在 Report Mode 输入一个数据问题。
2. 检查报告范围、来源和结构化指标。
3. 需要完整内容时打开 Deep Window，或把报告加入对话。
4. 在 Chat Mode 中继续追问、比较和解释。
5. 使用 Memory、View 或 Excel 导出复用已确认的报告。

提示：无匹配、歧义、部分数据和估算数据都会单独标记；不会把未知目标扩大成全量查询。Publisher Records 支持空过滤列表，Publisher Profile 需要明确的媒体名称或 ID。`;

const GUIDE_EN = `# Chatbot workflow

1. Start with a data question in Report Mode.
2. Check the report scope, source, and structured metrics.
3. Open a Deep Window for the full view, or add the report to the conversation.
4. Continue with follow-up questions, comparisons, and explanations in Chat Mode.
5. Reuse confirmed reports through Memory, View, or Excel export.

Tip: no-match, ambiguous, partial, and estimated states are shown explicitly; unknown targets never expand into a full-dataset query. Publisher Records supports an empty filter list; Publisher Profile needs an explicit publisher name or ID.`;

export function getReportHelpMarkdown(language: UiLanguage): string {
  return language === "zh" ? REPORT_HELP_ZH : REPORT_HELP_EN;
}

export function getUserGuideMarkdown(language: UiLanguage): string {
  return language === "zh" ? GUIDE_ZH : GUIDE_EN;
}

export function chatbotHelpHtml(language: UiLanguage): string {
  return renderMarkdownToHtml(getReportHelpMarkdown(language));
}

export function chatbotGuideHtml(language: UiLanguage): string {
  return renderMarkdownToHtml(getUserGuideMarkdown(language));
}

export async function loadUserGuide(language: UiLanguage, signal?: AbortSignal): Promise<string> {
  const path = language === "zh" ? "/chatbot-user-guide.md" : "/chatbot-user-guide-en.md";
  const response = await fetch(path, { signal });
  if (!response.ok) throw new Error(`Guide request failed: ${response.status}`);
  const markdown = (await response.text()).trim();
  return markdown || getUserGuideMarkdown(language);
}
