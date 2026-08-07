export interface MintHistoryCsvRow {
  id: string;
  wireAccountId: string;
  targetAccountOfDigitalAssetId: string;
  amountMinorUnits: string;
  status: string;
  providerMintId?: string;
  createdAt: string;
}

export const formatMintHistoryMinorUnits = (value?: string): string => {
  if (!value) return "0.000000 USDC";
  const isNegative = value.startsWith("-");
  const normalized = value.replace(/[^0-9]/g, "");
  const padded = normalized.padStart(7, "0");
  const whole = padded.slice(0, -6).replace(/^0+(?=\d)/, "") || "0";
  const fraction = padded.slice(-6);
  return `${isNegative ? "-" : ""}${whole}.${fraction} USDC`;
};

export const buildMintHistoryQuery = (input: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}): string => {
  const params = new URLSearchParams();
  params.set("page", String(Math.max(1, input.page)));
  params.set("pageSize", String(Math.max(1, input.pageSize)));
  if (input.search?.trim()) params.set("search", input.search.trim());
  if (input.status && input.status !== "all") params.set("status", input.status);
  return params.toString();
};

const toCsvCell = (value: string): string => `"${value.replaceAll("\"", "\"\"")}"`;

export const buildMintHistoryCsv = (rows: MintHistoryCsvRow[]): string => {
  const header = ["mint_id", "wire_account_id", "target_ada_id", "amount_minor_units", "amount_display", "status", "provider_mint_id", "created_at"];
  const body = rows.map((row) => [
    row.id,
    row.wireAccountId,
    row.targetAccountOfDigitalAssetId,
    row.amountMinorUnits,
    formatMintHistoryMinorUnits(row.amountMinorUnits),
    row.status,
    row.providerMintId ?? "",
    row.createdAt
  ].map(toCsvCell).join(","));
  return [header.join(","), ...body].join("\n");
};
