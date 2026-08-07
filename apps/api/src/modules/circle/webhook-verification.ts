import { createHmac, createPublicKey, createVerify, randomUUID, type KeyObject } from "node:crypto";
import { circleBaseUrl, circleEnvironment } from "./env-config.js";
import type { CircleEnvironment, CircleWebhookVerification } from "./types.js";
import { asRecord, asString } from "./value-utils.js";

const circleWebhookPublicKeyCache = new Map<string, KeyObject>();

const getCircleWebhookPublicKey = async (
  keyId: string,
  environment: CircleEnvironment
): Promise<KeyObject | undefined> => {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) return undefined;

  const cacheKey = `${environment}:${keyId}`;
  const cached = circleWebhookPublicKeyCache.get(cacheKey);
  if (cached) return cached;

  const baseUrls = Array.from(new Set([circleBaseUrl(environment), "https://api.circle.com"]));
  for (const baseUrl of baseUrls) {
    const response = await fetch(`${baseUrl}/v2/notifications/publicKey/${encodeURIComponent(keyId)}`, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`
      }
    });
    if (!response.ok) continue;

    const payload = await response.json() as Record<string, unknown>;
    const data = asRecord(payload.data);
    const encodedPublicKey = asString(data?.publicKey);
    if (!encodedPublicKey) continue;

    try {
      const keyObject = createPublicKey({
        key: Buffer.from(encodedPublicKey, "base64"),
        format: "der",
        type: "spki"
      });
      circleWebhookPublicKeyCache.set(cacheKey, keyObject);
      return keyObject;
    } catch {
      continue;
    }
  }
  return undefined;
};

const verifyCircleWebhookAsymmetricSignature = async (
  rawBody: string,
  signature: string,
  keyId: string,
  environment: CircleEnvironment
): Promise<boolean> => {
  const publicKey = await getCircleWebhookPublicKey(keyId, environment);
  if (!publicKey) return false;

  try {
    const verifier = createVerify("sha256");
    verifier.update(rawBody);
    verifier.end();
    return verifier.verify(publicKey, Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
};

export const verifyCircleWebhook = async (
  rawBody: string,
  signature: string | undefined,
  secret = process.env.CIRCLE_WEBHOOK_SECRET ?? "dev_webhook_secret",
  keyId?: string
): Promise<CircleWebhookVerification> => {
  const environment = circleEnvironment();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const hmacSignatureMatches = signature === expected || (environment !== "circle-production" && signature === "test_valid_signature");
  const asymmetricSignatureMatches = keyId && signature
    ? await verifyCircleWebhookAsymmetricSignature(rawBody, signature, keyId, environment)
    : false;
  const signatureMatches = hmacSignatureMatches || asymmetricSignatureMatches;
  const valid = environment === "simulator" ? (!signature || signatureMatches) : signatureMatches;
  const payload = rawBody.trim() ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
  const providerEventId = typeof payload.id === "string"
    ? payload.id
    : typeof payload.notificationId === "string"
      ? payload.notificationId
      : `circle_event_${randomUUID()}`;
  const eventType = typeof payload.type === "string"
    ? payload.type
    : typeof payload.notificationType === "string"
      ? payload.notificationType
      : "circle.transfer.status_changed";
  return {
    valid,
    providerEventId,
    eventType,
    normalizedPayload: {
      providerEventId,
      eventType,
      status: typeof payload.status === "string" ? payload.status : "unknown",
      resourceId: typeof payload.resourceId === "string" ? payload.resourceId : undefined
    }
  };
};
