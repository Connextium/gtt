import type {
  AccountOfDigitalAsset,
  ApiIdempotencyRecord,
  ApiState,
  AuditEvent,
  Balance,
  BusinessClient,
  EventRecord,
  JournalEntry
} from "../../data.js";

export interface RepositoryList<T> {
  list(tenantId: string): Promise<T[]>;
  get(tenantId: string, id: string): Promise<T | undefined>;
  save(tenantId: string, value: T): Promise<T>;
}

export interface ApiRepositories {
  businessClients: RepositoryList<BusinessClient>;
  accounts: RepositoryList<AccountOfDigitalAsset>;
  balances: RepositoryList<Balance>;
  journals: RepositoryList<JournalEntry>;
  outbox: RepositoryList<EventRecord>;
  inbox: RepositoryList<EventRecord>;
  audit: RepositoryList<AuditEvent>;
  idempotency: RepositoryList<ApiIdempotencyRecord>;
}

export const createStateRepositories = (state: ApiState): ApiRepositories => ({
  businessClients: listBackedRepository(state.businessClients),
  accounts: listBackedRepository(state.accounts),
  balances: balanceRepository(state.balances),
  journals: listBackedRepository(state.journals),
  outbox: listBackedRepository(state.outbox),
  inbox: listBackedRepository(state.inbox),
  audit: listBackedRepository(state.auditEvents),
  idempotency: listBackedRepository(state.idempotencyRecords)
});

const listBackedRepository = <T extends { id: string; tenantId: string }>(items: T[]): RepositoryList<T> => ({
  async list(tenantId) {
    return items.filter((item) => item.tenantId === tenantId);
  },
  async get(tenantId, id) {
    return items.find((item) => item.tenantId === tenantId && item.id === id);
  },
  async save(_tenantId, value) {
    const index = items.findIndex((item) => item.id === value.id);
    if (index >= 0) items[index] = value;
    else items.push(value);
    return value;
  }
});

const balanceRepository = (items: Balance[]): RepositoryList<Balance> => ({
  async list() {
    return items;
  },
  async get(_tenantId, id) {
    return items.find((item) => item.accountOfDigitalAssetId === id);
  },
  async save(_tenantId, value) {
    const index = items.findIndex((item) => item.accountOfDigitalAssetId === value.accountOfDigitalAssetId);
    if (index >= 0) items[index] = value;
    else items.push(value);
    return value;
  }
});
