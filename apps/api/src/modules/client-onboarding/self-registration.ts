import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createPlaintextApiKey, hashApiSecret } from "../../auth/index.js";
import {
  emitOutbox,
  newId,
  type ApiState,
  type BusinessClient,
  type BusinessOnboardingApplication,
  type BusinessOnboardingInvitation,
  type BusinessUserProfile,
  type OnboardingRfiTask,
  type OnboardingStepPayload
} from "../../data.js";
import { postgresUrlFromEnv } from "../../db/connection.js";
import { withPostgresTransaction } from "../../db/transaction.js";
import { badRequest, unauthorized, type JsonResponse } from "../../http/index.js";

export interface AuthenticatedBusinessUser {
  authUserId: string;
  email: string;
}

interface OnboardingBusinessClientView {
  id: string;
  legalName: string;
  country: string;
  onboardingStatus: string;
}

interface OnboardingAdaAccountView {
  id: string;
  accountCode?: string;
  accountName: string;
  businessClientId: string;
  businessClientName?: string;
  status: string;
  usePurpose: string;
  assetCode?: string;
  assetRail?: string;
  createdAt?: string;
  balances?: {
    availableMinorUnits: string;
    pendingMinorUnits: string;
    reservedMinorUnits: string;
    lockedMinorUnits: string;
    suspenseMinorUnits: string;
    updatedAt?: string;
  };
}

interface BusinessApiKeyView {
  createdAt: string;
  id: string;
  keyPrefix: string;
  ownerAuthUserId: string;
  ownerTenantId: string;
  ownerBusinessClientId: string;
  ownerBusinessClientName: string;
  revokedAt?: string;
  scopes: string[];
  status: "active" | "revoked";
}

export interface AuthenticatedBusinessApiKey {
  authUserId: string;
  email: string;
  keyId: string;
  scopes: string[];
}

export interface BusinessJwtSession {
  access_token: string;
  token_type: string;
  expires_in?: number;
  expires_at?: number;
  refresh_token?: string;
  user: {
    id: string;
    email?: string;
  };
}

interface BusinessAuthTokenClaims {
  aud: "business-user";
  email: string;
  exp: number;
  iat: number;
  iss: "gtt-api";
  jti: string;
  sid: string;
  sub: string;
  token_use: "access" | "refresh";
}

interface BusinessSessionRecord {
  accessJti: string;
  authUserId: string;
  email: string;
  expiresAt: number;
  refreshExpiresAt: number;
  refreshJti: string;
  sessionId: string;
  supabaseAccessToken: string;
  supabaseRefreshToken?: string;
}

interface SupabaseBusinessAuthClient {
  getUser: (accessToken: string) => Promise<{
    data: { user: { id?: string; email?: string | null } | null };
    error: { message: string } | null;
  }>;
  inviteUserByEmail: (email: string, options: {
    redirectTo: string;
    data: Record<string, unknown>;
  }) => Promise<{
    data: { user?: { id?: string } | null };
    error: { message: string } | null;
  }>;
  refreshSession: (refreshToken: string) => Promise<{
    data: {
      session: {
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
        expires_in?: number;
        expires_at?: number;
        user?: { id?: string; email?: string | null };
      } | null;
    };
    error: { message: string } | null;
  }>;
  resetPasswordForEmail: (email: string, options: { redirectTo: string }) => Promise<{ error: { message: string } | null }>;
  signInWithPassword: (input: { email: string; password: string }) => Promise<{
    data: {
      session: {
        access_token?: string;
        refresh_token?: string;
        token_type?: string;
        expires_in?: number;
        expires_at?: number;
        user?: { id?: string; email?: string | null };
      } | null;
    };
    error: { message: string } | null;
  }>;
  signOutSession: (accessToken: string) => Promise<{ error: { message: string; status?: number } | null }>;
  updateUserById: (userId: string, input: { password: string; email_confirm: boolean }) => Promise<{ error: { message: string } | null }>;
}

type ActivationDecision = "auto" | "approval_required";

interface ActivationView {
  activationDecision: ActivationDecision;
  activationReasonCode: string;
}

const rateLimitWindowMs = 60_000;
const maxAttemptsPerWindow = 5;
const invitationAttempts = new Map<string, { count: number; resetAt: number }>();
const businessApiKeyAllowlist = [
  "business.profile.read",
  "onboarding.read",
  "onboarding.write",
  "ada.read",
  "ada.open",
  "payment-instruction.read",
  "payment-instruction.create"
] as const;
const businessApiKeyRecords = new Map<string, Array<BusinessApiKeyView & { keyHash: string }>>();
const businessAuthSessions = new Map<string, BusinessSessionRecord>();
const businessAuthSessionIdByAccessJti = new Map<string, string>();
const businessAuthSessionIdByRefreshJti = new Map<string, string>();
let supabaseBusinessAuthClientForTest: SupabaseBusinessAuthClient | undefined;

export const setSupabaseBusinessAuthClientForTest = (client: SupabaseBusinessAuthClient | undefined): void => {
  supabaseBusinessAuthClientForTest = client;
};

export const resetBusinessAuthSessionsForTest = (): void => {
  businessAuthSessions.clear();
  businessAuthSessionIdByAccessJti.clear();
  businessAuthSessionIdByRefreshJti.clear();
};

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const handleSelfRegistrationInvitation = async (
  state: ApiState,
  input: { email?: unknown; headers?: Record<string, string | undefined> }
): Promise<JsonResponse> => {
  const email = normalizeEmail(String(input.email ?? ""));
  if (!isValidEmail(email)) return badRequest("valid_email_required");

  const limiterKey = `${input.headers?.["x-forwarded-for"] ?? "local"}:${email}`;
  if (!checkRateLimit(limiterKey)) {
    return {
      status: 429,
      body: { error: "too_many_invitation_requests" }
    };
  }

  const invitation = createOrReuseInvitation(state, email);
  await persistInvitation(invitation);
  const supabase = supabaseAuthClient();

  if (!supabase) {
    if (process.env.ALLOW_DEV_WITHOUT_SUPABASE !== "true") {
      return {
        status: 503,
        body: { error: "supabase_admin_not_configured" }
      };
    }

    markInvitationSent(invitation);
    await persistInvitation(invitation);
    emitOutbox(state, "business_user.self_registration_invitation.dev_sent", {
      invitationId: invitation.id,
      email
    });
    return {
      status: 200,
      body: {
        ok: true,
        status: "check_email",
        message: "Invitation accepted for delivery.",
        devInviteLink: `${inviteRedirectUrl()}?dev_invitation=${invitation.id}`
      }
    };
  }

  const { data, error } = await supabase.inviteUserByEmail(email, {
    redirectTo: inviteRedirectUrl(),
    data: {
      onboardingInvitationId: invitation.id,
      role: "business_user"
    }
  });

  if (error) {
    if (isExistingSupabaseUserError(error.message)) {
      emitOutbox(state, "business_user.self_registration_invitation.existing_account", {
        invitationId: invitation.id,
        email
      });
      return {
        status: 200,
        body: {
          ok: true,
          status: "existing_account",
          message: "This email is already registered. Sign in to continue your application."
        }
      };
    }

    return {
      status: 502,
      body: { error: "supabase_invitation_failed", detail: error.message }
    };
  }

  markInvitationSent(invitation, data.user?.id);
  await persistInvitation(invitation);
  emitOutbox(state, "business_user.self_registration_invitation.sent", {
    invitationId: invitation.id,
    email,
    supabaseUserId: data.user?.id
  });

  return {
    status: 200,
    body: {
      ok: true,
      status: "check_email",
      message: "Invitation accepted for delivery."
    }
  };
};

export const handleGetOrCreateMyOnboarding = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  const rfiTasks = await hydrateOnboardingRfiTasks(state, bundle.application);
  const assets = await resolveOnboardingAssets(state, bundle.application, stepPayloads);
  await persistOnboardingBundle(state, auth, bundle);
  return {
    status: 200,
    body: {
      ...bundle,
      stepPayloads,
      rfiTasks,
      businessClient: assets.businessClient,
      adaAccounts: assets.adaAccounts
    }
  };
};

export const handleGetMyAdaBalance = async (
  state: ApiState,
  headers: Record<string, string | undefined>,
  accountId: string
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select account_of_digital_asset_id, asset_code, currency, available_minor_units, pending_minor_units, reserved_minor_units, locked_minor_units, suspense_minor_units, version, projected_at, updated_at
             from account_of_digital_asset_balances
            where platform_tenant_id = $1 and account_of_digital_asset_id = $2
            order by updated_at desc`,
          [owned.tenantId, accountId]
        );
        return {
          status: 200,
          body: {
            accountId,
            balances: result.rows.map((row) => ({
              accountId: row.account_of_digital_asset_id,
              assetCode: row.asset_code,
              currency: row.currency,
              availableMinorUnits: String(row.available_minor_units ?? 0),
              pendingMinorUnits: String(row.pending_minor_units ?? 0),
              reservedMinorUnits: String(row.reserved_minor_units ?? 0),
              lockedMinorUnits: String(row.locked_minor_units ?? 0),
              suspenseMinorUnits: String(row.suspense_minor_units ?? 0),
              version: Number(row.version ?? 1),
              projectedAt: timestampToOptionalIsoString(row.projected_at),
              updatedAt: timestampToOptionalIsoString(row.updated_at)
            })),
            source: "account_of_digital_asset_balances"
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleGetMyAdaBalance; falling back", error);
    }
  }

  const balance = state.balances.find((item) => item.accountOfDigitalAssetId === accountId);
  return {
    status: 200,
    body: {
      accountId,
      balances: balance ? [{
        accountId,
        assetCode: "USDC",
        currency: "USD",
        availableMinorUnits: balance.availableMinorUnits.toString(),
        pendingMinorUnits: balance.pendingMinorUnits.toString(),
        reservedMinorUnits: balance.reservedMinorUnits.toString(),
        lockedMinorUnits: balance.lockedMinorUnits.toString(),
        suspenseMinorUnits: balance.suspenseMinorUnits.toString(),
        version: balance.version
      }] : [],
      source: "runtime_state"
    }
  };
};

export const handleGetMyAdaStatement = async (
  state: ApiState,
  headers: Record<string, string | undefined>,
  accountId: string
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select
             entry.id as journal_entry_id,
             entry.description,
             entry.accounting_event_type,
             entry.correlation_id,
             entry.idempotency_key,
             entry.posted_at,
             ledger.account_code,
             ledger.account_name,
             line.asset_code,
             line.currency,
             line.debit_minor_units,
             line.credit_minor_units
           from treasury_journal_lines line
           join treasury_journal_entries entry on entry.id = line.journal_entry_id
           join ledger_accounts ledger on ledger.id = line.ledger_account_id
           where entry.platform_tenant_id = $1
             and (
               line.account_of_digital_asset_id = $2
               or exists (
                 select 1
                   from wire_funding_instructions instruction
                  where instruction.platform_tenant_id = entry.platform_tenant_id
                    and instruction.posting_journal_entry_id = entry.id
                    and $2 in (
                      instruction.account_of_digital_asset_id,
                      instruction.source_account_of_digital_asset_id,
                      instruction.destination_account_of_digital_asset_id
                    )
               )
               or exists (
                 select 1
                   from funding_instruction_orders funding_order
                   join wire_funding_instructions instruction
                     on instruction.id = funding_order.funding_instruction_id
                    and instruction.platform_tenant_id = funding_order.platform_tenant_id
                  where funding_order.platform_tenant_id = entry.platform_tenant_id
                    and funding_order.journal_entry_id = entry.id
                    and $2 in (
                      instruction.account_of_digital_asset_id,
                      instruction.source_account_of_digital_asset_id,
                      instruction.destination_account_of_digital_asset_id,
                      funding_order.source_account_of_digital_asset_id,
                      funding_order.destination_account_of_digital_asset_id
                    )
               )
             )
           order by entry.posted_at desc, line.created_at asc`,
          [owned.tenantId, accountId]
        );
        return {
          status: 200,
          body: {
            accountId,
            journals: result.rows.map((row) => ({
              journalEntryId: row.journal_entry_id,
              description: row.description,
              accountingEventType: row.accounting_event_type,
              correlationId: row.correlation_id,
              idempotencyKey: row.idempotency_key,
              postedAt: timestampToOptionalIsoString(row.posted_at),
              accountCode: row.account_code,
              accountName: row.account_name,
              assetCode: row.asset_code,
              currency: row.currency,
              debitMinorUnits: String(row.debit_minor_units ?? 0),
              creditMinorUnits: String(row.credit_minor_units ?? 0)
            }))
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleGetMyAdaStatement; falling back", error);
    }
  }

  return {
    status: 200,
    body: {
      accountId,
      journals: state.journals
        .filter((item) => item.tenantId === owned.tenantId && item.accountOfDigitalAssetId === accountId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((journal) => ({
          journalEntryId: journal.id,
          description: journal.description,
          accountingEventType: "runtime_journal",
          postedAt: journal.createdAt,
          accountCode: journal.creditLedgerAccountCode,
          accountName: "Runtime Ledger Account",
          assetCode: "USDC",
          currency: "USD",
          debitMinorUnits: journal.amountMinorUnits.toString(),
          creditMinorUnits: "0"
        }))
    }
  };
};

export const handleListMyAdaAccounts = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  if (bundle.application.status !== "approved") return badRequest("business_client_not_approved");
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  const assets = await resolveOnboardingAssets(state, bundle.application, stepPayloads);
  const runtimeClient = state.businessClients.find((item) =>
    item.tenantId === bundle.application.tenantId && item.onboardingStatus === "approved"
  );
  const fallbackAccounts = runtimeClient
    ? state.accounts
      .filter((item) => item.tenantId === runtimeClient.tenantId && item.businessClientId === runtimeClient.id)
      .map((account) => ({
        id: account.id,
        accountCode: buildAdaAccountCode(account.accountName, account.usePurpose, "USDC"),
        accountName: account.accountName,
        businessClientId: account.businessClientId,
        businessClientName: runtimeClient.legalName,
        status: account.status,
        usePurpose: account.usePurpose,
        assetCode: "USDC",
        createdAt: account.createdAt,
        balances: {
          availableMinorUnits: "0",
          pendingMinorUnits: "0",
          reservedMinorUnits: "0",
          lockedMinorUnits: "0",
          suspenseMinorUnits: "0"
        }
      }))
    : [];
  const sourceAccounts = assets.adaAccounts.length ? assets.adaAccounts : fallbackAccounts;
  const accounts = sourceAccounts.map((account) => ({
    ...account,
    ...activationViewFromAccountStatus(account.status)
  }));
  return { status: 200, body: { accounts } };
};

