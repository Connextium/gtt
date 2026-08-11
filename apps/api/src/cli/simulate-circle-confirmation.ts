import { createHmac, randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ quiet: true });

const argumentValue = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const requiredArgument = (name: string): string => {
  const value = argumentValue(name)?.trim();
  if (!value) throw new Error(`missing_required_argument:--${name}`);
  return value;
};

const run = async (): Promise<void> => {
  if (process.argv.includes("--help")) {
    console.log(`Usage:
  npm run circle:simulate-confirmation -- \\
    --funding-instruction-id <uuid> \\
    --amount-minor-units <positive-integer> \\
    [--event-type <event-type>] \\
    [--destination-account-id <uuid>] \\
    [--event-id <provider-event-id>] \\
    [--provider-reference-id <provider-reference-id>] \\
    [--url <webhook-url>]

The default event type is usdc.mint.confirmed.
Use the default for internal_treasury_mint instructions.
For client_exchange instructions, simulate wire.received before usdc.delivery.confirmed.`);
    return;
  }

  const fundingInstructionId = requiredArgument("funding-instruction-id");
  const amountMinorUnits = requiredArgument("amount-minor-units");
  if (!/^\d+$/.test(amountMinorUnits) || BigInt(amountMinorUnits) <= 0n) {
    throw new Error("amount_minor_units_must_be_a_positive_integer");
  }

  const eventType = argumentValue("event-type")?.trim() || "usdc.mint.confirmed";

  const webhookUrl = argumentValue("url")
    ?? process.env.CIRCLE_WEBHOOK_SIMULATOR_URL
    ?? "http://localhost:4000/webhooks/circle";
  const apiKey = process.env.GTT_DEV_API_KEY;
  if (apiKey) {
    const instructionUrl = new URL(webhookUrl);
    instructionUrl.pathname = `/funding-instructions/${encodeURIComponent(fundingInstructionId)}`;
    instructionUrl.search = "";
    const instructionResponse = await fetch(instructionUrl, {
      headers: { authorization: `Bearer ${apiKey}` }
    });
    if (!instructionResponse.ok) {
      throw new Error(`funding_instruction_preflight_failed:http_${instructionResponse.status}`);
    }
    const instructionBody = await instructionResponse.json() as Record<string, unknown>;
    const instruction = instructionBody.fundingInstruction && typeof instructionBody.fundingInstruction === "object"
      ? instructionBody.fundingInstruction as Record<string, unknown>
      : undefined;
    const expectedAmountMinorUnits = typeof instruction?.amountMinorUnits === "string"
      ? instruction.amountMinorUnits
      : undefined;
    if (!expectedAmountMinorUnits) throw new Error("funding_instruction_preflight_missing_amount");
    if (expectedAmountMinorUnits !== amountMinorUnits) {
      throw new Error(`funding_instruction_amount_mismatch:expected_${expectedAmountMinorUnits}:received_${amountMinorUnits}`);
    }
    const instructionRole = typeof instruction?.instructionRole === "string"
      ? instruction.instructionRole
      : undefined;
    if (instructionRole === "client_exchange" && isUsdcConfirmationEvent(eventType)) {
      const ordersUrl = new URL(instructionUrl);
      ordersUrl.pathname = `/funding-instructions/${encodeURIComponent(fundingInstructionId)}/orders`;
      const ordersResponse = await fetch(ordersUrl, {
        headers: { authorization: `Bearer ${apiKey}` }
      });
      if (!ordersResponse.ok) {
        throw new Error(`funding_instruction_orders_preflight_failed:http_${ordersResponse.status}`);
      }
      const ordersBody = await ordersResponse.json() as Record<string, unknown>;
      const orders = Array.isArray(ordersBody.orders)
        ? ordersBody.orders as Array<Record<string, unknown>>
        : [];
      const wireOrder = orders.find((order) => order.orderKind === "ada_wire_transfer");
      if (wireOrder?.status !== "completed") {
        throw new Error(
          `client_exchange_wire_not_completed:status_${String(wireOrder?.status ?? "missing")}`
          + ":simulate_wire.received_before_usdc_confirmation"
        );
      }
    }
    console.log("[circle webhook simulator] Funding instruction preflight passed", {
      fundingInstructionId,
      instructionRole,
      status: instruction?.status,
      amountMinorUnits: expectedAmountMinorUnits
    });
  }

  const destinationAccountOfDigitalAssetId = argumentValue("destination-account-id")?.trim();
  const providerEventId = argumentValue("event-id")?.trim() ?? `evt_simulated_${randomUUID()}`;
  const providerReferenceId = argumentValue("provider-reference-id")?.trim() ?? `circle_simulated_${randomUUID()}`;
  const secret = process.env.CIRCLE_WEBHOOK_SECRET ?? "dev_webhook_secret";
  const payload = {
    id: providerEventId,
    type: eventType,
    status: "complete",
    fundingInstructionId,
    providerReferenceId,
    ...(destinationAccountOfDigitalAssetId ? { destinationAccountOfDigitalAssetId } : {}),
    amountMinorUnits
  };
  const rawBody = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(rawBody).digest("hex");

  console.log(`[circle webhook simulator] Generated ${eventType} payload`);
  console.log(JSON.stringify(payload, null, 2));

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "circle-signature": signature,
      "idempotency-key": `circle-webhook-${providerEventId}`
    },
    body: rawBody
  });
  const responseText = await response.text();
  let responseBody: unknown = responseText;
  try {
    responseBody = responseText ? JSON.parse(responseText) : undefined;
  } catch {
    // Preserve a non-JSON response for diagnostics.
  }

  console.log(JSON.stringify({
    ok: response.ok,
    eventType,
    webhookUrl,
    request: payload,
    httpStatus: response.status,
    response: responseBody
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
};

const isUsdcConfirmationEvent = (eventType: string): boolean => {
  const normalized = eventType.toLowerCase();
  return normalized.includes("usdc")
    && (normalized.includes("confirm") || normalized.includes("complete") || normalized.includes("settle"));
};

run().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "circle_confirmation_simulation_failed"
  }, null, 2));
  process.exitCode = 1;
});