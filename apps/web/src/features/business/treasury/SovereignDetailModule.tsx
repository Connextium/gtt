import { ArrowLeft, ArrowRight, Building2, Circle, Download, Filter, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { apiRequest } from "../shared/apiClient.js";
import {
  accountDisplayCode,
  formatMinorUnitsAsUsdc,
  readableStatus,
  readableUsePurpose,
  type TreasuryAdaAccount
} from "./formatters.js";

interface AdaBalanceApi {
  availableMinorUnits?: string;
  pendingMinorUnits?: string;
  reservedMinorUnits?: string;
  lockedMinorUnits?: string;
  suspenseMinorUnits?: string;
}

interface AdaStatementJournalApi {
  journalEntryId: string;
  description?: string;
  accountingEventType?: string;
  postedAt?: string;
  accountCode?: string;
  accountName?: string;
  assetCode?: string;
  currency?: string;
  debitMinorUnits?: string;
  creditMinorUnits?: string;
}

export function SovereignDetailModule({
  account,
  onBack,
  token
}: {
  account?: TreasuryAdaAccount;
  onBack: () => void;
  token: string;
}) {
  const [liveBalance, setLiveBalance] = useState<AdaBalanceApi | undefined>();
  const [journals, setJournals] = useState<AdaStatementJournalApi[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const accountCode = account ? accountDisplayCode(account) : "ADA-UNAVAILABLE";
  const assetCode = account?.assetCode ?? "USDC";
  const railLabel = account?.assetRail ? readableUsePurpose(account.assetRail) : "Default Rail";
  const balance = liveBalance ?? account?.balances;
  const available = formatMinorUnitsAsUsdc(balance?.availableMinorUnits);
  const pending = formatMinorUnitsAsUsdc(balance?.pendingMinorUnits);
  const locked = formatMinorUnitsAsUsdc(balance?.lockedMinorUnits);
  const reserved = formatMinorUnitsAsUsdc(balance?.reservedMinorUnits);
  const suspense = formatMinorUnitsAsUsdc(balance?.suspenseMinorUnits);

  useEffect(() => {
    if (!account?.id || !token) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setLiveBalance(undefined);
    setJournals([]);
    Promise.all([
      apiRequest<{ balances?: AdaBalanceApi[] }>(`/business/me/accounts-of-digital-asset/${encodeURIComponent(account.id)}/balances`, { token }),
      apiRequest<{ journals?: AdaStatementJournalApi[] }>(`/business/me/accounts-of-digital-asset/${encodeURIComponent(account.id)}/statements`, { token })
    ])
      .then(([balanceResponse, statementResponse]) => {
        if (!active) return;
        setLiveBalance(balanceResponse.balances?.[0]);
        setJournals(statementResponse.journals ?? []);
      })
      .catch((caught) => {
        if (!active) return;
        setLoadError(caught instanceof Error ? caught.message : "ada_detail_load_failed");
        setLiveBalance(undefined);
        setJournals([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [account?.id, token]);

  return (
    <div className="gtt-sovereign-page">
      <div className="gtt-sovereign-breadcrumb">
        <button onClick={onBack} type="button"><ArrowLeft size={15} /> Accounts</button>
        <span>/</span>
        <span>Digital Asset Account {accountCode}</span>
      </div>

      <section className="gtt-sovereign-detail-hero">
        <div>
          <h1>{account?.accountName ?? "Digital Asset Account"}</h1>
          <p>A business-owned digital asset account managed under the Global Trade Treasury framework. This ledger reflects the selected ADA balance state and routing profile.</p>
          <dl>
            <div><dt>Account Code</dt><dd>{accountCode}</dd></div>
            <div><dt>Purpose</dt><dd>{account ? readableUsePurpose(account.usePurpose) : "Unavailable"}</dd></div>
            <div><dt>Base Asset</dt><dd>{assetCode}</dd></div>
          </dl>
        </div>
        <aside>
          <span>Available Liquidity</span>
          <strong>{withoutAssetUnit(available)}</strong>
          <dl>
            <div><dt>Status</dt><dd>{account ? readableStatus(account.status) : "Unavailable"}</dd></div>
            <div><dt>Pending</dt><dd>{pending}</dd></div>
            <div><dt>Reserved</dt><dd>{reserved}</dd></div>
            <div><dt>Locked</dt><dd>{locked}</dd></div>
            <div><dt>Suspense</dt><dd>{suspense}</dd></div>
          </dl>
        </aside>
      </section>

      <section className="gtt-sovereign-detail-grid">
        <aside>
          <header><h2>Linked Accounts</h2><button type="button">Link New</button></header>
          <SovereignLinkedAccount icon="bank" label="ADA Route" name={railLabel} identifier={account?.id ?? "Unavailable"} status={account ? readableStatus(account.status) : "Unavailable"} />
          <SovereignLinkedAccount icon="circle" label="Asset Rail" name={`${assetCode} Settlement`} identifier={accountCode} status="Primary Ledger" />
        </aside>

        <section>
          <header>
            <h2>Internal Ledger Activity</h2>
            <div><button type="button"><Filter size={18} /></button><button type="button"><Download size={18} /></button></div>
          </header>
          {loadError ? <div className="gtt-sovereign-detail-notice">Unable to load ADA ledger activity: {loadError}</div> : null}
          <table>
            <thead><tr><th>Date</th><th>Counterparty / Description</th><th>Type</th><th>Amount (USDC)</th></tr></thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4}>
                    <span className="gtt-sovereign-ledger-loading"><Loader2 className="spin" size={14} /> Loading ledger activity from database...</span>
                  </td>
                </tr>
              ) : null}
              {!loading && journals.length === 0 ? <tr><td colSpan={4}>No internal ledger activity found for this ADA.</td></tr> : null}
              {!loading && journals.map((journal) => (
                <SovereignActivityRow
                  amount={formatJournalAmount(journal)}
                  date={formatActivityDate(journal.postedAt)}
                  detail={`${journal.accountCode ?? "Ledger"}${journal.journalEntryId ? ` / ${journal.journalEntryId.slice(0, 8)}` : ""}`}
                  key={`${journal.journalEntryId}-${journal.accountCode}-${journal.debitMinorUnits}-${journal.creditMinorUnits}`}
                  name={journal.description ?? journal.accountingEventType ?? journal.accountName ?? "ADA ledger movement"}
                  type={journalType(journal)}
                />
              ))}
            </tbody>
          </table>
        </section>
      </section>
    </div>
  );
}

function SovereignLinkedAccount({ icon, label, name, identifier, status }: { icon: "bank" | "circle"; label: string; name: string; identifier: string; status: string }) {
  const Icon = icon === "bank" ? Building2 : Circle;
  return (
    <article className="gtt-sovereign-linked-account">
      <header><Icon size={23} /><span>{label}</span></header>
      <h3>{name}</h3>
      <p>{identifier}</p>
      <footer><span>{status}</span><ArrowRight size={15} /></footer>
    </article>
  );
}

function SovereignActivityRow({ amount, date, detail, name, type }: { amount: string; date: string; detail: string; name: string; type: string }) {
  return (
    <tr>
      <td>{date}</td>
      <td><strong>{name}</strong><span>{detail}</span></td>
      <td><mark>{type}</mark></td>
      <td>{amount}</td>
    </tr>
  );
}

const withoutAssetUnit = (value: string): string => value.replace(/\s[A-Z0-9]+$/, "");

const formatActivityDate = (value: string | undefined): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
};

const journalType = (journal: AdaStatementJournalApi): string =>
  Number(journal.creditMinorUnits ?? "0") > 0 ? "Credit" : "Debit";

const formatJournalAmount = (journal: AdaStatementJournalApi): string => {
  const credit = Number(journal.creditMinorUnits ?? "0");
  const debit = Number(journal.debitMinorUnits ?? "0");
  const value = credit > 0 ? credit : debit;
  const sign = credit > 0 ? "+" : "-";
  return `${sign} ${formatMinorUnitsAsUsdc(String(value))}`;
};
