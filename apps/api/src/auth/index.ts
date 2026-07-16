import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type ApiScope =
  | "read:operations"
  | "write:clients"
  | "write:accounts"
  | "write:ledger"
  | "write:obligations"
  | "write:reservations"
  | "write:payments"
  | "write:rebalancing"
  | "write:reconciliation"
  | "write:release-readiness"
  | "admin:api-keys";

export interface ApiClient {
  id: string;
  tenantId: string;
  clientName: string;
  status: "active" | "disabled";
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  apiClientId: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiScope[];
  status: "active" | "revoked";
  expiresAt?: string;
  revokedAt?: string;
  rotatedFromApiKeyId?: string;
  lastUsedAt?: string;
  lastUsedIp?: string;
  createdAt: string;
}

export interface ApiAuthContext {
  tenantId: string;
  apiClientId: string;
  apiKeyId: string;
  scopes: ApiScope[];
}

export interface CreatedApiKey {
  client: ApiClient;
  key: Omit<ApiKeyRecord, "keyHash">;
  plaintextKey: string;
}

export const allApiScopes: ApiScope[] = [
  "read:operations",
  "write:clients",
  "write:accounts",
  "write:ledger",
  "write:obligations",
  "write:reservations",
  "write:payments",
  "write:rebalancing",
  "write:reconciliation",
  "write:release-readiness",
  "admin:api-keys"
];

export const hashApiSecret = (secret: string): string => {
  const pepper = process.env.GTT_API_KEY_HASH_PEPPER ?? "gtt_local_api_key_hash_pepper";
  return `hmac-sha256:${createHmac("sha256", pepper).update(secret).digest("hex")}`;
};

export const verifyApiSecretHash = (secret: string, storedHash: string): boolean => {
  if (storedHash.startsWith("hmac-sha256:")) {
    return keySafeEqual(hashApiSecret(secret), storedHash);
  }
  const legacyHash = createHash("sha256").update(secret).digest("hex");
  return keySafeEqual(legacyHash, storedHash);
};

export const createPlaintextApiKey = (keyId: string, secret = randomBytes(24).toString("hex")): string => {
  return `gtt_live_${keyId}.${secret}`;
};

export const parsePresentedApiKey = (value: string): { keyId: string; secret: string; prefix: string } | undefined => {
  const normalized = value.trim().replace(/^Bearer\s+/i, "");
  const match = normalized.match(/^gtt_live_([^.\s]+)\.([^.\s]+)$/);
  if (!match) return undefined;
  return {
    keyId: match[1]!,
    secret: match[2]!,
    prefix: `gtt_live_${match[1]!}`
  };
};

export const keySafeEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};

export const publicApiKey = (key: ApiKeyRecord): Omit<ApiKeyRecord, "keyHash"> => {
  const { keyHash: _keyHash, ...safe } = key;
  return safe;
};