export const handleGetMyAdaAccount = async (
  state: ApiState,
  headers: Record<string, string | undefined>,
  accountId: string
): Promise<JsonResponse> => {
  const list = await handleListMyAdaAccounts(state, headers);
  if (list.status !== 200) return list;
  const accounts = ((list.body as { accounts?: unknown }).accounts ?? []) as Array<OnboardingAdaAccountView & ActivationView>;
  const account = accounts.find((item) => item.id === accountId);
  if (!account) return { status: 404, body: { error: "account_not_found" } };
  return { status: 200, body: { account } };
};

export const handleUpdateMyAdaAccount = async (
  state: ApiState,
  input: { accountId: string; headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, input.accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  const body = isRecord(input.payload) ? input.payload : {};
  const requestedName = optionalBodyString(body, "accountName");
  const requestedUsePurpose = optionalBodyString(body, "usePurpose");
  const requestedAssetRail = optionalBodyString(body, "assetRail");
  const requestedStatus = optionalBodyString(body, "status");

  if (!requestedName && !requestedUsePurpose && !requestedAssetRail && !requestedStatus) {
    return badRequest("account_update_payload_required");
  }

  const normalizedUsePurpose = requestedUsePurpose ? normalizeUsePurpose(requestedUsePurpose) : undefined;
  const normalizedStatus = requestedStatus ? requestedStatus.trim().toLowerCase() : undefined;
  if (normalizedStatus && !["active", "pending_activation", "restricted"].includes(normalizedStatus)) {
    return badRequest("account_status_invalid");
  }

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        await client.query(
          `update accounts_of_digital_asset
              set account_name = coalesce($4, account_name),
                  use_purpose = coalesce($5, use_purpose),
                  asset_rail = coalesce($6, asset_rail),
                  status = coalesce($7, status),
                  updated_at = now()
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3`,
          [
            owned.accountId,
            owned.tenantId,
            owned.businessClientId,
            requestedName ?? null,
            normalizedUsePurpose ?? null,
            requestedAssetRail ?? null,
            normalizedStatus ?? null
          ]
        );
        const result = await handleGetMyAdaAccount(state, input.headers, owned.accountId);
        return result.status === 200 ? result : { status: 500, body: { error: "account_update_failed" } };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleUpdateMyAdaAccount; falling back", error);
    }
  }

  const runtimeAccount = state.accounts.find((item) =>
    item.id === owned.accountId && item.tenantId === owned.tenantId && item.businessClientId === owned.businessClientId
  );
  if (!runtimeAccount) return { status: 404, body: { error: "account_not_found" } };

  if (requestedName) runtimeAccount.accountName = requestedName;
  if (normalizedUsePurpose) runtimeAccount.usePurpose = runtimePurposeFromUsePurpose(normalizedUsePurpose);
  if (normalizedStatus) runtimeAccount.status = normalizedStatus as typeof runtimeAccount.status;

  return handleGetMyAdaAccount(state, input.headers, owned.accountId);
};

export const handleListMyLinkedInstruments = async (
  state: ApiState,
  headers: Record<string, string | undefined>,
  accountId: string
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const schema = await getLinkedInstrumentSchema(client);
        const whereTenant = schema.hasPlatformTenantId ? "and platform_tenant_id = $1" : "";
        const result = await client.query(
          `select ${linkedInstrumentSelectProjection(schema)}
             from linked_instruments
            where account_of_digital_asset_id = $2
              ${whereTenant}
            order by created_at desc`,
          [owned.tenantId, owned.accountId]
        );
        return {
          status: 200,
          body: {
            accountId: owned.accountId,
            linkedInstruments: result.rows.map((row) => mapLinkedInstrumentRow(row))
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleListMyLinkedInstruments; falling back", error);
    }
  }

  return {
    status: 200,
    body: {
      accountId: owned.accountId,
      linkedInstruments: []
    }
  };
};

export const handleListMyBusinessLinkedInstruments = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");

  const tenantId = uuidFromRuntimeId(context.tenantId) ?? context.tenantId;

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select id, account_of_digital_asset_id, business_client_id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where platform_tenant_id = $1
              and business_client_id = $2
            order by created_at desc`,
          [tenantId, context.businessClientId]
        );
        return {
          status: 200,
          body: {
            businessClientId: context.businessClientId,
            linkedInstruments: result.rows.map((row) => mapLinkedInstrumentRow(row))
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleListMyBusinessLinkedInstruments; falling back", error);
    }
  }

  return {
    status: 200,
    body: {
      businessClientId: context.businessClientId,
      linkedInstruments: []
    }
  };
};

const buildLinkedInstrumentPayload = (body: Record<string, unknown>) => {
  const instrumentType = bodyString(body, "instrumentType", "on_chain_wallet");
  const railType = bodyString(
    body,
    "railType",
    instrumentType.includes("fiat") ? "fiat" : "on-chain"
  );
  const purpose = bodyString(body, "purpose", "settlement");
  const railCode = bodyString(body, "railCode", `${railType}_${purpose}`.toLowerCase());
  const railName = bodyString(body, "railName", `${purpose} rail`);
  const assetCode = normalizeAssetCode(bodyString(body, "assetCode", "USDC"));
  const networkCode = optionalBodyString(body, "networkCode");
  const provider = optionalBodyString(body, "provider") ?? (railType === "fiat" ? "bank" : "circle");
  const verificationStatus = optionalBodyString(body, "verificationStatus") ?? "verified";
  const isDefault = Boolean(body.isDefault);
  const status = optionalBodyString(body, "status");
  const metadata = bodyRecord(body, "metadata");

  const mergedMetadata: Record<string, unknown> = {
    ...metadata,
    ...(optionalBodyString(body, "destinationAddress") ? { address: optionalBodyString(body, "destinationAddress") } : {}),
    ...(optionalBodyString(body, "walletAddress") ? { walletAddress: optionalBodyString(body, "walletAddress") } : {}),
    ...(optionalBodyString(body, "walletId") ? { walletId: optionalBodyString(body, "walletId") } : {}),
    ...(optionalBodyString(body, "routingNumber") ? { routingNumber: optionalBodyString(body, "routingNumber") } : {}),
    ...(optionalBodyString(body, "accountNumber") ? { accountNumberLast4: optionalBodyString(body, "accountNumber")?.slice(-4) } : {}),
    ...(optionalBodyString(body, "bankingInstitution") ? { bankName: optionalBodyString(body, "bankingInstitution") } : {})
  };

  return {
    instrumentType,
    railType,
    purpose,
    railCode,
    railName,
    assetCode,
    networkCode,
    provider,
    verificationStatus,
    isDefault,
    status,
    mergedMetadata
  };
};

const inferAssetCatalogDefaults = (assetCode: string, railType: string): { assetName: string; minorUnitScale: number } => {
  if (assetCode === "USDC") return { assetName: "USD Coin", minorUnitScale: 6 };
  if (assetCode === "EURC") return { assetName: "Euro Coin", minorUnitScale: 6 };
  if (assetCode === "USD") return { assetName: "US Dollar", minorUnitScale: 2 };
  return {
    assetName: railType === "fiat" ? `${assetCode} Fiat` : `${assetCode} Asset`,
    minorUnitScale: railType === "fiat" ? 2 : 6
  };
};

const ensureAssetCatalogRow = async (
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  assetCode: string,
  railType: string
) => {
  const defaults = inferAssetCatalogDefaults(assetCode, railType);
  await client.query(
    `insert into assets (asset_code, asset_name, minor_unit_scale, status)
     values ($1, $2, $3, 'active')
     on conflict (asset_code) do nothing`,
    [assetCode, defaults.assetName, defaults.minorUnitScale]
  );
};

type LinkedInstrumentSchema = {
  hasBusinessClientId: boolean;
  hasPlatformTenantId: boolean;
  hasRailCode: boolean;
  hasRailName: boolean;
  hasRailType: boolean;
  hasAssetCode: boolean;
  hasPurpose: boolean;
  hasProvider: boolean;
  hasVerificationStatus: boolean;
  hasMetadata: boolean;
  hasNetworkCode: boolean;
  hasIsDefault: boolean;
  hasUpdatedAt: boolean;
  hasExternalReference: boolean;
};

const getLinkedInstrumentSchema = async (
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }
): Promise<LinkedInstrumentSchema> => {
  const result = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = 'linked_instruments'`
  );
  const columns = new Set(result.rows.map((row) => String(row.column_name ?? "")));
  return {
    hasBusinessClientId: columns.has("business_client_id"),
    hasPlatformTenantId: columns.has("platform_tenant_id"),
    hasRailCode: columns.has("rail_code"),
    hasRailName: columns.has("rail_name"),
    hasRailType: columns.has("rail_type"),
    hasAssetCode: columns.has("asset_code"),
    hasPurpose: columns.has("purpose"),
    hasProvider: columns.has("provider"),
    hasVerificationStatus: columns.has("verification_status"),
    hasMetadata: columns.has("metadata"),
    hasNetworkCode: columns.has("network_code"),
    hasIsDefault: columns.has("is_default"),
    hasUpdatedAt: columns.has("updated_at"),
    hasExternalReference: columns.has("external_reference")
  };
};

const linkedInstrumentSelectProjection = (schema: LinkedInstrumentSchema): string => [
  "id",
  "account_of_digital_asset_id",
  schema.hasBusinessClientId ? "business_client_id" : "null::uuid as business_client_id",
  "instrument_type",
  schema.hasPurpose ? "purpose" : "null::text as purpose",
  schema.hasRailCode ? "rail_code" : "null::text as rail_code",
  schema.hasRailName ? "rail_name" : "null::text as rail_name",
  schema.hasRailType ? "rail_type" : "null::text as rail_type",
  schema.hasAssetCode ? "asset_code" : "null::text as asset_code",
  "status",
  schema.hasNetworkCode ? "network_code" : "null::text as network_code",
  schema.hasIsDefault ? "is_default" : "false as is_default",
  schema.hasProvider ? "provider" : "null::text as provider",
  schema.hasVerificationStatus ? "verification_status" : "null::text as verification_status",
  schema.hasMetadata ? "metadata" : "'{}'::jsonb as metadata",
  "created_at",
  schema.hasUpdatedAt ? "updated_at" : "created_at as updated_at"
].join(", ");

const insertLinkedInstrument = async (
  client: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
  params: {
    linkedInstrumentId: string;
    accountId: string | null;
    tenantId: string;
    businessClientId: string;
    instrumentType: string;
    status: string;
    assetCode: string;
    railType: string;
    purpose: string;
    railCode: string;
    railName: string;
    provider: string;
    verificationStatus: string;
    metadata: Record<string, unknown>;
    networkCode: string | null;
    isDefault: boolean;
    schema: LinkedInstrumentSchema;
  }
) => {
  if (params.schema.hasRailCode) {
    await client.query(
      params.schema.hasBusinessClientId
        ? `insert into linked_instruments
          (id, account_of_digital_asset_id, platform_tenant_id, business_client_id, instrument_type, status, asset_code, rail_type,
           purpose, rail_code, rail_name, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, now(), now())`
        : `insert into linked_instruments
          (id, account_of_digital_asset_id, platform_tenant_id, instrument_type, status, asset_code, rail_type,
           purpose, rail_code, rail_name, provider, verification_status, metadata, network_code, is_default, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, now(), now())`,
      params.schema.hasBusinessClientId
        ? [
          params.linkedInstrumentId,
          params.accountId,
          params.tenantId,
          params.businessClientId,
          params.instrumentType,
          params.status,
          params.assetCode,
          params.railType,
          params.purpose,
          params.railCode,
          params.railName,
          params.provider,
          params.verificationStatus,
          JSON.stringify(params.metadata),
          params.networkCode,
          params.isDefault
        ]
        : [
          params.linkedInstrumentId,
          params.accountId,
          params.tenantId,
          params.instrumentType,
          params.status,
          params.assetCode,
          params.railType,
          params.purpose,
          params.railCode,
          params.railName,
          params.provider,
          params.verificationStatus,
          JSON.stringify(params.metadata),
          params.networkCode,
          params.isDefault
        ]
    );
  } else {
    const columns = ["id", "account_of_digital_asset_id", "instrument_type", "status", "created_at"];
    const values: unknown[] = [
      params.linkedInstrumentId,
      params.accountId,
      params.instrumentType,
      params.status,
      new Date().toISOString()
    ];

    if (params.schema.hasPlatformTenantId) {
      columns.splice(2, 0, "platform_tenant_id");
      values.splice(2, 0, params.tenantId);
    }
    if (params.schema.hasBusinessClientId) {
      const idx = params.schema.hasPlatformTenantId ? 3 : 2;
      columns.splice(idx, 0, "business_client_id");
      values.splice(idx, 0, params.businessClientId);
    }
    if (params.schema.hasExternalReference) {
      const insertIndex = columns.length - 1;
      columns.splice(insertIndex, 0, "external_reference");
      values.splice(insertIndex, 0, params.railCode || params.railName || null);
    }

    const placeholders = values.map((_, index) => `$${index + 1}`).join(", ");
    await client.query(
      `insert into linked_instruments (${columns.join(", ")}) values (${placeholders})`,
      values
    );
  }

  const tenantWhere = params.schema.hasPlatformTenantId ? "and platform_tenant_id = $2" : "";
  const result = await client.query(
    `select ${linkedInstrumentSelectProjection(params.schema)}
       from linked_instruments
      where id = $1 ${tenantWhere}
      limit 1`,
    [params.linkedInstrumentId, params.tenantId]
  );
  return result.rows[0];
};

