import { invariant } from "./errors.js";
import { nextId, nowIso } from "./ids.js";
import { assertPositiveMinorUnits } from "./money.js";
import type {
  ActorContext,
  AuditMetadata,
  OutboxEvent,
  TreasuryJournalEntry,
  TreasuryJournalLine
} from "./types.js";
import type { Sprint1State } from "./store.js";

export interface JournalLineDraft {
  ledgerAccountCode: string;
  accountOfDigitalAssetId?: string;
  partyId?: string;
  debitMinorUnits?: bigint;
  creditMinorUnits?: bigint;
}

export interface PostOpeningJournalInput {
  tenantId: string;
  accountOfDigitalAssetId: string;
  description: string;
  idempotencyKey: string;
  debitLedgerAccountCode: string;
  creditLedgerAccountCode: string;
  amountMinorUnits: bigint;
}

export const makeAudit = (context: ActorContext, idempotencyKey: string): AuditMetadata => ({
  actorUserId: context.userId,
  actorRoles: context.roles,
  tenantId: context.tenantId,
  correlationId: context.correlationId,
  idempotencyKey,
  createdAt: nowIso()
});

export const validateBalancedJournal = (lines: TreasuryJournalLine[]): void => {
  let debitTotal = 0n;
  let creditTotal = 0n;

  for (const line of lines) {
    const hasDebit = line.debitMinorUnits > 0n;
    const hasCredit = line.creditMinorUnits > 0n;
    invariant(hasDebit !== hasCredit, "journal_line_must_be_single_sided", { lineId: line.id });
    debitTotal += line.debitMinorUnits;
    creditTotal += line.creditMinorUnits;
  }

  invariant(debitTotal === creditTotal, "journal_entry_unbalanced", {
    debitTotal: debitTotal.toString(),
    creditTotal: creditTotal.toString()
  });
};

export const postOpeningJournal = (
  state: Sprint1State,
  context: ActorContext,
  input: PostOpeningJournalInput
): TreasuryJournalEntry => {
  invariant(context.tenantId === input.tenantId, "tenant_context_mismatch");
  invariant(context.roles.includes("treasury_operator"), "role_not_authorized", { requiredRole: "treasury_operator" });
  assertPositiveMinorUnits(input.amountMinorUnits);

  const account = state.accountsOfDigitalAsset.get(input.accountOfDigitalAssetId);
  invariant(Boolean(account), "account_of_digital_asset_not_found", {
    accountOfDigitalAssetId: input.accountOfDigitalAssetId
  });
  invariant(account?.tenantId === input.tenantId, "tenant_access_denied");

  const debitAccount = state.ledgerAccounts.get(input.debitLedgerAccountCode);
  const creditAccount = state.ledgerAccounts.get(input.creditLedgerAccountCode);
  invariant(Boolean(debitAccount), "debit_ledger_account_not_found", { code: input.debitLedgerAccountCode });
  invariant(Boolean(creditAccount), "credit_ledger_account_not_found", { code: input.creditLedgerAccountCode });
  const resolvedDebitAccount = debitAccount!;
  const resolvedCreditAccount = creditAccount!;

  const audit = makeAudit(context, input.idempotencyKey);
  const journalEntryId = nextId("journal");
  const sourceEventId = nextId("acct_event");
  const postedAt = nowIso();
  const lines: TreasuryJournalLine[] = [
    {
      id: nextId("line"),
      journalEntryId,
      ledgerAccountId: resolvedDebitAccount.id,
      accountOfDigitalAssetId: input.accountOfDigitalAssetId,
      partyId: account?.businessClientId,
      assetCode: "USDC",
      currency: "USD",
      debitMinorUnits: input.amountMinorUnits,
      creditMinorUnits: 0n,
      createdAt: postedAt
    },
    {
      id: nextId("line"),
      journalEntryId,
      ledgerAccountId: resolvedCreditAccount.id,
      accountOfDigitalAssetId: input.accountOfDigitalAssetId,
      partyId: account?.businessClientId,
      assetCode: "USDC",
      currency: "USD",
      debitMinorUnits: 0n,
      creditMinorUnits: input.amountMinorUnits,
      createdAt: postedAt
    }
  ];

  validateBalancedJournal(lines);

  const journalEntry: TreasuryJournalEntry = {
    id: journalEntryId,
    tenantId: input.tenantId,
    sourceEventId,
    accountingEventType: "treasury.opening_journal.posted",
    description: input.description,
    postedAt,
    audit,
    lines
  };

  state.journalEntries.set(journalEntry.id, journalEntry);
  state.outboxEvents.set(nextId("outbox"), makeOutboxEvent(context, "treasury.journal_entry.posted", journalEntry));
  return journalEntry;
};

export const makeOutboxEvent = (context: ActorContext, eventType: string, payload: unknown): OutboxEvent => {
  return {
    id: nextId("outbox"),
    tenantId: context.tenantId,
    eventType,
    payload,
    createdAt: nowIso()
  };
};
