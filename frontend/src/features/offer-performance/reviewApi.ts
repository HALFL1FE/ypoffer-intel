import { apiRequest } from "../../shared/api/client";
import type { ReviewBatch, ReviewReport, ReviewRequest } from "./reviewModel";
import { METRICS } from "./performanceModel";
const path = "/api/ui/db/offer-performance";
export const reviewCatalog = () =>
  apiRequest<{ batches: ReviewBatch[] }>(`${path}?action=review-catalog`);
export const reviewPost = <T>(body: unknown, signal?: AbortSignal) =>
  apiRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 210_000,
    signal,
  });
export async function reviewReport(
  request: ReviewRequest,
  signal?: AbortSignal,
): Promise<ReviewReport> {
  if (request.merchantId)
    return reviewPost<ReviewReport>({ action: "review", ...request }, signal);
  const [summary, relations] = await Promise.all([
    reviewPost<ReviewReport>(
      { action: "review", ...request, part: "summary" },
      signal,
    ),
    reviewPost<ReviewReport>(
      { action: "review", ...request, part: "relations" },
      signal,
    ),
  ]);
  if (summary.availableThrough !== relations.availableThrough)
    throw new Error("数据更新中，请重试 / Reporting data changed; retry");
  for (const merchant of summary.merchants) {
    const relation = relations.merchants.find(
      (row) => row.merchantId === merchant.merchantId,
    );
    if (
      !relation ||
      (["before", "after"] as const).some((period) =>
        METRICS.some((metric) => {
          const a = merchant[period][metric],
            b = relation[period][metric];
          return a === null || b === null ? a !== b : Math.abs(a - b) > 0.01;
        }),
      )
    )
      throw new Error(
        "汇总和媒体数据正在更新，请重试 / Summary and publisher totals changed; retry",
      );
  }
  return { ...summary, media: relations.media, links: relations.links };
}
