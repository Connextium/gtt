import {
  ArrowRight,
  ArrowLeftRight,
  Bell,
  Building2,
  FileText,
  LineChart,
  Settings,
  Wallet
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BusinessApiKeysContent } from "../api-keys/BusinessApiKeysContent.js";
import { BusinessFundingModule } from "../business-funding/BusinessFundingModule.js";
import { BusinessClientAdaModule } from "../client-ada/BusinessClientAdaModule.js";
import { TradeLedgersOpenAccountWizardView } from "../trade-ledgers/TradeLedgersOpenAccountWizardView.js";
import { TradeLedgersTreasuryView } from "../trade-ledgers/TradeLedgersTreasuryView.js";
import "../trade-ledgers/trade-ledgers-tailwind.css";
import { routeForApplication } from "../onboarding/onboardingRouting.js";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";
import { type MyOnboardingResponse, type OnboardingApplication } from "../onboarding/types.js";
import { apiRequest } from "../shared/apiClient.js";
import { type BusinessJwtSession } from "../shared/useSupabaseSession.js";
import { SovereignAccountsModule } from "./SovereignAccountsModule.js";
import { SovereignDashboardModule } from "./SovereignDashboardModule.js";
import { SovereignDetailModule } from "./SovereignDetailModule.js";
import { SovereignMoveMoneyModal } from "./SovereignMoveMoneyModal.js";
import { SovereignSectionPlaceholderModule } from "./SovereignSectionPlaceholderModule.js";
import { accountDisplayCode, parseMinorUnits, type TreasuryAdaAccount } from "./formatters.js";

type Navigate = (path: string) => void;

type OnboardingAdaAccount = TreasuryAdaAccount;

type SovereignView = "accounts" | "trade-ledgers" | "open-account" | "api-keys" | "netting" | "dashboard" | "detail" | "funding" | "ada-registry" | "analytics";

const SOVEREIGN_VIEW_QUERY_KEY = "view";

const SOVEREIGN_VIEW_TO_URL_TOKEN: Record<SovereignView, string> = {
  accounts: "accounts",
  "trade-ledgers": "trade-ledgers",
  "open-account": "open-account",
  "api-keys": "api-keys",
  netting: "netting",
  dashboard: "treasury",
  detail: "treasury-detail",
  funding: "funding",
  "ada-registry": "ada-registry",
  analytics: "analytics"
};

function parseSovereignView(raw: string | null | undefined): SovereignView | undefined {
  if (!raw) return undefined;
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case "accounts":
      return "accounts";
    case "trade-ledgers":
    case "trade_ledgers":
    case "ledgers":
      return "trade-ledgers";
    case "open-account":
    case "open_account":
    case "client-account":
      return "open-account";
    case "api-keys":
    case "api_keys":
    case "apikeys":
      return "api-keys";
    case "netting":
      return "netting";
    case "dashboard":
    case "treasury":
      return "dashboard";
    case "detail":
    case "treasury-detail":
    case "treasury_detail":
      return "detail";
    case "funding":
    case "funding-instructions":
    case "funding_instructions":
      return "funding";
    case "ada-registry":
    case "ada_registry":
    case "business-client-ada":
    case "business_client_ada":
      return "ada-registry";
    case "analytics":
      return "analytics";
    default:
      return undefined;
  }
}

function readSovereignViewFromLocation(): SovereignView | undefined {
  if (typeof window === "undefined") return undefined;
  const search = new URLSearchParams(window.location.search);
  const queryView = parseSovereignView(search.get(SOVEREIGN_VIEW_QUERY_KEY));
  if (queryView) return queryView;
  const hashToken = window.location.hash ? window.location.hash.slice(1) : "";
  return parseSovereignView(hashToken);
}

function writeSovereignViewToLocation(view: SovereignView, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const token = SOVEREIGN_VIEW_TO_URL_TOKEN[view];
  const search = new URLSearchParams(window.location.search);
  const currentQuery = search.get(SOVEREIGN_VIEW_QUERY_KEY);
  const currentHash = window.location.hash ? window.location.hash.slice(1) : "";
  if (currentQuery === token && currentHash === token) return;
  search.set(SOVEREIGN_VIEW_QUERY_KEY, token);
  const query = search.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}#${token}`;
  if (mode === "replace") {
    window.history.replaceState({}, "", nextUrl);
    return;
  }
  window.history.pushState({}, "", nextUrl);
}

