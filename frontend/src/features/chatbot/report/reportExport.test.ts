import { describe, expect, it } from "vitest";
import { toExportSheets } from "./reportExport";

describe("reportExport", () => {
  it("把结构化报告转换成多工作表，并保留百分比/整数格式", () => {
    const sheets = toExportSheets({
      sheets: [
        { name: "Detail", role: "detail", rows: [{ clicks: 12, cvr: 0.2 }], columns: [
          { key: "clicks", label: "Clicks", format: "integer" }, { key: "cvr", label: "CVR", format: "percentage" }
        ] }
      ],
      sourceInfo: { kind: "cache", asOf: null, estimated: false, partial: false, covered: 1, requested: 1 }
    });
    expect(sheets).toHaveLength(2);
    expect(sheets[0]?.downloadColumns?.[0]?.[3]).toBe("integer");
    expect(sheets[0]?.downloadColumns?.[1]?.[3]).toBe("percentage");
    expect(sheets[1]?.sheetName).toBe("Notes");
  });
});
