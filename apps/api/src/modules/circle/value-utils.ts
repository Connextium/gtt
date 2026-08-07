export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

export const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export const maskSensitiveNumber = (value: string | undefined, visibleSuffix = 4): string | undefined => {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const suffixLength = Math.max(0, Math.min(visibleSuffix, normalized.length));
  const maskedPrefixLength = Math.max(0, normalized.length - suffixLength);
  const suffix = normalized.slice(normalized.length - suffixLength);
  return `${"*".repeat(maskedPrefixLength)}${suffix}`;
};
