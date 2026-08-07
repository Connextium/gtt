import { ArrowLeft, Copy, Download, Filter, Info, LineChart, Receipt } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./ada-statement-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

interface AdaAccount {
  id: string;
  accountName: string;
  businessClientId: string;
  businessClientName?: string;
  status: string;
  assetCode?: string;
  assetRail?: string;
}

interface BalanceProjectionItem {
  accountId: string;
  assetCode: string;
  currency: string;
  availableMinorUnits: string;
  pendingMinorUnits: string;
  reservedMinorUnits: string;
  lockedMinorUnits: string;
  suspenseMinorUnits: string;
  version: number;
  updatedAt?: string;
}

interface StatementJournal {
  journalEntryId: string;
  description?: string;
  accountingEventType?: string;
  correlationId?: string;
  idempotencyKey?: string;
  postedAt?: string;
  accountCode?: string;
  accountName?: string;
  debitMinorUnits?: string;
  creditMinorUnits?: string;
}

interface AuditEvent {
  eventType: string;
  correlationId?: string;
  idempotencyKey?: string;
  createdAt?: string;
}

export const AdaStatementContent = ({
  account,
  onBack
}: {
  account: AdaAccount;
  onBack: () => void;
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [balances, setBalances] = useState<BalanceProjectionItem[]>([]);
  const [journals, setJournals] = useState<StatementJournal[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      apiFetch<{ balances?: BalanceProjectionItem[] }>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/balances`).catch(() => ({ balances: [] })),
      apiFetch<{ journals?: StatementJournal[] }>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/statements`).catch(() => ({ journals: [] })),
      apiFetch<{ auditEvents?: AuditEvent[] }>("/audit-log").catch(() => ({ auditEvents: [] }))
    ])
      .then(([balancesPayload, statementsPayload, auditPayload]) => {
        if (!active) return;
        setBalances(balancesPayload.balances ?? []);
        setJournals(statementsPayload.journals ?? []);
        setAudit(auditPayload.auditEvents ?? []);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "ada_statement_load_failed");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [account.id]);

  const projection = balances[0];
  const available = toBigInt(projection?.availableMinorUnits);
  const pending = toBigInt(projection?.pendingMinorUnits);
  const reserved = toBigInt(projection?.reservedMinorUnits);
  const locked = toBigInt(projection?.lockedMinorUnits);
  const suspense = toBigInt(projection?.suspenseMinorUnits);

  const forecast = useMemo(() => {
    return {
      immediate: available,
      t1: available + pending,
      t3: available + pending - reserved
    };
  }, [available, pending, reserved]);

  const statementRows = useMemo(() => {
    const ordered = [...journals].sort((a, b) => {
      const aTs = a.postedAt ? Date.parse(a.postedAt) : 0;
      const bTs = b.postedAt ? Date.parse(b.postedAt) : 0;
      return bTs - aTs;
    });
    let running = available;
    return ordered.map((row) => {
      const debit = toBigInt(row.debitMinorUnits);
      const credit = toBigInt(row.creditMinorUnits);
      running = running - credit + debit;
      return {
        ...row,
        debit,
        credit,
        balance: running
      };
    });
  }, [journals, available]);

  const latestJournal = journals[0];
  const latestAudit = audit.find((item) => item.correlationId === latestJournal?.correlationId) ?? audit[0];

  return (
    <section className="ada-scope ada-statement-v2">
      <div className="ast1-shell">
        <header className="ast1-header">
          <div className="ast1-heading">
            <h1>{account.businessClientName ?? account.businessClientId}</h1>
            <p>{account.accountName}</p>
          </div>
          <div className="ast1-header-actions">
            <span className="ast1-status">{account.status}</span>
            <span className="ast1-ada-id">
              ADA ID: {displayAdaCode(account.id)}
              <button
                onClick={() => void navigator.clipboard?.writeText(displayAdaCode(account.id))}
                title="Copy ADA ID"
                type="button"
              >
                <Copy size={12} />
              </button>
            </span>
            <button onClick={onBack} type="button"><ArrowLeft size={13} /> Back</button>
            <button type="button"><Download size={13} /> Export</button>
          </div>
        </header>

        <section className="ast1-meta-row">
          <article>
            <span>Asset</span>
            <strong>{account.assetCode ?? projection?.assetCode ?? "USDC"}</strong>
          </article>
          <article>
            <span>Rail</span>
            <strong>{formatRailLabel(account.assetRail)}</strong>
          </article>
          <article>
            <span>Classification</span>
            <strong>Tier 1 Capital</strong>
          </article>
        </section>

        {error ? <div className="ada-management-notice">Unable to load ADA statement module: {error}</div> : null}
        {loading ? <div className="ada-management-notice">Loading ADA statement, liquidity projection, and audit trace...</div> : null}

        {!loading ? (
          <>
            <section className="ast1-balance-grid">
              <article className="ast1-available">
                <div className="ast1-label">Available Balance <Info size={12} /></div>
                <div className="ast1-big-amount">{formatMinorUnitsDetailed(available)}</div>
              </article>
              <article>
                <div className="ast1-label">Pending</div>
                <div className="ast1-mid-amount">{formatMinorUnitsDetailed(pending)}</div>
              </article>
              <article>
                <div className="ast1-label">Reserved</div>
                <div className="ast1-mid-amount">{formatMinorUnitsDetailed(reserved)}</div>
              </article>
              <article className="ast1-flat-row"><span>Locked</span><strong>{formatMinorUnits(locked)}</strong></article>
              <article className="ast1-flat-row ast1-suspense"><span>Suspense</span><strong>{formatMinorUnits(suspense)}</strong></article>
            </section>

            <section className="ast1-forecast-panel">
              <header>
                <h2><LineChart size={14} /> Liquidity Forecast</h2>
                <span>Last Updated: {formatDateTime(projection?.updatedAt)}</span>
              </header>
              <div className="ast1-forecast-grid">
                <article>
                  <span className="ast1-label">Immediate (T+0)</span>
                  <strong>{formatMinorUnitsDetailed(forecast.immediate)}</strong>
                  <div className="ast1-drivers">
                    <h4>Primary Drivers</h4>
                    <ul>
                      <li><span>Intraday Sweeps</span><b>{formatMinorUnits(0n)}</b></li>
                      <li><span>Real-time Rails</span><b>{formatMinorUnits(0n)}</b></li>
                    </ul>
                  </div>
                  <small>High / Reconciled</small>
                </article>
                <article>
                  <span className="ast1-label">Settlement (T+1)</span>
                  <strong>{formatMinorUnitsDetailed(forecast.t1)}</strong>
                  <div className="ast1-drivers">
                    <h4>Primary Drivers</h4>
                    <ul>
                      <li><span>Inbound Wires</span><b>{formatMinorUnits(pending)}</b></li>
                      <li><span>Netting Settlement</span><b>{formatMinorUnits(0n)}</b></li>
                    </ul>
                  </div>
                  <small>High / Reconciled</small>
                </article>
                <article>
                  <span className="ast1-label">Netting (T+3)</span>
                  <strong>{formatMinorUnitsDetailed(forecast.t3)}</strong>
                  <div className="ast1-drivers">
                    <h4>Primary Drivers</h4>
                    <ul>
                      <li><span>Factoring Advances</span><b>{formatMinorUnits(-reserved)}</b></li>
                      <li><span>Redemption Queue</span><b>{formatMinorUnits(0n)}</b></li>
                    </ul>
                  </div>
                  <small>Medium / Projected</small>
                </article>
              </div>
            </section>

            <section className="ast1-main-grid">
              <div className="ast1-ledger-panel">
                <header>
                  <h3>Statement Ledger</h3>
                  <div>
                    <button type="button"><Filter size={12} /> Filter</button>
                    <button type="button"><Download size={12} /> Export</button>
                  </div>
                </header>
                <div className="ast1-table-wrap">
                  <table className="ast1-table">
                    <thead>
                      <tr>
                        <th>Posted At</th>
                        <th>Journal ID</th>
                        <th>Event Type</th>
                        <th className="right">Debit</th>
                        <th className="right">Credit</th>
                        <th className="right">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementRows.length === 0 ? <tr><td colSpan={6}>No statement entries found.</td></tr> : null}
                      {statementRows.slice(0, 12).map((row) => (
                        <tr key={`${row.journalEntryId}-${row.accountCode}-${row.postedAt}`}>
                          <td>{formatShortDateTime(row.postedAt)}</td>
                          <td className="mono-link" title={row.journalEntryId}>{displayJournalCode(row.journalEntryId)}</td>
                          <td><span className="ast1-chip">{displayEventType(row.accountingEventType)}</span></td>
                          <td className="right">{row.debit === 0n ? "-" : formatMinorUnits(row.debit)}</td>
                          <td className="right">{row.credit === 0n ? "-" : formatMinorUnits(row.credit)}</td>
                          <td className="right strong">{formatMinorUnits(row.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <footer>
                  <button type="button">Load More Entries</button>
                </footer>
              </div>

              <aside className="ast1-audit-panel">
                <h4>Audit Trace</h4>
                <div>
                  <label>Latest Correlation ID</label>
                  <code>{latestJournal?.correlationId ?? latestAudit?.correlationId ?? "Unavailable"}</code>
                </div>
                <div>
                  <label>Idempotency Key</label>
                  <code>{latestJournal?.idempotencyKey ?? latestAudit?.idempotencyKey ?? "Unavailable"}</code>
                </div>
                <div>
                  <label>Ledger Sequence</label>
                  <code>{latestJournal?.journalEntryId ?? "Unavailable"}</code>
                </div>
                <button className="primary" type="button"><Receipt size={12} /> View Full Audit Log</button>
              </aside>
            </section>
          </>
        ) : null}
      </div>
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  } = {}
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      "content-type": "application/json",
      "x-gtt-api-key": gttApiKey,
      ...options.headers
    },
    method: options.method ?? "GET"
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string" ? payload.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};

const toBigInt = (value?: string): bigint => {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
};

const formatMinorUnits = (value: bigint): string => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}$${whole.toLocaleString()}.${fraction.slice(0, 2)}`;
};

const formatMinorUnitsDetailed = (value: bigint): string => {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 1_000_000n;
  const fraction = (abs % 1_000_000n).toString().padStart(6, "0");
  return `${negative ? "-" : ""}$${whole.toLocaleString()}.${fraction}`;
};

const formatDateTime = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
};

const formatShortDateTime = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hh = `${date.getUTCHours()}`.padStart(2, "0");
  const mm = `${date.getUTCMinutes()}`.padStart(2, "0");
  return `${month} ${day}, ${hh}:${mm}`;
};

const displayAdaCode = (accountId: string): string =>
  accountId.toUpperCase().startsWith("ADA") ? accountId : `ADA-${accountId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;

const displayJournalCode = (journalEntryId: string): string => {
  if (!journalEntryId) return "-";
  const compact = journalEntryId.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return `JNL-${compact.slice(-8)}`;
};

const displayEventType = (eventType?: string): string => {
  if (!eventType) return "Journal";
  if (eventType.includes("settlement")) return "Settlement";
  if (eventType.includes("fee")) return "Fee";
  if (eventType.includes("transfer")) return "Transfer";
  return "Journal";
};

const formatRailLabel = (rail?: string): string => {
  if (!rail) return "Circle Arc";
  return rail
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (segment) => segment.toUpperCase());
};
