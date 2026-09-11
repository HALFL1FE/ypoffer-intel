import { parseMonthlyNewMerchantTable } from "../../features/monthly-new-merchants/monthlyNewMerchantsModel";

export const MAX_MERCHANT_FILE_BYTES = 5 * 1024 * 1024;

interface SpreadsheetReader {
  readonly read: (data: ArrayBuffer, options: { readonly type: "array" }) => SpreadsheetWorkbook;
  readonly utils: {
    readonly sheet_to_json: (sheet: unknown, options: {
      readonly header: 1;
      readonly raw: false;
      readonly defval: string;
    }) => unknown;
  };
}

interface SpreadsheetWorkbook {
  readonly SheetNames: readonly string[];
  readonly Sheets: Readonly<Record<string, unknown>>;
}

interface WindowWithSpreadsheetReader extends Window {
  readonly XLSX?: SpreadsheetReader;
}

export class MerchantWorkbookError extends Error {
  readonly code: "MERCHANT_FILE_FORMAT" | "MERCHANT_FILE_TOO_LARGE" | "MERCHANT_FILE_READ";

  constructor(code: MerchantWorkbookError["code"], message: string) {
    super(message);
    this.name = "MerchantWorkbookError";
    this.code = code;
  }
}

let spreadsheetReaderPromise: Promise<SpreadsheetReader> | null = null;

function loadSpreadsheetReader(): Promise<SpreadsheetReader> {
  const existing = (window as WindowWithSpreadsheetReader).XLSX;
  if (existing) return Promise.resolve(existing);
  if (spreadsheetReaderPromise) return spreadsheetReaderPromise;
  spreadsheetReaderPromise = new Promise<SpreadsheetReader>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    script.async = true;
    script.onload = () => {
      const reader = (window as WindowWithSpreadsheetReader).XLSX;
      if (reader) resolve(reader);
      else reject(new MerchantWorkbookError("MERCHANT_FILE_READ", "Spreadsheet reader did not load."));
    };
    script.onerror = () => reject(new MerchantWorkbookError("MERCHANT_FILE_READ", "Could not load the spreadsheet reader."));
    document.head.appendChild(script);
  }).catch((error) => {
    spreadsheetReaderPromise = null;
    throw error;
  });
  return spreadsheetReaderPromise;
}

function extension(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() || "";
}

export async function readMerchantWorkbook(file: File): Promise<unknown[][][]> {
  const fileExtension = extension(file.name);
  if (!["xlsx", "xls", "csv", "tsv"].includes(fileExtension)) {
    throw new MerchantWorkbookError("MERCHANT_FILE_FORMAT", "Only XLSX, XLS, CSV, and TSV files are supported.");
  }
  if (file.size > MAX_MERCHANT_FILE_BYTES) {
    throw new MerchantWorkbookError("MERCHANT_FILE_TOO_LARGE", "The merchant file is larger than 5 MiB.");
  }
  try {
    if (fileExtension === "xlsx" || fileExtension === "xls") {
      const reader = await loadSpreadsheetReader();
      const workbook = reader.read(await file.arrayBuffer(), { type: "array" });
      return workbook.SheetNames.flatMap((name) => {
        const table = reader.utils.sheet_to_json(workbook.Sheets[name], {
          header: 1,
          raw: false,
          defval: "",
        });
        return Array.isArray(table) ? [table.filter((row): row is unknown[] => Array.isArray(row))] : [];
      });
    }
    const table = parseMonthlyNewMerchantTable(await file.text(), fileExtension === "tsv" ? "\t" : "");
    return [table];
  } catch (error) {
    if (error instanceof MerchantWorkbookError) throw error;
    throw new MerchantWorkbookError("MERCHANT_FILE_READ", "The merchant file could not be read.");
  }
}
