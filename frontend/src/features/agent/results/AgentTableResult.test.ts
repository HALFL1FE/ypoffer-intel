import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { normalizeAgentResultView } from "../../../shared/contracts/agentResult";
import AgentTableResult from "./AgentTableResult.vue";

describe("ASIN 独立表格", () => {
  it.each(["details", "performance"])("%s 按 ASIN 拆表并保留每行", (mode) => {
    const view = normalizeAgentResultView({ id: "asins", toolName: "asin_analysis", kind: "table", status: "done",
      title: "多个 ASIN", columns: ["字段", "值"], rows: [
        { label: mode === "details" ? "B000000001" : "B000000001 · Merach · 2026-08", values: ["2026-08", "100"] },
        { label: mode === "details" ? "B000000002" : "B000000002 · Merach · 2026-09", values: ["2026-09", "200"] },
        { label: mode === "details" ? "B000000001" : "B000000001 · Merach · 2026-09", values: ["2026-09", "300"] }
      ] })!;
    const wrapper = mount(AgentTableResult, { props: { language: "zh", view } });
    const tables = wrapper.findAll("table");
    expect(tables).toHaveLength(2);
    expect(tables[0]!.findAll("tbody tr")).toHaveLength(2);
    expect(tables[0]!.text()).not.toContain("B000000002");
    expect(tables[1]!.text()).not.toContain("B000000001");
    expect(wrapper.findAll("header strong").map(node => node.text())).toEqual(["B000000001", "B000000002"]);
  });
});
