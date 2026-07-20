import { makeOutboxEvent, postOpeningJournal, type PostOpeningJournalInput } from "./accounting.js";
import { initialControlAccounts } from "./control-accounts.js";
import { invariant } from "./errors.js";
import { executeIdempotently, hashRequest } from "./idempotency.js";
import { nextId, nowIso } from "./ids.js";
import { parseMinorUnits } from "./money.js";
import { initialPostingRules } from "./posting-rules.js";
import { InMemorySprint1Store } from "./store.js";
import type {
  AccountOfDigitalAsset,
  AccountStatement,
  ActorContext,
  BusinessClient,
  LinkedInstrument,
  TreasuryJournalEntry
} from "./types.js";

export interface CreateBusinessClientInput {
  legalName: string;
  country: string;
  onboardingStatus: BusinessClient["onboardingStatus"];
  circleClientEntityId?: string;
  circleApplicationId?: string;
  idempotencyKey: string;
}

export interface CreateAccountOfDigitalAssetInput {
  businessClientId: string;
  accountName: string;
  usePurpose: AccountOfDigitalAsset["usePurpose"];
  circleAccountId?: string;
  circleSubAccountId?: string;
  idempotencyKey: string;
}

export interface CreateLinkedInstrumentInput {
  accountOfDigitalAssetId: string;
  instrumentType: LinkedInstrument["instrumentType"];
  status: LinkedInstrument["status"];
  externalReference?: string;
}

export class Sprint1Application {
  constructor(private readonly store: InMemorySprint1Store) {}

  bootstrapControlAccounts(): void {
    const existingCount = this.store.read((state) => state.ledgerAccounts.size);
    if (existingCount === 0) {
      this.store.seedLedgerAccounts(initialControlAccounts);
    }
  }

  bootstrapPostingRules(): void {
    const existingCount = this.store.read((state) => state.postingRules.size);
    if (existingCount === 0) {
      this.store.seedPostingRules(initialPostingRules);
    }
  }

  createBusinessClient(context: ActorContext, input: CreateBusinessClientInput): BusinessClient {
    return this.store.transaction((state) => {
      return executeIdempotently(state.idempotencyRecords, input.idempotencyKey, hashRequest(input), () => {
        invariant(context.roles.includes("platform_operator"), "role_not_authorized", {
          requiredRole: "platform_operator"
        });

        for (const client of state.businessClients.values()) {
          invariant(
            client.circleClientEntityId !== input.circleClientEntityId || !input.circleClientEntityId,
            "circle_client_entity_id_duplicate"
          );
          invariant(
            client.circleApplicationId !== input.circleApplicationId || !input.circleApplicationId,
            "circle_application_id_duplicate"
          );
        }

        const client: BusinessClient = {
          id: nextId("client"),
          tenantId: context.tenantId,
          legalName: input.legalName,
          country: input.country,
          onboardingStatus: input.onboardingStatus,
          circleClientEntityId: input.circleClientEntityId,
          circleApplicationId: input.circleApplicationId,
          audit: {
            actorUserId: context.userId,
            actorRoles: context.roles,
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            idempotencyKey: input.idempotencyKey,
            createdAt: nowIso()
          }
        };

        state.businessClients.set(client.id, client);
        const outboxEvent = makeOutboxEvent(context, "business_client.created", client);
        state.outboxEvents.set(outboxEvent.id, outboxEvent);
        return client;
      });
    });
  }

  createAccountOfDigitalAsset(
    context: ActorContext,
    input: CreateAccountOfDigitalAssetInput
  ): AccountOfDigitalAsset {
    return this.store.transaction((state) => {
      return executeIdempotently(state.idempotencyRecords, input.idempotencyKey, hashRequest(input), () => {
        invariant(context.roles.includes("platform_operator"), "role_not_authorized", {
          requiredRole: "platform_operator"
        });

        const client = state.businessClients.get(input.businessClientId);
        invariant(Boolean(client), "business_client_not_found", { businessClientId: input.businessClientId });
        invariant(client?.tenantId === context.tenantId, "tenant_access_denied");

        for (const account of state.accountsOfDigitalAsset.values()) {
          invariant(account.circleAccountId !== input.circleAccountId || !input.circleAccountId, "circle_account_id_duplicate");
          invariant(
            account.circleSubAccountId !== input.circleSubAccountId || !input.circleSubAccountId,
            "circle_sub_account_id_duplicate"
          );
        }

        const account: AccountOfDigitalAsset = {
          id: nextId("ada"),
          tenantId: context.tenantId,
          businessClientId: input.businessClientId,
          accountName: input.accountName,
          usePurpose: input.usePurpose,
          status: "active",
          assetCode: "USDC",
          assetRail: "circle_internal",
          circleAccountId: input.circleAccountId,
          circleSubAccountId: input.circleSubAccountId,
          audit: {
            actorUserId: context.userId,
            actorRoles: context.roles,
            tenantId: context.tenantId,
            correlationId: context.correlationId,
            idempotencyKey: input.idempotencyKey,
            createdAt: nowIso()
          }
        };

        state.accountsOfDigitalAsset.set(account.id, account);
        const outboxEvent = makeOutboxEvent(context, "account_of_digital_asset.provisioned", account);
        state.outboxEvents.set(outboxEvent.id, outboxEvent);
        return account;
      });
    });
  }

