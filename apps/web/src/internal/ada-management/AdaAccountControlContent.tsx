import { CheckCircle2, Printer, Unlock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./ada-account-control-scope.css";

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

interface TrialBalanceLine {
  accountCode?: string;
  accountName?: string;
  totalDebitMinorUnits?: string;
  totalCreditMinorUnits?: string;
  netMinorUnits?: string;
}

interface TrialBalanceReport {
  lines?: TrialBalanceLine[];
  totalDebitMinorUnits?: string;
  totalCreditMinorUnits?: string;
  balanced?: boolean;
  asOf?: string;
  asOfTimestamp?: string;
  generatedAt?: string;
  runTimestamp?: string;
}

interface LiabilityControlReport {
  customerLiabilityMinorUnits?: string;
  adaSubledgerMinorUnits?: string;
  deltaMinorUnits?: string;
  balanced?: boolean;
  asOf?: string;
  asOfTimestamp?: string;
  generatedAt?: string;
  runTimestamp?: string;
}

export const AdaAccountControlContent = ({
  account
}: {
  account: AdaAccount;
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [trialBalance, setTrialBalance] = useState<TrialBalanceReport>({ lines: [] });
  const [liabilityControl, setLiabilityControl] = useState<LiabilityControlReport>({});
  const [asOfTimestamp, setAsOfTimestamp] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([
      apiFetch<TrialBalanceReport>("/treasury-accounting/trial-balance"),
      apiFetch<LiabilityControlReport>("/treasury-accounting/customer-liability-control")
    ])
      .then(([trialPayload, liabilityPayload]) => {
        if (!active) return;
        setTrialBalance({
          lines: trialPayload.lines ?? [],
          totalDebitMinorUnits: trialPayload.totalDebitMinorUnits,
          totalCreditMinorUnits: trialPayload.totalCreditMinorUnits,
          balanced: trialPayload.balanced,
          asOf: trialPayload.asOf,
          asOfTimestamp: trialPayload.asOfTimestamp,
          generatedAt: trialPayload.generatedAt,
          runTimestamp: trialPayload.runTimestamp
        });
        setLiabilityControl({
          ...liabilityPayload
        });
        setAsOfTimestamp(
          firstDefinedTimestamp(
            liabilityPayload.asOf,
            liabilityPayload.asOfTimestamp,
            liabilityPayload.generatedAt,
            liabilityPayload.runTimestamp,
            trialPayload.asOf,
            trialPayload.asOfTimestamp,
            trialPayload.generatedAt,
            trialPayload.runTimestamp
          )
        );
        setLoading(false);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "ada_account_control_load_failed");
        setTrialBalance({ lines: [] });
        setLiabilityControl({});
        setAsOfTimestamp(undefined);
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [account.id]);

  const computed = useMemo(() => {
    const rows = (trialBalance.lines ?? []).slice(0, 12);
    const debitTotal = toBigInt(trialBalance.totalDebitMinorUnits);
    const creditTotal = toBigInt(trialBalance.totalCreditMinorUnits);
    const trialDelta = debitTotal - creditTotal;
    const liabilityCustomer = toBigInt(liabilityControl.customerLiabilityMinorUnits);
    const liabilitySubledger = toBigInt(liabilityControl.adaSubledgerMinorUnits);
    const liabilityDelta = toBigInt(liabilityControl.deltaMinorUnits);
    const trialBalanced = trialBalance.balanced ?? (trialDelta === 0n);
    const liabilityBalanced = liabilityControl.balanced ?? (liabilityDelta === 0n);

    return {
      rows,
      debitTotal,
      creditTotal,
      trialDelta,
      trialBalanced,
      liabilityCustomer,
      liabilitySubledger,
      liabilityDelta,
      liabilityBalanced,
      balanceOk: trialBalanced && liabilityBalanced
    };
  }, [liabilityControl, trialBalance]);

  return (
    <section className="ada-scope ada-account-control-scope">
      <div className="acc-shell">
        <header className="acc-page-header">
          <div>
            <p>Internal Operations</p>
            <h1>Accounting Controls</h1>
          </div>
          <div className="acc-status-stack">
            <p>As of: {formatAsOfTimestamp(asOfTimestamp)}</p>
            <div>
              <span />
              <strong>{computed.balanceOk ? "System Balanced" : "System Imbalanced"}</strong>
            </div>
          </div>
        </header>

        {error ? <div className="ada-management-notice">Unable to load account control data: {error}</div> : null}
        {loading ? <div className="ada-management-notice">Loading account control data...</div> : null}

        {!loading ? (
          <>
            <section className="acc-section">
              <header>
                <h2>Trial Balance</h2>
                <span>USD Equivalent</span>
              </header>

              <div className="acc-summary-grid">
                <article>
                  <p>Total Debit</p>
                  <strong>{formatMinorUnits(computed.debitTotal)}</strong>
                </article>
                <article>
                  <p>Total Credit</p>
                  <strong>{formatMinorUnits(computed.creditTotal)}</strong>
                </article>
                <article className="state-card">
                  <div>
                    <CheckCircle2 size={18} />
                    <p>{computed.trialBalanced ? "Balanced" : "Review Required"}</p>
                  </div>
                  <span>Net difference: {formatMinorUnits(computed.trialDelta)}</span>
                </article>
              </div>

              <div className="acc-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account Code</th>
                      <th>Account Name</th>
                      <th className="right">Net Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.rows.length === 0 ? (
                      <tr>
                        <td colSpan={3}>No trial-balance rows found.</td>
                      </tr>
                    ) : (
                      computed.rows.map((row, index) => {
                        const net = toBigInt(row.netMinorUnits);
                        return (
                          <tr key={`${row.accountCode ?? "acct"}-${index}`}>
                            <td>{row.accountCode ?? `1000-0${index + 1}`}</td>
                            <td>{row.accountName ?? "Journal Account"}</td>
                            <td className={`right ${net < 0n ? "negative" : ""}`}>{formatMinorUnits(net)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="acc-section">
              <header>
                <h2>Customer Liability Control</h2>
                <span>Ledger Reconciliation</span>
              </header>

              <div className="acc-liability-grid">
                <article>
                  <p>Core Subledger Total</p>
                  <strong>{formatMinorUnits(computed.liabilitySubledger)}</strong>
                  <small>Source: account_of_digital_asset_balances</small>
                </article>
                <article>
                  <p>GL Liability Total (2000-10)</p>
                  <strong>{formatMinorUnits(computed.liabilityCustomer)}</strong>
                  <small>Source: treasury_journal_lines</small>
                </article>
                <article className="soft">
                  <p>Delta (Unreconciled)</p>
                  <strong>{formatMinorUnits(computed.liabilityDelta)}</strong>
                  <small>Threshold: $0.00</small>
                </article>
                <article className="state-card">
                  <Unlock size={18} />
                  <p>{computed.liabilityBalanced ? "Subledger Synced" : "Subledger Diverged"}</p>
                  <small>Continuous Audit Active</small>
                </article>
              </div>

              <div className="acc-export-row">
                <button type="button">
                  <Printer size={12} />
                  Export Attestation Report
                </button>
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
  return `${negative ? "(" : ""}$${whole.toLocaleString()}.${fraction.slice(0, 2)}${negative ? ")" : ""}`;
};

const firstDefinedTimestamp = (...candidates: Array<string | undefined>): string | undefined =>
  candidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);

const formatAsOfTimestamp = (timestamp?: string): string => {
  if (!timestamp) return `${new Date().toISOString().replace("T", " ").slice(0, 19)} UTC`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return `${parsed.toISOString().replace("T", " ").slice(0, 19)} UTC`;
};
