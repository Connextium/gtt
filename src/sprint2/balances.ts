import { DomainError, invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import type { InMemorySprint1Store } from "../sprint1/store.js";
import type { ActorContext, TreasuryJournalEntry, TreasuryJournalLine } from "../sprint1/types.js";
import type { BalanceProjectionRun, ClassifiedBalance, ExtendedAccountStatement } from "./types.js";

const zeroBalance = (accountOfDigitalAssetId: string): ClassifiedBalance => ({
  accountOfDigitalAssetId,
  assetCode: "USDC",
  currency: "USD",
  availableMinorUnits: 0n,
  pendingMinorUnits: 0n,
  reservedMinorUnits: 0n,
  lockedMinorUnits: 0n,
  suspenseMinorUnits: 0n,
  totalMinorUnits: 0n,
  version: 0,
  projectedAt: nowIso()
});

export class BalanceProjectionService {
  private readonly balances = new Map<string, ClassifiedBalance>();
  private readonly projectionRuns = new Map<string, BalanceProjectionRun>();

  constructor(private readonly store: InMemorySprint1Store) {}

  projectBalancesForAccount(context: ActorContext, accountOfDigitalAssetId: string): ClassifiedBalance {
    const startedAt = nowIso();
    const data = this.store.read((state) => {
      const account = state.accountsOfDigitalAsset.get(accountOfDigitalAssetId);
      invariant(Boolean(account), "account_of_digital_asset_not_found", { accountOfDigitalAssetId });
      invariant(account?.tenantId === context.tenantId, "tenant_access_denied");

      const entries = [...state.journalEntries.values()].filter((entry) => {
        return entry.tenantId === context.tenantId && entry.lines.some((line) => line.accountOfDigitalAssetId === accountOfDigitalAssetId);
      });
      return { entries };
    });

    const existing = this.balances.get(accountOfDigitalAssetId);
    const balance = zeroBalance(accountOfDigitalAssetId);
    balance.version = existing ? existing.version + 1 : 1;
    balance.projectedAt = nowIso();

    for (const entry of data.entries) {
      for (const line of entry.lines.filter((item) => item.accountOfDigitalAssetId === accountOfDigitalAssetId)) {
        this.applyLine(balance, line);
      }
    }

    balance.totalMinorUnits =
      balance.availableMinorUnits +
      balance.pendingMinorUnits +
      balance.reservedMinorUnits +
      balance.lockedMinorUnits +
      balance.suspenseMinorUnits;

    this.balances.set(accountOfDigitalAssetId, balance);

    const run: BalanceProjectionRun = {
      id: nextId("projection_run"),
      tenantId: context.tenantId,
      accountOfDigitalAssetId,
      status: "completed",
      sourceJournalCount: data.entries.length,
      startedAt,
      completedAt: nowIso()
    };
    this.projectionRuns.set(run.id, run);
    return balance;
  }

  getClassifiedBalance(context: ActorContext, accountOfDigitalAssetId: string): ClassifiedBalance {
    this.assertAccountAccess(context, accountOfDigitalAssetId);
    return this.balances.get(accountOfDigitalAssetId) ?? zeroBalance(accountOfDigitalAssetId);
  }

  applyProjectionUpdate(
    context: ActorContext,
    accountOfDigitalAssetId: string,
    expectedVersion: number,
    nextBalance: Omit<ClassifiedBalance, "version" | "projectedAt" | "totalMinorUnits">
  ): ClassifiedBalance {
    this.assertAccountAccess(context, accountOfDigitalAssetId);
    const current = this.balances.get(accountOfDigitalAssetId) ?? zeroBalance(accountOfDigitalAssetId);
    if (current.version !== expectedVersion) {
      throw new DomainError("balance_projection_version_conflict", "balance_projection_version_conflict", {
        expectedVersion,
        actualVersion: current.version
      });
    }

    this.assertNonNegative(nextBalance.availableMinorUnits);
    this.assertNonNegative(nextBalance.pendingMinorUnits);
    this.assertNonNegative(nextBalance.reservedMinorUnits);
    this.assertNonNegative(nextBalance.lockedMinorUnits);
    this.assertNonNegative(nextBalance.suspenseMinorUnits);

    const updated: ClassifiedBalance = {
      ...nextBalance,
      version: current.version + 1,
      projectedAt: nowIso(),
      totalMinorUnits:
        nextBalance.availableMinorUnits +
        nextBalance.pendingMinorUnits +
        nextBalance.reservedMinorUnits +
        nextBalance.lockedMinorUnits +
        nextBalance.suspenseMinorUnits
    };
    this.balances.set(accountOfDigitalAssetId, updated);
    return updated;
  }

  generateAccountStatement(context: ActorContext, accountOfDigitalAssetId: string): ExtendedAccountStatement {
    const movements = this.store.read((state) => {
      return [...state.journalEntries.values()].filter((entry) => {
        return entry.tenantId === context.tenantId && entry.lines.some((line) => line.accountOfDigitalAssetId === accountOfDigitalAssetId);
      });
    });
    const endingBalance = this.getClassifiedBalance(context, accountOfDigitalAssetId);
    return {
      accountOfDigitalAssetId,
      openingBalanceMinorUnits: 0n,
      endingBalance,
      movements
    };
  }

  projectionRunCount(): number {
    return this.projectionRuns.size;
  }

  private applyLine(balance: ClassifiedBalance, line: TreasuryJournalLine): void {
    const amount = line.debitMinorUnits - line.creditMinorUnits;
    switch (line.ledgerAccountId) {
      case "ledger_10020":
      case "ledger_10100":
        balance.availableMinorUnits += amount;
        break;
      case "ledger_10150":
        balance.suspenseMinorUnits += amount;
        break;
      default:
        break;
    }
  }

  private assertAccountAccess(context: ActorContext, accountOfDigitalAssetId: string): void {
    this.store.read((state) => {
      const account = state.accountsOfDigitalAsset.get(accountOfDigitalAssetId);
      invariant(Boolean(account), "account_of_digital_asset_not_found", { accountOfDigitalAssetId });
      invariant(account?.tenantId === context.tenantId, "tenant_access_denied");
    });
  }

  private assertNonNegative(value: bigint): void {
    invariant(value >= 0n, "balance_bucket_negative");
  }
}