export const handleCreateMyBusinessLinkedInstrument = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");

  const body = isRecord(input.payload) ? input.payload : {};
  const accountId = optionalBodyString(body, "accountOfDigitalAssetId") ?? optionalBodyString(body, "accountId");
  let ownedAccount: { accountId: string; businessClientId: string; tenantId: string } | undefined;
  if (accountId) {
    ownedAccount = await resolveOwnedBusinessAda(state, auth, accountId);
    if (!ownedAccount) return { status: 404, body: { error: "account_not_found" } };
  }

  const payload = buildLinkedInstrumentPayload(body);
  const tenantId = uuidFromRuntimeId(context.tenantId) ?? context.tenantId;

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const linkedSchema = await getLinkedInstrumentSchema(client);
        await ensureAssetCatalogRow(client, payload.assetCode, payload.railType);
        await client.query(
          `insert into asset_rails (rail_code, asset_code, rail_name, status)
           values ($1, $2, $3, 'active')
           on conflict (rail_code) do update
             set rail_name = excluded.rail_name,
                 status = excluded.status`,
          [payload.railCode, payload.assetCode, payload.railName]
        );

        const linkedInstrumentId = randomUUID();
        const created = await insertLinkedInstrument(client, {
          linkedInstrumentId,
          accountId: ownedAccount?.accountId ?? null,
          tenantId,
          businessClientId: context.businessClientId,
          instrumentType: payload.instrumentType,
          status: payload.status ?? (ownedAccount ? "active" : "draft"),
          assetCode: payload.assetCode,
          railType: payload.railType,
          purpose: payload.purpose,
          railCode: payload.railCode,
          railName: payload.railName,
          provider: payload.provider,
          verificationStatus: payload.verificationStatus,
          metadata: payload.mergedMetadata,
          networkCode: payload.networkCode ?? null,
          isDefault: payload.isDefault,
          schema: linkedSchema
        });

        if (!created) return { status: 500, body: { error: "linked_instrument_create_failed" } };
        return {
          status: 201,
          body: {
            businessClientId: context.businessClientId,
            linkedInstrument: mapLinkedInstrumentRow(created)
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleCreateMyBusinessLinkedInstrument; falling back", error);
    }
  }

  return { status: 503, body: { error: "linked_instrument_postgres_required" } };
};

