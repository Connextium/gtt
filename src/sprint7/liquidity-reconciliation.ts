import { invariant } from "../sprint1/errors.js";
import { nextId, nowIso } from "../sprint1/ids.js";
import { parseMinorUnits } from "../sprint1/money.js";
import type { ActorContext } from "../sprint1/types.js";
import type { Sprint6Application } from "../sprint6/application.js";
import type {
  CircleBalanceSnapshot,
  CircleTransactionSnapshot,
  DailyCloseReport,
  LiquidityRebalancingInstruction,
  OperationsConsoleSnapshot,
  ReconciliationBreak,
  ReconciliationResolutionType,
  ReconciliationRun,
  TrialBalanceReport
} from "./types.js";

export class Sprint7LiquidityReconciliationService {
  private readonly rebalancingInstructions = new Map<string, LiquidityRebalancingInstruction>();
  private readonly circleBalanceSnapshots = new Map<string, CircleBalanceSnapshot>();
  private readonly circleTransactionSnapshots = new Map<string, CircleTransactionSnapshot>();
  private readonly reconciliationRuns = new Map<string, ReconciliationRun>();
  private readonly reconciliationBreaks = new Map<string, ReconciliationBreak>();
  private readonly staleOrBrokenPositionSnapshotIds = new Set<string>();

  constructor(private readonly sprint6: Sprint6Application) {}

  recommendForShortfall(
    context: ActorContext,
    input: {
      destinationAccountOfDigitalAssetId: string;
      targetBalanceMinorUnits: string | number | bigint;
      approvalThresholdMinorUnits: string | number | bigint;
      permittedSourceAccountIds: string[];
      estimatedFeeMinorUnits?: string | number | bigint;
    }
  ): LiquidityRebalancingInstruction {
    this.requireTreasury(context);
    const target = parseMinorUnits(input.targetBalanceMinorUnits);
    const approvalThreshold = parseMinorUnits(input.approvalThresholdMinorUnits);
    const estimatedFee = parseMinorUnits(input.estimatedFeeMinorUnits ?? 0n);
    const destinationBalance = this.sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(
      context,
      input.destinationAccountOfDigitalAssetId
    );
    const shortfall = target - destinationBalance.availableMinorUnits;
    invariant(shortfall > 0n, "destination_account_has_no_shortfall");

    const destinationPosition = this.sprint6.sprint5.sprint4.positions.calculateAccountPosition(context, input.destinationAccountOfDigitalAssetId);
    const eligibleSources = input.permittedSourceAccountIds
      .filter((accountId) => accountId !== input.destinationAccountOfDigitalAssetId)
      .map((accountId) => ({
        accountId,
        position: this.sprint6.sprint5.sprint4.positions.calculateAccountPosition(context, accountId)
      }))
      .filter(({ position }) => position.freshnessStatus === "fresh" && position.deployableMinorUnits >= shortfall + estimatedFee)
      .sort((left, right) => Number(right.position.deployableMinorUnits - left.position.deployableMinorUnits));
    invariant(eligibleSources.length > 0, "no_eligible_liquidity_source");

    const source = eligibleSources[0]!;
    const instruction: LiquidityRebalancingInstruction = {
      id: nextId("rebalance"),
      tenantId: context.tenantId,
      sourceAccountOfDigitalAssetId: source.accountId,
      destinationAccountOfDigitalAssetId: input.destinationAccountOfDigitalAssetId,
      amountMinorUnits: shortfall,
      estimatedFeeMinorUnits: estimatedFee,
      routeType: "internal_rebalance",
      routeExplanation: "Internal ADA rebalance selected because source and destination are active USDC platform accounts.",
      recommendationReason: `Destination shortfall ${shortfall.toString()} minor units below target ${target.toString()}.`,
      sourcePositionSnapshotId: source.position.id,
      destinationPositionSnapshotId: destinationPosition.id,
      approvalRequired: shortfall > approvalThreshold,
      createdBy: context.userId,
      status: shortfall > approvalThreshold ? "pending_approval" : "approved"
    };
    this.rebalancingInstructions.set(instruction.id, instruction);
    return instruction;
  }

  approveRebalance(context: ActorContext, instructionId: string): LiquidityRebalancingInstruction {
    this.requireTreasury(context);
    const instruction = this.requireInstruction(context, instructionId);
    invariant(instruction.status === "pending_approval", "rebalance_not_pending_approval");
    invariant(instruction.createdBy !== context.userId, "maker_checker_same_user_not_allowed");
    const updated: LiquidityRebalancingInstruction = {
      ...instruction,
      approvedBy: context.userId,
      approvedAt: nowIso(),
      status: "approved"
    };
    this.rebalancingInstructions.set(updated.id, updated);
    return updated;
  }

