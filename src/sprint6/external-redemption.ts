import { invariant } from "../sprint1/errors.js";
import { nextId } from "../sprint1/ids.js";
import { parseMinorUnits } from "../sprint1/money.js";
import type { ActorContext } from "../sprint1/types.js";
import type { Sprint5Application } from "../sprint5/application.js";
import type { ExternalPaymentExecution, ExternalRecipient, FiatWireAccount, RedemptionInstruction, ReversalObligation } from "./types.js";

export class Sprint6ExternalRedemptionService {
  private readonly recipients = new Map<string, ExternalRecipient>();
  private readonly payments = new Map<string, ExternalPaymentExecution>();
  private readonly wireAccounts = new Map<string, FiatWireAccount>();
  private readonly redemptions = new Map<string, RedemptionInstruction>();
  private readonly reversals: ReversalObligation[] = [];

  constructor(private readonly sprint5: Sprint5Application) {}

  registerRecipient(context: ActorContext, input: { label: string; chain: "base" | "ethereum"; address: string }): ExternalRecipient {
    invariant(input.address.startsWith("0x") && input.address.length >= 10, "recipient_address_invalid");
    const recipient: ExternalRecipient = {
      id: nextId("recipient"),
      tenantId: context.tenantId,
      label: input.label,
      assetCode: "USDC",
      chain: input.chain,
      address: input.address,
      status: "active"
    };
    this.recipients.set(recipient.id, recipient);
    return recipient;
  }

  submitExternalPayment(
    context: ActorContext,
    input: {
      sourceAccountOfDigitalAssetId: string;
      externalRecipientId: string;
      settlementObligationId: string;
      fundingReservationId: string;
      amountMinorUnits: string | number | bigint;
      feeMinorUnits?: string | number | bigint;
      idempotencyKey: string;
      simulateFailure?: boolean;
    }
  ): ExternalPaymentExecution {
    const existing = [...this.payments.values()].find((payment) => payment.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const recipient = this.requireRecipient(context, input.externalRecipientId);
    invariant(recipient.assetCode === "USDC", "asset_not_supported");
    invariant(recipient.chain === "base" || recipient.chain === "ethereum", "chain_not_supported");
    const amount = parseMinorUnits(input.amountMinorUnits);
    const fee = parseMinorUnits(input.feeMinorUnits ?? 0n);
    const balance = this.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, input.sourceAccountOfDigitalAssetId);
    invariant(amount + fee <= balance.reservedMinorUnits, "external_payment_exceeds_reserved_balance");
    const status = input.simulateFailure ? "failed" : "complete";
    const execution: ExternalPaymentExecution = {
      id: nextId("external_payment"),
      tenantId: context.tenantId,
      sourceAccountOfDigitalAssetId: input.sourceAccountOfDigitalAssetId,
      externalRecipientId: input.externalRecipientId,
      settlementObligationId: input.settlementObligationId,
      fundingReservationId: input.fundingReservationId,
      amountMinorUnits: amount,
      feeMinorUnits: fee,
      idempotencyKey: input.idempotencyKey,
      status,
      providerTransferId: nextId("circle_crypto_transfer"),
      blockchainTxHash: status === "complete" ? `0x${nextId("tx").replaceAll("_", "")}` : undefined,
      failureCode: status === "failed" ? "simulated_external_payment_failure" : undefined
    };
    this.payments.set(execution.id, execution);
    this.sprint5.sprint4.sprint3.sprint2.balances.applyProjectionUpdate(context, input.sourceAccountOfDigitalAssetId, balance.version, {
      ...balance,
      reservedMinorUnits: balance.reservedMinorUnits - amount - fee,
      availableMinorUnits: status === "failed" ? balance.availableMinorUnits + amount : balance.availableMinorUnits
    });
    if (status === "failed") {
      this.reversals.push({
        id: nextId("reversal"),
        tenantId: context.tenantId,
        sourceExecutionId: execution.id,
        sourceExecutionType: "external_payment",
        reasonCode: "external_payment_failed",
        status: "open"
      });
    }
    return execution;
  }

