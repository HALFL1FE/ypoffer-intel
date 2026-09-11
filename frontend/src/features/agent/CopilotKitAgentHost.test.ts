import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import CopilotKitAgentHost from "./CopilotKitAgentHost.vue";
import { emptyAgentMemory } from "./agentModel";
import type { AgentPromotionAttachment } from "./agentAttachment";
import type { AgentToolExecutionResponse } from "./agentSession";

vi.mock("@copilotkit/vue/v2", () => ({ CopilotKitProvider: { name: "Provider", props: ["frontendTools"], template: "<slot />" } }));
vi.mock("./CopilotKitAgentRuntime.vue", () => ({ default: { name: "Runtime", props: ["beginRun"], template: "<div />" } }));

describe("CopilotKit local result projection", () => {
  it("sends only the bounded tool result to Python, keeping charts and full UI rows local", async () => {
    const toolResult = { callId: "r1c1", result: { ok: true } };
    const toolExecutor = vi.fn(async (): Promise<AgentToolExecutionResponse> => ({ toolResult, resultView: { id: "trend-1", toolName: "trend", kind: "table", status: "done", title: "Trend", source: "cache", dataAsOf: null, estimated: false, partial: false, metrics: [], columns: [], rows: [], message: "" }, memoryEvent: { kind: "tool_success" } }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "en", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    const toolNames = wrapper.findComponent({ name: "Provider" }).props("frontendTools").map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("asin_analysis");
    wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "Show a trend",
      language: "en",
      history: [],
      memory: emptyAgentMemory(),
      memoryText: "",
      signal: new AbortController().signal
    });
    const tool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")[0];
    const output = await tool.handler({ merchant: "Fixture" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    expect(output).toEqual({ toolResult });
    expect(toolExecutor).toHaveBeenCalledWith(expect.objectContaining({ prompt: "Show a trend", toolName: "merchant_analysis" }));
    wrapper.unmount();
  });

  it("passes the run attachment to a frontend promotion tool call", async () => {
    const promotionAttachment = {
      manifest: {
        attachmentId: "attachment-a",
        fileName: "campaign.csv",
        merchantCount: 1,
        merchants: [{ merchantId: "101", merchantName: "First merchant" }],
        window: {
          launchDate: "2026-09-07", startDate: "2026-09-07", endDate: "2026-09-13",
          beforeStart: "2026-08-31", beforeEnd: "2026-09-06", days: 7,
        },
      },
      offers: [{ merchantId: "101", merchantName: "First merchant", category: "Home", asins: [] }],
      diagnostics: { totalRows: 1, invalidIdRows: 0, duplicateRows: 0, missingNameRows: 0, sheetsWithMerchantHeader: 1 },
    } as AgentPromotionAttachment;
    const toolResult = { callId: "r1c1", result: { ok: true } };
    const toolExecutor = vi.fn(async (): Promise<AgentToolExecutionResponse> => ({ toolResult }));
    const wrapper = mount(CopilotKitAgentHost, { props: { language: "zh", endpoint: "/api/copilotkit", enabled: true, fallbackRun: vi.fn(), toolExecutor } });
    wrapper.findComponent({ name: "Runtime" }).props("beginRun")({
      prompt: "统计媒体数量",
      language: "zh",
      history: [],
      memory: emptyAgentMemory(),
      memoryText: "",
      signal: new AbortController().signal,
      promotionAttachment,
    });
    const promotionTool = wrapper.findComponent({ name: "Provider" }).props("frontendTools")
      .find((tool: { name: string }) => tool.name === "promotion_analysis");
    expect(promotionTool).toBeDefined();
    await promotionTool.handler({ attachmentId: "attachment-a", view: "file" }, { toolCall: { id: "r1c1" }, signal: new AbortController().signal });
    expect(toolExecutor).toHaveBeenCalledWith(expect.objectContaining({
      toolName: "promotion_analysis",
      promotionAttachment,
    }));
    wrapper.unmount();
  });
});
