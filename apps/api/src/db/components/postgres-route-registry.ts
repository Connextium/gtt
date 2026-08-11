const getRoutes = [
  /^\/api-keys$/,
  /^\/api-keys\/[^/]+$/,
  /^\/business-clients$/,
  /^\/business-clients\/[^/]+$/,
  /^\/accounts-of-digital-asset$/,
  /^\/accounts-of-digital-asset\/[^/]+$/,
  /^\/accounts-of-digital-asset\/[^/]+\/(balances|statement|statements|linked-instruments|provider-mappings|funding-routes)$/,
  /^\/ledger\/(chart-of-accounts|posting-rules|journals)$/,
  /^\/ledger\/journals\/[^/]+$/,
  /^\/funding-instructions$/,
  /^\/funding-instructions\/[^/]+(\/orders)?$/,
  /^\/business\/me\/funding-instructions$/,
  /^\/business\/me\/funding-instructions\/[^/]+(\/orders)?$/,
  /^\/funding-reservations$/,
  /^\/funding-reservations\/[^/]+$/,
  /^\/payments$/,
  /^\/payments\/[^/]+$/,
  /^\/fiat\/(wire-accounts|mints|redemptions)$/,
  /^\/fiat\/redemptions\/[^/]+$/,
  /^\/internal\/treasury\/credit-line$/,
  /^\/internal\/treasury\/settlement-advance$/,
  /^\/internal\/treasury\/settlement-advance\/[^/]+$/,
  /^\/internal\/treasury\/tenant-disbursements$/,
  /^\/internal\/treasury\/tenant-disbursements\/[^/]+$/,
  /^\/internal\/operations\/linked-wire-accounts$/,
  /^\/internal\/operations\/linked-wire-accounts\/[^/]+$/,
  /^\/reconciliation\/breaks$/,
  /^\/reconciliation\/breaks\/[^/]+$/,
  /^\/balances\/projection-runs$/,
  /^\/treasury-accounting\/(trial-balance|customer-liability-control)$/,
  /^\/events\/(outbox|inbox)$/,
  /^\/audit-(log|events)$/,
  /^\/tenants\/current\/activation$/,
  /^\/integrations\/circle\/health$/
];

const postRoutes = [
  /^\/api-keys$/,
  /^\/api-keys\/[^/]+\/(revoke|rotate)$/,
  /^\/business-clients$/,
  /^\/business-clients\/[^/]+\/(submit-onboarding|map-circle|restrict|close)$/,
  /^\/accounts-of-digital-asset$/,
  /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments$/,
  /^\/accounts-of-digital-asset\/[^/]+\/linked-instruments\/[^/]+\/(verify|disable)$/,
  /^\/accounts-of-digital-asset\/[^/]+\/(activate|restrict|unrestrict|freeze|unfreeze|close|provision-circle)$/,
  /^\/accounts-of-digital-asset\/[^/]+\/funding-routes$/,
  /^\/accounts-of-digital-asset\/[^/]+\/funding-routes\/[^/]+\/verify$/,
  /^\/ledger\/events\/opening-journal$/,
  /^\/ledger\/journals$/,
  /^\/ledger\/journals\/[^/]+\/reverse$/,
  /^\/tenants\/current\/activate$/,
  /^\/integrations\/circle\/sandbox-check$/,
  /^\/funding-instructions$/,
  /^\/business\/me\/funding-instructions$/,
  /^\/funding-instructions\/[^/]+\/(assign-route|cancel)$/,
  /^\/funding-reservations$/,
  /^\/funding-reservations\/[^/]+\/(activate|release|expire|cancel)$/,
  /^\/payments\/(internal|external-usdc)$/,
  /^\/payments\/[^/]+\/(submit|cancel|retry|refresh-status)$/,
  /^\/fiat\/wire-accounts$/,
  /^\/fiat\/wire-accounts\/[^/]+\/mint$/,
  /^\/fiat\/redemptions$/,
  /^\/fiat\/redemptions\/[^/]+\/(submit|retry|refresh-status)$/,
  /^\/internal\/treasury\/settlement-advance\/reserve$/,
  /^\/internal\/treasury\/settlement-advance\/[^/]+\/(request|cancel)$/,
  /^\/internal\/treasury\/tenant-disbursements$/,
  /^\/internal\/treasury\/tenant-disbursements\/[^/]+\/(approve|submit)$/,
  /^\/internal\/operations\/linked-wire-accounts\/[^/]+\/refresh-instructions$/,
  /^\/webhooks\/circle$/,
  /^\/internal\/webhooks\/circle\/[^/]+\/reprocess$/,
  /^\/reconciliation\/breaks\/[^/]+\/resolve$/,
  /^\/events\/(outbox|inbox)\/[^/]+\/retry$/
];

export const isPostgresRoute = (method: string, pathname: string): boolean => {
  const routes = method === "GET"
    ? getRoutes
    : method === "POST" || method === "PUT"
      ? postRoutes
      : method === "PATCH"
        ? [/^\/accounts-of-digital-asset\/[^/]+\/linked-instruments\/[^/]+$/]
        : [];
  return routes.some((route) => route.test(pathname));
};