  linkFiatWireAccount(context: ActorContext, input: { businessClientId: string; bankName: string; accountNumberLast4: string; routingNumber: string }): FiatWireAccount {
    const account: FiatWireAccount = {
      id: nextId("fiat_wire"),
      tenantId: context.tenantId,
      businessClientId: input.businessClientId,
      bankName: input.bankName,
      accountNumberLast4: input.accountNumberLast4,
      routingNumber: input.routingNumber,
      status: "active"
    };
    this.wireAccounts.set(account.id, account);
    return account;
  }

  submitRedemption(
    context: ActorContext,
    input: {
      sourceAccountOfDigitalAssetId: string;
      fiatWireAccountId: string;
      amountMinorUnits: string | number | bigint;
      idempotencyKey: string;
      simulateUnknown?: boolean;
    }
  ): RedemptionInstruction {
    const existing = [...this.redemptions.values()].find((redemption) => redemption.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    this.requireWireAccount(context, input.fiatWireAccountId);
    const amount = parseMinorUnits(input.amountMinorUnits);
    const balance = this.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, input.sourceAccountOfDigitalAssetId);
    invariant(amount <= balance.availableMinorUnits, "redemption_exceeds_available_balance");
    const redemption: RedemptionInstruction = {
      id: nextId("redemption"),
      tenantId: context.tenantId,
      sourceAccountOfDigitalAssetId: input.sourceAccountOfDigitalAssetId,
      fiatWireAccountId: input.fiatWireAccountId,
      amountMinorUnits: amount,
      idempotencyKey: input.idempotencyKey,
      status: input.simulateUnknown ? "unknown_suspense" : "complete",
      providerWithdrawalId: nextId("circle_withdrawal"),
      suspenseReason: input.simulateUnknown ? "provider_status_unknown" : undefined
    };
    this.redemptions.set(redemption.id, redemption);
    this.sprint5.sprint4.sprint3.sprint2.balances.applyProjectionUpdate(context, input.sourceAccountOfDigitalAssetId, balance.version, {
      ...balance,
      availableMinorUnits: balance.availableMinorUnits - amount,
      suspenseMinorUnits: input.simulateUnknown ? balance.suspenseMinorUnits + amount : balance.suspenseMinorUnits
    });
    return redemption;
  }

  manualStatusRefresh(context: ActorContext, redemptionId: string, status: "complete" | "failed"): RedemptionInstruction {
    const redemption = this.redemptions.get(redemptionId);
    invariant(Boolean(redemption), "redemption_not_found");
    invariant(redemption?.tenantId === context.tenantId, "tenant_access_denied");
    const updated = { ...redemption!, status, suspenseReason: undefined };
    this.redemptions.set(updated.id, updated);
    return updated;
  }

  timeoutExternalPayment(context: ActorContext, executionId: string): ExternalPaymentExecution {
    const execution = this.payments.get(executionId);
    invariant(Boolean(execution), "external_payment_not_found");
    invariant(execution?.tenantId === context.tenantId, "tenant_access_denied");
    const updated = { ...execution!, status: "timeout" as const };
    this.payments.set(updated.id, updated);
    return updated;
  }

  reversalObligations(context: ActorContext): ReversalObligation[] {
    return this.reversals.filter((item) => item.tenantId === context.tenantId);
  }

  private requireRecipient(context: ActorContext, recipientId: string): ExternalRecipient {
    const recipient = this.recipients.get(recipientId);
    invariant(Boolean(recipient), "external_recipient_not_found");
    invariant(recipient?.tenantId === context.tenantId, "tenant_access_denied");
    return recipient!;
  }

  private requireWireAccount(context: ActorContext, wireAccountId: string): FiatWireAccount {
    const account = this.wireAccounts.get(wireAccountId);
    invariant(Boolean(account), "fiat_wire_account_not_found");
    invariant(account?.tenantId === context.tenantId, "tenant_access_denied");
    return account!;
  }
}
