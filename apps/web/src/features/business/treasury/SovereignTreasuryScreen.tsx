import { type Session } from "@supabase/supabase-js";
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
import { useEffect, useState } from "react";
import { BusinessFundingModule } from "../business-funding/BusinessFundingModule.js";
import { routeForApplication } from "../onboarding/onboardingRouting.js";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";
import { type MyOnboardingResponse, type OnboardingApplication } from "../onboarding/types.js";
import { apiRequest } from "../shared/apiClient.js";
import { SovereignAccountsModule } from "./SovereignAccountsModule.js";
import { SovereignDashboardModule } from "./SovereignDashboardModule.js";
import { SovereignDetailModule } from "./SovereignDetailModule.js";
import { SovereignMoveMoneyModal } from "./SovereignMoveMoneyModal.js";
import { SovereignSectionPlaceholderModule } from "./SovereignSectionPlaceholderModule.js";
import { type TreasuryAdaAccount } from "./formatters.js";

type Navigate = (path: string) => void;

type OnboardingAdaAccount = TreasuryAdaAccount;

type SovereignView = "accounts" | "trade-ledgers" | "netting" | "dashboard" | "detail" | "funding" | "analytics";

const SOVEREIGN_VIEW_QUERY_KEY = "view";

const SOVEREIGN_VIEW_TO_URL_TOKEN: Record<SovereignView, string> = {
  accounts: "accounts",
  "trade-ledgers": "trade-ledgers",
  netting: "netting",
  dashboard: "treasury",
  detail: "treasury-detail",
  funding: "funding",
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
  session: Session | null;
}) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [adaAccounts, setAdaAccounts] = useState<OnboardingAdaAccount[]>([]);
  const [adaAccountsLoading, setAdaAccountsLoading] = useState(true);
  const [view, setView] = useState<SovereignView>(() => readSovereignViewFromLocation() ?? initialView);
  const [selectedAdaAccountId, setSelectedAdaAccountId] = useState("");
  const [detailReturnView, setDetailReturnView] = useState<SovereignView>("dashboard");
  const [moveMoneyOpen, setMoveMoneyOpen] = useState(false);
  const treasuryActive = view === "dashboard" || view === "detail" || view === "funding";

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
    const token = session?.access_token;
    if (!token) {
      setAdaAccountsLoading(false);
      return;
    }
    let active = true;
    setAdaAccountsLoading(true);
    apiRequest<MyOnboardingResponse<OnboardingAdaAccount>>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
        if (result.application.status !== "approved") {
          navigate(routeForApplication(result.application));
          return;
        }
        setApplication(result.application);
        setAdaAccounts(result.adaAccounts ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!active) return;
        setAdaAccountsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigate, session?.access_token]);

  const email = application?.email ?? session?.user.email ?? "treasury@gtt.example";

  function setViewWithUrl(nextView: SovereignView) {
    setView(nextView);
    writeSovereignViewToLocation(nextView, "push");
  }

  function openAdaDetail(accountId: string, returnView: SovereignView) {
    setSelectedAdaAccountId(accountId);
    setDetailReturnView(returnView);
    setViewWithUrl("detail");
  }

  const selectedAdaAccount = adaAccounts.find((account) => account.id === selectedAdaAccountId) ?? adaAccounts[0];

  return (
    <div className="gtt-sovereign-shell">
      <aside className="gtt-sovereign-sidebar">
        <div className="gtt-sovereign-brand">
          <h1>GTT Treasure</h1>
          <p>Terminal ID: 8842-X</p>
        </div>

        <nav className="gtt-sovereign-nav" aria-label="Business treasury navigation">
          <button className={view === "accounts" ? "active" : ""} onClick={() => setViewWithUrl("accounts")} type="button"><Building2 size={18} /> Accounts</button>
          <button className={view === "trade-ledgers" ? "active" : ""} onClick={() => setViewWithUrl("trade-ledgers")} type="button"><FileText size={18} /> Trade Ledgers</button>
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
            <Settings size={19} />
            <BusinessAvatarMenu email={email} onLogout={() => void onLogout()} />
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
            <SovereignSectionPlaceholderModule
              description="Trade ledger operations are loaded in-page with no sidebar refresh."
              title="Trade Ledgers"
            />
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
