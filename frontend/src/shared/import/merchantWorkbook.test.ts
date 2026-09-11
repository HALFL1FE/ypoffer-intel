import { describe, expect, it } from "vitest";

import { readMerchantWorkbook } from "./merchantWorkbook";

describe("readMerchantWorkbook", () => {
  it("reads a UTF-8 CSV as one worksheet", async () => {
    const file = new File(
      ["Merchant ID,Merchant Name\n101,First merchant\n"],
      "merchants.csv",
      { type: "text/csv" },
    );

    await expect(readMerchantWorkbook(file)).resolves.toEqual([
      [
        ["Merchant ID", "Merchant Name"],
        ["101", "First merchant"],
      ],
    ]);
  });

  it("rejects files above the upload limit before reading them", async () => {
    const file = new File(["small"], "merchants.csv");
    Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 + 1 });

    await expect(readMerchantWorkbook(file)).rejects.toMatchObject({
      code: "MERCHANT_FILE_TOO_LARGE",
    });
  });
});
