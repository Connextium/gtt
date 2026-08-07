export interface TreasuryAdaBalances {
  availableMinorUnits: string;
  pendingMinorUnits: string;
  reservedMinorUnits: string;
  lockedMinorUnits: string;
  suspenseMinorUnits: string;
  updatedAt?: string;
}

export interface TreasuryAdaAccount {
  id: string;
  accountCode?: string;
  accountName: string;
  businessClientId: string;
  businessClientName?: string;
  status: string;
  usePurpose: string;
  assetCode?: string;
  assetRail?: string;
  createdAt?: string;
  balances?: TreasuryAdaBalances;
}

const minorUnitsPerUsdc = 1_000_000;

export const parseMinorUnits = (value: string | undefined): number => {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const formatMinorUnitsAsUsdc = (value: string | undefined): string => {
  const usdcValue = parseMinorUnits(value) / minorUnitsPerUsdc;
  return `${usdcValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
};

export const formatMinorUnitsAsUsd = (value: string | undefined): string => {
  const usdcValue = parseMinorUnits(value) / minorUnitsPerUsdc;
  return `$${usdcValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const sumMinorUnits = (
  accounts: TreasuryAdaAccount[],
  pick: (account: TreasuryAdaAccount) => string | undefined
): string => {
  const total = accounts.reduce((sum, account) => sum + parseMinorUnits(pick(account)), 0);
  return String(total);
};

export const accountDisplayCode = (account: TreasuryAdaAccount): string => {
  if (account.accountCode?.trim()) return account.accountCode;
  const nameSeed = account.accountName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const purposeSeed = account.usePurpose.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "GEN";
  const assetSeed = (account.assetCode ?? "USDC").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4);
  return `DAA-${assetSeed}-${purposeSeed}-${nameSeed}`;
};

export const readableStatus = (value: string): string => value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());

export const readableUsePurpose = (value: string): string => value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
