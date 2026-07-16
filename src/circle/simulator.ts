import type {
  CircleAdapter,
  CircleBalance,
  CircleBusinessClient,
  CircleAccountOfDigitalAsset,
  CircleEvent,
  CircleTransfer,
  CreateAccountInput,
  CreateBusinessClientInput,
  MoneyAmount,
  TransferInput
} from "./types.js";

const zeroUsdc = (): MoneyAmount => ({ assetCode: "USDC", amountMinor: "0" });

const addMinorUnits = (left: string, right: string): string => {
  return (BigInt(left) + BigInt(right)).toString();
};

const subtractMinorUnits = (left: string, right: string): string => {
  const result = BigInt(left) - BigInt(right);
  if (result < 0n) {
    throw new Error("insufficient_funds");
  }
  return result.toString();
};

export class InMemoryCircleSimulator implements CircleAdapter {
  private readonly clients = new Map<string, CircleBusinessClient>();
  private readonly accounts = new Map<string, CircleAccountOfDigitalAsset>();
  private readonly balances = new Map<string, CircleBalance>();
  private readonly idempotencyResults = new Map<string, unknown>();
  private readonly events: CircleEvent[] = [];
  private sequence = 1;

  async createBusinessClient(input: CreateBusinessClientInput): Promise<CircleBusinessClient> {
    return this.withIdempotency(input.idempotencyKey, () => {
      const client: CircleBusinessClient = {
        clientEntityId: this.nextId("client"),
        applicationId: this.nextId("application"),
        status: "draft"
      };
      this.clients.set(client.applicationId, client);
      this.recordEvent("onboarding.application_created", client);
      return client;
    });
  }

  async approveBusinessClient(applicationId: string): Promise<CircleBusinessClient> {
    const client = this.clients.get(applicationId);
    if (!client) {
      throw new Error("application_not_found");
    }
    const approved: CircleBusinessClient = { ...client, status: "approved" };
    this.clients.set(applicationId, approved);
    this.recordEvent("onboarding.application_approved", approved);
    return approved;
  }

  async createAccountOfDigitalAsset(input: CreateAccountInput): Promise<CircleAccountOfDigitalAsset> {
    return this.withIdempotency(input.idempotencyKey, () => {
      const account: CircleAccountOfDigitalAsset = {
        accountId: this.nextId("account"),
        clientEntityId: input.clientEntityId,
        subAccountId: this.nextId("sub_account"),
        status: "active"
      };
      this.accounts.set(account.accountId, account);
      this.balances.set(account.accountId, {
        accountId: account.accountId,
        available: zeroUsdc(),
        pending: zeroUsdc()
      });
      this.recordEvent("account_of_digital_asset.provisioned", account);
      return account;
    });
  }

  async getBalance(accountId: string): Promise<CircleBalance> {
    const balance = this.balances.get(accountId);
    if (!balance) {
      throw new Error("account_not_found");
    }
    return balance;
  }

  async createInternalTransfer(input: TransferInput): Promise<CircleTransfer> {
    return this.withIdempotency(input.idempotencyKey, () => {
      const source = this.requireBalance(input.sourceAccountId);
      const destination = this.requireBalance(input.destinationAccountId);

      source.available.amountMinor = subtractMinorUnits(source.available.amountMinor, input.amount.amountMinor);
      destination.available.amountMinor = addMinorUnits(destination.available.amountMinor, input.amount.amountMinor);

      const transfer: CircleTransfer = {
        transferId: this.nextId("transfer"),
        sourceAccountId: input.sourceAccountId,
        destinationAccountId: input.destinationAccountId,
        amount: input.amount,
        status: "settled"
      };
      this.recordEvent("payment_instruction.executed", transfer);
      return transfer;
    });
  }

  async listEvents(): Promise<CircleEvent[]> {
    return [...this.events];
  }

  seedBalance(accountId: string, amount: MoneyAmount): void {
    const balance = this.requireBalance(accountId);
    balance.available.amountMinor = addMinorUnits(balance.available.amountMinor, amount.amountMinor);
    this.recordEvent("fiat_deposit.received", { accountId, amount });
  }

  private requireBalance(accountId: string): CircleBalance {
    const balance = this.balances.get(accountId);
    if (!balance) {
      throw new Error("account_not_found");
    }
    return balance;
  }

  private withIdempotency<T>(key: string, action: () => T): T {
    const existing = this.idempotencyResults.get(key);
    if (existing) {
      return existing as T;
    }
    const result = action();
    this.idempotencyResults.set(key, result);
    return result;
  }

  private recordEvent(eventType: string, payload: unknown): void {
    this.events.push({
      eventId: this.nextId("event"),
      eventType,
      occurredAt: new Date().toISOString(),
      payload
    });
  }

  private nextId(prefix: string): string {
    const id = `${prefix}_${this.sequence.toString().padStart(6, "0")}`;
    this.sequence += 1;
    return id;
  }
}
