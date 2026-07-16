import { domainModules, evaluatePilotReadiness, type PilotReadinessInput } from "./domain/index.js";
import { validateMigrationCatalog } from "./db/migrations-catalog/index.js";

export interface ApiHealth {
  service: "gtt-api";
  status: "ok";
}

export interface ApiRouteContract {
  method: "GET" | "POST";
  path: string;
  domain: string;
  description: string;
}

export interface ApiApplicationManifest {
  service: "gtt-api";
  domainModules: string[];
  latestMigrationVersion: string;
  migrationSequenceValid: boolean;
  routeCount: number;
}

export const health = (): ApiHealth => ({
  service: "gtt-api",
  status: "ok"
});

export const apiRouteContracts: ApiRouteContract[] = [
  ...[
    ["GET", "/health", "platform"],
    ["GET", "/manifest", "platform"],
    ["GET", "/version", "platform"],
    ["GET", "/readiness", "platform"],
    ["POST", "/api-keys", "api-auth"],
    ["GET", "/api-keys", "api-auth"],
    ["GET", "/api-keys/{id}", "api-auth"],
    ["POST", "/api-keys/{id}/revoke", "api-auth"],
    ["POST", "/api-keys/{id}/rotate", "api-auth"],
    ["POST", "/business-clients", "client-onboarding"],
    ["GET", "/business-clients", "client-onboarding"],
    ["GET", "/business-clients/{id}", "client-onboarding"],
    ["POST", "/business-clients/{id}/submit-onboarding", "client-onboarding"],
    ["POST", "/business-clients/{id}/map-circle", "client-onboarding"],
    ["POST", "/accounts-of-digital-asset", "digital-accounts"],
    ["GET", "/accounts-of-digital-asset", "digital-accounts"],
    ["GET", "/accounts-of-digital-asset/{id}", "digital-accounts"],
    ["POST", "/accounts-of-digital-asset/{id}/provision-circle", "digital-accounts"],
    ["GET", "/accounts-of-digital-asset/{id}/balance", "balance"],
    ["GET", "/accounts-of-digital-asset/{id}/statement", "digital-accounts"],
    ["GET", "/ledger/chart-of-accounts", "ledger"],
    ["POST", "/ledger/journals", "ledger"],
    ["GET", "/ledger/journals", "ledger"],
    ["GET", "/ledger/journals/{id}", "ledger"],
    ["POST", "/ledger/journals/{id}/reverse", "ledger"],
    ["POST", "/balances/project", "balance"],
    ["GET", "/balances/{accountOfDigitalAssetId}", "balance"],
    ["GET", "/balances/{accountOfDigitalAssetId}/history", "balance"],
    ["GET", "/balances/projection-runs", "balance"],
    ["POST", "/settlement-obligations", "settlement-obligation"],
    ["GET", "/settlement-obligations", "settlement-obligation"],
    ["GET", "/settlement-obligations/{id}", "settlement-obligation"],
    ["POST", "/settlement-obligations/{id}/approve", "settlement-obligation"],
    ["POST", "/settlement-obligations/{id}/dispute", "settlement-obligation"],
    ["POST", "/settlement-obligations/{id}/release-dispute", "settlement-obligation"],
    ["POST", "/settlement-obligations/{id}/cancel", "settlement-obligation"],
    ["POST", "/funding-reservations", "funding-reservation"],
    ["GET", "/funding-reservations", "funding-reservation"],
    ["GET", "/funding-reservations/{id}", "funding-reservation"],
    ["POST", "/funding-reservations/{id}/activate", "funding-reservation"],
    ["POST", "/funding-reservations/{id}/release", "funding-reservation"],
    ["POST", "/funding-reservations/{id}/expire", "funding-reservation"],
    ["POST", "/funding-reservations/{id}/cancel", "funding-reservation"],
    ["POST", "/payments/internal", "payment-execution"],
    ["POST", "/payments/external-usdc", "payment-execution"],
    ["GET", "/payments", "payment-execution"],
    ["GET", "/payments/{id}", "payment-execution"],
    ["POST", "/payments/{id}/submit", "payment-execution"],
    ["POST", "/payments/{id}/cancel", "payment-execution"],
    ["POST", "/payments/{id}/retry", "payment-execution"],
    ["POST", "/payments/{id}/refresh-status", "payment-execution"],
    ["POST", "/fiat/wire-accounts", "payment-execution"],
    ["GET", "/fiat/wire-accounts", "payment-execution"],
    ["POST", "/fiat/funding-instructions", "payment-execution"],
    ["GET", "/fiat/funding-instructions", "payment-execution"],
    ["POST", "/fiat/redemptions", "payment-execution"],
    ["GET", "/fiat/redemptions", "payment-execution"],
    ["GET", "/fiat/redemptions/{id}", "payment-execution"],
    ["POST", "/fiat/redemptions/{id}/submit", "payment-execution"],
    ["POST", "/fiat/redemptions/{id}/retry", "payment-execution"],
    ["POST", "/fiat/redemptions/{id}/refresh-status", "payment-execution"],
    ["GET", "/liquidity-rebalancing/recommendations", "liquidity-rebalancing"],
    ["POST", "/liquidity-rebalancing/instructions", "liquidity-rebalancing"],
    ["GET", "/liquidity-rebalancing/instructions", "liquidity-rebalancing"],
    ["GET", "/liquidity-rebalancing/instructions/{id}", "liquidity-rebalancing"],
    ["POST", "/liquidity-rebalancing/instructions/{id}/approve", "liquidity-rebalancing"],
    ["POST", "/liquidity-rebalancing/instructions/{id}/reject", "liquidity-rebalancing"],
    ["POST", "/liquidity-rebalancing/instructions/{id}/execute", "liquidity-rebalancing"],
    ["POST", "/reconciliation/runs", "reconciliation"],
    ["GET", "/reconciliation/runs", "reconciliation"],
    ["GET", "/reconciliation/runs/{id}", "reconciliation"],
    ["GET", "/reconciliation/breaks", "reconciliation"],
    ["GET", "/reconciliation/breaks/{id}", "reconciliation"],
    ["POST", "/reconciliation/breaks/{id}/assign", "reconciliation"],
    ["POST", "/reconciliation/breaks/{id}/add-note", "reconciliation"],
    ["POST", "/reconciliation/breaks/{id}/attach-evidence", "reconciliation"],
    ["POST", "/reconciliation/breaks/{id}/resolve", "reconciliation"],
    ["POST", "/reconciliation/breaks/{id}/reopen", "reconciliation"],
    ["POST", "/webhooks/circle", "circle-integration"],
    ["GET", "/webhooks/circle/events", "circle-integration"],
    ["POST", "/webhooks/circle/events/{id}/retry", "circle-integration"],
    ["GET", "/events/outbox", "events"],
    ["POST", "/events/outbox/{id}/retry", "events"],
    ["GET", "/events/inbox", "events"],
    ["POST", "/events/inbox/{id}/retry", "events"],
    ["GET", "/dead-letter", "events"],
    ["POST", "/dead-letter/{id}/replay", "events"],
    ["GET", "/audit-log", "events"],
    ["GET", "/operations/dashboard", "reporting"],
    ["GET", "/treasury-accounting/trial-balance", "ledger"],
    ["GET", "/treasury-accounting/customer-liability-control", "ledger"],
    ["GET", "/reports/daily-close", "reporting"],
    ["GET", "/reports/daily-settlement", "reporting"],
    ["GET", "/reports/obligation-maturity", "reporting"],
    ["GET", "/reports/reservations", "reporting"],
    ["GET", "/reports/treasury-position", "reporting"],
    ["GET", "/reports/suspense", "reporting"],
    ["GET", "/reports/circle-custody-reconciliation", "reporting"],
    ["GET", "/uat/scenarios", "hardening-release"],
    ["POST", "/uat/scenarios/{id}/result", "hardening-release"],
    ["GET", "/release-readiness", "hardening-release"],
    ["POST", "/release-readiness/evaluate", "hardening-release"],
    ["POST", "/release-readiness/decision", "hardening-release"],
    ["GET", "/release-artifacts", "hardening-release"],
    ["POST", "/release-artifacts", "hardening-release"]
  ].map(([method, path, domain]) => ({
    method: method as "GET" | "POST",
    path: path!,
    domain: domain!,
    description: `${method} ${path}`
  }))
];

export const applicationManifest = (): ApiApplicationManifest => {
  const migrationValidation = validateMigrationCatalog();
  return {
    service: "gtt-api",
    domainModules,
    latestMigrationVersion: migrationValidation.latestVersion,
    migrationSequenceValid: migrationValidation.sequenceValid,
    routeCount: apiRouteContracts.length
  };
};

export const evaluateReleaseReadiness = (input: PilotReadinessInput) => evaluatePilotReadiness(input);