export const handleCreateMyLinkedInstrument = async (
  state: ApiState,
  input: { accountId: string; headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, input.accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  const body = isRecord(input.payload) ? input.payload : {};
  const payload = buildLinkedInstrumentPayload(body);

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const linkedSchema = await getLinkedInstrumentSchema(client);
        await ensureAssetCatalogRow(client, payload.assetCode, payload.railType);
        await client.query(
          `insert into asset_rails (rail_code, asset_code, rail_name, status)
           values ($1, $2, $3, 'active')
           on conflict (rail_code) do update
             set rail_name = excluded.rail_name,
                 status = excluded.status`,
          [payload.railCode, payload.assetCode, payload.railName]
        );

        const linkedInstrumentId = randomUUID();
        const row = await insertLinkedInstrument(client, {
          linkedInstrumentId,
          accountId: owned.accountId,
          tenantId: owned.tenantId,
          businessClientId: owned.businessClientId,
          instrumentType: payload.instrumentType,
          status: payload.status ?? "active",
          assetCode: payload.assetCode,
          railType: payload.railType,
          purpose: payload.purpose,
          railCode: payload.railCode,
          railName: payload.railName,
          provider: payload.provider,
          verificationStatus: payload.verificationStatus,
          metadata: payload.mergedMetadata,
          networkCode: payload.networkCode ?? null,
          isDefault: payload.isDefault,
          schema: linkedSchema
        });
        if (!row) return { status: 500, body: { error: "linked_instrument_create_failed" } };
        return {
          status: 201,
          body: {
            accountId: owned.accountId,
            linkedInstrument: mapLinkedInstrumentRow(row)
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleCreateMyLinkedInstrument; falling back", error);
    }
  }

  return { status: 503, body: { error: "linked_instrument_postgres_required" } };
};

export const handleUpdateMyLinkedInstrument = async (
  state: ApiState,
  input: {
    accountId: string;
    linkedInstrumentId: string;
    headers: Record<string, string | undefined>;
    payload?: unknown;
  }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessAda(state, auth, input.accountId);
  if (!owned) return { status: 404, body: { error: "account_not_found" } };

  const body = isRecord(input.payload) ? input.payload : {};
  const patchPurpose = optionalBodyString(body, "purpose");
  const patchRailName = optionalBodyString(body, "railName");
  const patchStatus = optionalBodyString(body, "status");
  const patchNetworkCode = optionalBodyString(body, "networkCode");
  const patchIsDefault = typeof body.isDefault === "boolean" ? body.isDefault : undefined;
  const patchMetadata = bodyRecord(body, "metadata");

  if (!patchPurpose && !patchRailName && !patchStatus && !patchNetworkCode && patchIsDefault === undefined && Object.keys(patchMetadata).length === 0) {
    return badRequest("linked_instrument_update_payload_required");
  }

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const existing = await client.query(
          `select id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where id = $1
              and account_of_digital_asset_id = $2
              and platform_tenant_id = $3
            limit 1`,
          [input.linkedInstrumentId, owned.accountId, owned.tenantId]
        );
        const row = existing.rows[0] as Record<string, unknown> | undefined;
        if (!row) return { status: 404, body: { error: "linked_instrument_not_found" } };

        const existingMetadata = (row.metadata && typeof row.metadata === "object") ? row.metadata as Record<string, unknown> : {};
        const mergedMetadata = Object.keys(patchMetadata).length > 0 ? { ...existingMetadata, ...patchMetadata } : existingMetadata;

        await client.query(
          `update linked_instruments
              set purpose = coalesce($4, purpose),
                  rail_name = coalesce($5, rail_name),
                  status = coalesce($6, status),
                  network_code = coalesce($7, network_code),
                  is_default = coalesce($8, is_default),
                  metadata = $9::jsonb,
                  updated_at = now()
            where id = $1
              and account_of_digital_asset_id = $2
              and platform_tenant_id = $3`,
          [
            input.linkedInstrumentId,
            owned.accountId,
            owned.tenantId,
            patchPurpose ?? null,
            patchRailName ?? null,
            patchStatus ?? null,
            patchNetworkCode ?? null,
            patchIsDefault ?? null,
            JSON.stringify(mergedMetadata)
          ]
        );

        const updated = await client.query(
          `select id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where id = $1
              and account_of_digital_asset_id = $2
              and platform_tenant_id = $3
            limit 1`,
          [input.linkedInstrumentId, owned.accountId, owned.tenantId]
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return { status: 500, body: { error: "linked_instrument_update_failed" } };
        return {
          status: 200,
          body: {
            accountId: owned.accountId,
            linkedInstrument: mapLinkedInstrumentRow(updatedRow)
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleUpdateMyLinkedInstrument; falling back", error);
    }
  }

  return { status: 503, body: { error: "linked_instrument_postgres_required" } };
};

export const handleUpdateMyBusinessLinkedInstrument = async (
  state: ApiState,
  input: {
    linkedInstrumentId: string;
    headers: Record<string, string | undefined>;
    payload?: unknown;
  }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const owned = await resolveOwnedBusinessLinkedInstrument(state, auth, input.linkedInstrumentId);
  if (!owned) return { status: 404, body: { error: "linked_instrument_not_found" } };

  const body = isRecord(input.payload) ? input.payload : {};
  const patchPurpose = optionalBodyString(body, "purpose");
  const patchRailName = optionalBodyString(body, "railName");
  const patchStatus = optionalBodyString(body, "status");
  const patchNetworkCode = optionalBodyString(body, "networkCode");
  const patchIsDefault = typeof body.isDefault === "boolean" ? body.isDefault : undefined;
  const patchMetadata = bodyRecord(body, "metadata");

  if (!patchPurpose && !patchRailName && !patchStatus && !patchNetworkCode && patchIsDefault === undefined && Object.keys(patchMetadata).length === 0) {
    return badRequest("linked_instrument_update_payload_required");
  }

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const existing = await client.query(
          `select id, account_of_digital_asset_id, business_client_id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3
            limit 1`,
          [owned.linkedInstrumentId, owned.tenantId, owned.businessClientId]
        );
        const row = existing.rows[0] as Record<string, unknown> | undefined;
        if (!row) return { status: 404, body: { error: "linked_instrument_not_found" } };

        const existingMetadata = (row.metadata && typeof row.metadata === "object") ? row.metadata as Record<string, unknown> : {};
        const mergedMetadata = Object.keys(patchMetadata).length > 0 ? { ...existingMetadata, ...patchMetadata } : existingMetadata;

        await client.query(
          `update linked_instruments
              set purpose = coalesce($4, purpose),
                  rail_name = coalesce($5, rail_name),
                  status = coalesce($6, status),
                  network_code = coalesce($7, network_code),
                  is_default = coalesce($8, is_default),
                  metadata = $9::jsonb,
                  updated_at = now()
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3`,
          [
            owned.linkedInstrumentId,
            owned.tenantId,
            owned.businessClientId,
            patchPurpose ?? null,
            patchRailName ?? null,
            patchStatus ?? null,
            patchNetworkCode ?? null,
            patchIsDefault ?? null,
            JSON.stringify(mergedMetadata)
          ]
        );

        const updated = await client.query(
          `select id, account_of_digital_asset_id, business_client_id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3
            limit 1`,
          [owned.linkedInstrumentId, owned.tenantId, owned.businessClientId]
        );
        const updatedRow = updated.rows[0];
        if (!updatedRow) return { status: 500, body: { error: "linked_instrument_update_failed" } };
        return {
          status: 200,
          body: {
            linkedInstrument: mapLinkedInstrumentRow(updatedRow)
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleUpdateMyBusinessLinkedInstrument; falling back", error);
    }
  }

  return { status: 503, body: { error: "linked_instrument_postgres_required" } };
};

export const handleAssignMyLinkedInstrumentToAda = async (
  state: ApiState,
  input: {
    linkedInstrumentId: string;
    headers: Record<string, string | undefined>;
    payload?: unknown;
  }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const ownedLinked = await resolveOwnedBusinessLinkedInstrument(state, auth, input.linkedInstrumentId);
  if (!ownedLinked) return { status: 404, body: { error: "linked_instrument_not_found" } };

  const body = isRecord(input.payload) ? input.payload : {};
  const accountId = optionalBodyString(body, "accountOfDigitalAssetId") ?? optionalBodyString(body, "accountId");
  if (!accountId) return badRequest("account_id_required");
  const ownedAccount = await resolveOwnedBusinessAda(state, auth, accountId);
  if (!ownedAccount) return { status: 404, body: { error: "account_not_found" } };

  if (ownedAccount.businessClientId !== ownedLinked.businessClientId) {
    return { status: 400, body: { error: "linked_instrument_business_client_mismatch" } };
  }

  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        await client.query(
          `update linked_instruments
              set account_of_digital_asset_id = $4,
                  status = case when status = 'draft' then 'active' else status end,
                  updated_at = now()
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3`,
          [ownedLinked.linkedInstrumentId, ownedLinked.tenantId, ownedLinked.businessClientId, ownedAccount.accountId]
        );

        const updated = await client.query(
          `select id, account_of_digital_asset_id, business_client_id, instrument_type, purpose, rail_code, rail_name, rail_type, asset_code, status,
                  network_code, is_default, provider, verification_status, metadata, created_at, updated_at
             from linked_instruments
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3
            limit 1`,
          [ownedLinked.linkedInstrumentId, ownedLinked.tenantId, ownedLinked.businessClientId]
        );
        const row = updated.rows[0];
        if (!row) return { status: 500, body: { error: "linked_instrument_assign_failed" } };
        return {
          status: 200,
          body: {
            accountId: ownedAccount.accountId,
            linkedInstrument: mapLinkedInstrumentRow(row)
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleAssignMyLinkedInstrumentToAda; falling back", error);
    }
  }

  return { status: 503, body: { error: "linked_instrument_postgres_required" } };
};

export const handleCreateMyAdaAccount = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");

  const body = isRecord(input.payload) ? input.payload : {};
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  if (bundle.application.status !== "approved") return badRequest("business_client_not_approved");

  const now = new Date().toISOString();
  const accountName = bodyString(body, "accountName", "New ADA");
  const usePurpose = normalizeUsePurpose(bodyString(body, "usePurpose", "settlement"));
  const topology = bodyString(body, "topology", "unlinked");
  const assetCode = normalizeAssetCode(bodyString(body, "assetCode", "USDC"));
  const activationDecision: ActivationDecision = topology === "unlinked" ? "auto" : "approval_required";
  const activationReasonCode = activationDecision === "auto"
    ? "virtual_no_linked_instrument_auto_activation"
    : "linked_instrument_requires_internal_approval";
  const initialStatus: "active" | "pending_activation" = topology === "unlinked" ? "active" : "pending_activation";
  const assetRail = bodyString(
    body,
    "assetRail",
    topology === "wallet-linked"
      ? "wallet_blockchain"
      : topology === "fiat-linked"
        ? "commercial_wire"
        : "circle_internal"
  );

  const applicationTenantId = uuidFromRuntimeId(bundle.application.tenantId) ?? persistentTenantId(state);
  const authUserId = uuidFromRuntimeId(auth.authUserId);

  if (postgresUrlFromEnv() && authUserId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const identity = await client.query(
          `select business_client.id,
                  business_client.legal_name,
                  business_client.platform_tenant_id
             from business_onboarding_applications application
             join business_clients business_client
               on business_client.platform_tenant_id = $1
              and (
                business_client.id = application.id
                or business_client.correlation_id = 'business_onboarding:' || application.id::text
              )
            where application.auth_user_id = $2::uuid
              and application.status = 'approved'
              and business_client.onboarding_status = 'approved'
            order by business_client.created_at desc
            limit 1`,
          [applicationTenantId, authUserId]
        );

        const businessClient = identity.rows[0] as {
          id: string;
          legal_name: string;
          platform_tenant_id: string;
        } | undefined;

        if (!businessClient) return { status: 400, body: { error: "business_client_not_approved" } };

        const accountId = randomUUID();
        await client.query(
          `insert into accounts_of_digital_asset
            (id, platform_tenant_id, business_client_id, account_name, use_purpose, status, asset_code, asset_rail, correlation_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
          [
            accountId,
            businessClient.platform_tenant_id,
            businessClient.id,
            accountName,
            usePurpose,
            initialStatus,
            assetCode,
            assetRail,
            `business_me_ada_create:${accountId}`,
            now
          ]
        );

        return {
          status: 201,
          body: {
            account: {
              id: accountId,
              tenantId: businessClient.platform_tenant_id,
              businessClientId: businessClient.id,
              businessClientName: businessClient.legal_name,
              accountName,
              usePurpose,
              status: initialStatus,
              activationDecision,
              activationReasonCode,
              assetCode,
              assetRail,
              createdAt: now
            }
          }
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in handleCreateMyAdaAccount; falling back", error);
    }
  }

  const runtimeBusinessClient = state.businessClients.find((item) =>
    item.tenantId === bundle.application.tenantId && item.onboardingStatus === "approved"
  );
  if (!runtimeBusinessClient) return badRequest("business_client_not_approved");

  const runtimeAccount = {
    id: newId("ada"),
    tenantId: runtimeBusinessClient.tenantId,
    businessClientId: runtimeBusinessClient.id,
    accountName,
    usePurpose: runtimePurposeFromUsePurpose(usePurpose),
    status: initialStatus,
    createdAt: now
  };
  state.accounts.push(runtimeAccount);
  state.balances.push({
    accountOfDigitalAssetId: runtimeAccount.id,
    availableMinorUnits: 0n,
    pendingMinorUnits: 0n,
    reservedMinorUnits: 0n,
    lockedMinorUnits: 0n,
    suspenseMinorUnits: 0n,
    version: 1
  });

  return {
    status: 201,
    body: {
      account: {
        ...runtimeAccount,
        businessClientName: runtimeBusinessClient.legalName,
        activationDecision,
        activationReasonCode,
        assetCode,
        assetRail
      }
    }
  };
};

export const handleListMyApiKeys = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");
  const ownerKey = businessApiKeyStoreKey(context.tenantId, context.businessClientId, context.authUserId);
  const keys = businessApiKeyRecords.get(ownerKey) ?? [];
  return {
    status: 200,
    body: {
      keys: keys.map(({ keyHash: _keyHash, ...key }) => key)
    }
  };
};

export const handleCreateMyApiKey = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");

  const body = isRecord(input.payload) ? input.payload : {};
  const requestedScopes = normalizeBusinessApiKeyScopes(body.scopes);
  if (requestedScopes.error) return badRequest(requestedScopes.error);
  const scopes = requestedScopes.scopes;
  const plaintextKey = createPlaintextApiKey(randomUUID());
  const secret = plaintextKey.split(".")[1]!;
  const createdAt = new Date().toISOString();
  const key: BusinessApiKeyView & { keyHash: string } = {
    id: randomUUID(),
    keyPrefix: plaintextKey.split(".")[0]!,
    ownerAuthUserId: context.authUserId,
    ownerTenantId: context.tenantId,
    ownerBusinessClientId: context.businessClientId,
    ownerBusinessClientName: context.businessClientName,
    scopes,
    status: "active",
    createdAt,
    keyHash: hashApiSecret(secret)
  };
  const ownerKey = businessApiKeyStoreKey(context.tenantId, context.businessClientId, context.authUserId);
  const keys = businessApiKeyRecords.get(ownerKey) ?? [];
  businessApiKeyRecords.set(ownerKey, [key, ...keys]);

  emitOutbox(state, "business_user.api_key_created", {
    authUserId: context.authUserId,
    businessClientId: context.businessClientId,
    keyId: key.id,
    scopes
  });

  return {
    status: 201,
    body: {
      key: {
        id: key.id,
        keyPrefix: key.keyPrefix,
        ownerBusinessClientId: key.ownerBusinessClientId,
        ownerBusinessClientName: key.ownerBusinessClientName,
        scopes: key.scopes,
        status: key.status,
        createdAt: key.createdAt
      },
      plaintextKey
    }
  };
};

const mapLinkedInstrumentRow = (row: Record<string, unknown>) => ({
  id: String(row.id ?? ""),
  accountOfDigitalAssetId: row.account_of_digital_asset_id ? String(row.account_of_digital_asset_id) : undefined,
  businessClientId: row.business_client_id ? String(row.business_client_id) : undefined,
  instrumentType: String(row.instrument_type ?? ""),
  purpose: row.purpose ? String(row.purpose) : undefined,
  railCode: row.rail_code ? String(row.rail_code) : undefined,
  railName: row.rail_name ? String(row.rail_name) : undefined,
  railType: row.rail_type ? String(row.rail_type) : undefined,
  assetCode: row.asset_code ? String(row.asset_code) : undefined,
  status: String(row.status ?? ""),
  networkCode: row.network_code ? String(row.network_code) : undefined,
  isDefault: Boolean(row.is_default),
  provider: row.provider ? String(row.provider) : undefined,
  verificationStatus: row.verification_status ? String(row.verification_status) : undefined,
  metadata: row.metadata && typeof row.metadata === "object" ? row.metadata as Record<string, unknown> : {},
  createdAt: timestampToOptionalIsoString(row.created_at),
  updatedAt: timestampToOptionalIsoString(row.updated_at)
});

export const handleRevokeMyApiKey = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; apiKeyId: string }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");

  const ownerKey = businessApiKeyStoreKey(context.tenantId, context.businessClientId, context.authUserId);
  const keys = businessApiKeyRecords.get(ownerKey) ?? [];
  const target = keys.find((key) => key.id === input.apiKeyId);
  if (!target) return { status: 404, body: { error: "api_key_not_found" } };
  if (target.status !== "revoked") {
    target.status = "revoked";
    target.revokedAt = new Date().toISOString();
    emitOutbox(state, "business_user.api_key_revoked", {
      authUserId: context.authUserId,
      businessClientId: context.businessClientId,
      keyId: target.id
    });
  }
  const { keyHash: _keyHash, ...safe } = target;
  return { status: 200, body: { key: safe } };
};

export const handleRotateMyApiKey = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; apiKeyId: string; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return badRequest("business_client_not_approved");

  const body = isRecord(input.payload) ? input.payload : {};
  const ownerKey = businessApiKeyStoreKey(context.tenantId, context.businessClientId, context.authUserId);
  const keys = businessApiKeyRecords.get(ownerKey) ?? [];
  const previous = keys.find((key) => key.id === input.apiKeyId);
  if (!previous) return { status: 404, body: { error: "api_key_not_found" } };

  if (previous.status !== "revoked") {
    previous.status = "revoked";
    previous.revokedAt = new Date().toISOString();
  }

  const requestedScopes = normalizeBusinessApiKeyScopes(body.scopes);
  if (requestedScopes.error) return badRequest(requestedScopes.error);
  const scopes = requestedScopes.scopes.length ? requestedScopes.scopes : previous.scopes;
  const plaintextKey = createPlaintextApiKey(randomUUID());
  const secret = plaintextKey.split(".")[1]!;
  const rotatedKey: BusinessApiKeyView & { keyHash: string } = {
    id: randomUUID(),
    keyPrefix: plaintextKey.split(".")[0]!,
    ownerAuthUserId: context.authUserId,
    ownerTenantId: context.tenantId,
    ownerBusinessClientId: context.businessClientId,
    ownerBusinessClientName: context.businessClientName,
    scopes,
    status: "active",
    createdAt: new Date().toISOString(),
    keyHash: hashApiSecret(secret)
  };

  businessApiKeyRecords.set(ownerKey, [rotatedKey, ...keys]);
  emitOutbox(state, "business_user.api_key_rotated", {
    authUserId: context.authUserId,
    businessClientId: context.businessClientId,
    keyId: rotatedKey.id,
    rotatedFromApiKeyId: previous.id
  });

  return {
    status: 201,
    body: {
      key: {
        id: rotatedKey.id,
        keyPrefix: rotatedKey.keyPrefix,
        ownerBusinessClientId: rotatedKey.ownerBusinessClientId,
        ownerBusinessClientName: rotatedKey.ownerBusinessClientName,
        scopes: rotatedKey.scopes,
        status: rotatedKey.status,
        createdAt: rotatedKey.createdAt
      },
      plaintextKey,
      rotatedFromApiKeyId: previous.id
    }
  };
};

const resolveOnboardingAssets = async (
  state: ApiState,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>
): Promise<{ businessClient?: OnboardingBusinessClientView; adaAccounts: OnboardingAdaAccountView[] }> => {
  const applicationId = uuidFromRuntimeId(application.id);
  const tenantId = uuidFromRuntimeId(application.tenantId) ?? process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";

  if (postgresUrlFromEnv() && applicationId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const businessClientResult = await client.query(
          `select id, legal_name, country, onboarding_status
             from business_clients
            where platform_tenant_id = $1
              and correlation_id = $2
            order by created_at desc
            limit 1`,
          [tenantId, `business_onboarding:${applicationId}`]
        );

        const businessClientRow = businessClientResult.rows[0] as {
          id: string;
          legal_name: string;
          country: string;
          onboarding_status: string;
        } | undefined;

        if (!businessClientRow) {
          return { businessClient: undefined, adaAccounts: [] };
        }

        const accountRows = await client.query(
          `select account.id,
                  account.business_client_id,
                  account.account_name,
                  account.use_purpose,
                  account.status,
                  account.asset_code,
                  account.asset_rail,
                  account.created_at,
                  balance.available_minor_units,
                  balance.pending_minor_units,
                  balance.reserved_minor_units,
                  balance.locked_minor_units,
                  balance.suspense_minor_units,
                  balance.updated_at as balance_updated_at
             from accounts_of_digital_asset account
             left join lateral (
               select b.available_minor_units,
                      b.pending_minor_units,
                      b.reserved_minor_units,
                      b.locked_minor_units,
                      b.suspense_minor_units,
                      b.updated_at
                 from account_of_digital_asset_balances b
                where b.platform_tenant_id = account.platform_tenant_id
                  and b.account_of_digital_asset_id = account.id
                order by b.updated_at desc
                limit 1
             ) balance on true
            where account.platform_tenant_id = $1
              and account.business_client_id = $2
            order by account.created_at desc`,
          [tenantId, businessClientRow.id]
        ).catch(async (error: unknown) => {
          if (!isMissingTableError(error, "account_of_digital_asset_balances")) throw error;
          return client.query(
            `select account.id,
                    account.business_client_id,
                    account.account_name,
                    account.use_purpose,
                    account.status,
                    account.asset_code,
                    account.asset_rail,
                    account.created_at,
                    null::bigint as available_minor_units,
                    null::bigint as pending_minor_units,
                    null::bigint as reserved_minor_units,
                    null::bigint as locked_minor_units,
                    null::bigint as suspense_minor_units,
                    null::timestamptz as balance_updated_at
               from accounts_of_digital_asset account
              where account.platform_tenant_id = $1
                and account.business_client_id = $2
              order by account.created_at desc`,
            [tenantId, businessClientRow.id]
          );
        });

        return {
          businessClient: {
            id: businessClientRow.id,
            legalName: businessClientRow.legal_name,
            country: businessClientRow.country,
            onboardingStatus: businessClientRow.onboarding_status
          },
          adaAccounts: accountRows.rows.map((row) => ({
            id: String(row.id),
            accountCode: buildAdaAccountCode(String(row.account_name), String(row.use_purpose), row.asset_code ? String(row.asset_code) : "USDC"),
            accountName: String(row.account_name),
            businessClientId: String(row.business_client_id),
            businessClientName: businessClientRow.legal_name,
            status: String(row.status),
            usePurpose: String(row.use_purpose),
            assetCode: row.asset_code ? String(row.asset_code) : undefined,
            assetRail: row.asset_rail ? String(row.asset_rail) : undefined,
            createdAt: timestampToOptionalIsoString(row.created_at),
            balances: {
              availableMinorUnits: String(row.available_minor_units ?? 0),
              pendingMinorUnits: String(row.pending_minor_units ?? 0),
              reservedMinorUnits: String(row.reserved_minor_units ?? 0),
              lockedMinorUnits: String(row.locked_minor_units ?? 0),
              suspenseMinorUnits: String(row.suspense_minor_units ?? 0),
              updatedAt: timestampToOptionalIsoString(row.balance_updated_at)
            }
          }))
        };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in resolveOnboardingAssets; falling back", error);
    }
  }

  // Never return simulated ADA account data to business users.
  // If Postgres data is unavailable or missing, surface an empty list so UI reflects real backend state only.
  return { businessClient: undefined, adaAccounts: [] };
};

const resolveApprovedBusinessClientContext = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser
): Promise<{ authUserId: string; businessClientId: string; businessClientName: string; tenantId: string } | undefined> => {
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  if (bundle.application.status !== "approved") return undefined;
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  const assets = await resolveOnboardingAssets(state, bundle.application, stepPayloads);
  if (assets.businessClient && assets.businessClient.onboardingStatus === "approved") {
    return {
      authUserId: auth.authUserId,
      businessClientId: assets.businessClient.id,
      businessClientName: assets.businessClient.legalName,
      tenantId: bundle.application.tenantId
    };
  }
  const runtimeClient = state.businessClients.find((item) =>
    item.tenantId === bundle.application.tenantId && item.onboardingStatus === "approved"
  );
  if (!runtimeClient) return undefined;
  return {
    authUserId: auth.authUserId,
    businessClientId: runtimeClient.id,
    businessClientName: runtimeClient.legalName,
    tenantId: bundle.application.tenantId
  };
};

const businessApiKeyStoreKey = (tenantId: string, businessClientId: string, authUserId: string): string =>
  `${tenantId}:${businessClientId}:${authUserId}`;

const normalizeBusinessApiKeyScopes = (
  value: unknown
): { scopes: string[]; error?: string } => {
  if (!Array.isArray(value)) return { scopes: ["ada.read", "ada.open"] };
  const requested = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!requested.length) return { scopes: ["ada.read", "ada.open"] };
  if (requested.some((scope) => scope.includes("*") || scope.startsWith("internal."))) {
    return { scopes: [], error: "business_scope_forbidden" };
  }
  const allowed = new Set<string>(businessApiKeyAllowlist);
  const invalid = requested.find((scope) => !allowed.has(scope));
  if (invalid) return { scopes: [], error: "business_scope_not_allowlisted" };
  return { scopes: [...new Set(requested)] };
};

const optionalBodyString = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const bodyRecord = (body: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = body[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
};

const readBusinessApiKeyFromHeaders = (headers: Record<string, string | undefined>): string | undefined => {
  const headerKey = headers["x-gtt-api-key"] ?? headers["X-GTT-API-Key"];
  if (headerKey?.trim()) return headerKey.trim();
  const authorization = headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return undefined;
  const bearer = authorization.slice("Bearer ".length).trim();
  if (!bearer.startsWith("gtt_live_") || !bearer.includes(".")) return undefined;
  return bearer;
};

const resolveBusinessApiKeyRecord = (
  plaintextKey: string
): (BusinessApiKeyView & { keyHash: string }) | undefined => {
  const [prefix, secret] = plaintextKey.split(".");
  if (!prefix || !secret) return undefined;
  const secretHash = hashApiSecret(secret);
  for (const keys of businessApiKeyRecords.values()) {
    const match = keys.find((candidate) =>
      candidate.keyPrefix === prefix
      && candidate.keyHash === secretHash
      && candidate.status === "active"
    );
    if (match) return match;
  }
  return undefined;
};

export const authenticateBusinessApiKey = async (
  headers: Record<string, string | undefined>,
  requiredScopes: string[] = []
): Promise<AuthenticatedBusinessApiKey | undefined> => {
  const plaintextKey = readBusinessApiKeyFromHeaders(headers);
  if (!plaintextKey) return undefined;
  const record = resolveBusinessApiKeyRecord(plaintextKey);
  if (!record) return undefined;
  if (requiredScopes.length > 0 && requiredScopes.some((scope) => !record.scopes.includes(scope))) return undefined;
  return {
    authUserId: record.ownerAuthUserId,
    email: "business_api_key@gtt.local",
    keyId: record.id,
    scopes: [...record.scopes]
  };
};

export const authenticateBusinessUserOrApiKey = async (
  headers: Record<string, string | undefined>,
  requiredScopes: string[] = []
): Promise<AuthenticatedBusinessUser | undefined> => {
  const user = await authenticateBusinessUser(headers);
  if (user) return user;
  const apiKey = await authenticateBusinessApiKey(headers, requiredScopes);
  if (!apiKey) return undefined;
  return {
    authUserId: apiKey.authUserId,
    email: apiKey.email
  };
};

const activationViewFromAccountStatus = (status: string): ActivationView => {
  if (status === "active") {
    return {
      activationDecision: "auto",
      activationReasonCode: "virtual_no_linked_instrument_auto_activation"
    };
  }
  return {
    activationDecision: "approval_required",
    activationReasonCode: "linked_instrument_requires_internal_approval"
  };
};

const resolveOwnedBusinessAda = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser,
  accountId: string
): Promise<{ accountId: string; businessClientId: string; tenantId: string } | undefined> => {
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const application = persisted?.application ?? state.businessOnboardingApplications.find((item) => item.authUserId === auth.authUserId);
  if (!application) return undefined;
  const applicationId = uuidFromRuntimeId(application.id);
  const tenantId = uuidFromRuntimeId(application.tenantId) ?? persistentTenantId(state);

  if (postgresUrlFromEnv() && applicationId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select account.id, account.business_client_id, account.platform_tenant_id
             from business_onboarding_applications application
             join business_clients client
               on client.platform_tenant_id = $1
              and (
                client.id = application.id
                or client.correlation_id = 'business_onboarding:' || application.id::text
              )
             join accounts_of_digital_asset account
               on account.business_client_id = client.id
              and account.platform_tenant_id = client.platform_tenant_id
            where application.auth_user_id = $2::uuid
              and application.status = 'approved'
              and account.platform_tenant_id = $1
              and account.id = $3
            limit 1`,
          [tenantId, uuidFromRuntimeId(auth.authUserId) ?? auth.authUserId, accountId]
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? {
          accountId: String(row.id),
          businessClientId: String(row.business_client_id),
          tenantId: String(row.platform_tenant_id)
        } : undefined;
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in resolveOwnedBusinessAda; falling back", error);
    }
  }

  const businessClient = state.businessClients.find((item) =>
    item.tenantId === application.tenantId && item.onboardingStatus === "approved"
  );
  const account = state.accounts.find((item) =>
    item.id === accountId
    && item.tenantId === (businessClient?.tenantId ?? application.tenantId)
    && item.businessClientId === businessClient?.id
  );
  return account && businessClient ? {
    accountId: account.id,
    businessClientId: businessClient.id,
    tenantId: account.tenantId
  } : undefined;
};

const resolveOwnedBusinessLinkedInstrument = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser,
  linkedInstrumentId: string
): Promise<{ linkedInstrumentId: string; businessClientId: string; tenantId: string; accountId?: string } | undefined> => {
  const context = await resolveApprovedBusinessClientContext(state, auth);
  if (!context) return undefined;

  const tenantId = uuidFromRuntimeId(context.tenantId) ?? context.tenantId;
  if (postgresUrlFromEnv()) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select id, business_client_id, platform_tenant_id, account_of_digital_asset_id
             from linked_instruments
            where id = $1
              and platform_tenant_id = $2
              and business_client_id = $3
            limit 1`,
          [linkedInstrumentId, tenantId, context.businessClientId]
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        return row ? {
          linkedInstrumentId: String(row.id),
          businessClientId: String(row.business_client_id),
          tenantId: String(row.platform_tenant_id),
          accountId: row.account_of_digital_asset_id ? String(row.account_of_digital_asset_id) : undefined
        } : undefined;
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in resolveOwnedBusinessLinkedInstrument; falling back", error);
    }
  }

  return undefined;
};

export const handleSaveMyOnboardingStep = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; stepKey: string; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const stepKey = input.stepKey.trim();
  if (!stepKey) return badRequest("step_key_required");

  const now = new Date().toISOString();
  const payload = isRecord(input.payload) ? input.payload : {};
  const payloadStepKey = stringPayload(payload, "completedStepKey") ?? stepKey;
  const existing = state.onboardingStepPayloads.find((item) => item.applicationId === bundle.application.id && item.stepKey === payloadStepKey);
  let savedStep: OnboardingStepPayload;
  if (existing) {
    existing.payload = payload;
    existing.savedAt = now;
    savedStep = existing;
  } else {
    savedStep = {
      id: newId("onboarding_step"),
      tenantId: state.tenantId,
      applicationId: bundle.application.id,
      stepKey: payloadStepKey,
      payload,
      savedAt: now
    };
    state.onboardingStepPayloads.push(savedStep);
  }

  if (isOnboardingStep(stepKey)) {
    bundle.application.currentStep = stepKey;
    bundle.application.updatedAt = now;
  }

  await persistOnboardingBundle(state, auth, bundle);
  await persistOnboardingStepPayload(savedStep);

  return {
    status: 200,
    body: { ok: true, application: bundle.application }
  };
};

export const handleSubmitMyOnboarding = async (
  state: ApiState,
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  const now = new Date().toISOString();
  bundle.application.status = "pending_review";
  bundle.application.currentStep = "pending_review";
  bundle.application.submittedAt = now;
  bundle.application.updatedAt = now;
  const stepPayloads = await hydrateOnboardingStepPayloads(state, bundle.application);
  const businessClient = businessClientFromOnboarding(state, bundle.application, stepPayloads, now);
  upsertRuntimeBusinessClient(state, businessClient);
  await persistOnboardingBundle(state, auth, bundle);
  await persistSubmittedBusinessClient(businessClient, bundle.application);
  emitOutbox(state, "business_user.onboarding_submitted", {
    applicationId: bundle.application.id,
    businessClientId: businessClient.id,
    authUserId: auth.authUserId,
    email: auth.email
  });

  return {
    status: 200,
    body: {
      status: "pending_review",
      redirectTo: "/submission-confirmed",
      application: bundle.application,
      businessClient
    }
  };
};

export const handleRespondToMyOnboardingRfi = async (
  state: ApiState,
  input: { headers: Record<string, string | undefined>; payload?: unknown }
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(input.headers);
  if (!auth) return unauthorized("business_user_auth_required");
  const persisted = await hydrateBusinessUserOnboarding(state, auth);
  const bundle = persisted ?? ensureBusinessUserOnboarding(state, auth);
  if (bundle.application.status !== "needs_information") return badRequest("rfi_not_open");

  const now = new Date().toISOString();
  const payload = isRecord(input.payload) ? input.payload : {};
  const responseStep: OnboardingStepPayload = {
    id: newId("onboarding_step"),
    tenantId: state.tenantId,
    applicationId: bundle.application.id,
    stepKey: "rfi_response",
    payload,
    savedAt: now
  };
  upsertRuntimeStepPayload(state, responseStep);
  for (const task of state.onboardingRfiTasks.filter((item) => item.applicationId === bundle.application.id && item.status === "open")) {
    task.status = "responded";
    task.resolvedAt = now;
    task.updatedAt = now;
  }
  bundle.application.status = "pending_review";
  bundle.application.currentStep = "pending_review";
  bundle.application.updatedAt = now;
  await persistOnboardingBundle(state, auth, bundle);
  await persistOnboardingStepPayload(responseStep);
  await persistRfiResponse(bundle.application, payload, now);
  const rfiTasks = await hydrateOnboardingRfiTasks(state, bundle.application);
  emitOutbox(state, "business_user.onboarding_rfi_responded", {
    applicationId: bundle.application.id,
    authUserId: auth.authUserId,
    email: auth.email
  });
  return {
    status: 200,
    body: {
      ok: true,
      status: "pending_review",
      application: bundle.application,
      rfiTasks
    }
  };
};

const ensureBusinessUserOnboarding = (
  state: ApiState,
  auth: AuthenticatedBusinessUser
): { profile: BusinessUserProfile; application: BusinessOnboardingApplication } => {
  const now = new Date().toISOString();
  let profile = state.businessUserProfiles.find((item) => item.authUserId === auth.authUserId);
  if (!profile) {
    profile = {
      id: newId("business_user_profile"),
      tenantId: state.tenantId,
      authUserId: auth.authUserId,
      email: auth.email,
      role: "business_user",
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    state.businessUserProfiles.push(profile);
  } else {
    profile.email = auth.email;
    profile.status = "active";
    profile.updatedAt = now;
  }

  let application = state.businessOnboardingApplications.find((item) => item.authUserId === auth.authUserId);
  if (!application) {
    application = {
      id: newId("business_onboarding_application"),
      tenantId: state.tenantId,
      authUserId: auth.authUserId,
      email: auth.email,
      currentStep: "step_1",
      status: "draft",
      createdAt: now,
      updatedAt: now
    };
    state.businessOnboardingApplications.push(application);
  }

  const invitation = state.businessOnboardingInvitations.find((item) => item.email === auth.email);
  if (invitation && invitation.status !== "accepted") {
    invitation.status = "accepted";
    invitation.supabaseUserId = auth.authUserId;
    invitation.acceptedAt = now;
    invitation.updatedAt = now;
  }

  return { profile, application };
};

const hydrateBusinessUserOnboarding = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser
): Promise<{ profile: BusinessUserProfile; application: BusinessOnboardingApplication } | undefined> => {
  const authUserId = uuidFromRuntimeId(auth.authUserId);
  if (postgresUrlFromEnv() && authUserId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const [profileResult, applicationResult] = await Promise.all([
          client.query(
          `select id, tenant_id, auth_user_id, email, role, status, created_at, updated_at
           from business_user_profiles
           where auth_user_id = $1
           limit 1`,
            [authUserId]
          ),
          client.query(
          `select id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at
           from business_onboarding_applications
           where auth_user_id = $1
           limit 1`,
            [authUserId]
          )
        ]);
        if (!profileResult.rows[0] || !applicationResult.rows[0]) return undefined;
        const profile = mapStoredProfile(profileResult.rows[0] as Record<string, unknown>);
        const application = mapStoredApplication(applicationResult.rows[0] as Record<string, unknown>);
        upsertRuntimeProfile(state, profile);
        upsertRuntimeApplication(state, application);
        return { profile, application };
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in hydrateBusinessUserOnboarding; falling back", error);
    }
  }

  const supabase = supabaseAdminClient();
  if (!supabase || !authUserId) return undefined;

  const profileResult = await supabase
    .from("business_user_profiles")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (profileResult.error) throw new Error(`business_user_profiles_select_failed: ${profileResult.error.message}`);

  const applicationResult = await supabase
    .from("business_onboarding_applications")
    .select("*")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (applicationResult.error) throw new Error(`business_onboarding_applications_select_failed: ${applicationResult.error.message}`);
  if (!profileResult.data || !applicationResult.data) return undefined;

  const profile = mapStoredProfile(profileResult.data);
  const application = mapStoredApplication(applicationResult.data);
  upsertRuntimeProfile(state, profile);
  upsertRuntimeApplication(state, application);
  return { profile, application };
};

const hydrateOnboardingStepPayloads = async (
  state: ApiState,
  application: BusinessOnboardingApplication
): Promise<Record<string, Record<string, unknown>>> => {
  const applicationId = uuidFromRuntimeId(application.id);
  if (postgresUrlFromEnv() && applicationId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
        `select id, tenant_id, application_id, step_key, payload, saved_at
         from onboarding_step_payloads
         where application_id = $1`,
          [applicationId]
        );
        const payloads: Record<string, Record<string, unknown>> = {};
        for (const row of result.rows) {
          const stepPayload = mapStoredStepPayload(row as Record<string, unknown>);
          payloads[stepPayload.stepKey] = stepPayload.payload;
          upsertRuntimeStepPayload(state, stepPayload);
        }
        if (!Object.keys(payloads).length) {
          return Object.fromEntries(
            state.onboardingStepPayloads
              .filter((item) => item.applicationId === application.id)
              .map((item) => [item.stepKey, item.payload])
          );
        }
        return payloads;
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in hydrateOnboardingStepPayloads; falling back", error);
      return Object.fromEntries(
        state.onboardingStepPayloads
          .filter((item) => item.applicationId === application.id)
          .map((item) => [item.stepKey, item.payload])
      );
    }
  }

  const supabase = supabaseAdminClient();
  if (!supabase || !applicationId) {
    return Object.fromEntries(
      state.onboardingStepPayloads
        .filter((item) => item.applicationId === application.id)
        .map((item) => [item.stepKey, item.payload])
    );
  }

  const result = await supabase
    .from("onboarding_step_payloads")
    .select("*")
    .eq("application_id", applicationId);
  if (result.error) throw new Error(`onboarding_step_payloads_select_failed: ${result.error.message}`);

  const payloads: Record<string, Record<string, unknown>> = {};
  for (const row of result.data ?? []) {
    const stepPayload = mapStoredStepPayload(row);
    payloads[stepPayload.stepKey] = stepPayload.payload;
    upsertRuntimeStepPayload(state, stepPayload);
  }
  return payloads;
};

const hydrateOnboardingRfiTasks = async (
  state: ApiState,
  application: BusinessOnboardingApplication
): Promise<OnboardingRfiTask[]> => {
  const applicationId = uuidFromRuntimeId(application.id);
  if (postgresUrlFromEnv() && applicationId) {
    try {
      return await withPostgresTransaction(async (client) => {
        const result = await client.query(
          `select id, platform_tenant_id, onboarding_application_id, business_client_id, status, requested_fields, note, requester_email, assignee_email, due_at, resolved_at, created_at, updated_at
           from onboarding_rfi_tasks
           where onboarding_application_id = $1
           order by created_at desc`,
          [applicationId]
        ).catch((error: unknown) => {
          if (isMissingTableError(error, "onboarding_rfi_tasks")) return { rows: [] };
          throw error;
        });
        return result.rows.map((row) => ({
          id: `onboarding_rfi_task_${String(row.id)}`,
          tenantId: String(row.platform_tenant_id),
          applicationId: `business_onboarding_application_${String(row.onboarding_application_id)}`,
          businessClientId: row.business_client_id ? String(row.business_client_id) : undefined,
          status: isRfiTaskStatus(row.status) ? row.status : "open",
          requestedFields: Array.isArray(row.requested_fields) ? row.requested_fields.map(String) : [],
          note: row.note ? String(row.note) : undefined,
          requesterEmail: row.requester_email ? String(row.requester_email) : undefined,
          assigneeEmail: row.assignee_email ? String(row.assignee_email) : undefined,
          dueAt: row.due_at ? String(row.due_at) : undefined,
          resolvedAt: row.resolved_at ? String(row.resolved_at) : undefined,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at)
        }));
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in hydrateOnboardingRfiTasks; falling back", error);
    }
  }
  return state.onboardingRfiTasks
    .filter((task) => task.applicationId === application.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
};

const isMissingTableError = (error: unknown, tableName: string): boolean => {
  if (!error || typeof error !== "object") return false;
  const record = error as { code?: unknown; message?: unknown };
  const message = typeof record.message === "string" ? record.message : "";
  return record.code === "42P01" || (message.includes(tableName) && message.includes("does not exist"));
};

const mapStoredStepPayload = (row: Record<string, unknown>): OnboardingStepPayload => ({
  id: `onboarding_step_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  applicationId: `business_onboarding_application_${String(row.application_id)}`,
  stepKey: String(row.step_key),
  payload: isRecord(row.payload) ? row.payload : {},
  savedAt: timestampToIsoString(row.saved_at)
});

