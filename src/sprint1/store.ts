import { invariant } from "./errors.js";
import { nowIso } from "./ids.js";
import type {
  AccountOfDigitalAsset,
  BusinessClient,
  IdempotencyRecord,
  InboundEvent,
  LedgerAccount,
  LinkedInstrument,
  OutboxEvent,
  TreasuryJournalEntry
} from "./types.js";

export interface Sprint1State {
  businessClients: Map<string, BusinessClient>;
  accountsOfDigitalAsset: Map<string, AccountOfDigitalAsset>;
  linkedInstruments: Map<string, LinkedInstrument>;
  ledgerAccounts: Map<string, LedgerAccount>;
  journalEntries: Map<string, TreasuryJournalEntry>;
  idempotencyRecords: Map<string, IdempotencyRecord>;
  inboundEvents: Map<string, InboundEvent>;
  outboxEvents: Map<string, OutboxEvent>;
}

const cloneMap = <T>(source: Map<string, T>): Map<string, T> => {
  return new Map([...source.entries()].map(([key, value]) => [key, structuredClone(value)]));
};

const cloneState = (source: Sprint1State): Sprint1State => ({
  businessClients: cloneMap(source.businessClients),
  accountsOfDigitalAsset: cloneMap(source.accountsOfDigitalAsset),
  linkedInstruments: cloneMap(source.linkedInstruments),
  ledgerAccounts: cloneMap(source.ledgerAccounts),
  journalEntries: cloneMap(source.journalEntries),
  idempotencyRecords: cloneMap(source.idempotencyRecords),
  inboundEvents: cloneMap(source.inboundEvents),
  outboxEvents: cloneMap(source.outboxEvents)
});

export class InMemorySprint1Store {
  private state: Sprint1State = {
    businessClients: new Map(),
    accountsOfDigitalAsset: new Map(),
    linkedInstruments: new Map(),
    ledgerAccounts: new Map(),
    journalEntries: new Map(),
    idempotencyRecords: new Map(),
    inboundEvents: new Map(),
    outboxEvents: new Map()
  };

  transaction<T>(work: (state: Sprint1State) => T): T {
    const draft = cloneState(this.state);
    const result = work(draft);
    this.state = draft;
    return result;
  }

  read<T>(work: (state: Sprint1State) => T): T {
    return work(cloneState(this.state));
  }

  seedLedgerAccounts(accounts: LedgerAccount[]): void {
    this.transaction((state) => {
      for (const account of accounts) {
        invariant(!state.ledgerAccounts.has(account.accountCode), "ledger_account_code_duplicate", {
          accountCode: account.accountCode
        });
        state.ledgerAccounts.set(account.accountCode, account);
      }
    });
  }

  insertInboundEvent(event: InboundEvent): void {
    this.transaction((state) => {
      invariant(!state.inboundEvents.has(event.eventId), "inbound_event_duplicate", { eventId: event.eventId });
      state.inboundEvents.set(event.eventId, event);
    });
  }

  outboxEvents(): OutboxEvent[] {
    return this.read((state) => [...state.outboxEvents.values()]);
  }

  journalEntries(): TreasuryJournalEntry[] {
    return this.read((state) => [...state.journalEntries.values()]);
  }

  appendOnlyUpdateJournalForTest(journalEntryId: string): never {
    return this.transaction((state) => {
      invariant(state.journalEntries.has(journalEntryId), "journal_entry_not_found", { journalEntryId });
      throw new Error("posted_journals_are_append_only");
    });
  }

  createInboundEvent(source: string, eventId: string, eventType: string, payload: unknown): InboundEvent {
    return {
      eventId,
      source,
      eventType,
      payload,
      receivedAt: nowIso()
    };
  }
}