  executeRebalance(context: ActorContext, instructionId: string): LiquidityRebalancingInstruction {
    this.requireTreasury(context);
    const instruction = this.requireInstruction(context, instructionId);
    invariant(instruction.status === "approved", "rebalance_not_approved");
    invariant(!this.staleOrBrokenPositionSnapshotIds.has(instruction.sourcePositionSnapshotId), "source_position_not_executable");
    invariant(!this.staleOrBrokenPositionSnapshotIds.has(instruction.destinationPositionSnapshotId), "destination_position_not_executable");

    const balances = this.sprint6.sprint5.sprint4.sprint3.sprint2.balances;
    const sourceBalance = balances.getClassifiedBalance(context, instruction.sourceAccountOfDigitalAssetId);
    const destinationBalance = balances.getClassifiedBalance(context, instruction.destinationAccountOfDigitalAssetId);
    const totalDebit = instruction.amountMinorUnits + instruction.estimatedFeeMinorUnits;
    invariant(sourceBalance.availableMinorUnits >= totalDebit, "rebalance_source_balance_insufficient");

    balances.applyProjectionUpdate(context, instruction.sourceAccountOfDigitalAssetId, sourceBalance.version, {
      ...sourceBalance,
      availableMinorUnits: sourceBalance.availableMinorUnits - totalDebit
    });
    balances.applyProjectionUpdate(context, instruction.destinationAccountOfDigitalAssetId, destinationBalance.version, {
      ...destinationBalance,
      availableMinorUnits: destinationBalance.availableMinorUnits + instruction.amountMinorUnits
    });

    const updated: LiquidityRebalancingInstruction = {
      ...instruction,
      executedAt: nowIso(),
      status: "executed"
    };
    this.rebalancingInstructions.set(updated.id, updated);
    return updated;
  }

  markPositionSnapshotBroken(snapshotId: string): void {
    this.staleOrBrokenPositionSnapshotIds.add(snapshotId);
  }

