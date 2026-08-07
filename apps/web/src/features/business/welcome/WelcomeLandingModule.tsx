import type { Session } from "@supabase/supabase-js";
import { ArrowRight, BarChart2, Bell, Building2, CheckCircle2, Clock, Download, Gavel, Search, Settings, ShieldCheck, TrendingUp, User, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../shared/apiClient.js";
import { BusinessAvatarMenu } from "../shared/BusinessAvatarMenu.js";
import type { MyOnboardingResponse, OnboardingApplication } from "../onboarding/types.js";
import {
  accountDisplayCode,
  formatMinorUnitsAsUsdc,
  readableStatus,
  readableUsePurpose,
  sumMinorUnits,
  type TreasuryAdaAccount
} from "../treasury/formatters.js";

export function WelcomeLandingModule({
  navigate,
  onLogout,
  session
}: {
  navigate: (path: string) => void;
  onLogout: () => Promise<void> | void;
  session: Session | null;
}) {
  const [application, setApplication] = useState<OnboardingApplication | undefined>();
  const [adaAccounts, setAdaAccounts] = useState<TreasuryAdaAccount[]>([]);
  const [adaAccountsLoading, setAdaAccountsLoading] = useState(true);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    const token = session?.access_token;
    if (!token) {
      setAdaAccountsLoading(false);
      return;
    }
    let active = true;
    setAdaAccountsLoading(true);
    apiRequest<MyOnboardingResponse<TreasuryAdaAccount>>("/onboarding/me", { token })
      .then((result) => {
        if (!active) return;
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
  }, [session?.access_token]);

  const email = application?.email ?? session?.user.email ?? "approved-user@gtt.example";
  const terminalId = application?.id ? `8842-${application.id.slice(-6).toUpperCase()}` : "8842-X";
  const totalTreasuryBalance = formatMinorUnitsAsUsdc(sumMinorUnits(adaAccounts, (account) => account.balances?.availableMinorUnits));
  const totalPendingBalance = formatMinorUnitsAsUsdc(sumMinorUnits(adaAccounts, (account) => account.balances?.pendingMinorUnits));
  const activeAccountCount = String(adaAccounts.filter((account) => account.status === "active").length).padStart(2, "0");

  async function logout() {
    setProfileMenuOpen(false);
    await onLogout();
  }

  return (
    <div className="gtt-welcome-shell">
      <aside className="gtt-welcome-sidebar">
        <div className="gtt-welcome-brand">
          <h1>GTT Treasure</h1>
          <p>Terminal ID: {terminalId}</p>
        </div>
        <nav className="gtt-welcome-nav" aria-label="Treasury dashboard navigation">
          <a className="active" href="#"><Building2 size={20} /> Accounts</a>
          <a href="#"><Gavel size={20} /> Trade Ledgers</a>
          <a href="#"><ArrowRight size={20} /> Netting</a>
          <button onClick={() => navigate("/treasury")} type="button"><Wallet size={20} /> Treasury</button>
          <a href="#"><BarChart2 size={20} /> Analytics</a>
        </nav>
        <div className="gtt-welcome-profile">
          <button type="button"><User size={16} /> New Transaction</button>
          <div className="gtt-welcome-profile-menu">
            <button
              aria-expanded={profileMenuOpen}
              aria-haspopup="menu"
              className="gtt-welcome-avatar"
              onClick={() => setProfileMenuOpen((open) => !open)}
              type="button"
            >
              <User size={18} />
            </button>
            <section>
              <strong>{email.split("@")[0]}</strong>
              <span>Chief Treasurer</span>
            </section>
            {profileMenuOpen ? (
              <div className="gtt-welcome-avatar-menu" role="menu">
                <button onClick={() => void logout()} role="menuitem" type="button">Logout</button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>

      <main className="gtt-welcome-main">
        <header className="gtt-welcome-topbar">
          <div>
            <strong>GTT</strong>
            <nav aria-label="Welcome links">
              <a className="active" href="#">Markets</a>
              <a href="#">Insights</a>
              <a href="#">Regulatory</a>
            </nav>
          </div>
          <div className="gtt-welcome-tools">
            <label>
              <Search size={15} />
              <input placeholder="Search Ledgers..." type="search" />
            </label>
            <Bell size={21} />
            <Settings size={21} />
            <BusinessAvatarMenu email={email} onLogout={() => void logout()} />
          </div>
        </header>

        <section className="gtt-welcome-content">
          <section className="gtt-welcome-masthead">
            <span>Dashboard / Overview</span>
            <h2>Welcome back, President.</h2>
            <i />
          </section>

          <section className="gtt-welcome-summary">
            <WelcomeMetric title="Total Treasury Balance" value={totalTreasuryBalance.replace(" USDC", "")} unit="USDC" meta="Live from ADA ledgers" icon={TrendingUp} />
            <WelcomeMetric title="Pending Netting" value={totalPendingBalance.replace(" USDC", "")} unit="USDC" meta="Pending settlement amounts" icon={Clock} />
            <WelcomeMetric title="Active Accounts" value={activeAccountCount} unit="Entities" meta={adaAccounts.length ? "Retrieved from backend" : "No ADA accounts yet"} icon={CheckCircle2} />
          </section>

          <section className="gtt-welcome-grid">
            <div className="gtt-welcome-left">
              <div className="gtt-welcome-section-heading">
                <h3>Accounts of Digital Asset</h3>
                <a href="#">View Ledger Report</a>
              </div>
              <div className="gtt-welcome-table-wrap">
                <table className="gtt-welcome-table">
                  <thead>
                    <tr>
                      <th>Account Name</th>
                      <th>Status</th>
                      <th>Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adaAccountsLoading ? (
                      <tr>
                        <td colSpan={4}>
                          <strong>Loading ADA accounts from backend...</strong>
                        </td>
                      </tr>
                    ) : adaAccounts.length ? adaAccounts.map((account) => (
                      <AccountRow
                        balance={formatMinorUnitsAsUsdc(account.balances?.availableMinorUnits)}
                        code={accountDisplayCode(account)}
                        key={account.id}
                        name={account.accountName}
                        status={readableStatus(account.status)}
                        usePurpose={readableUsePurpose(account.usePurpose)}
                      />
                    )) : (
                      <tr>
                        <td colSpan={4}><strong>No Digital Asset Accounts provisioned yet.</strong></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="gtt-welcome-activity">
                <div className="gtt-welcome-section-heading">
                  <h3>Recent Activity</h3>
                  <button type="button">Filter</button>
                </div>
                <ActivityItem active copy="Your institutional profile has been approved by the compliance board. Full treasury access granted." icon={ShieldCheck} meta="2 Hours Ago" title="Onboarding Completed" />
                <ActivityItem copy="Transfer of 12,500.00 USDC to Operating Account is currently processing." icon={Download} meta="Yesterday, 14:32" title="Deposit Initiated" />
              </div>
            </div>

            <aside className="gtt-welcome-right">
              <section className="gtt-welcome-actions">
                <h4>Quick Actions</h4>
                <button className="primary" type="button"><span>New Transaction</span><ArrowRight size={18} /></button>
                <button type="button"><span>Link Bank Account</span><Building2 size={18} /></button>
                <button type="button"><span>Generate Statement</span><Wallet size={18} /></button>
              </section>

              <section className="gtt-welcome-trust">
                <h4>Institutional Trust</h4>
                <div>
                  <CheckCircle2 size={34} />
                  <section>
                    <strong>Status: Approved</strong>
                    <span>KYC/AML Review: 100%</span>
                  </section>
                </div>
                <p>Compliance profile re-evaluates every 365 days. Next review is scheduled by the operator desk.</p>
              </section>

              <section className="gtt-welcome-outlook">
                <h4>Market Outlook</h4>
                <p>Regulatory frameworks are shifting toward unified digital asset standards. Align netting protocols with current treasury directives.</p>
                <a href="#">Read Whitepaper</a>
              </section>
            </aside>
          </section>
        </section>
      </main>
    </div>
  );
}

function WelcomeMetric({ icon: Icon, meta, title, unit, value }: { icon: typeof TrendingUp; meta: string; title: string; unit: string; value: string }) {
  return (
    <article className="gtt-welcome-metric">
      <span>{title}</span>
      <div>
        <strong>{value} <em>{unit}</em></strong>
        <p><Icon size={15} /> {meta}</p>
      </div>
    </article>
  );
}

function AccountRow({ balance, code, name, status, usePurpose }: { balance: string; code: string; name: string; status: string; usePurpose: string }) {
  return (
    <tr>
      <td><strong>{name}</strong><span>{code} • {usePurpose}</span></td>
      <td><mark>{status}</mark></td>
      <td>{balance}</td>
      <td><button type="button">Deposit</button><button type="button">Withdraw</button></td>
    </tr>
  );
}

function ActivityItem({ active, copy, icon: Icon, meta, title }: { active?: boolean; copy: string; icon: typeof ShieldCheck; meta: string; title: string }) {
  return (
    <article className={`gtt-welcome-activity-item ${active ? "active" : ""}`}>
      <div><Icon size={20} /></div>
      <section>
        <strong>{title}</strong>
        <p>{copy}</p>
        <span>{meta}</span>
      </section>
    </article>
  );
}
