import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import AgentPage, { type AgentRunner } from "./AgentPage.vue";
import { createAgentAttachmentStore } from "./agentAttachment";

const readFile = vi.fn(async () => [[
  ["Merchant ID", "Merchant Name", "Category", "ASIN"],
  ["101", "First merchant", "Home", "B012345678"],
]]);

async function upload(wrapper: ReturnType<typeof mount>) {
  const file = new File(["Merchant ID,Merchant Name\n101,First merchant"], "campaign.csv");
  await wrapper.get('[data-agent-attachment-dropzone]').trigger("drop", {
    dataTransfer: { types: ["Files"], files: [file], items: [{ kind: "file" }] },
  });
  await flushPromises();
}

describe("Agent promotion upload flow", () => {
  it("passes one immutable attachment snapshot into a promotion question", async () => {
    const store = createAgentAttachmentStore();
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "完成", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, attachmentStore: store, readFile, autoFocus: false } });

    await upload(wrapper);
    await wrapper.get('[data-agent-attachment-date]').setValue("2026-09-07");
    await wrapper.get('[data-agent-input]').setValue("分析推广后一周表现");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].promotionAttachment).toMatchObject({
      manifest: { fileName: "campaign.csv", merchantCount: 1, window: { launchDate: "2026-09-07" } },
    });
    expect(run.mock.calls[0]![0].prompt).toBe("分析推广后一周表现");
    wrapper.unmount();
  });

  it("allows file-only questions before a launch date is confirmed", async () => {
    const store = createAgentAttachmentStore();
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "清单包含 1 个商家", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, attachmentStore: store, readFile, autoFocus: false } });

    await upload(wrapper);
    await wrapper.get('[data-agent-input]').setValue("文件里有哪些商家？");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]![0].promotionAttachment?.manifest.window).toBeNull();
    wrapper.unmount();
  });

  it("keeps a promotion question pending until a launch date is confirmed", async () => {
    const store = createAgentAttachmentStore();
    const run = vi.fn<AgentRunner>().mockResolvedValue({ ok: true, status: "done", response: "不应执行", steps: [] });
    const wrapper = mount(AgentPage, { props: { language: "zh", run, attachmentStore: store, readFile, autoFocus: false } });

    await upload(wrapper);
    await wrapper.get('[data-agent-input]').setValue("分析推广表现");
    await wrapper.get('[data-agent-form]').trigger("submit");
    await flushPromises();

    expect(run).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').text()).toContain("确认推送日期");
    wrapper.unmount();
  });
});
