import { config as loadEnv } from "dotenv";
import { checkCircleHealth, circleEnvironment } from "../modules/circle/index.js";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const run = async (): Promise<void> => {
  const environment = circleEnvironment();
  if (environment !== "circle-sandbox") {
    console.error(JSON.stringify({
      ok: false,
      error: "circle_sandbox_environment_required",
      environment
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const result = await checkCircleHealth({ probe: true });
  const ok = result.status === "ready";
  console.log(JSON.stringify({
    ok,
    environment: result.environment,
    baseUrl: result.baseUrl,
    apiKeyConfigured: result.apiKeyConfigured,
    timeoutMs: result.timeoutMs,
    retryMaxAttempts: result.retryMaxAttempts,
    status: result.status,
    providerRequestId: result.providerRequestId,
    httpStatus: result.httpStatus,
    errorCode: result.errorCode,
    response: result.responsePayload
  }, null, 2));
  if (!ok) process.exitCode = 1;
};

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "circle_sandbox_check_failed"
  }, null, 2));
  process.exitCode = 1;
});
