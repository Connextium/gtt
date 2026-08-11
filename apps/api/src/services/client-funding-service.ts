import { randomUUID } from "node:crypto";
import type { ClientFundingRepository } from "../db/repositories/client-funding-repository.js";
import type { PostgresRouteInput } from "../db/postgres-route-types.js";
import type { AuthenticatedBusinessUser } from "../modules/client-onboarding/index.js";
import type { JsonResponse } from "../http/index.js";

export interface ClientFundingService {
  list: (tenantId: string, user: AuthenticatedBusinessUser, filters: Record<string, string>) => Promise<JsonResponse>;
  detail: (tenantId: string, user: AuthenticatedBusinessUser, instructionId: string) => Promise<JsonResponse>;
  orders: (tenantId: string, user: AuthenticatedBusinessUser, instructionId: string) => Promise<JsonResponse>;
  create: (tenantId: string, user: AuthenticatedBusinessUser, input: PostgresRouteInput) => Promise<JsonResponse>;
}

export const createClientFundingService = (repository: ClientFundingRepository): ClientFundingService => {
  const resolveIdentity = async (tenantId: string, user: AuthenticatedBusinessUser) =>
    repository.resolveIdentity(tenantId, user.authUserId);

  return {
    list: async (tenantId, user, filters) => {
      const identity = await resolveIdentity(tenantId, user);
      if (!identity) return { status: 403, body: { error: "approved_business_client_required" } };
      const rows = await repository.listInstructions(tenantId, identity.businessClientId, filters);
      return { status: 200, body: { fundingInstructions: rows.map(mapClientInstruction) } };
    },

    detail: async (tenantId, user, instructionId) => {
      const identity = await resolveIdentity(tenantId, user);
      if (!identity) return { status: 403, body: { error: "approved_business_client_required" } };
      const row = await repository.getInstruction(tenantId, identity.businessClientId, instructionId);
      if (!row) return { status: 404, body: { error: "funding_instruction_not_found" } };
      const orders = await repository.listOrders(tenantId, identity.businessClientId, instructionId);
      return {
        status: 200,
        body: {
          fundingInstruction: mapClientInstruction(row),
          orders: orders.map(mapClientOrder)
        }
      };
    },

    orders: async (tenantId, user, instructionId) => {
      const identity = await resolveIdentity(tenantId, user);
      if (!identity) return { status: 403, body: { error: "approved_business_client_required" } };
      const instruction = await repository.getInstruction(tenantId, identity.businessClientId, instructionId);
      if (!instruction) return { status: 404, body: { error: "funding_instruction_not_found" } };
      const orders = await repository.listOrders(tenantId, identity.businessClientId, instructionId);
      return { status: 200, body: { fundingInstructionId: instructionId, orders: orders.map(mapClientOrder) } };
    },

    create: async (tenantId, user, input) => {
      const identity = await resolveIdentity(tenantId, user);
      if (!identity) return { status: 403, body: { error: "approved_business_client_required" } };

      const sourceAccountId = requiredString(input.body.sourceAccountOfDigitalAssetId);
      const destinationAccountId = requiredString(input.body.destinationAccountOfDigitalAssetId);
      const amountMinorUnits = requiredString(input.body.amountMinorUnits);
      if (!sourceAccountId || !destinationAccountId || !amountMinorUnits) {
        return { status: 400, body: { error: "source_destination_and_amount_required" } };
      }
      if (!isUuid(sourceAccountId) || !isUuid(destinationAccountId)) {
        return { status: 400, body: { error: "source_and_destination_must_be_uuid" } };
      }
      let amount: bigint;
      try {
        amount = BigInt(amountMinorUnits);
      } catch {
        return { status: 400, body: { error: "amount_minor_units_invalid" } };
      }
      if (amount <= 0n) return { status: 400, body: { error: "amount_must_be_positive" } };

      const [sourceAccount, destinationAccount] = await Promise.all([
        repository.findOwnedAccount(tenantId, identity.businessClientId, sourceAccountId),
        repository.findOwnedAccount(tenantId, identity.businessClientId, destinationAccountId)
      ]);
      if (!sourceAccount || !destinationAccount) {
        return { status: 403, body: { error: "account_not_authorized_for_business_client" } };
      }
      if (sourceAccount.status !== "active" || destinationAccount.status !== "active") {
        return { status: 409, body: { error: "active_source_and_destination_required" } };
      }

      const [sourceInstrument, destinationInstrument] = await Promise.all([
        repository.findEligibleLinkedInstrument(tenantId, sourceAccountId, "fiat"),
        repository.findEligibleLinkedInstrument(tenantId, destinationAccountId, "usdc")
      ]);
      if (!sourceInstrument) return { status: 409, body: { error: "verified_source_fiat_route_required" } };
      if (!destinationInstrument) return { status: 409, body: { error: "verified_destination_usdc_route_required" } };

      const instructionId = randomUUID();
      const wireOrderId = randomUUID();
      const usdcOrderId = randomUUID();
      const requestedAt = new Date().toISOString();
      const idempotencyKey = input.idempotencyKey ?? randomUUID();
      await repository.createInstruction({
        id: instructionId,
        tenantId,
        businessClientId: identity.businessClientId,
        sourceAccountId,
        destinationAccountId,
        amountMinorUnits: amount.toString(),
        idempotencyKey,
        correlationId: input.correlationId,
        requestedBy: user.authUserId,
        requestedAt,
        wireOrderId,
        usdcOrderId,
        routeEvidence: {
          clientSource: { accountOfDigitalAssetId: sourceAccountId, linkedInstrument: sourceInstrument },
          clientDestination: { accountOfDigitalAssetId: destinationAccountId, linkedInstrument: destinationInstrument },
          platformIntermediaryStatus: "pending_internal_route_assignment",
          capturedAt: requestedAt
        }
      });
      await repository.writeAuditAndOutbox(
        tenantId,
        "funding_instruction.client_exchange.created",
        input.correlationId,
        idempotencyKey,
        {
          fundingInstructionId: instructionId,
          businessClientId: identity.businessClientId,
          sourceAccountOfDigitalAssetId: sourceAccountId,
          destinationAccountOfDigitalAssetId: destinationAccountId,
          amountMinorUnits: amount.toString(),
          wireOrderId,
          usdcOrderId
        },
        randomUUID(),
        randomUUID()
      );
      const row = await repository.getInstruction(tenantId, identity.businessClientId, instructionId);
      const orders = await repository.listOrders(tenantId, identity.businessClientId, instructionId);
      return {
        status: 201,
        body: {
          fundingInstruction: row ? mapClientInstruction(row) : { id: instructionId },
          orders: orders.map(mapClientOrder)
        }
      };
    }
  };
};

