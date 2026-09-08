type Row = Readonly<Record<string, unknown>>;

function isRow(value: unknown): value is Row {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function merchantId(row: Row): string {
  return String(row.merchantId ?? row.merchant_id ?? row["Merchant ID"] ?? "").trim().replace(/\.0$/, "");
}

function strings(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim()).filter(Boolean);
}

/** Enrich search fields only, joining the lazy payload by exact Merchant ID. */
export function mergeChatbotKeywords(offers: readonly Row[], payload: unknown): readonly Row[] {
  if (!isRow(payload) || !Array.isArray(payload.merchants)) return offers;
  const byId = new Map<string, Row>();
  for (const row of payload.merchants) {
    if (isRow(row) && merchantId(row)) byId.set(merchantId(row), row);
  }
  return offers.map((offer) => {
    const keywords = byId.get(merchantId(offer));
    if (!keywords) return offer;
    const fields: Record<string, readonly string[]> = {};
    for (const key of ["productTitles", "productKeywords", "productAsins"] as const) {
      fields[key] = [...new Set([...strings(offer[key]), ...strings(keywords[key])])];
    }
    return { ...offer, ...fields };
  });
}