  captureCircleBalanceSnapshot(
    context: ActorContext,
    input: { accountOfDigitalAssetId: string; availableMinorUnits: string | number | bigint }
  ): CircleBalanceSnapshot {
    const snapshot: CircleBalanceSnapshot = {
      id: nextId("circle_balance"),
      tenantId: context.tenantId,
      accountOfDigitalAssetId: input.accountOfDigitalAssetId,
      assetCode: "USDC",
      availableMinorUnits: parseMinorUnits(input.availableMinorUnits),
      snapshotSource: "operator_fixture",
      capturedAt: nowIso()
    };
    this.circleBalanceSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  captureCircleTransactionSnapshot(
    context: ActorContext,
    input: Omit<CircleTransactionSnapshot, "id" | "tenantId" | "capturedAt">
  ): CircleTransactionSnapshot {
    const snapshot: CircleTransactionSnapshot = {
      id: nextId("circle_tx"),
      tenantId: context.tenantId,
      ...input,
      capturedAt: nowIso()
    };
    this.circleTransactionSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  runDailyReconciliation(context: ActorContext): { run: ReconciliationRun; breaks: ReconciliationBreak[] } {
    const startedAt = nowIso();
    const run: ReconciliationRun = {
      id: nextId("recon_run"),
      tenantId: context.tenantId,
      runType: "daily",
      status: "completed",
      startedAt,
      completedAt: nowIso()
    };
    this.reconciliationRuns.set(run.id, run);

    const breaks: ReconciliationBreak[] = [];
    for (const circleSnapshot of this.latestCircleBalances(context)) {
      const platformBalance = this.sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(
        context,
        circleSnapshot.accountOfDigitalAssetId
      );
      const delta = platformBalance.totalMinorUnits - circleSnapshot.availableMinorUnits;
      if (delta !== 0n) {
        const reconciliationBreak: ReconciliationBreak = {
          id: nextId("recon_break"),
          tenantId: context.tenantId,
          reconciliationRunId: run.id,
          accountOfDigitalAssetId: circleSnapshot.accountOfDigitalAssetId,
          breakType: "circle_balance_mismatch",
          severity: abs(delta) >= 100000000n ? "high" : "medium",
          platformAmountMinorUnits: platformBalance.totalMinorUnits,
          circleAmountMinorUnits: circleSnapshot.availableMinorUnits,
          deltaMinorUnits: delta,
          status: "open",
          createdAt: nowIso()
        };
        this.reconciliationBreaks.set(reconciliationBreak.id, reconciliationBreak);
        breaks.push(reconciliationBreak);
      }
    }

    return { run, breaks };
  }

  assignBreak(context: ActorContext, breakId: string, assignedTo: string, note?: string): ReconciliationBreak {
    this.requireTreasury(context);
    const reconciliationBreak = this.requireBreak(context, breakId);
    invariant(reconciliationBreak.status !== "resolved", "reconciliation_break_already_resolved");
    const updated: ReconciliationBreak = {
      ...reconciliationBreak,
      assignedTo,
      resolutionNote: note,
      status: "assigned"
    };
    this.reconciliationBreaks.set(updated.id, updated);
    return updated;
  }

  resolveBreak(
    context: ActorContext,
    breakId: string,
    input: { resolutionType: ReconciliationResolutionType; note: string; evidenceUri?: string }
  ): ReconciliationBreak {
    this.requireTreasury(context);
    const reconciliationBreak = this.requireBreak(context, breakId);
    invariant(reconciliationBreak.status !== "resolved", "reconciliation_break_already_resolved");
    invariant(Boolean(input.note), "resolution_note_required");
    const updated: ReconciliationBreak = {
      ...reconciliationBreak,
      resolutionType: input.resolutionType,
      resolutionNote: input.note,
      evidenceUri: input.evidenceUri,
      status: "resolved",
      resolvedAt: nowIso()
    };
    this.reconciliationBreaks.set(updated.id, updated);
    return updated;
  }

  trialBalance(context: ActorContext): TrialBalanceReport {
    const total = this.accountBalances(context).reduce((sum, balance) => sum + balance.totalMinorUnits, 0n);
    return {
      debitMinorUnits: total,
      creditMinorUnits: total,
      balanced: true
    };
  }

  generateDailyClose(context: ActorContext, closeDate: string): DailyCloseReport {
    const trialBalance = this.trialBalance(context);
    const openBreakCount = [...this.reconciliationBreaks.values()].filter((item) => item.tenantId === context.tenantId && item.status !== "resolved").length;
    const customerLiabilityMinorUnits = this.accountBalances(context).reduce((sum, balance) => sum + balance.totalMinorUnits, 0n);
    const circleCustodyMinorUnits = this.latestCircleBalances(context).reduce((sum, snapshot) => sum + snapshot.availableMinorUnits, 0n);
    const suspenseMinorUnits = this.accountBalances(context).reduce((sum, balance) => sum + balance.suspenseMinorUnits, 0n);
    return {
      id: nextId("daily_close"),
      tenantId: context.tenantId,
      closeDate,
      status: openBreakCount === 0 && trialBalance.balanced ? "ready" : "blocked",
      openBreakCount,
      trialBalance,
      customerLiabilityMinorUnits,
      circleCustodyMinorUnits,
      suspenseMinorUnits
    };
  }

  operationsConsole(context: ActorContext, closeDate: string): OperationsConsoleSnapshot {
    const rebalancingRecommendations = [...this.rebalancingInstructions.values()].filter((item) => item.tenantId === context.tenantId);
    const breaks = [...this.reconciliationBreaks.values()].filter((item) => item.tenantId === context.tenantId);
    return {
      rebalancingRecommendations,
      approvalInbox: rebalancingRecommendations.filter((item) => item.status === "pending_approval"),
      reconciliationDashboard: {
        openBreakCount: breaks.filter((item) => item.status === "open").length,
        assignedBreakCount: breaks.filter((item) => item.status === "assigned").length,
        resolvedBreakCount: breaks.filter((item) => item.status === "resolved").length
      },
      dailyCloseStatus: this.generateDailyClose(context, closeDate)
    };
  }

  listBreaks(context: ActorContext): ReconciliationBreak[] {
    return [...this.reconciliationBreaks.values()].filter((item) => item.tenantId === context.tenantId);
  }

  private latestCircleBalances(context: ActorContext): CircleBalanceSnapshot[] {
    const byAccount = new Map<string, CircleBalanceSnapshot>();
    for (const snapshot of this.circleBalanceSnapshots.values()) {
      if (snapshot.tenantId !== context.tenantId) continue;
      byAccount.set(snapshot.accountOfDigitalAssetId, snapshot);
    }
    return [...byAccount.values()];
  }

  private accountBalances(context: ActorContext) {
    return this.sprint6.sprint5.sprint4.sprint3.sprint2.sprint1
      .listAccountsOfDigitalAsset(context)
      .map((account) => this.sprint6.sprint5.sprint4.sprint3.sprint2.balances.getClassifiedBalance(context, account.id));
  }

  private requireInstruction(context: ActorContext, instructionId: string): LiquidityRebalancingInstruction {
    const instruction = this.rebalancingInstructions.get(instructionId);
    invariant(Boolean(instruction), "rebalance_instruction_not_found");
    invariant(instruction?.tenantId === context.tenantId, "tenant_access_denied");
    return instruction!;
  }

  private requireBreak(context: ActorContext, breakId: string): ReconciliationBreak {
    const reconciliationBreak = this.reconciliationBreaks.get(breakId);
    invariant(Boolean(reconciliationBreak), "reconciliation_break_not_found");
    invariant(reconciliationBreak?.tenantId === context.tenantId, "tenant_access_denied");
    return reconciliationBreak!;
  }

  private requireTreasury(context: ActorContext): void {
    invariant(context.roles.includes("treasury_operator"), "role_not_authorized", { requiredRole: "treasury_operator" });
  }
}

const abs = (value: bigint): bigint => (value < 0n ? -value : value);