const mapStoredProfile = (row: Record<string, unknown>): BusinessUserProfile => ({
  id: `business_user_profile_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  authUserId: String(row.auth_user_id),
  email: String(row.email),
  role: "business_user",
  status: isBusinessUserProfileStatus(row.status) ? row.status : "active",
  createdAt: timestampToIsoString(row.created_at),
  updatedAt: timestampToIsoString(row.updated_at)
});

const mapStoredApplication = (row: Record<string, unknown>): BusinessOnboardingApplication => ({
  id: `business_onboarding_application_${String(row.id)}`,
  tenantId: String(row.tenant_id),
  authUserId: String(row.auth_user_id),
  email: String(row.email),
  currentStep: isOnboardingStep(String(row.current_step)) ? String(row.current_step) as BusinessOnboardingApplication["currentStep"] : "step_1",
  status: isOnboardingStatus(row.status) ? row.status : "draft",
  submittedAt: timestampToOptionalIsoString(row.submitted_at),
  createdAt: timestampToIsoString(row.created_at),
  updatedAt: timestampToIsoString(row.updated_at)
});

const upsertRuntimeProfile = (state: ApiState, profile: BusinessUserProfile): void => {
  const index = state.businessUserProfiles.findIndex((item) => item.authUserId === profile.authUserId);
  if (index >= 0) {
    state.businessUserProfiles[index] = profile;
    return;
  }
  state.businessUserProfiles.push(profile);
};

const upsertRuntimeApplication = (state: ApiState, application: BusinessOnboardingApplication): void => {
  const index = state.businessOnboardingApplications.findIndex((item) => item.authUserId === application.authUserId);
  if (index >= 0) {
    state.businessOnboardingApplications[index] = application;
    return;
  }
  state.businessOnboardingApplications.push(application);
};

const upsertRuntimeStepPayload = (state: ApiState, stepPayload: OnboardingStepPayload): void => {
  const index = state.onboardingStepPayloads.findIndex(
    (item) => item.applicationId === stepPayload.applicationId && item.stepKey === stepPayload.stepKey
  );
  if (index >= 0) {
    state.onboardingStepPayloads[index] = stepPayload;
    return;
  }
  state.onboardingStepPayloads.push(stepPayload);
};

const upsertRuntimeBusinessClient = (state: ApiState, businessClient: BusinessClient): void => {
  const index = state.businessClients.findIndex((item) => item.id === businessClient.id);
  if (index >= 0) {
    state.businessClients[index] = {
      ...state.businessClients[index],
      ...businessClient
    };
    return;
  }
  state.businessClients.push(businessClient);
};

const businessClientFromOnboarding = (
  state: ApiState,
  application: BusinessOnboardingApplication,
  stepPayloads: Record<string, Record<string, unknown>>,
  now: string
): BusinessClient => {
  const step2 = stepPayloads.step_2 ?? {};
  const legalName =
    stringPayload(step2, "legalBusinessName") ??
    stringPayload(step2, "legalName") ??
    application.email.split("@")[0] ??
    "Submitted Business Client";
  return {
    id: uuidFromRuntimeId(application.id) ?? newId("client"),
    tenantId: persistentTenantId(state),
    legalName,
    country: countryCodeFromPayload(step2),
    onboardingStatus: "submitted",
    createdAt: application.createdAt || now
  };
};

const createOrReuseInvitation = (state: ApiState, email: string): BusinessOnboardingInvitation => {
  const existing = state.businessOnboardingInvitations.find(
    (item) => item.email === email && ["requested", "sent", "accepted"].includes(item.status)
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const invitation: BusinessOnboardingInvitation = {
    id: newId("business_invitation"),
    tenantId: state.tenantId,
    email,
    status: "requested",
    idempotencyKey: newId("idem"),
    createdAt: now,
    updatedAt: now
  };
  state.businessOnboardingInvitations.push(invitation);
  return invitation;
};

const markInvitationSent = (invitation: BusinessOnboardingInvitation, supabaseUserId?: string) => {
  const now = new Date().toISOString();
  invitation.status = "sent";
  invitation.supabaseUserId = supabaseUserId ?? invitation.supabaseUserId;
  invitation.invitedAt = invitation.invitedAt ?? now;
  invitation.updatedAt = now;
};

export const authenticateBusinessUser = async (headers: Record<string, string | undefined>): Promise<AuthenticatedBusinessUser | undefined> => {
  const token = bearerTokenFromHeaders(headers);
  if (token) {
    const firstPartyAuth = await authenticateFirstPartyBusinessUser(token);
    if (firstPartyAuth) return firstPartyAuth;
  }
  return authenticateDevBusinessUser(headers);
};

const authenticateDevBusinessUser = (
  headers: Record<string, string | undefined>
): AuthenticatedBusinessUser | undefined => {
  if (process.env.ALLOW_DEV_WITHOUT_SUPABASE !== "true") return undefined;
  const authUserId = headers["x-dev-auth-user-id"]?.trim();
  const email = headers["x-dev-auth-email"]?.trim();
  if (!authUserId || !email) return undefined;
  return {
    authUserId,
    email: normalizeEmail(email)
  };
};

const bearerTokenFromHeaders = (headers: Record<string, string | undefined>): string | undefined => {
  const header = headers.authorization;
  if (!header?.startsWith("Bearer ")) return undefined;
  const token = header.slice("Bearer ".length).trim();
  return token ? token : undefined;
};

const mapSupabaseSessionToBusinessSession = async (
  session: {
    access_token?: string;
    token_type?: string;
    expires_in?: number;
    expires_at?: number;
    refresh_token?: string;
    user?: {
      id?: string;
      email?: string | null;
    };
  }
): Promise<BusinessJwtSession | undefined> => {
  if (!session.access_token || !session.user?.id || !session.user.email) return undefined;
  const tokenBundle = createBusinessSessionToken({
    authUserId: session.user.id,
    email: normalizeEmail(session.user.email),
    sessionId: randomUUID(),
    tokenUse: "access"
  });
  const refreshTokenBundle = createBusinessSessionToken({
    authUserId: session.user.id,
    email: normalizeEmail(session.user.email),
    sessionId: tokenBundle?.sessionId ?? randomUUID(),
    tokenUse: "refresh",
    expiresIn: businessJwtRefreshExpiresInSeconds()
  });
  if (!tokenBundle || !refreshTokenBundle) return undefined;

  const storedSession: BusinessSessionRecord = {
    sessionId: tokenBundle.sessionId,
    authUserId: session.user.id,
    email: normalizeEmail(session.user.email),
    accessJti: tokenBundle.jti,
    refreshJti: refreshTokenBundle.jti,
    expiresAt: tokenBundle.expiresAt,
    refreshExpiresAt: refreshTokenBundle.expiresAt,
    supabaseAccessToken: session.access_token,
    supabaseRefreshToken: session.refresh_token
  };

  await upsertBusinessAuthSession(storedSession);

  return {
    access_token: tokenBundle.token,
    token_type: "bearer",
    expires_in: tokenBundle.expiresIn,
    expires_at: Math.floor(tokenBundle.expiresAt / 1000),
    refresh_token: refreshTokenBundle.token,
    user: {
      id: session.user.id,
      email: session.user.email
    }
  };
};

export const handleBusinessAuthSignIn = async (
  input: { email?: unknown; password?: unknown }
): Promise<JsonResponse> => {
  const email = normalizeEmail(String(input.email ?? ""));
  const password = String(input.password ?? "");
  if (!isValidEmail(email)) return badRequest("valid_email_required");
  if (!password.trim()) return badRequest("password_required");

  const supabase = supabaseAuthClient();
  if (!supabase) {
    return {
      status: 503,
      body: { error: "supabase_admin_not_configured" }
    };
  }

  const { data, error } = await supabase.signInWithPassword({ email, password });
  if (error || !data.session) {
    return {
      status: 401,
      body: { error: "invalid_credentials" }
    };
  }

  const session = await mapSupabaseSessionToBusinessSession(data.session);
  if (!session) {
    return {
      status: 503,
      body: { error: "business_auth_not_configured" }
    };
  }

  return {
    status: 200,
    body: { session }
  };
};

export const handleBusinessAuthSetPassword = async (
  input: { headers: Record<string, string | undefined>; token?: unknown; password?: unknown }
): Promise<JsonResponse> => {
  const password = String(input.password ?? "");
  if (!password.trim()) return badRequest("password_required");

  const tokenFromBody = typeof input.token === "string" ? input.token.trim() : "";
  const token = tokenFromBody || bearerTokenFromHeaders(input.headers) || "";
  if (!token) return unauthorized("business_user_auth_required");

  const supabase = supabaseAuthClient();
  if (!supabase) {
    return {
      status: 503,
      body: { error: "supabase_admin_not_configured" }
    };
  }

  const userResult = await supabase.getUser(token);
  if (userResult.error || !userResult.data.user?.id || !userResult.data.user?.email) {
    return unauthorized("business_user_auth_required");
  }

  const update = await supabase.updateUserById(userResult.data.user.id, {
    password,
    email_confirm: true
  });
  if (update.error) {
    return {
      status: 502,
      body: { error: "set_password_failed", detail: update.error.message }
    };
  }

  const signIn = await supabase.signInWithPassword({
    email: userResult.data.user.email,
    password
  });
  if (signIn.error || !signIn.data.session) {
    return {
      status: 502,
      body: { error: "auth_session_unavailable" }
    };
  }

  const session = await mapSupabaseSessionToBusinessSession(signIn.data.session);
  if (!session) {
    return {
      status: 503,
      body: { error: "business_auth_not_configured" }
    };
  }

  return {
    status: 200,
    body: { session }
  };
};

export const handleBusinessAuthResetPassword = async (
  input: { email?: unknown }
): Promise<JsonResponse> => {
  const email = normalizeEmail(String(input.email ?? ""));
  if (!isValidEmail(email)) return badRequest("valid_email_required");

  const supabase = supabaseAuthClient();
  if (!supabase) {
    return {
      status: 503,
      body: { error: "supabase_admin_not_configured" }
    };
  }

  const { error } = await supabase.resetPasswordForEmail(email, {
    redirectTo: inviteRedirectUrl()
  });

  if (error) {
    return {
      status: 502,
      body: { error: "password_reset_failed", detail: error.message }
    };
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: "password_reset_sent",
      message: "Password recovery email sent."
    }
  };
};

export const handleBusinessAuthMe = async (
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const auth = await authenticateBusinessUser(headers);
  if (!auth) return unauthorized("business_user_auth_required");
  return {
    status: 200,
    body: {
      user: {
        authUserId: auth.authUserId,
        email: auth.email
      }
    }
  };
};

export const handleBusinessAuthSignOut = async (
  headers: Record<string, string | undefined>
): Promise<JsonResponse> => {
  const token = bearerTokenFromHeaders(headers);
  if (!token) return unauthorized("business_user_auth_required");

  const verified = verifyBusinessSessionToken(token);
  if (!verified) return unauthorized("business_user_auth_required");

  if (verified.token_use !== "access") return unauthorized("business_user_auth_required");

  const session = await getBusinessAuthSessionByAccessJti(verified.jti);
  if (!session) return unauthorized("business_user_auth_required");

  if (session.expiresAt <= Date.now()) {
    await revokeBusinessAuthSession(session.sessionId);
    return unauthorized("business_user_auth_required");
  }

  const supabase = supabaseAuthClient();
  if (!supabase) {
    return {
      status: 503,
      body: { error: "supabase_admin_not_configured" }
    };
  }

  const { error } = await supabase.signOutSession(session.supabaseAccessToken);
  if (error) {
    const statusCode = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    if (statusCode === 401 || statusCode === 403) {
      return unauthorized("business_user_auth_required");
    }
    return {
      status: 502,
      body: { error: "sign_out_failed", detail: error.message }
    };
  }

  await revokeBusinessAuthSession(session.sessionId);

  return {
    status: 200,
    body: { ok: true }
  };
};

export const handleBusinessAuthRefresh = async (
  input: { refreshToken?: unknown }
): Promise<JsonResponse> => {
  const refreshToken = typeof input.refreshToken === "string" ? input.refreshToken.trim() : "";
  if (!refreshToken) return unauthorized("business_user_auth_required");

  const verified = verifyBusinessSessionToken(refreshToken);
  if (!verified || verified.token_use !== "refresh") return unauthorized("business_user_auth_required");

  const existing = await getBusinessAuthSessionByRefreshJti(verified.jti);
  if (!existing) return unauthorized("business_user_auth_required");
  if (existing.refreshExpiresAt <= Date.now()) {
    await revokeBusinessAuthSession(existing.sessionId);
    return unauthorized("business_user_auth_required");
  }

  const supabase = supabaseAuthClient();
  if (!supabase) {
    return {
      status: 503,
      body: { error: "supabase_admin_not_configured" }
    };
  }

  if (!existing.supabaseRefreshToken) {
    return unauthorized("business_user_auth_required");
  }

  const refreshed = await supabase.refreshSession(existing.supabaseRefreshToken);
  if (refreshed.error || !refreshed.data.session?.access_token) {
    await revokeBusinessAuthSession(existing.sessionId);
    return unauthorized("business_user_auth_required");
  }

  const nextAccessToken = createBusinessSessionToken({
    authUserId: existing.authUserId,
    email: existing.email,
    sessionId: existing.sessionId,
    tokenUse: "access"
  });
  const nextRefreshToken = createBusinessSessionToken({
    authUserId: existing.authUserId,
    email: existing.email,
    sessionId: existing.sessionId,
    tokenUse: "refresh",
    expiresIn: businessJwtRefreshExpiresInSeconds()
  });
  if (!nextAccessToken || !nextRefreshToken) {
    return {
      status: 503,
      body: { error: "business_auth_not_configured" }
    };
  }

  const updatedSession: BusinessSessionRecord = {
    ...existing,
    accessJti: nextAccessToken.jti,
    expiresAt: nextAccessToken.expiresAt,
    refreshJti: nextRefreshToken.jti,
    refreshExpiresAt: nextRefreshToken.expiresAt,
    supabaseAccessToken: refreshed.data.session.access_token,
    supabaseRefreshToken: refreshed.data.session.refresh_token ?? existing.supabaseRefreshToken
  };
  await upsertBusinessAuthSession(updatedSession);

  return {
    status: 200,
    body: {
      session: {
        access_token: nextAccessToken.token,
        token_type: "bearer",
        expires_in: nextAccessToken.expiresIn,
        expires_at: Math.floor(nextAccessToken.expiresAt / 1000),
        refresh_token: nextRefreshToken.token,
        user: {
          id: existing.authUserId,
          email: existing.email
        }
      }
    }
  };
};

const authenticateFirstPartyBusinessUser = async (token: string): Promise<AuthenticatedBusinessUser | undefined> => {
  const verified = verifyBusinessSessionToken(token);
  if (!verified) return undefined;
  if (verified.token_use !== "access") return undefined;

  const session = await getBusinessAuthSessionByAccessJti(verified.jti);
  if (!session) return undefined;
  if (session.expiresAt <= Date.now()) {
    await revokeBusinessAuthSession(session.sessionId);
    return undefined;
  }
  if (session.sessionId !== verified.sid || session.authUserId !== verified.sub) {
    return undefined;
  }

  return {
    authUserId: session.authUserId,
    email: session.email
  };
};

const createBusinessSessionToken = (
  input: { authUserId: string; email: string; expiresIn?: number; sessionId: string; tokenUse: "access" | "refresh" }
): { expiresAt: number; expiresIn: number; jti: string; sessionId: string; token: string } | undefined => {
  const secret = businessJwtSecret();
  if (!secret) return undefined;

  const now = Math.floor(Date.now() / 1000);
  const expiresIn = input.expiresIn ?? businessJwtExpiresInSeconds();
  const jti = randomUUID();
  const payload: BusinessAuthTokenClaims = {
    iss: "gtt-api",
    aud: "business-user",
    sub: input.authUserId,
    sid: input.sessionId,
    token_use: input.tokenUse,
    email: input.email,
    jti,
    iat: now,
    exp: now + expiresIn
  };
  const token = signBusinessSessionPayload(payload, secret);
  return {
    expiresAt: (now + expiresIn) * 1000,
    expiresIn,
    jti,
    sessionId: input.sessionId,
    token
  };
};

const verifyBusinessSessionToken = (token: string): BusinessAuthTokenClaims | undefined => {
  const secret = businessJwtSecret();
  if (!secret) return undefined;

  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return undefined;

  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = base64UrlEncode(createHmac("sha256", secret).update(signingInput).digest());
  const expectedBuf = Buffer.from(expectedSignature);
  const receivedBuf = Buffer.from(signaturePart);
  if (expectedBuf.length !== receivedBuf.length || !timingSafeEqual(expectedBuf, receivedBuf)) return undefined;

  const payloadJson = base64UrlDecodeToString(payloadPart);
  if (!payloadJson) return undefined;

  let payloadUnknown: unknown;
  try {
    payloadUnknown = JSON.parse(payloadJson);
  } catch {
    return undefined;
  }
  if (!isRecord(payloadUnknown)) return undefined;

  const iss = payloadUnknown.iss;
  const aud = payloadUnknown.aud;
  const sub = payloadUnknown.sub;
  const sid = payloadUnknown.sid;
  const tokenUse = payloadUnknown.token_use;
  const email = payloadUnknown.email;
  const jti = payloadUnknown.jti;
  const iat = payloadUnknown.iat;
  const exp = payloadUnknown.exp;
  if (iss !== "gtt-api" || aud !== "business-user") return undefined;
  if (typeof sub !== "string" || !sub) return undefined;
  if (typeof sid !== "string" || !sid) return undefined;
  if (tokenUse !== "access" && tokenUse !== "refresh") return undefined;
  if (typeof email !== "string" || !email) return undefined;
  if (typeof jti !== "string" || !jti) return undefined;
  if (typeof iat !== "number" || typeof exp !== "number") return undefined;
  if (exp <= Math.floor(Date.now() / 1000)) return undefined;

  return {
    iss,
    aud,
    sub,
    sid,
    token_use: tokenUse,
    email,
    jti,
    iat,
    exp
  };
};

const signBusinessSessionPayload = (payload: BusinessAuthTokenClaims, secret: string): string => {
  const header = { alg: "HS256", typ: "JWT" };
  const headerPart = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const payloadPart = base64UrlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signaturePart = base64UrlEncode(createHmac("sha256", secret).update(signingInput).digest());
  return `${signingInput}.${signaturePart}`;
};

const businessJwtSecret = (): string | undefined => {
  const secret = process.env.BUSINESS_AUTH_JWT_SECRET?.trim();
  return secret || undefined;
};

const businessJwtExpiresInSeconds = (): number => {
  const fromEnv = Number.parseInt(process.env.BUSINESS_AUTH_JWT_EXPIRES_IN_SECONDS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 3600;
};

const businessJwtRefreshExpiresInSeconds = (): number => {
  const fromEnv = Number.parseInt(process.env.BUSINESS_AUTH_JWT_REFRESH_EXPIRES_IN_SECONDS ?? "", 10);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  return 60 * 60 * 24 * 30;
};

const base64UrlEncode = (value: Buffer): string =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const base64UrlDecodeToString = (value: string): string | undefined => {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (normalized.length % 4)) % 4;
    const padded = `${normalized}${"=".repeat(padLen)}`;
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
};

const supabaseAuthClient = (): SupabaseBusinessAuthClient | undefined => {
  if (supabaseBusinessAuthClientForTest) return supabaseBusinessAuthClientForTest;

  const rawClient = supabaseAdminClient();
  if (!rawClient) return undefined;

  return {
    inviteUserByEmail: (email, options) => rawClient.auth.admin.inviteUserByEmail(email, options),
    signInWithPassword: (input) => rawClient.auth.signInWithPassword(input),
    getUser: (accessToken) => rawClient.auth.getUser(accessToken),
    updateUserById: (userId, input) => rawClient.auth.admin.updateUserById(userId, input),
    resetPasswordForEmail: (email, options) => rawClient.auth.resetPasswordForEmail(email, options),
    signOutSession: (accessToken) => rawClient.auth.admin.signOut(accessToken, "local"),
    refreshSession: (refreshToken) => rawClient.auth.refreshSession({ refresh_token: refreshToken })
  };
};

const supabaseAdminClient = (): SupabaseClient | undefined => {

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return undefined;
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

const upsertBusinessAuthSession = async (session: BusinessSessionRecord): Promise<void> => {
  upsertRuntimeBusinessAuthSession(session);

  if (!postgresUrlFromEnv()) return;
  try {
    await withPostgresTransaction(async (client) => {
      await client.query(
        `insert into business_auth_sessions
          (session_id, auth_user_id, email, access_jti, access_expires_at, refresh_jti, refresh_expires_at, supabase_access_token, supabase_refresh_token, revoked_at, created_at, updated_at)
         values ($1, $2, $3, $4, to_timestamp($5 / 1000.0), $6, to_timestamp($7 / 1000.0), $8, $9, null, now(), now())
         on conflict (session_id) do update set
           auth_user_id = excluded.auth_user_id,
           email = excluded.email,
           access_jti = excluded.access_jti,
           access_expires_at = excluded.access_expires_at,
           refresh_jti = excluded.refresh_jti,
           refresh_expires_at = excluded.refresh_expires_at,
           supabase_access_token = excluded.supabase_access_token,
           supabase_refresh_token = excluded.supabase_refresh_token,
           revoked_at = excluded.revoked_at,
           updated_at = now()`,
        [
          session.sessionId,
          session.authUserId,
          session.email,
          session.accessJti,
          session.expiresAt,
          session.refreshJti,
          session.refreshExpiresAt,
          session.supabaseAccessToken,
          session.supabaseRefreshToken ?? null
        ]
      );
    });
  } catch (error) {
    if (isPostgresConnectivityError(error) || isMissingTableError(error, "business_auth_sessions")) return;
    throw error;
  }
};

const revokeBusinessAuthSession = async (sessionId: string): Promise<void> => {
  deleteRuntimeBusinessAuthSession(sessionId);
  if (!postgresUrlFromEnv()) return;
  try {
    await withPostgresTransaction(async (client) => {
      await client.query(
        `update business_auth_sessions
            set revoked_at = now(),
                updated_at = now()
          where session_id = $1`,
        [sessionId]
      );
    });
  } catch (error) {
    if (isPostgresConnectivityError(error) || isMissingTableError(error, "business_auth_sessions")) return;
    throw error;
  }
};

const getBusinessAuthSessionByAccessJti = async (accessJti: string): Promise<BusinessSessionRecord | undefined> => {
  const runtimeSession = getRuntimeBusinessAuthSessionByAccessJti(accessJti);
  if (runtimeSession) return runtimeSession;

  if (!postgresUrlFromEnv()) return undefined;
  try {
    const stored = await withPostgresTransaction(async (client) => {
      const result = await client.query(
        `select session_id, auth_user_id, email, access_jti, refresh_jti, access_expires_at, refresh_expires_at, supabase_access_token, supabase_refresh_token, revoked_at
           from business_auth_sessions
          where access_jti = $1
          limit 1`,
        [accessJti]
      );
      return result.rows[0] as Record<string, unknown> | undefined;
    });
    if (!stored || stored.revoked_at) return undefined;
    const session = mapStoredBusinessAuthSession(stored);
    if (!session) return undefined;
    upsertRuntimeBusinessAuthSession(session);
    return session;
  } catch (error) {
    if (isPostgresConnectivityError(error) || isMissingTableError(error, "business_auth_sessions")) return undefined;
    throw error;
  }
};

const getBusinessAuthSessionByRefreshJti = async (refreshJti: string): Promise<BusinessSessionRecord | undefined> => {
  const runtimeSession = getRuntimeBusinessAuthSessionByRefreshJti(refreshJti);
  if (runtimeSession) return runtimeSession;

  if (!postgresUrlFromEnv()) return undefined;
  try {
    const stored = await withPostgresTransaction(async (client) => {
      const result = await client.query(
        `select session_id, auth_user_id, email, access_jti, refresh_jti, access_expires_at, refresh_expires_at, supabase_access_token, supabase_refresh_token, revoked_at
           from business_auth_sessions
          where refresh_jti = $1
          limit 1`,
        [refreshJti]
      );
      return result.rows[0] as Record<string, unknown> | undefined;
    });
    if (!stored || stored.revoked_at) return undefined;
    const session = mapStoredBusinessAuthSession(stored);
    if (!session) return undefined;
    upsertRuntimeBusinessAuthSession(session);
    return session;
  } catch (error) {
    if (isPostgresConnectivityError(error) || isMissingTableError(error, "business_auth_sessions")) return undefined;
    throw error;
  }
};

const mapStoredBusinessAuthSession = (row: Record<string, unknown>): BusinessSessionRecord | undefined => {
  const sessionId = typeof row.session_id === "string" ? row.session_id : undefined;
  const authUserId = typeof row.auth_user_id === "string" ? row.auth_user_id : undefined;
  const email = typeof row.email === "string" ? row.email : undefined;
  const accessJti = typeof row.access_jti === "string" ? row.access_jti : undefined;
  const refreshJti = typeof row.refresh_jti === "string" ? row.refresh_jti : undefined;
  const supabaseAccessToken = typeof row.supabase_access_token === "string" ? row.supabase_access_token : undefined;
  if (!sessionId || !authUserId || !email || !accessJti || !refreshJti || !supabaseAccessToken) return undefined;

  const accessExpiresAt = parseTimestampToMillis(row.access_expires_at);
  const refreshExpiresAt = parseTimestampToMillis(row.refresh_expires_at);
  if (!accessExpiresAt || !refreshExpiresAt) return undefined;

  return {
    sessionId,
    authUserId,
    email,
    accessJti,
    refreshJti,
    expiresAt: accessExpiresAt,
    refreshExpiresAt,
    supabaseAccessToken,
    supabaseRefreshToken: typeof row.supabase_refresh_token === "string" ? row.supabase_refresh_token : undefined
  };
};

const parseTimestampToMillis = (value: unknown): number | undefined => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const upsertRuntimeBusinessAuthSession = (session: BusinessSessionRecord): void => {
  const previous = businessAuthSessions.get(session.sessionId);
  if (previous) {
    businessAuthSessionIdByAccessJti.delete(previous.accessJti);
    businessAuthSessionIdByRefreshJti.delete(previous.refreshJti);
  }
  businessAuthSessions.set(session.sessionId, session);
  businessAuthSessionIdByAccessJti.set(session.accessJti, session.sessionId);
  businessAuthSessionIdByRefreshJti.set(session.refreshJti, session.sessionId);
};

const getRuntimeBusinessAuthSessionByAccessJti = (accessJti: string): BusinessSessionRecord | undefined => {
  const sessionId = businessAuthSessionIdByAccessJti.get(accessJti);
  return sessionId ? businessAuthSessions.get(sessionId) : undefined;
};

const getRuntimeBusinessAuthSessionByRefreshJti = (refreshJti: string): BusinessSessionRecord | undefined => {
  const sessionId = businessAuthSessionIdByRefreshJti.get(refreshJti);
  return sessionId ? businessAuthSessions.get(sessionId) : undefined;
};

const deleteRuntimeBusinessAuthSession = (sessionId: string): void => {
  const existing = businessAuthSessions.get(sessionId);
  if (!existing) return;
  businessAuthSessions.delete(sessionId);
  businessAuthSessionIdByAccessJti.delete(existing.accessJti);
  businessAuthSessionIdByRefreshJti.delete(existing.refreshJti);
};

const inviteRedirectUrl = (): string => process.env.AUTH_INVITE_REDIRECT_URL ?? "http://localhost:5173/auth/set-password";

const checkRateLimit = (key: string): boolean => {
  const now = Date.now();
  const current = invitationAttempts.get(key);
  if (!current || current.resetAt <= now) {
    invitationAttempts.set(key, { count: 1, resetAt: now + rateLimitWindowMs });
    return true;
  }
  current.count += 1;
  return current.count <= maxAttemptsPerWindow;
};

const isExistingSupabaseUserError = (message: string): boolean => {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("already registered") ||
    normalized.includes("already been registered") ||
    normalized.includes("user already") ||
    normalized.includes("already exists")
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const stringPayload = (payload: Record<string, unknown>, key: string): string | undefined => {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};

const isOnboardingStep = (value: string): value is BusinessOnboardingApplication["currentStep"] =>
  ["step_1", "step_2", "step_3", "step_4", "pending_review", "reviewd"].includes(value);

const isOnboardingStatus = (value: unknown): value is BusinessOnboardingApplication["status"] =>
  typeof value === "string" && ["draft", "submitted", "pending_review", "needs_information", "approved", "rejected"].includes(value);

const isBusinessUserProfileStatus = (value: unknown): value is BusinessUserProfile["status"] =>
  typeof value === "string" && ["invited", "active", "disabled"].includes(value);

const isRfiTaskStatus = (value: unknown): value is OnboardingRfiTask["status"] =>
  typeof value === "string" && ["open", "responded", "closed", "cancelled"].includes(value);

const timestampToIsoString = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
};

const timestampToOptionalIsoString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  return timestampToIsoString(value);
};

const buildAdaAccountCode = (accountName: string, usePurpose: string, assetCode: string): string => {
  const normalizedPurpose = usePurpose.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) || "GEN";
  const normalizedAsset = assetCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 4) || "USDC";
  const normalizedName = accountName.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const nameSegment = normalizedName.slice(0, 4).padEnd(4, "X");
  return `DAA-${normalizedAsset}-${normalizedPurpose}-${nameSegment}`;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuidFromRuntimeId = (value?: string): string | undefined => {
  if (!value) return undefined;
  const candidate = value.includes("_") ? value.split("_").at(-1) : value;
  return candidate && uuidPattern.test(candidate) ? candidate : undefined;
};

const persistInvitation = async (invitation?: BusinessOnboardingInvitation): Promise<void> => {
  if (!invitation) return;
  const id = uuidFromRuntimeId(invitation.id);
  if (!id) return;
  if (postgresUrlFromEnv()) {
    try {
      await withPostgresTransaction(async (client) => {
        const existing = await client.query<{ id: string }>(
          `select id
           from business_onboarding_invitations
           where tenant_id = $1
             and lower(email) = lower($2)
             and status = any($3::text[])
           limit 1`,
          [invitation.tenantId, invitation.email, ["requested", "sent", "accepted"]]
        );
        await client.query(
          `insert into business_onboarding_invitations
            (id, tenant_id, email, status, supabase_user_id, idempotency_key, invited_at, accepted_at, expires_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           on conflict (id) do update set
             status = excluded.status,
             supabase_user_id = excluded.supabase_user_id,
             invited_at = excluded.invited_at,
             accepted_at = excluded.accepted_at,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
          [
            existing.rows[0]?.id ?? id,
            invitation.tenantId,
            invitation.email,
            invitation.status,
            uuidFromRuntimeId(invitation.supabaseUserId) ?? null,
            invitation.idempotencyKey,
            invitation.invitedAt ?? null,
            invitation.acceptedAt ?? null,
            invitation.expiresAt ?? null,
            invitation.createdAt,
            invitation.updatedAt
          ]
        );
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in persistInvitation; skipping", error);
    }
    return;
  }
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const existing = await supabase
    .from("business_onboarding_invitations")
    .select("id")
    .eq("tenant_id", invitation.tenantId)
    .ilike("email", invitation.email)
    .in("status", ["requested", "sent", "accepted"])
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(`business_onboarding_invitations_select_failed: ${existing.error.message}`);

  const { error } = await supabase
    .from("business_onboarding_invitations")
    .upsert(
      {
        id: existing.data?.id ?? id,
        tenant_id: invitation.tenantId,
        email: invitation.email,
        status: invitation.status,
        supabase_user_id: uuidFromRuntimeId(invitation.supabaseUserId) ?? null,
        idempotency_key: invitation.idempotencyKey,
        invited_at: invitation.invitedAt ?? null,
        accepted_at: invitation.acceptedAt ?? null,
        expires_at: invitation.expiresAt ?? null,
        created_at: invitation.createdAt,
        updated_at: invitation.updatedAt
      },
      { onConflict: "id" }
    );
  if (error) throw new Error(`business_onboarding_invitations_upsert_failed: ${error.message}`);
};