  createLinkedInstrument(context: ActorContext, input: CreateLinkedInstrumentInput): LinkedInstrument {
    return this.store.transaction((state) => {
      const account = state.accountsOfDigitalAsset.get(input.accountOfDigitalAssetId);
      invariant(Boolean(account), "account_of_digital_asset_not_found");
      invariant(account?.tenantId === context.tenantId, "tenant_access_denied");

      const instrument: LinkedInstrument = {
        id: nextId("instrument"),
        accountOfDigitalAssetId: input.accountOfDigitalAssetId,
        instrumentType: input.instrumentType,
        status: input.status,
        externalReference: input.externalReference,
        createdAt: nowIso()
      };
      state.linkedInstruments.set(instrument.id, instrument);
      return instrument;
    });
  }

  postOpeningJournal(
    context: ActorContext,
    input: Omit<PostOpeningJournalInput, "tenantId" | "amountMinorUnits"> & {
      amountMinorUnits: string | number | bigint;
    }
  ): TreasuryJournalEntry {
    const request = { ...input, tenantId: context.tenantId };
    return this.store.transaction((state) => {
      return executeIdempotently(state.idempotencyRecords, input.idempotencyKey, hashRequest(request), () => {
        return postOpeningJournal(state, context, {
          ...input,
          tenantId: context.tenantId,
          amountMinorUnits: parseMinorUnits(input.amountMinorUnits)
        });
      });
    });
  }

  getAccountStatement(context: ActorContext, accountOfDigitalAssetId: string): AccountStatement {
    return this.store.read((state) => {
      const account = state.accountsOfDigitalAsset.get(accountOfDigitalAssetId);
      invariant(Boolean(account), "account_of_digital_asset_not_found", { accountOfDigitalAssetId });
      invariant(account?.tenantId === context.tenantId, "tenant_access_denied");

      const journalEntries = [...state.journalEntries.values()].filter((entry) => {
        return entry.tenantId === context.tenantId && entry.lines.some((line) => line.accountOfDigitalAssetId === accountOfDigitalAssetId);
      });

      return {
        accountOfDigitalAssetId,
        journalEntries,
        auditTrail: [account!.audit, ...journalEntries.map((entry) => entry.audit)]
      };
    });
  }

  getBusinessClient(context: ActorContext, businessClientId: string): BusinessClient | undefined {
    return this.store.read((state) => {
      const client = state.businessClients.get(businessClientId);
      if (!client || client.tenantId !== context.tenantId) {
        return undefined;
      }
      return client;
    });
  }

  listBusinessClients(context: ActorContext): BusinessClient[] {
    return this.store.read((state) => {
      return [...state.businessClients.values()].filter((client) => client.tenantId === context.tenantId);
    });
  }

  listAccountsOfDigitalAsset(context: ActorContext): AccountOfDigitalAsset[] {
    return this.store.read((state) => {
      return [...state.accountsOfDigitalAsset.values()].filter((account) => account.tenantId === context.tenantId);
    });
  }

  mapApprovedOnboarding(
    context: ActorContext,
    businessClientId: string,
    circleClientEntityId: string,
    circleApplicationId: string
  ): BusinessClient {
    return this.store.transaction((state) => {
      invariant(context.roles.includes("platform_operator"), "role_not_authorized", {
        requiredRole: "platform_operator"
      });

      const client = state.businessClients.get(businessClientId);
      invariant(Boolean(client), "business_client_not_found", { businessClientId });
      invariant(client?.tenantId === context.tenantId, "tenant_access_denied");
      invariant(client?.onboardingStatus === "submitted", "business_client_invalid_status_transition", {
        from: client?.onboardingStatus,
        to: "approved"
      });

      const updated: BusinessClient = {
        ...client!,
        onboardingStatus: "approved",
        circleClientEntityId,
        circleApplicationId
      };
      state.businessClients.set(updated.id, updated);
      return updated;
    });
  }
}

export const createSprint1Application = (): { app: Sprint1Application; store: InMemorySprint1Store } => {
  const store = new InMemorySprint1Store();
  const app = new Sprint1Application(store);
  app.bootstrapControlAccounts();
  app.bootstrapPostingRules();
  return { app, store };
};
