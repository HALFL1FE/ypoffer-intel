import type { ExportColumn, ExportSheet } from "../../../shared/export/xlsx";
import type { ReportDocument, ReportSnapshot, ReportSource } from "./reportContracts";

type ExportableReport = Pick<ReportDocument, "sheets" | "sourceInfo"> | Pick<ReportSnapshot, "sheets" | "sourceInfo">;

function exportFormat(format: string): "" | "percentage" | "integer" {
  if (format === "percentage") return "percentage";
  if (format === "integer") return "integer";
  return "";
}

function columnsFor(sheet: ExportableReport["sheets"][number]): readonly ExportColumn[] {
  return sheet.columns.map((column) => [
    column.label,
    (row: Readonly<Record<string, unknown>>) => row[column.key] ?? "",
    column.width,
    exportFormat(column.format)
  ] as ExportColumn);
}

function sourceText(source: ReportSource): string {
  return [
    `Source: ${source.kind}`,
    `As of: ${source.asOf || "unavailable"}`,
    `Estimated: ${source.estimated ? "yes" : "no"}`,
    `Partial: ${source.partial ? "yes" : "no"}`,
    `Covered: ${source.covered}/${source.requested}`
  ].join("\n");
}

export function toExportSheets(report: ExportableReport): readonly ExportSheet[] {
  const detailSheets: ExportSheet[] = report.sheets.map((sheet) => ({
    sheetName: sheet.name,
    rows: sheet.rows,
    columns: columnsFor(sheet),
    downloadColumns: columnsFor(sheet)
  }));
  const notes: ExportSheet = {
    sheetName: "Notes",
    rows: [{ source: sourceText(report.sourceInfo) }],
    columns: [["Source", (row: Readonly<Record<string, unknown>>) => row.source ?? ""]]
  };
  return [...detailSheets, notes];
}

export function reportExportFilename(report: Pick<ReportDocument, "intent" | "documentId">): string {
  const safeIntent = String(report.intent).replace(/[^a-z0-9_-]+/gi, "_").slice(0, 32) || "report";
  return `chatbot_${safeIntent}_${report.documentId.slice(-12)}.xlsx`;
}