const persistOnboardingBundle = async (
  state: ApiState,
  auth: AuthenticatedBusinessUser,
  bundle: { profile: BusinessUserProfile; application: BusinessOnboardingApplication }
): Promise<void> => {
  const invitation = state.businessOnboardingInvitations.find((item) => item.email === auth.email);
  await persistInvitation(invitation);
  await persistBusinessUserProfile(bundle.profile);
  await persistOnboardingApplication(bundle.application);
};

const persistBusinessUserProfile = async (profile: BusinessUserProfile): Promise<void> => {
  const id = uuidFromRuntimeId(profile.id);
  const authUserId = uuidFromRuntimeId(profile.authUserId);
  if (!id || !authUserId) return;
  if (postgresUrlFromEnv()) {
    try {
      await withPostgresTransaction(async (client) => {
        await client.query(
          `insert into business_user_profiles
            (id, tenant_id, auth_user_id, email, role, status, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
           on conflict (auth_user_id) do update set
             email = excluded.email,
             role = excluded.role,
             status = excluded.status,
             updated_at = excluded.updated_at`,
          [id, profile.tenantId, authUserId, profile.email, profile.role, profile.status, profile.createdAt, profile.updatedAt]
        );
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in persistBusinessUserProfile; skipping", error);
    }
    return;
  }
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("business_user_profiles")
    .upsert(
      {
        id,
        tenant_id: profile.tenantId,
        auth_user_id: authUserId,
        email: profile.email,
        role: profile.role,
        status: profile.status,
        created_at: profile.createdAt,
        updated_at: profile.updatedAt
      },
      { onConflict: "auth_user_id" }
    );
  if (error) throw new Error(`business_user_profiles_upsert_failed: ${error.message}`);
};

const persistOnboardingApplication = async (application: BusinessOnboardingApplication): Promise<void> => {
  const id = uuidFromRuntimeId(application.id);
  const authUserId = uuidFromRuntimeId(application.authUserId);
  if (!id || !authUserId) return;
  if (postgresUrlFromEnv()) {
    try {
      await withPostgresTransaction(async (client) => {
        await client.query(
          `insert into business_onboarding_applications
            (id, tenant_id, auth_user_id, email, current_step, status, submitted_at, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           on conflict (auth_user_id) do update set
             email = excluded.email,
             current_step = excluded.current_step,
             status = excluded.status,
             submitted_at = excluded.submitted_at,
             updated_at = excluded.updated_at`,
          [
            id,
            application.tenantId,
            authUserId,
            application.email,
            application.currentStep,
            application.status,
            application.submittedAt ?? null,
            application.createdAt,
            application.updatedAt
          ]
        );
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in persistOnboardingApplication; skipping", error);
    }
    return;
  }
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("business_onboarding_applications")
    .upsert(
      {
        id,
        tenant_id: application.tenantId,
        auth_user_id: authUserId,
        email: application.email,
        current_step: application.currentStep,
        status: application.status,
        submitted_at: application.submittedAt ?? null,
        created_at: application.createdAt,
        updated_at: application.updatedAt
      },
      { onConflict: "auth_user_id" }
    );
  if (error) throw new Error(`business_onboarding_applications_upsert_failed: ${error.message}`);
};

const persistSubmittedBusinessClient = async (
  businessClient: BusinessClient,
  application: BusinessOnboardingApplication
): Promise<void> => {
  if (!postgresUrlFromEnv()) return;
  const id = uuidFromRuntimeId(businessClient.id);
  const tenantId = uuidFromRuntimeId(businessClient.tenantId);
  if (!id || !tenantId) return;

  try {
    await withPostgresTransaction(async (client) => {
      await client.query(
        `insert into platform_tenants (id, tenant_name)
         values ($1, 'Demo Tenant')
         on conflict (id) do nothing`,
        [tenantId]
      );
      await client.query(
        `insert into business_clients
          (id, platform_tenant_id, legal_name, country, onboarding_status, correlation_id, created_at, updated_at)
         values ($1, $2, $3, $4, 'submitted', $5, $6, $7)
         on conflict (id) do update set
           platform_tenant_id = excluded.platform_tenant_id,
           legal_name = excluded.legal_name,
           country = excluded.country,
           onboarding_status = excluded.onboarding_status,
           correlation_id = excluded.correlation_id,
           updated_at = excluded.updated_at`,
        [
          id,
          tenantId,
          businessClient.legalName,
          businessClient.country,
          `business_onboarding:${uuidFromRuntimeId(application.id) ?? application.id}`,
          businessClient.createdAt,
          application.updatedAt
        ]
      );
    });
  } catch (error) {
    if (!isPostgresConnectivityError(error)) throw error;
    console.warn("[self-registration] Postgres unavailable in persistSubmittedBusinessClient; skipping", error);
  }
};

const persistOnboardingStepPayload = async (step: OnboardingStepPayload): Promise<void> => {
  const id = uuidFromRuntimeId(step.id);
  const applicationId = uuidFromRuntimeId(step.applicationId);
  if (!id || !applicationId) return;
  if (postgresUrlFromEnv()) {
    try {
      await withPostgresTransaction(async (client) => {
        await client.query(
          `insert into onboarding_step_payloads
            (id, tenant_id, application_id, step_key, payload, saved_at)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (application_id, step_key) do update set
             payload = excluded.payload,
             saved_at = excluded.saved_at`,
          [id, step.tenantId, applicationId, step.stepKey, JSON.stringify(step.payload), step.savedAt]
        );
      });
    } catch (error) {
      if (!isPostgresConnectivityError(error)) throw error;
      console.warn("[self-registration] Postgres unavailable in persistOnboardingStepPayload; skipping", error);
    }
    return;
  }
  const supabase = supabaseAdminClient();
  if (!supabase) return;

  const { error } = await supabase
    .from("onboarding_step_payloads")
    .upsert(
      {
        id,
        tenant_id: step.tenantId,
        application_id: applicationId,
        step_key: step.stepKey,
        payload: step.payload,
        saved_at: step.savedAt
      },
      { onConflict: "application_id,step_key" }
    );
  if (error) throw new Error(`onboarding_step_payloads_upsert_failed: ${error.message}`);
};

const persistRfiResponse = async (
  application: BusinessOnboardingApplication,
  payload: Record<string, unknown>,
  now: string
): Promise<void> => {
  if (!postgresUrlFromEnv()) return;
  const applicationId = uuidFromRuntimeId(application.id);
  if (!applicationId) return;
  try {
    await withPostgresTransaction(async (client) => {
      const businessClientId = await client.query<{ id: string }>(
        `select id from business_clients where id = $1 or correlation_id = $2 limit 1`,
        [applicationId, `business_onboarding:${applicationId}`]
      );
      const clientId = businessClientId.rows[0]?.id ?? null;
      await client.query(
        `update onboarding_rfi_tasks
         set status = 'responded', resolved_at = $2, updated_at = $2
         where onboarding_application_id = $1 and status = 'open'`,
        [applicationId, now]
      ).catch(() => undefined);
      await client.query(
        `insert into onboarding_status_events
          (id, platform_tenant_id, onboarding_application_id, business_client_id, previous_status, next_status, source, actor_email, payload, created_at)
         values ($1, $2, $3, $4, 'needs_information', 'pending_review', 'applicant', $5, $6, $7)`,
        [
          newId("onboarding_status_event").split("_").at(-1),
          uuidFromRuntimeId(application.tenantId) ?? process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001",
          applicationId,
          clientId,
          application.email,
          JSON.stringify(payload),
          now
        ]
      ).catch(() => undefined);
    });
  } catch (error) {
    if (!isPostgresConnectivityError(error)) throw error;
    console.warn("[self-registration] Postgres unavailable in persistRfiResponse; skipping", error);
  }
};

const isPostgresConnectivityError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown; errno?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const errno = typeof candidate.errno === "string" ? candidate.errno : "";
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

  return (
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ECONNREFUSED" ||
    errno === "ENOTFOUND" ||
    errno === "EAI_AGAIN" ||
    message.includes("getaddrinfo") ||
    message.includes("enotfound") ||
    message.includes("could not translate host name") ||
    message.includes("connection terminated unexpectedly")
  );
};

const persistentTenantId = (state: ApiState): string => {
  if (uuidFromRuntimeId(state.tenantId)) return state.tenantId;
  return process.env.GTT_PLATFORM_TENANT_ID ?? "00000000-0000-4000-8000-000000000001";
};

const countryCodeFromPayload = (payload: Record<string, unknown>): string => {
  const country = stringPayload(payload, "formationCountry") ?? stringPayload(payload, "country") ?? "US";
  const normalized = country.trim().toLowerCase();
  const mapped: Record<string, string> = {
    "germany": "DE",
    "select jurisdiction": "US",
    "singapore": "SG",
    "united kingdom": "GB",
    "united states": "US",
    "us": "US",
    "usa": "US"
  };
  return mapped[normalized] ?? (country.trim().slice(0, 2).toUpperCase() || "US");
};

const bodyString = (payload: Record<string, unknown>, key: string, fallback: string): string => {
  const value = payload[key];
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const normalizeUsePurpose = (input: string): string => {
  const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || "settlement";
};

const runtimePurposeFromUsePurpose = (usePurpose: string): "operating" | "settlement" | "escrow" | "suspense" => {
  if (usePurpose.includes("operat")) return "operating";
  if (usePurpose.includes("escrow")) return "escrow";
  if (usePurpose.includes("suspense")) return "suspense";
  return "settlement";
};

const normalizeAssetCode = (value: string): string => {
  const normalized = value.trim().toUpperCase();
  return normalized === "EURC" || normalized === "USD" || normalized === "USDC" ? normalized : "USDC";
};