export function SovereignTreasuryScreen({
  initialFundingInstructionId,
  initialView = "dashboard",
  navigate,
  onLogout,
  session
}: {
  initialFundingInstructionId?: string;
  initialView?: SovereignView;
  navigate: Navigate;
  onLogout: () => Promise<void> | void;
  session: BusinessJwtSession | null;
}) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [adaAccounts, setAdaAccounts] = useState<OnboardingAdaAccount[]>([]);
  const [adaAccountsLoading, setAdaAccountsLoading] = useState(true);
  const [view, setView] = useState<SovereignView>(() => readSovereignViewFromLocation() ?? initialView);
  const [selectedAdaAccountId, setSelectedAdaAccountId] = useState("");
  const [detailReturnView, setDetailReturnView] = useState<SovereignView>("dashboard");
  const [moveMoneyOpen, setMoveMoneyOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const treasuryActive = view === "dashboard" || view === "detail" || view === "funding";
  const tradeLedgersActive = view === "trade-ledgers" || view === "open-account";

  const loadOnboardingSnapshot = useCallback(async (token: string) => {
    const result = await apiRequest<MyOnboardingResponse<OnboardingAdaAccount>>("/onboarding/me", { token });
    if (result.application.status !== "approved") {
      navigate(routeForApplication(result.application));
      return;
    }
    setApplication(result.application);
    setAdaAccounts(result.adaAccounts ?? []);
  }, [navigate]);

  useEffect(() => {
    const locationView = readSovereignViewFromLocation();
    if (locationView) {
      setView(locationView);
      return;
    }
    setView(initialView);
    writeSovereignViewToLocation(initialView, "replace");
  }, [initialView]);

  useEffect(() => {
    const syncFromLocation = () => {
      const locationView = readSovereignViewFromLocation();
      if (locationView) {
        setView(locationView);
      }
    };

    window.addEventListener("popstate", syncFromLocation);
    window.addEventListener("hashchange", syncFromLocation);
    return () => {
      window.removeEventListener("popstate", syncFromLocation);
      window.removeEventListener("hashchange", syncFromLocation);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!settingsMenuRef.current) return;
      if (settingsMenuRef.current.contains(event.target as Node)) return;
      setSettingsOpen(false);
    };

    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setApplication(undefined);
      setAdaAccounts([]);
      setAdaAccountsLoading(false);
      return;
    }
    let active = true;
    setAdaAccountsLoading(true);
    loadOnboardingSnapshot(token)
      .then(() => {
        if (!active) return;
      })
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        setAdaAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadOnboardingSnapshot, session?.access_token]);

  const refreshAdaAccounts = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    setAdaAccountsLoading(true);
    try {
      await loadOnboardingSnapshot(token);
    } catch {
      // Keep existing UI state when refresh fails and allow user to retry action.
    } finally {
      setAdaAccountsLoading(false);
    }
  }, [loadOnboardingSnapshot, session?.access_token]);

  const email = application?.email ?? session?.user.email ?? "treasury@gtt.example";

  function setViewWithUrl(nextView: SovereignView) {
    setView(nextView);
    writeSovereignViewToLocation(nextView, "push");
    setSettingsOpen(false);
  }

  function openAdaDetail(accountId: string, returnView: SovereignView) {
    setSelectedAdaAccountId(accountId);
    setDetailReturnView(returnView);
    setViewWithUrl("detail");
  }

  const selectedAdaAccount = adaAccounts.find((account) => account.id === selectedAdaAccountId) ?? adaAccounts[0];
  const tradeLedgerAccounts = useMemo(
    () => adaAccounts.map((account) => {
      const assetCode = (account.assetCode ?? "USDC").toUpperCase();
      const currency: "USDC" | "EURC" | "USD" = assetCode === "EURC"
        ? "EURC"
        : assetCode === "USD"
          ? "USD"
          : "USDC";
      const normalizedStatus = account.status.trim().toLowerCase();
      const status: "active" | "pending_internal_approval" | "draft" = normalizedStatus === "active"
        ? "active"
        : normalizedStatus.includes("pending")
          ? "pending_internal_approval"
          : "draft";

      return {
        id: account.id,
        code: accountDisplayCode(account),
        displayName: account.accountName,
        purpose: account.usePurpose.replaceAll("_", " "),
        currency,
        status,
        balance: parseMinorUnits(account.balances?.availableMinorUnits) / 1_000_000
      };
    }),
    [adaAccounts]
  );

  return (
    <div className="gtt-sovereign-shell">
      <aside className="gtt-sovereign-sidebar">
        <div className="gtt-sovereign-brand">
          <h1>GTT Treasure</h1>
          <p>Terminal ID: 8842-X</p>
        </div>

        <nav className="gtt-sovereign-nav" aria-label="Business treasury navigation">
          <button className={view === "accounts" ? "active" : ""} onClick={() => setViewWithUrl("accounts")} type="button"><Building2 size={18} /> Accounts</button>
          <button className={tradeLedgersActive ? "active" : ""} onClick={() => setViewWithUrl("trade-ledgers")} type="button"><FileText size={18} /> Trade Ledgers</button>
          <button className={view === "ada-registry" ? "active" : ""} onClick={() => setViewWithUrl("ada-registry")} type="button"><FileText size={18} /> ADA Registry</button>
          <button className={view === "netting" ? "active" : ""} onClick={() => setViewWithUrl("netting")} type="button"><ArrowLeftRight size={18} /> Netting</button>
          <div className="gtt-sovereign-nav-group">
            <button className={treasuryActive ? "active" : ""} onClick={() => setViewWithUrl("dashboard")} type="button"><Wallet size={18} /> Treasury</button>
            <button className={`gtt-sovereign-subitem ${view === "funding" ? "active" : ""}`} onClick={() => setViewWithUrl("funding")} type="button"><ArrowRight size={18} /> Funding Instructions</button>
          </div>
          <button className={view === "analytics" ? "active" : ""} onClick={() => setViewWithUrl("analytics")} type="button"><LineChart size={18} /> Analytics</button>
        </nav>

        <div className="gtt-sovereign-sidebar-footer">
          <button onClick={() => setMoveMoneyOpen(true)} type="button">New Transaction</button>
        </div>
      </aside>

      <main className="gtt-sovereign-main">
        <header className="gtt-sovereign-topbar">
          <nav aria-label="Treasury links">
            <a className="active" href="#">Markets</a>
            <a href="#">Insights</a>
            <a href="#">Regulatory</a>
          </nav>
          <div className="gtt-sovereign-topbar-tools">
            <Bell size={19} />
            <div className="gtt-sovereign-settings-menu" ref={settingsMenuRef}>
              <button
                aria-expanded={settingsOpen}
                aria-haspopup="menu"
                aria-label="Configuration menu"
                className="gtt-sovereign-settings-trigger"
                onClick={() => setSettingsOpen((current) => !current)}
                title="Configuration"
                type="button"
              >
                <Settings size={18} />
              </button>
              {settingsOpen ? (
                <div className="gtt-sovereign-settings-popover" role="menu">
                  <p>Configuration</p>
                  <button onClick={() => setViewWithUrl("api-keys")} role="menuitem" type="button">
                    API Key Credentials
                  </button>
                </div>
              ) : null}
            </div>
            <BusinessAvatarMenu
              email={email}
              onLogout={() => void onLogout()}
            />
          </div>
        </header>

        <section className="gtt-sovereign-body">
          {view === "accounts" ? (
            <SovereignAccountsModule
              adaAccounts={adaAccounts}
              adaAccountsLoading={adaAccountsLoading}
              onOpenDetail={(accountId) => openAdaDetail(accountId, "accounts")}
            />
          ) : view === "trade-ledgers" ? (
            <div className="bc-account-scope bc-density-compact">
              <TradeLedgersTreasuryView
                accounts={tradeLedgerAccounts}
                onInitiateTransfer={() => setMoveMoneyOpen(true)}
                onOpenProvisionWizard={() => setViewWithUrl("open-account")}
                transfers={[]}
              />
            </div>
          ) : view === "open-account" ? (
            <div className="bc-account-scope bc-density-compact">
              <TradeLedgersOpenAccountWizardView
                onBackToTradeLedgers={() => navigate("/treasury?view=trade-ledgers#trade-ledgers")}
                onAccountCreated={() => refreshAdaAccounts()}
                onComplete={() => navigate("/treasury?view=accounts#accounts")}
                token={session?.access_token ?? ""}
              />
            </div>
          ) : view === "api-keys" ? (
            <BusinessApiKeysContent token={session?.access_token ?? ""} />
          ) : view === "netting" ? (
            <SovereignSectionPlaceholderModule
              description="Netting workflows are rendered in this panel while layout remains fixed."
              title="Netting"
            />
          ) : view === "funding" ? (
            <BusinessFundingModule
              authorizedAccounts={adaAccounts}
              embedded
              initialInstructionId={initialFundingInstructionId}
              navigate={navigate}
              token={session?.access_token ?? ""}
            />
          ) : view === "ada-registry" ? (
            <BusinessClientAdaModule token={session?.access_token ?? ""} />
          ) : view === "analytics" ? (
            <SovereignSectionPlaceholderModule
              description="Analytics surfaces are rendered as in-page content under the same shell."
              title="Analytics"
            />
          ) : view === "dashboard" ? (
            <SovereignDashboardModule
              adaAccounts={adaAccounts}
              adaAccountsLoading={adaAccountsLoading}
              onOpenDetail={(accountId) => openAdaDetail(accountId, "dashboard")}
            />
          ) : (
            <SovereignDetailModule account={selectedAdaAccount} onBack={() => setViewWithUrl(detailReturnView)} token={session?.access_token ?? ""} />
          )}
        </section>

        <footer className="gtt-sovereign-footer">
          <div>Global Trade Treasury</div>
          <nav aria-label="Treasury policies">
            <a href="#">Terms</a>
            <a href="#">Privacy</a>
            <a href="#">Compliance</a>
            <a href="#">API Documentation</a>
          </nav>
          <p>2026 Global Trade Treasury. All rights reserved. Member SIPC.</p>
        </footer>
      </main>

      <SovereignMoveMoneyModal isOpen={moveMoneyOpen} onClose={() => setMoveMoneyOpen(false)} />
    </div>
  );
}
