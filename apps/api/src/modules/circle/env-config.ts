import type { CircleEnvironment } from "./types.js";

export const circleEnvironment = (): CircleEnvironment => {
  const value = process.env.CIRCLE_ENVIRONMENT;
  if (value === "circle-sandbox" || value === "circle-production") return value;
  return "simulator";
};

export const circleBaseUrl = (environment: CircleEnvironment = circleEnvironment()): string =>
  process.env.CIRCLE_API_BASE_URL ?? (environment === "circle-production" ? "https://api.circle.com" : "https://api-sandbox.circle.com");

export const circleTimeoutMs = (): number => Number(process.env.CIRCLE_TIMEOUT_MS ?? 10000);

export const circleRetryMaxAttempts = (): number => Number(process.env.CIRCLE_RETRY_MAX_ATTEMPTS ?? 2);
