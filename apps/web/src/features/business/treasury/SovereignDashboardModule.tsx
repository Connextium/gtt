import { CheckCircle2, Factory, FileText, Loader2, MoreHorizontal, PlusSquare, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  accountDisplayCode,
  formatMinorUnitsAsUsd,
  readableStatus,
  readableUsePurpose,
  sumMinorUnits,
  type TreasuryAdaAccount
} from "./formatters.js";

export function SovereignDashboardModule({
  adaAccounts,
  adaAccountsLoading,
  onOpenDetail
}: {
  adaAccounts: TreasuryAdaAccount[];
  adaAccountsLoading: boolean;
  onOpenDetail: (accountId: string) => void;
}) {
  const totalAvailable = formatMinorUnitsAsUsd(sumMinorUnits(adaAccounts, (account) => account.balances?.availableMinorUnits));
  return (
    <div className="gtt-sovereign-page">
      <section className="gtt-sovereign-hero">
        <div>
          <h1 className="gtt-sovereign-dashboard-title">Managing Digital Asset Accounts</h1>
          <p>Unified liquidity management for high-velocity trade ecosystems. Managing Digital Asset Accounts with bank-grade finality and regulatory transparency.</p>
        </div>
        <aside>
          <span>Total Ecosystem Value</span>
          <strong>{totalAvailable}</strong>
          <small><i /> Real-time sync active</small>
        </aside>
      </section>

      <section className="gtt-sovereign-section-head">
        <div>
          <h2>Digital Asset Accounts</h2>
          <p>Liquidity sub-ledgers partitioned by role and purpose.</p>
        </div>
        <button type="button">View All DAAs</button>
      </section>

      <section className="gtt-sovereign-daa-grid">
        {adaAccountsLoading ? (
          <article aria-live="polite" className="gtt-sovereign-daa-card empty loading">
            <Loader2 aria-hidden="true" className="spin" size={36} />
            <h3>Loading Digital Asset Accounts</h3>
          </article>
        ) : adaAccounts.length ? adaAccounts.map((account, index) => {
          const isPrimary = index === 0;
          const cardClassName = isPrimary ? "gtt-sovereign-daa-card primary" : "gtt-sovereign-daa-card";
          const Icon = isPrimary ? ShieldCheck : Factory;

          return (
            <button
              className={cardClassName}
              key={account.id}
              onClick={() => onOpenDetail(account.id)}
              type="button"
            >
              <header>
                <div>
                  <mark>{readableUsePurpose(account.usePurpose)}</mark>
                  <h3>{account.accountName}</h3>
                  <code>{accountDisplayCode(account)}-{(account.assetCode ?? "USDC").toUpperCase()}</code>
                </div>
                <Icon size={24} />
              </header>
              <dl>
                <div><dt>Available</dt><dd>{formatMinorUnitsAsUsd(account.balances?.availableMinorUnits)}</dd></div>
                <div><dt>Pending</dt><dd>{formatMinorUnitsAsUsd(account.balances?.pendingMinorUnits)}</dd></div>
                <div><dt>Locked</dt><dd>{formatMinorUnitsAsUsd(account.balances?.lockedMinorUnits)}</dd></div>
              </dl>
              <footer><span><i /></span><div><em>Status</em><b>{readableStatus(account.status)}</b></div></footer>
            </button>
          );
        }) : (
          <article className="gtt-sovereign-daa-card empty">
            <PlusSquare size={38} />
            <h3>No ADA Accounts</h3>
            <p>No digital asset accounts were returned from backend for this business user.</p>
          </article>
        )}
      </section>

      <section className="gtt-sovereign-ledger">
        <header>
          <div><RefreshCcw size={18} /><h2>Netting Ledger: Real-Time Timeline</h2></div>
          <code>REF: TX-NET-88421990</code>
        </header>
        <div>
          <table>
            <thead><tr><th>Timestamp</th><th>Invoice ID</th><th>Entity</th><th>Amount</th><th>Lifecycle Status</th><th>Action</th></tr></thead>
            <tbody>
              <SovereignLedgerRow amount="$1,200,000.00" entity="TechFab Shenzhen" invoice="#INV-882-B" status="Settled" time="14:02:11" />
              <SovereignLedgerRow amount="$450,000.00" entity="Global Logistics" invoice="#INV-901-X" status="Factored" time="14:05:44" />
              <SovereignLedgerRow amount="$2,890,000.00" entity="Apex Components" invoice="#INV-922-P" status="Reconciling" time="14:12:01" />
              <SovereignLedgerRow amount="$98,000.00" entity="Silicon Ventures" invoice="#INV-940-L" status="Settled" time="14:15:30" />
            </tbody>
          </table>
        </div>
      </section>

      <section className="gtt-sovereign-insights">
        <article>
          <h3>Treasury Velocity</h3>
          <strong>4.2x <span>Turnover Index</span></strong>
          <p>Capital efficiency has increased by 12% following automated netting cycles.</p>
        </article>
        <article>
          <h3>Regulatory Compliance</h3>
          <div><span>A+</span><p><b>Tier 1 Capital Ratio</b><small>Exceeding Basel III requirements</small></p></div>
          <footer><i /><i /><i /><i /><i /></footer>
        </article>
      </section>
    </div>
  );
}

function SovereignLedgerRow({ amount, entity, invoice, status, time }: { amount: string; entity: string; invoice: string; status: string; time: string }) {
  return (
    <tr>
      <td>{time}</td>
      <td>{invoice}</td>
      <td>{entity}</td>
      <td>{amount}</td>
      <td><span>{status}</span>{status === "Settled" ? <CheckCircle2 size={15} /> : status === "Factored" ? <RefreshCcw size={14} /> : <MoreHorizontal size={15} />}</td>
      <td><button type="button"><FileText size={17} /></button></td>
    </tr>
  );
}
