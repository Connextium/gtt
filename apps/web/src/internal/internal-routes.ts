import {
  AlertTriangle,
  BanknoteArrowUp,
  ClipboardCheck,
  Code,
  Database,
  Key,
  Landmark,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users
} from "lucide-react";
import type { ComponentType } from "react";

export type InternalWorkflow =
  | "identity"
  | "client-operations"
  | "ledger"
  | "audit"
  | "liquidity-rebalancing"
  | "reconciliation"
  | "reporting"
  | "uat"
  | "release-readiness";

export interface InternalRouteDefinition {
  label: string;
  path: string;
  description: string;
  workflow: InternalWorkflow;
  icon: ComponentType<{ size?: number }>;
  navTarget?: string;
  showInShellNav?: boolean;
}

export const internalRoutes: InternalRouteDefinition[] = [
  {
    label: "Command Center",
    path: "/internal/operations/commandcentre",
    description: "Operate the internal command center, system status, ledger parity, and event feed.",
    workflow: "identity",
    icon: Database,
    showInShellNav: true
  },
  {
    label: "User Management",
    path: "/internal/operations/admin/users",
    description: "Manage tenant-scoped users, statuses, and role assignments.",
    workflow: "identity",
    icon: Users,
    showInShellNav: true
  },
  {
    label: "Role Catalog",
    path: "/internal/operations/admin/roles",
    description: "Inspect assignable actor roles, owners, permissions, and default landings.",
    workflow: "identity",
    icon: Key,
    showInShellNav: true
  },
  {
    label: "API Management",
    path: "/internal/operations/api-keys",
    description: "Manage API credentials and scoped access.",
    workflow: "identity",
    icon: Code,
    showInShellNav: true
  },
  {
    label: "Business Clients",
    path: "/internal/operations/business-clients",
    description: "Review business onboarding applications, KYB evidence, approvals, and RFIs.",
    workflow: "client-operations",
    icon: UserCheck,
    showInShellNav: true
  },
  {
    label: "Ledger Registry",
    path: "/internal/operations/ledger/chart-of-accounts",
    description: "Inspect ledger access, posting rules, and statement shortcuts.",
    workflow: "ledger",
    icon: Landmark,
    showInShellNav: true
  },
  {
    label: "Rebalancing",
    path: "/internal/operations/rebalancing",
    description: "Review policy-driven liquidity recommendations before instruction creation.",
    workflow: "liquidity-rebalancing",
    icon: BanknoteArrowUp,
    showInShellNav: true
  },
  {
    label: "Approval Inbox",
    path: "/internal/operations/rebalancing/approvals",
    description: "Approve or reject maker-checker liquidity instructions.",
    workflow: "liquidity-rebalancing",
    icon: UserCheck,
    showInShellNav: true
  },
  {
    label: "Reconciliation",
    path: "/internal/operations/reconciliation",
    description: "Monitor reconciliation breaks and custody deltas.",
    workflow: "reconciliation",
    icon: RefreshCw,
    showInShellNav: true
  },
  {
    label: "Break Detail",
    path: "/internal/operations/reconciliation/breaks",
    description: "Assign, evidence, and resolve controlled reconciliation breaks.",
    workflow: "reconciliation",
    icon: AlertTriangle,
    navTarget: "/internal/operations/reconciliation",
    showInShellNav: true
  },
  {
    label: "Daily Close",
    path: "/internal/operations/daily-close",
    description: "Confirm close blockers, trial balance, custody, and suspense status.",
    workflow: "reporting",
    icon: ClipboardCheck,
    showInShellNav: true
  },
  {
    label: "UAT Evidence",
    path: "/internal/operations/uat",
    description: "Review pilot scenario outcomes and stakeholder evidence.",
    workflow: "uat",
    icon: ListChecks,
    showInShellNav: true
  },
  {
    label: "Release Readiness",
    path: "/internal/operations/release-readiness",
    description: "Inspect final MVP gate status and pilot release decision.",
    workflow: "release-readiness",
    icon: ShieldCheck,
    showInShellNav: true
  }
];

export const internalShellNavItems = internalRoutes.filter((route) => route.showInShellNav);

export const internalRouteForPath = (path: string): InternalRouteDefinition | undefined =>
  internalRoutes.find((route) => path === route.path || path.startsWith(`${route.path}/`));
