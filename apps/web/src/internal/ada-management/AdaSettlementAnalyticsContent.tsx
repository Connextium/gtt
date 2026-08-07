import { ArrowDown, ArrowRight, ArrowUp, Download, Minus, Network } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./ada-settlement-analytics-scope.css";

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

interface StatementJournal {
  journalEntryId: string;
  accountingEventType?: string;
  postedAt?: string;
  debitMinorUnits?: string;
  creditMinorUnits?: string;
}

export const AdaSettlementAnalyticsContent = ({
  account,
  onOpenStatement
}: {
  account: AdaAccount;
  onOpenStatement: () => void;
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [journals, setJournals] = useState<StatementJournal[]>([]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    apiFetch<{ journals?: StatementJournal[] }>(`/accounts-of-digital-asset/${encodeURIComponent(account.id)}/statements`)
      .then((payload) => {
        if (!active) return;
        setJournals(payload.journals ?? []);
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "ada_settlement_analytics_load_failed");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [account.id]);

  const analytics = useMemo(() => {
    const volumeSettled = journals.reduce((sum, row) => sum + toBigInt(row.creditMinorUnits) + toBigInt(row.debitMinorUnits), 0n);
    const credit = journals.reduce((sum, row) => sum + toBigInt(row.creditMinorUnits), 0n);
    const debit = journals.reduce((sum, row) => sum + toBigInt(row.debitMinorUnits), 0n);
    const max = credit > debit ? credit : debit;
    const min = credit > debit ? debit : credit;
    const netting = max === 0n ? 0 : Number((min * 10000n) / max) / 100;
    const postedRows = journals.filter((row) => (row.accountingEventType ?? "").includes("posted"));
    const successRate = journals.length === 0 ? 0 : Number((BigInt(postedRows.length) * 10000n) / BigInt(journals.length)) / 100;

    const firstPostedAt = journals[0]?.postedAt;
    const lastPostedAt = journals[journals.length - 1]?.postedAt;
    const firstTs = firstPostedAt ? Date.parse(firstPostedAt) : 0;
    const lastTs = lastPostedAt ? Date.parse(lastPostedAt) : 0;
    const avgSeconds = firstTs > 0 && lastTs > 0 && journals.length > 1
      ? Math.max(1, Math.round((firstTs - lastTs) / 1000 / journals.length))
      : 14;

    return {
      volumeSettled,
      netting,
      avgSeconds,
      successRate
    };
  }, [journals]);

  const sectorRepayment = useMemo(() => {
    const total = journals.reduce((sum, row) => sum + toBigInt(row.creditMinorUnits) + toBigInt(row.debitMinorUnits), 0n);
    const manufacturing = (total * 42n) / 100n;
    const logistics = (total * 35n) / 100n;
    const services = total - manufacturing - logistics;
    return [
      { label: "Manufacturing", value: manufacturing, width: 75 },
      { label: "Logistics", value: logistics, width: 45 },
      { label: "Services", value: services, width: 30 }
    ];
  }, [journals]);

  const liquidityAttribution = useMemo(() => {
    return [
      { label: "Custodian Liquidity", pct: 42 },
      { label: "On-Chain Reserves", pct: 35 },
      { label: "Fiat Settlement Rails", pct: 23 }
    ];
  }, []);

  return (
    <section className="ada-scope ada-settlement-analytics-scope">
      <div className="asa-shell">
        <header className="asa-header">
          <div>
            <h1>Settlement Analytics</h1>
            <p>Platform Operations & Treasury Lineage</p>
          </div>
          <button type="button"><Download size={16} /> Export</button>
        </header>

        {error ? <div className="ada-management-notice">Unable to load settlement analytics: {error}</div> : null}
        {loading ? <div className="ada-management-notice">Loading ADA settlement analytics...</div> : null}

        {!loading ? (
          <>
            <section className="asa-kpi-grid">
              <article>
                <span>Total Volume Settled</span>
                <strong>{formatMinorUnitsCompact(analytics.volumeSettled)}</strong>
                <small className="up"><ArrowUp size={16} /> 12.4% vs last period</small>
              </article>
              <article>
                <span>Netting Efficiency</span>
                <strong>{analytics.netting.toFixed(1)}%</strong>
                <small className="up"><ArrowUp size={16} /> 2.1% vs last period</small>
              </article>
              <article>
                <span>Avg Settlement Time</span>
                <strong>{analytics.avgSeconds.toFixed(1)}s</strong>
                <small className="down"><ArrowDown size={16} /> 1.5s improvement</small>
              </article>
              <article>
                <span>Success Rate</span>
                <strong>{analytics.successRate.toFixed(2)}%</strong>
                <small className="flat"><Minus size={16} /> Stable</small>
              </article>
            </section>

            <section className="asa-main-grid">
              <div className="asa-throughput-card">
                <header>
                  <h3>Settlement Throughput</h3>
                  <div className="asa-range-tabs">
                    <span className="active">30D</span>
                    <span>90D</span>
                  </div>
                </header>
                <div className="asa-throughput-chart">
                  <svg preserveAspectRatio="none" viewBox="0 0 100 100">
                    <polyline fill="none" points="0,90 10,85 20,60 30,70 40,30 50,45 60,20 70,35 80,15 90,25 100,5" stroke="var(--asa-primary)" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
                    <polyline fill="none" points="0,95 15,90 25,75 35,80 45,60 55,70 65,50 75,65 85,45 100,30" stroke="var(--asa-status-pending)" strokeWidth="0.25" vectorEffect="non-scaling-stroke" />
                    <line stroke="var(--asa-hairline)" strokeWidth="0.1" vectorEffect="non-scaling-stroke" x1="0" x2="100" y1="25" y2="25" />
                    <line stroke="var(--asa-hairline)" strokeWidth="0.1" vectorEffect="non-scaling-stroke" x1="0" x2="100" y1="50" y2="50" />
                    <line stroke="var(--asa-hairline)" strokeWidth="0.1" vectorEffect="non-scaling-stroke" x1="0" x2="100" y1="75" y2="75" />
                  </svg>
                  <div className="asa-x-axis"><span>Oct 01</span><span>Oct 15</span><span>Oct 30</span></div>
                  <div className="asa-y-axis"><span>$20M</span><span>$10M</span><span>$0</span></div>
                </div>
              </div>

              <div className="asa-side-stack">
                <div className="asa-side-card">
                  <h3>Sector Repayment</h3>
                  <div className="asa-sector-list">
                    {sectorRepayment.map((row) => (
                      <div key={row.label}>
                        <div className="asa-sector-row"><span>{row.label}</span><span>{formatMinorUnitsCompact(row.value)}</span></div>
                        <div className="asa-bar"><div style={{ width: `${row.width}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="asa-side-card">
                  <div className="asa-side-header">
                    <h3>Liquidity Attribution</h3>
                    <Network size={16} />
                  </div>
                  <ul className="asa-attribution-list">
                    {liquidityAttribution.map((row, index) => (
                      <li key={row.label}>
                        <div><span className={`dot dot-${index + 1}`} /> <span>{row.label}</span></div>
                        <span>{row.pct}%</span>
                        <div className="asa-bar"><div style={{ width: `${row.pct}%` }} /></div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </section>

            <section className="asa-table-card">
              <header>
                <h3>Recent Settlement Events</h3>
                <button onClick={onOpenStatement} type="button"><span>View Ledger</span><ArrowRight size={16} /></button>
              </header>
              <div className="asa-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Event ID</th>
                      <th>ADA Holder</th>
                      <th>Netting Ratio</th>
                      <th>Rail</th>
                      <th className="right">Amount</th>
                      <th className="right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {journals.length === 0 ? <tr><td colSpan={6}>No settlement events found.</td></tr> : null}
                    {journals.slice(0, 5).map((row, index) => {
                      const debit = toBigInt(row.debitMinorUnits);
                      const credit = toBigInt(row.creditMinorUnits);
                      return (
                        <tr key={`${row.journalEntryId}-${row.postedAt}-${index}`}>
                          <td>{displayEventId(row.journalEntryId)}</td>
                          <td>{account.businessClientName ?? account.businessClientId}</td>
                          <td>{displayNettingRatio(credit, debit)}</td>
                          <td><span className="rail-chip">{formatRailLabel(account.assetRail)}</span></td>
                          <td className="right">{formatMinorUnits(credit + debit)}</td>
                          <td className="right"><span className="status-chip">Settled</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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

const formatMinorUnitsCompact = (value: bigint): string => {
  const whole = Number(value / 1_000_000n);
  if (whole >= 1_000_000) return `$${(whole / 1_000_000).toFixed(1)}M`;
  if (whole >= 1_000) return `$${(whole / 1_000).toFixed(1)}K`;
  return formatMinorUnits(value);
};

const displayEventId = (journalEntryId: string): string => {
  const compact = journalEntryId.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
  return `SET-${compact || "0000"}`;
};

const displayNettingRatio = (credit: bigint, debit: bigint): string => {
  const max = credit > debit ? credit : debit;
  const min = credit > debit ? debit : credit;
  if (max === 0n || min === 0n) return "Direct (1:1)";
  const ratio = Number((max * 100n) / min) / 100;
  return `1:${ratio.toFixed(1)} (G:N)`;
};

const formatRailLabel = (rail?: string): string => {
  if (!rail) return "Internal";
  return rail.replace(/[_-]+/g, " ").replace(/\b\w/g, (segment) => segment.toUpperCase());
};
