import { ArrowRight, Building2, CheckCircle2, Clock, Download, FileText, Loader2, ShieldCheck, TrendingUp } from "lucide-react";
import {
  accountDisplayCode,
  formatMinorUnitsAsUsd,
  formatMinorUnitsAsUsdc,
  readableStatus,
  readableUsePurpose,
  sumMinorUnits,
  type TreasuryAdaAccount
} from "./formatters.js";

export function SovereignAccountsModule({
  adaAccounts,
  adaAccountsLoading,
  onOpenDetail
}: {
  adaAccounts: TreasuryAdaAccount[];
  adaAccountsLoading: boolean;
  onOpenDetail: (accountId: string) => void;
}) {
  const totalAvailable = formatMinorUnitsAsUsd(sumMinorUnits(adaAccounts, (account) => account.balances?.availableMinorUnits));
  const totalPending = formatMinorUnitsAsUsdc(sumMinorUnits(adaAccounts, (account) => account.balances?.pendingMinorUnits));
  const activeAccountCount = String(adaAccounts.filter((account) => account.status === "active").length).padStart(2, "0");

  return (
    <section className="gtt-welcome-content">
      <section className="gtt-welcome-masthead">
        <span>Dashboard / Overview</span>
        <h2>Welcome back, President.</h2>
        <i />
      </section>

      <section className="gtt-welcome-summary">
        <WelcomeMetric title="Total Treasury Balance" value={totalAvailable.replace("$", "")} unit="USD" meta="Live from ADA ledgers" icon={TrendingUp} />
        <WelcomeMetric title="Pending Netting" value={totalPending.replace(" USDC", "")} unit="USDC" meta="Pending settlement amounts" icon={Clock} />
        <WelcomeMetric title="Active Accounts" value={activeAccountCount} unit="Entities" meta={adaAccounts.length ? "Retrieved from backend" : "No ADA accounts yet"} icon={CheckCircle2} />
      </section>

      <section className="gtt-welcome-grid">
        <div className="gtt-welcome-left">
          <div className="gtt-welcome-section-heading">
            <h3>Accounts of Digital Asset</h3>
            <button disabled={!adaAccounts[0]} onClick={() => adaAccounts[0] && onOpenDetail(adaAccounts[0].id)} type="button">View Ledger Report</button>
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
                      <strong><Loader2 className="spin" size={14} /> Loading ADA accounts from backend...</strong>
                    </td>
                  </tr>
                ) : adaAccounts.length ? adaAccounts.map((account) => (
                  <AccountRow
                    balance={formatMinorUnitsAsUsdc(account.balances?.availableMinorUnits)}
                    code={accountDisplayCode(account)}
                    key={account.id}
                    name={account.accountName}
                    onOpen={() => onOpenDetail(account.id)}
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
            <button type="button"><span>Generate Statement</span><FileText size={18} /></button>
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

function AccountRow({
  balance,
  code,
  name,
  onOpen,
  status,
  usePurpose
}: {
  balance: string;
  code: string;
  name: string;
  onOpen: () => void;
  status: string;
  usePurpose: string;
}) {
  return (
    <tr>
      <td><strong>{name}</strong><span>{code} • {usePurpose}</span></td>
      <td><mark>{status}</mark></td>
      <td>{balance}</td>
      <td><button onClick={onOpen} type="button">View</button><button type="button">Deposit</button><button type="button">Withdraw</button></td>
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
