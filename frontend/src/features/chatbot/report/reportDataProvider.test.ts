import { describe, expect, it, vi } from "vitest";

import { parityOffers, parityPublishers } from "./fixtures/parityData";
import { createReportDataProvider } from "./reportDataProvider";

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe("createReportDataProvider", () => {
  it("优先使用远程 offers，并复用同一轮请求", async () => {
    const loadOffers = vi.fn(async () => ({ ok: true, offers: [parityOffers[0]] }));
    const provider = createReportDataProvider({
      offers: parityOffers.slice(1),
      source: "cache",
      preferRemote: true,
      loadOffers
    });

    const [first, second] = await Promise.all([provider.offers(signal()), provider.offers(signal())]);

    expect(first).toEqual([parityOffers[0]]);
    expect(second).toEqual(first);
    expect(loadOffers).toHaveBeenCalledTimes(1);
    expect(provider.snapshot()).toMatchObject({ source: "db", offersLoadedFrom: "db" });
  });

  it("对 HTTP 200 但 ok=false 的响应回退到缓存", async () => {
    const provider = createReportDataProvider({
      offers: [parityOffers[1]],
      source: "cache",
      preferRemote: true,
      loadOffers: async () => ({ ok: false, offers: [parityOffers[0]] })
    });

    await expect(provider.offers(signal())).resolves.toEqual([parityOffers[1]]);
    expect(provider.snapshot()).toMatchObject({ source: "cache", offersLoadedFrom: "cache" });
  });

  it("允许关键词空 bootstrap 延迟加载，并缓存成功结果", async () => {
    const keywordPayload = { merchants: [{ merchantId: "1001", productKeywords: ["headphones"] }] };
    const loadKeywords = vi.fn(async () => keywordPayload);
    const provider = createReportDataProvider({
      offers: parityOffers,
      keywords: { merchants: [] },
      loadKeywords
    });

    const first = await provider.keywords(signal());
    const second = await provider.keywords(signal());

    expect(first).toBe(keywordPayload);
    expect(second).toBe(keywordPayload);
    expect(loadKeywords).toHaveBeenCalledTimes(1);
  });

  it("按 merchant、search、portfolio 的参数去重请求", async () => {
    const loadMerchant = vi.fn(async (merchantId: string) => ({ rows: [{ merchantId }] }));
    const loadSearch = vi.fn(async (query: string) => ({ results: [{ merchantName: query }] }));
    const loadPublisherPortfolio = vi.fn(async (userId: string) => ({ merchants: [{ merchantId: userId }] }));
    const provider = createReportDataProvider({
      offers: parityOffers,
      loadMerchant,
      loadSearch,
      loadPublisherPortfolio
    });

    await Promise.all([
      provider.merchant("1001", 3, signal()),
      provider.merchant("1001", 3, signal()),
      provider.search("headphones", signal()),
      provider.search("HEADPHONES", signal()),
      provider.publisherPortfolio("p-1", "2026-08-01", "2026-08-31", signal()),
      provider.publisherPortfolio("p-1", "2026-08-01", "2026-08-31", signal())
    ]);

    expect(loadMerchant).toHaveBeenCalledTimes(1);
    expect(loadSearch).toHaveBeenCalledTimes(1);
    expect(loadPublisherPortfolio).toHaveBeenCalledTimes(1);
  });

  it("按规范化后的 ASIN 集合去重详情请求，并记录数据库来源", async () => {
    const loadAsin = vi.fn(async (asins: readonly string[], months: number) => ({
      rows: [{ asin: asins[0], months }]
    }));
    const provider = createReportDataProvider({ offers: parityOffers, loadAsin });

    const [first, second] = await Promise.all([
      provider.asin!(["b000000001", "B000000001"], 6, signal()),
      provider.asin!(["B000000001"], 6, signal())
    ]);

    expect(first).toEqual(second);
    expect(loadAsin).toHaveBeenCalledTimes(1);
    expect(loadAsin).toHaveBeenCalledWith(["B000000001"], 6, expect.any(AbortSignal));
    expect(provider.snapshot()).toMatchObject({ source: "db", detailLoadedFrom: "db" });
  });

  it("取消一个调用方时只结束该窗口，其他窗口仍可复用远程请求", async () => {
    const controller = new AbortController();
    const survivor = new AbortController();
    let release!: () => void;
    let remoteSignal: AbortSignal | undefined;
    const remoteRequest = new Promise<void>((resolve) => { release = resolve; });
    const loadMerchant = vi.fn(async (_merchantId: string, _months: number, requestSignal: AbortSignal) => {
      remoteSignal = requestSignal;
      await remoteRequest;
      return { rows: [{ merchantId: "1001" }] };
    });
    const provider = createReportDataProvider({ offers: [], loadMerchant });

    const pending = provider.merchant("1001", 3, controller.signal);
    const remaining = provider.merchant("1001", 3, survivor.signal);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    release();
    await expect(remaining).resolves.toEqual({ rows: [{ merchantId: "1001" }] });
    expect(loadMerchant).toHaveBeenCalledTimes(1);
    expect(remoteSignal?.aborted).toBe(false);
  });

  it("识别 Publisher Records 的完整缓存 payload", async () => {
    const loadPublishers = vi.fn();
    const provider = createReportDataProvider({ publishers: parityPublishers, offers: [], loadPublishers });

    await expect(provider.publishers(signal())).resolves.toBe(parityPublishers);
    expect(loadPublishers).not.toHaveBeenCalled();
  });
});
