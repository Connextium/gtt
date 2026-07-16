import { DomainError, invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import { parseMinorUnits } from "../sprint1/money.js";
import type { ActorContext } from "../sprint1/types.js";
import type { Sprint4Application } from "../sprint4/application.js";
import type {
  FundingDeposit,
  InternalTransferExecution,
  PaymentInstruction,
  PaymentInstructionEvent,
  ProcessingAttempt,
  WebhookNotification,
  WireFundingInstruction
} from "./types.js";

export class Sprint5SettlementService {
  private readonly webhooks = new Map<string, WebhookNotification>();
  private readonly attempts: ProcessingAttempt[] = [];
  private readonly instructions = new Map<string, WireFundingInstruction>();
  private readonly deposits = new Map<string, FundingDeposit>();
  private readonly payments = new Map<string, PaymentInstruction>();
  private readonly paymentEvents: PaymentInstructionEvent[] = [];
  private readonly transfers = new Map<string, InternalTransferExecution>();

  constructor(private readonly sprint4: Sprint4Application) {}

  storeWireInstructions(context: ActorContext, accountOfDigitalAssetId: string): WireFundingInstruction {
    this.assertAccount(context, accountOfDigitalAssetId);
    const instruction: WireFundingInstruction = {
      id: nextId("wire"),
      tenantId: context.tenantId,
      accountOfDigitalAssetId,
      bankName: "Circle Simulator Bank",
      routingNumber: "000000001",
      accountNumberLast4: "1001",
      beneficiaryName: "Global Trade Treasury FBO Customer",
      status: "active",
      createdAt: nowIso()
    };
    this.instructions.set(instruction.id, instruction);
    return instruction;
  }

  receiveWebhook(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    signature: string;
  }): WebhookNotification {
    const existing = this.webhooks.get(input.eventId);
    if (existing) return existing;
    const signatureValid = input.signature === "valid-signature";
    const notification: WebhookNotification = {
      id: nextId("webhook"),
      provider: "circle_simulator",
      eventId: input.eventId,
      eventType: input.eventType,
      signatureValid,
      rawPayload: input.payload,
      processingStatus: signatureValid ? "queued" : "dead_letter",
      receivedAt: nowIso()
    };
    this.webhooks.set(input.eventId, notification);
    this.attempts.push({
      id: nextId("attempt"),
      webhookNotificationId: notification.id,
      attemptNumber: 1,
      status: notification.processingStatus,
      errorCode: signatureValid ? undefined : "invalid_signature",
      createdAt: nowIso()
    });
    return notification;
  }

  processDepositWebhook(context: ActorContext, eventId: string): FundingDeposit {
    const notification = this.requireWebhook(eventId);
    invariant(notification.signatureValid, "webhook_signature_invalid");
    if (notification.processingStatus === "processed") {
      const existing = [...this.deposits.values()].find((deposit) => deposit.webhookNotificationId === notification.id);
      invariant(Boolean(existing), "deposit_not_found_for_processed_webhook");
      return existing!;
    }
    const accountOfDigitalAssetId = String(notification.rawPayload.accountOfDigitalAssetId);
    const providerDepositId = String(notification.rawPayload.providerDepositId);
    const amount = parseMinorUnits(String(notification.rawPayload.amountMinorUnits));
    this.assertAccount(context, accountOfDigitalAssetId);
    const deposit: FundingDeposit = {
      id: nextId("deposit"),
      tenantId: context.tenantId,
      accountOfDigitalAssetId,
      webhookNotificationId: notification.id,
      providerDepositId,
      amountMinorUnits: amount,
      status: "settled",
      createdAt: nowIso(),
      settledAt: nowIso()
    };
    this.deposits.set(providerDepositId, deposit);
    const balance = this.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, accountOfDigitalAssetId);
    this.sprint4.sprint3.sprint2.balances.applyProjectionUpdate(context, accountOfDigitalAssetId, balance.version, {
      ...balance,
      availableMinorUnits: balance.availableMinorUnits + amount
    });
    notification.processingStatus = "processed";
    notification.processedAt = nowIso();
    this.attempts.push({
      id: nextId("attempt"),
      webhookNotificationId: notification.id,
      attemptNumber: 2,
      status: "processed",
      createdAt: nowIso()
    });
    return deposit;
  }

  createPaymentInstruction(
    context: ActorContext,
    input: {
      sourceAccountOfDigitalAssetId: string;
      destinationAccountOfDigitalAssetId: string;
      settlementObligationId: string;
      fundingReservationId: string;
      amountMinorUnits: string | number | bigint;
      idempotencyKey: string;
    }
  ): PaymentInstruction {
    const existing = [...this.payments.values()].find((payment) => payment.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    this.assertAccount(context, input.sourceAccountOfDigitalAssetId);
    this.assertAccount(context, input.destinationAccountOfDigitalAssetId);
    const amount = parseMinorUnits(input.amountMinorUnits);
    const payment: PaymentInstruction = {
      id: nextId("payment"),
      tenantId: context.tenantId,
      sourceAccountOfDigitalAssetId: input.sourceAccountOfDigitalAssetId,
      destinationAccountOfDigitalAssetId: input.destinationAccountOfDigitalAssetId,
      settlementObligationId: input.settlementObligationId,
      fundingReservationId: input.fundingReservationId,
      amountMinorUnits: amount,
      routeType: "internal",
      status: "created",
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso()
    };
    this.payments.set(payment.id, payment);
    this.recordPaymentEvent(context, payment.id, "payment_instruction.created", {});
    return payment;
  }

  executeInternalSettlement(context: ActorContext, paymentInstructionId: string): InternalTransferExecution {
    const payment = this.requirePayment(context, paymentInstructionId);
    if (payment.status === "settled") {
      return [...this.transfers.values()].find((transfer) => transfer.paymentInstructionId === payment.id)!;
    }
    const source = this.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, payment.sourceAccountOfDigitalAssetId);
    const destination = this.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, payment.destinationAccountOfDigitalAssetId);
    invariant(payment.amountMinorUnits <= source.reservedMinorUnits, "settlement_exceeds_reserved_balance");
    this.sprint4.sprint3.sprint2.balances.applyProjectionUpdate(context, payment.sourceAccountOfDigitalAssetId, source.version, {
      ...source,
      reservedMinorUnits: source.reservedMinorUnits - payment.amountMinorUnits,
      availableMinorUnits: source.availableMinorUnits
    });
    this.sprint4.sprint3.sprint2.balances.applyProjectionUpdate(context, payment.destinationAccountOfDigitalAssetId, destination.version, {
      ...destination,
      availableMinorUnits: destination.availableMinorUnits + payment.amountMinorUnits
    });
    payment.status = "settled";
    payment.terminalAt = nowIso();
    const transfer: InternalTransferExecution = {
      id: nextId("transfer_execution"),
      tenantId: context.tenantId,
      paymentInstructionId: payment.id,
      provider: "circle_simulator",
      providerTransferId: nextId("circle_transfer"),
      status: "settled",
      createdAt: nowIso()
    };
    this.transfers.set(transfer.id, transfer);
    this.recordPaymentEvent(context, payment.id, "payment_instruction.settled", {
      transferExecutionId: transfer.id
    });
    return transfer;
  }

  recordDeadLetter(eventId: string, errorCode: string): void {
    const notification = this.requireWebhook(eventId);
    notification.processingStatus = "dead_letter";
    this.attempts.push({
      id: nextId("attempt"),
      webhookNotificationId: notification.id,
      attemptNumber: this.attempts.filter((attempt) => attempt.webhookNotificationId === notification.id).length + 1,
      status: "dead_letter",
      errorCode,
      createdAt: nowIso()
    });
  }

  paymentTimeline(paymentInstructionId: string): PaymentInstructionEvent[] {
    return this.paymentEvents.filter((event) => event.paymentInstructionId === paymentInstructionId);
  }

  processingHistory(eventId: string): ProcessingAttempt[] {
    const notification = this.requireWebhook(eventId);
    return this.attempts.filter((attempt) => attempt.webhookNotificationId === notification.id);
  }

  depositCount(): number {
    return this.deposits.size;
  }

  private assertAccount(context: ActorContext, accountOfDigitalAssetId: string): void {
    const account = this.sprint4.sprint3.sprint2.sprint1
      .listAccountsOfDigitalAsset(context)
      .find((item) => item.id === accountOfDigitalAssetId);
    invariant(Boolean(account), "account_of_digital_asset_not_found");
  }

  private requireWebhook(eventId: string): WebhookNotification {
    const notification = this.webhooks.get(eventId);
    if (!notification) throw new DomainError("webhook_notification_not_found");
    return notification;
  }

  private requirePayment(context: ActorContext, paymentInstructionId: string): PaymentInstruction {
    const payment = this.payments.get(paymentInstructionId);
    invariant(Boolean(payment), "payment_instruction_not_found");
    invariant(payment?.tenantId === context.tenantId, "tenant_access_denied");
    return payment!;
  }

  private recordPaymentEvent(
    context: ActorContext,
    paymentInstructionId: string,
    eventType: string,
    payload: Record<string, unknown>
  ): void {
    this.paymentEvents.push({
      id: nextId("payment_event"),
      tenantId: context.tenantId,
      paymentInstructionId,
      eventType,
      payload,
      createdAt: nowIso()
    });
  }
}
