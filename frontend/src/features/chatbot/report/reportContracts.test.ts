import { describe, expect, it } from "vitest";

import { reportBlockColumns, reportBlockRows } from "./reportContracts";

describe("report contracts", () => {
  it("keeps typed block rows and columns available to every renderer", () => {
    const block = {
      id: "metrics-1",
      kind: "metrics" as const,
      title: "Metrics",
      rows: [{ merchantId: "1001", revenue: 1200 }],
      columns: [
        { key: "merchantId", label: "Merchant ID", format: "text" as const },
        { key: "revenue", label: "Revenue", format: "money" as const }
      ]
    };

    expect(reportBlockRows(block)).toEqual(block.rows);
    expect(reportBlockColumns(block)).toEqual(block.columns);
  });
});
