export interface WebNavigationItem {
  label: string;
  route: string;
  workflow:
    | "liquidity-rebalancing"
    | "reconciliation"
    | "reporting"
    | "uat"
    | "release-readiness";
}

export interface WebAppShell {
  app: "gtt-web";
  status: "contract_ready";
  navigation: WebNavigationItem[];
}

export const operationsNavigation: WebNavigationItem[] = [
  {
    label: "Rebalancing Recommendations",
    route: "/operations/rebalancing",
    workflow: "liquidity-rebalancing"
  },
  {
    label: "Approval Inbox",
    route: "/operations/rebalancing/approvals",
    workflow: "liquidity-rebalancing"
  },
  {
    label: "Reconciliation Dashboard",
    route: "/operations/reconciliation",
    workflow: "reconciliation"
  },
  {
    label: "Break Detail",
    route: "/operations/reconciliation/breaks/:id",
    workflow: "reconciliation"
  },
  {
    label: "Daily Close",
    route: "/operations/daily-close",
    workflow: "reporting"
  },
  {
    label: "UAT Evidence",
    route: "/operations/uat",
    workflow: "uat"
  },
  {
    label: "Release Readiness",
    route: "/operations/release-readiness",
    workflow: "release-readiness"
  }
];

export const appShell = (): WebAppShell => ({
  app: "gtt-web",
  status: "contract_ready",
  navigation: operationsNavigation
});
