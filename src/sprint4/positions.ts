import { invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import type { ActorContext } from "../sprint1/types.js";
import type { Sprint3Application } from "../sprint3/application.js";
import type { LiquidityAlert, LiquidityPolicy, MaturityLadderItem, TreasuryPositionSnapshot } from "./types.js";

export class TreasuryPositionService {
  private readonly policies = new Map<string, LiquidityPolicy>();
  private readonly snapshots = new Map<string, TreasuryPositionSnapshot>();
  private readonly latestVersion = new Map<string, number>();
  private readonly alerts: LiquidityAlert[] = [];

  constructor(private readonly sprint3: Sprint3Application) {}

  setPolicy(context: ActorContext, input: Omit<LiquidityPolicy, "id" | "tenantId">): LiquidityPolicy {
    invariant(input.targetBalanceMinorUnits >= input.minimumBalanceMinorUnits, "liquidity_policy_invalid_target");
    invariant(input.maximumBalanceMinorUnits >= input.targetBalanceMinorUnits, "liquidity_policy_invalid_maximum");
    const policy: LiquidityPolicy = {
      id: nextId("policy"),
      tenantId: context.tenantId,
      ...input
    };
    this.policies.set(this.policyKey(context.tenantId, input.scopeType, input.scopeId), policy);
    return policy;
  }

  calculateAccountPosition(
    context: ActorContext,
    accountOfDigitalAssetId: string,
    options: { pendingInboundMinorUnits?: bigint; pendingOutboundMinorUnits?: bigint; expectedReceivableMinorUnits?: bigint } = {}
  ): TreasuryPositionSnapshot {
    const balance = this.sprint3.sprint2.balances.getClassifiedBalance(context, accountOfDigitalAssetId);
    const account = this.sprint3.sprint2.sprint1
      .listAccountsOfDigitalAsset(context)
      .find((item) => item.id === accountOfDigitalAssetId);
    invariant(Boolean(account), "account_of_digital_asset_not_found");
    const policy = this.policies.get(this.policyKey(context.tenantId, "account", accountOfDigitalAssetId));
    const expectedPayable = this.expectedPayableForActor(context, account!.businessClientId);
    const minimumBuffer = policy?.minimumBalanceMinorUnits ?? 0n;
    const current =
      balance.availableMinorUnits +
      balance.pendingMinorUnits +
      balance.reservedMinorUnits +
      balance.lockedMinorUnits +
      balance.suspenseMinorUnits;
    const deployable = max(balance.availableMinorUnits - balance.reservedMinorUnits - balance.lockedMinorUnits - minimumBuffer, 0n);
    const projected =
      current +
      (options.pendingInboundMinorUnits ?? 0n) -
      (options.pendingOutboundMinorUnits ?? 0n) +
      (options.expectedReceivableMinorUnits ?? 0n) -
      expectedPayable;
    const snapshot = this.makeSnapshot(context, {
      scopeType: "account",
      scopeId: accountOfDigitalAssetId,
      accountOfDigitalAssetId,
      businessClientId: account!.businessClientId,
      currentMinorUnits: current,
      deployableMinorUnits: deployable,
      projectedMinorUnits: projected,
      pendingInboundMinorUnits: options.pendingInboundMinorUnits ?? 0n,
      pendingOutboundMinorUnits: options.pendingOutboundMinorUnits ?? 0n,
      expectedPayableMinorUnits: expectedPayable,
      expectedReceivableMinorUnits: options.expectedReceivableMinorUnits ?? 0n,
      minimumBufferMinorUnits: minimumBuffer,
      sourceBalanceVersion: balance.version,
      staleAfterSeconds: policy?.staleAfterSeconds ?? 300
    });
    this.evaluatePolicy(context, snapshot, policy);
    return snapshot;
  }

  calculateActorPosition(context: ActorContext, businessClientId: string): TreasuryPositionSnapshot {
    const accounts = this.sprint3.sprint2.sprint1
      .listAccountsOfDigitalAsset(context)
      .filter((account) => account.businessClientId === businessClientId);
    invariant(accounts.length > 0, "actor_has_no_accounts");
    const accountSnapshots = accounts.map((account) => this.calculateAccountPosition(context, account.id));
    const policy = this.policies.get(this.policyKey(context.tenantId, "actor", businessClientId));
    const snapshot = this.makeSnapshot(context, {
      scopeType: "actor",
      scopeId: businessClientId,
      businessClientId,
      currentMinorUnits: sum(accountSnapshots.map((item) => item.currentMinorUnits)),
      deployableMinorUnits: max(sum(accountSnapshots.map((item) => item.deployableMinorUnits)) - (policy?.minimumBalanceMinorUnits ?? 0n), 0n),
      projectedMinorUnits: sum(accountSnapshots.map((item) => item.projectedMinorUnits)),
      pendingInboundMinorUnits: sum(accountSnapshots.map((item) => item.pendingInboundMinorUnits)),
      pendingOutboundMinorUnits: sum(accountSnapshots.map((item) => item.pendingOutboundMinorUnits)),
      expectedPayableMinorUnits: sum(accountSnapshots.map((item) => item.expectedPayableMinorUnits)),
      expectedReceivableMinorUnits: sum(accountSnapshots.map((item) => item.expectedReceivableMinorUnits)),
      minimumBufferMinorUnits: policy?.minimumBalanceMinorUnits ?? 0n,
      sourceBalanceVersion: Math.max(...accountSnapshots.map((item) => item.sourceBalanceVersion)),
      staleAfterSeconds: policy?.staleAfterSeconds ?? 300
    });
    this.evaluatePolicy(context, snapshot, policy);
    return snapshot;
  }

  markStaleAndBlockAutomation(snapshotId: string): boolean {
    const snapshot = this.snapshots.get(snapshotId);
    invariant(Boolean(snapshot), "position_snapshot_not_found");
    const stale: TreasuryPositionSnapshot = { ...snapshot!, freshnessStatus: "stale" };
    this.snapshots.set(stale.id, stale);
    this.alerts.push({
      id: nextId("alert"),
      tenantId: stale.tenantId,
      treasuryPositionSnapshotId: stale.id,
      alertType: "stale_position",
      amountMinorUnits: 0n,
      severity: "critical",
      status: "open"
    });
    return false;
  }

  maturityLadder(context: ActorContext, businessClientId: string): MaturityLadderItem[] {
    const items = this.sprint3.obligations
      .listObligations(context)
      .filter((obligation) => obligation.buyerBusinessClientId === businessClientId)
      .map((obligation) => ({
        dueDate: obligation.dueDate,
        expectedPayableMinorUnits: obligation.amountMinorUnits - obligation.disputedMinorUnits
      }));
    return items.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  }

  openAlerts(context: ActorContext): LiquidityAlert[] {
    return this.alerts.filter((alert) => alert.tenantId === context.tenantId && alert.status === "open");
  }

  private makeSnapshot(
    context: ActorContext,
    input: Omit<TreasuryPositionSnapshot, "id" | "tenantId" | "positionVersion" | "freshnessStatus" | "calculatedAt" | "staleAfter">
      & { staleAfterSeconds: number }
  ): TreasuryPositionSnapshot {
    const key = `${context.tenantId}:${input.scopeType}:${input.scopeId}`;
    const version = (this.latestVersion.get(key) ?? 0) + 1;
    this.latestVersion.set(key, version);
    const calculatedAt = nowIso();
    const staleAfter = new Date(Date.now() + input.staleAfterSeconds * 1000).toISOString();
    const snapshot: TreasuryPositionSnapshot = {
      id: nextId("position"),
      tenantId: context.tenantId,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      accountOfDigitalAssetId: input.accountOfDigitalAssetId,
      businessClientId: input.businessClientId,
      currentMinorUnits: input.currentMinorUnits,
      deployableMinorUnits: input.deployableMinorUnits,
      projectedMinorUnits: input.projectedMinorUnits,
      pendingInboundMinorUnits: input.pendingInboundMinorUnits,
      pendingOutboundMinorUnits: input.pendingOutboundMinorUnits,
      expectedPayableMinorUnits: input.expectedPayableMinorUnits,
      expectedReceivableMinorUnits: input.expectedReceivableMinorUnits,
      minimumBufferMinorUnits: input.minimumBufferMinorUnits,
      sourceBalanceVersion: input.sourceBalanceVersion,
      positionVersion: version,
      freshnessStatus: "fresh",
      calculatedAt,
      staleAfter
    };
    this.snapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  private evaluatePolicy(context: ActorContext, snapshot: TreasuryPositionSnapshot, policy?: LiquidityPolicy): void {
    if (!policy) return;
    if (snapshot.projectedMinorUnits < policy.minimumBalanceMinorUnits) {
      this.alerts.push({
        id: nextId("alert"),
        tenantId: context.tenantId,
        treasuryPositionSnapshotId: snapshot.id,
        alertType: "shortfall",
        amountMinorUnits: policy.minimumBalanceMinorUnits - snapshot.projectedMinorUnits,
        severity: "critical",
        status: "open"
      });
    }
    if (snapshot.projectedMinorUnits > policy.maximumBalanceMinorUnits) {
      this.alerts.push({
        id: nextId("alert"),
        tenantId: context.tenantId,
        treasuryPositionSnapshotId: snapshot.id,
        alertType: "surplus",
        amountMinorUnits: snapshot.projectedMinorUnits - policy.maximumBalanceMinorUnits,
        severity: "warning",
        status: "open"
      });
    }
  }

  private expectedPayableForActor(context: ActorContext, businessClientId: string): bigint {
    return sum(
      this.sprint3.obligations
        .listObligations(context)
        .filter((obligation) => obligation.buyerBusinessClientId === businessClientId && obligation.status !== "cancelled")
        .map((obligation) => obligation.amountMinorUnits - obligation.disputedMinorUnits)
    );
  }

  private policyKey(tenantId: string, scopeType: "account" | "actor", scopeId: string): string {
    return `${tenantId}:${scopeType}:${scopeId}`;
  }
}

const sum = (values: bigint[]): bigint => values.reduce((total, value) => total + value, 0n);
const max = (left: bigint, right: bigint): bigint => (left > right ? left : right);
