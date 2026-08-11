import {
  AlertTriangle,
  BanknoteArrowUp,
  Building2,
  ClipboardCheck,
  Code,
  Database,
  Key,
  Landmark,
  ListChecks,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  Wallet,
  Workflow
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
  children?: InternalRouteDefinition[];
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
    showInShellNav: false
  },
  {
    label: "Tenant Activation",
    path: "/internal/operations/admin/tenant-activation",
    description: "Activate tenant Circle wallet-set infrastructure and configure wallet creation network scope.",
    workflow: "identity",
    icon: Building2,
    showInShellNav: false
  },
  {
    label: "Business Clients",
    path: "/internal/operations/business-clients",
    description: "Review business onboarding applications, KYB evidence, approvals, and RFIs.",
    workflow: "client-operations",
    icon: UserCheck,
    children: [
      {
        label: "Onboarding Queue",
        path: "/internal/operations/business-clients",
        description: "Review business onboarding applications, approvals, RFIs, and KYB evidence.",
        workflow: "client-operations",
        icon: UserCheck,
        showInShellNav: true
      },
      {
        label: "ADA Accounts",
        path: "/internal/operations/accounts-of-digital-asset",
        description: "Manage accounts of digital assets linked to approved business clients.",
        workflow: "client-operations",
        icon: Wallet,
        showInShellNav: true
      }
    ],
    showInShellNav: true
  },
  {
    label: "Ledger Registry",
    path: "/internal/operations/ledger/chart-of-accounts",
    description: "Inspect ledger access, posting rules, and statement shortcuts.",
    workflow: "ledger",
    icon: Landmark,
    children: [
      {
        label: "Chart of Accounts",
        path: "/internal/operations/ledger/chart-of-accounts",
        description: "Inspect account codes, classifications, normal balances, and ledger status.",
        workflow: "ledger",
        icon: Landmark,
        showInShellNav: true
      },
      {
        label: "Initializing Journal",
        path: "/internal/operations/ledger/active-ledgers",
        description: "Monitor initializing journal records for ADA-backed ledgers, rail status, and reconciliation posture.",
        workflow: "ledger",
        icon: Landmark,
        showInShellNav: true
      },
      {
        label: "Post Journal",
        path: "/internal/operations/ledger/opening-journal",
        description: "Post controlled journal events to approved ADA accounts.",
        workflow: "ledger",
        icon: ClipboardCheck,
        showInShellNav: false
      },
      {
        label: "Journal Entries",
        path: "/internal/operations/ledger/journals",
        description: "Inspect posted journals, view lines, and execute controlled reversals.",
        workflow: "ledger",
        icon: ClipboardCheck,
        showInShellNav: true
      }
    ],
    showInShellNav: true
  },
  {
    label: "Funding Instructions",
    path: "/internal/operations/funding-instructions",
    description: "Create and authorize internal treasury mint funding instructions for ADA account topology.",
    workflow: "liquidity-rebalancing",
    icon: Workflow,
    showInShellNav: false
  },
  {
    label: "Funding Order Console",
    path: "/internal/operations/funding-instructions/orders",
    description: "Monitor funding instruction orchestration, order statuses, and settlement evidence.",
    workflow: "liquidity-rebalancing",
    icon: Workflow,
    showInShellNav: true
  },
  {
    label: "Settlement Advance",
    path: "/internal/operations/settlement-advance",
    description: "Operate reservation and activation lifecycle for Sprint 5-2.",
    workflow: "liquidity-rebalancing",
    icon: BanknoteArrowUp,
    showInShellNav: true
  },
  {
    label: "Tenant Disbursements",
    path: "/internal/operations/tenant-disbursements",
    description: "Operate tenant activation gating before disbursement execution.",
    workflow: "liquidity-rebalancing",
    icon: Workflow,
    showInShellNav: true
  },
  {
    label: "Platform Wire Mint",
    path: "/internal/operations/platform-wire-mint",
    description: "Operate platform wire account setup and fiat to USDC mint path.",
    workflow: "liquidity-rebalancing",
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
    label: "Evidence",
    path: "/internal/operations/audit",
    description: "Inspect audit events, outbox delivery, and inbox processing evidence.",
    workflow: "audit",
    icon: ShieldCheck,
    children: [
      {
        label: "Audit Events",
        path: "/internal/operations/audit",
        description: "Search audit events by actor, tenant, correlation ID, idempotency key, and event type.",
        workflow: "audit",
        icon: ShieldCheck,
        showInShellNav: true
      },
      {
        label: "Outbox",
        path: "/internal/operations/events/outbox",
        description: "Monitor outbound event status, attempts, publish timestamps, errors, and payload evidence.",
        workflow: "audit",
        icon: Workflow,
        showInShellNav: true
      },
      {
        label: "Inbox",
        path: "/internal/operations/events/inbox",
        description: "Monitor inbound provider events, dedupe status, processing timestamps, errors, and payload evidence.",
        workflow: "audit",
        icon: Workflow,
        showInShellNav: true
      }
    ],
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
  flattenInternalRoutes(internalRoutes).find((route) => path === route.path || path.startsWith(`${route.path}/`));

const flattenInternalRoutes = (routes: InternalRouteDefinition[]): InternalRouteDefinition[] =>
  routes.flatMap((route) => [route, ...(route.children ? flattenInternalRoutes(route.children) : [])]);
