import type { AgentResultView } from "../../shared/contracts/agentResult";

/** 仅提取上一轮工具表格中的编号，不从模型回答中猜测商品。 */
export function asinContextFromViews(views: readonly AgentResultView[]): string[] {
  const asins: string[] = [];
  for (const view of views) {
    if (view.status !== "done") continue;
    const index = view.columns.indexOf("ASIN");
    for (const row of view.rows) {
      const value = view.toolName === "asin_analysis" ? row.label.split(" · ")[0] :
        view.toolName === "merchant_analysis" && index >= 0 ? row.values[index] : "";
      if (value && /^B[0-9A-Z]{9}$/.test(value) && !asins.includes(value)) asins.push(value);
    }
  }
  return asins.slice(0, 30);
}