const mapClientInstruction = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  sourceAccountOfDigitalAssetId: row.source_account_of_digital_asset_id,
  sourceAdaCode: adaCodeFromRow(row, "source"),
  sourceAccountCode: adaCodeFromRow(row, "source"),
  destinationAccountOfDigitalAssetId: row.destination_account_of_digital_asset_id,
  destinationAdaCode: adaCodeFromRow(row, "destination"),
  destinationAccountCode: adaCodeFromRow(row, "destination"),
  fundingType: "usdc_payin",
  instructionRole: "client_exchange",
  transferKind: "ada_to_ada_payin_underlying",
  assetCode: "USDC",
  currency: "USD",
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  pendingUsdcMinorUnits: String(row.pending_usdc_minor_units ?? 0),
  availableUsdcMinorUnits: String(row.available_usdc_minor_units ?? 0),
  status: row.status,
  supportReference: row.status === "exception_suspense" ? `FUND-${String(row.id).slice(0, 8).toUpperCase()}` : undefined,
  postingJournalEntryId: row.posting_journal_entry_id ?? undefined,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const mapClientOrder = (row: Record<string, unknown>): Record<string, unknown> => ({
  id: row.id,
  orderKind: row.order_kind,
  stage: row.order_kind === "ada_wire_transfer" ? "fiat_received" : "usdc_delivered",
  dependencyOrderId: row.dependency_order_id ?? undefined,
  amountMinorUnits: String(row.amount_minor_units ?? 0),
  currency: row.currency,
  status: row.status,
  completedAt: row.completed_webhook_event_id ? toIso(row.updated_at) : undefined,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at)
});

const requiredString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const isUuid = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const toIso = (value: unknown): string | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const adaCodeFromRow = (row: Record<string, unknown>, prefix: "source" | "destination"): string =>
  buildAdaAccountCode(
    String(row[`${prefix}_account_name`] ?? "ADA"),
    String(row[`${prefix}_use_purpose`] ?? "general"),
    String(row[`${prefix}_asset_code`] ?? "USDC")
  );

const buildAdaAccountCode = (accountName: string, usePurpose: string, assetCode: string): string => {
  const nameSeed = accountName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4).padEnd(4, "X");
  const purposeSeed = usePurpose.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "GEN";
  const assetSeed = assetCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "USDC";
  return `DAA-${assetSeed}-${purposeSeed}-${nameSeed}`;
};
