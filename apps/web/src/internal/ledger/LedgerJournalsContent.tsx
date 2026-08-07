import {
  Ban,
  Calendar,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Filter,
  Search,
  Undo2,
  X
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import "./ledger-journals-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

interface JournalListItem {
  id: string;
  eventType?: string;
  description?: string;
  correlationId?: string;
  postedAt?: string;
  totalDebitMinorUnits?: string;
  totalCreditMinorUnits?: string;
  reversalOfJournalEntryId?: string;
}

interface JournalLineItem {
  id: string;
  ledgerAccountCode?: string;
  ledgerAccountName?: string;
  accountOfDigitalAssetId?: string;
  assetCode?: string;
  currency?: string;
  debitMinorUnits?: string;
  creditMinorUnits?: string;
}

interface JournalDetailItem {
  id: string;
  eventType?: string;
  description?: string;
  postedAt?: string;
  correlationId?: string;
  idempotencyKey?: string;
  reversalOfJournalEntryId?: string;
  lines?: JournalLineItem[];
}

interface AdaAccountItem {
  id: string;
  accountName?: string;
}

export const LedgerJournalsContent = ({
  journalId,
  navigate
}: {
  journalId?: string;
  navigate: (path: string) => void;
}) => {
  const [journals, setJournals] = useState<JournalListItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");

  const [detail, setDetail] = useState<JournalDetailItem | undefined>();
  const [detailStatus, setDetailStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");
  const [adaAccounts, setAdaAccounts] = useState<AdaAccountItem[]>([]);

  const [reversalModalOpen, setReversalModalOpen] = useState(false);
  const [reversalReason, setReversalReason] = useState("");
  const [reversalDescription, setReversalDescription] = useState("");
  const [reversalConfirmed, setReversalConfirmed] = useState(false);
  const [reversalError, setReversalError] = useState("");
  const [reversing, setReversing] = useState(false);

  const [successOpen, setSuccessOpen] = useState(false);
  const [reversalResult, setReversalResult] = useState<{ originalJournalId: string; reversalJournalId: string } | undefined>();

  useEffect(() => {
    let active = true;
    setStatus("loading");
    setError("");
    apiFetch<{ journals?: JournalListItem[] }>("/ledger/journals")
      .then((payload) => {
        if (!active) return;
        setJournals(payload.journals ?? []);
        setStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "ledger_journals_fetch_failed");
        setStatus("error");
        setJournals([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    apiFetch<{ accounts?: AdaAccountItem[] }>("/accounts-of-digital-asset")
      .then((payload) => {
        if (!active) return;
        setAdaAccounts(payload.accounts ?? []);
      })
      .catch(() => {
        if (!active) return;
        setAdaAccounts([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!journalId) {
      setDetail(undefined);
      setDetailStatus("idle");
      setDetailError("");
      return;
    }
    let active = true;
    setDetailStatus("loading");
    setDetailError("");
    apiFetch<{ journal?: JournalDetailItem }>(`/ledger/journals/${encodeURIComponent(journalId)}`)
      .then((payload) => {
        if (!active) return;
        setDetail(payload.journal);
        setDetailStatus("ready");
      })
      .catch((caught) => {
        if (!active) return;
        setDetail(undefined);
        setDetailStatus("error");
        setDetailError(caught instanceof Error ? caught.message : "ledger_journal_detail_fetch_failed");
      });
    return () => {
      active = false;
    };
  }, [journalId]);

  const summary = useMemo(() => {
    const postedToday = journals.length;
    const pendingReversals = journals.filter((item) => item.reversalOfJournalEntryId).length;
    return {
      postedToday,
      pendingReversals,
      lastSync: new Date().toISOString().slice(11, 19)
    };
  }, [journals]);

  const openReversalModal = () => {
    setReversalReason("");
    setReversalDescription("");
    setReversalConfirmed(false);
    setReversalError("");
    setReversalModalOpen(true);
  };

  const submitReversal = async () => {
    if (!detail?.id) return;
    setReversing(true);
    setReversalError("");
    const idempotencyKey = `ledger-reverse-${crypto.randomUUID()}`;
    const correlationId = `corr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const payload = await apiFetch<{ journal?: { id?: string } }>(
        `/ledger/journals/${encodeURIComponent(detail.id)}/reverse`,
        {
          body: {
            description: `${reversalReason || "Manual reversal"}${reversalDescription ? ` - ${reversalDescription}` : ""}`
          },
          headers: {
            "idempotency-key": idempotencyKey,
            "x-correlation-id": correlationId
          },
          method: "POST"
        }
      );

      const reversalJournalId = payload.journal?.id ?? "unknown";
      setReversalResult({
        originalJournalId: detail.id,
        reversalJournalId
      });
      setReversalModalOpen(false);
      setSuccessOpen(true);

      const refreshed = await apiFetch<{ journals?: JournalListItem[] }>("/ledger/journals");
      setJournals(refreshed.journals ?? []);

      if (journalId) {
        const detailPayload = await apiFetch<{ journal?: JournalDetailItem }>(`/ledger/journals/${encodeURIComponent(journalId)}`);
        setDetail(detailPayload.journal);
      }
    } catch (caught) {
      setReversalError(caught instanceof Error ? caught.message : "journal_reversal_failed");
    } finally {
      setReversing(false);
    }
  };

  const openDetail = (id: string) => {
    navigate(`/internal/operations/ledger/journals/${encodeURIComponent(id)}`);
  };

  const backToList = () => {
    navigate("/internal/operations/ledger/journals");
  };

  return (
    <section className="journal-entry-scope">
      {!journalId ? (
        <div className="journal-entry-list-wrap">
          <header className="journal-entry-list-header">
            <div>
              <h1>Ledger Journals</h1>
              <p>High-density view of journal entries, reversals, and correlated events across the institutional ledger.</p>
            </div>
            <div className="journal-entry-header-actions" role="group" aria-label="Journal list actions">
              <button className="primary" onClick={() => navigate("/internal/operations/ledger/opening-journal")} type="button">Post Journal</button>
              <button type="button"><Download size={15} /> Export CSV</button>
            </div>
          </header>

          <section className="journal-entry-summary-grid">
            <article>
              <span>Total Posted Today</span>
              <strong>{summary.postedToday.toLocaleString()}</strong>
              <small>From direct database journals</small>
            </article>
            <article>
              <span>Reversal Entries</span>
              <strong>{summary.pendingReversals.toLocaleString()}</strong>
              <small>Entries linked by reversal reference</small>
            </article>
            <article className="primary">
              <span>Ledger Sync</span>
              <strong>{summary.lastSync} UTC</strong>
              <small>Last browser refresh</small>
            </article>
          </section>

          <section className="journal-entry-filter-bar">
            <label>
              <Calendar size={14} />
              <input type="date" />
            </label>
            <select>
              <option>All Event Types</option>
            </select>
            <select>
              <option>Status: All</option>
            </select>
            <label className="search">
              <Search size={14} />
              <input placeholder="Search journal ID, correlation ID, description..." type="text" />
            </label>
            <button type="button"><Filter size={14} /> More</button>
          </section>

          {status === "error" ? <div className="journal-entry-error">Unable to load journals: {error}</div> : null}

          <div className="journal-entry-table-wrap">
            <table className="journal-entry-table">
              <thead>
                <tr>
                  <th>Journal Name</th>
                  <th>Event Type</th>
                  <th>Posted At</th>
                  <th>Total Debit</th>
                  <th>Total Credit</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {status === "loading" ? <tr><td colSpan={7}>Loading journals from database...</td></tr> : null}
                {status !== "loading" && journals.length === 0 ? <tr><td colSpan={7}>No journals found.</td></tr> : null}
                {journals.map((journal) => {
                  const isReversal = Boolean(journal.reversalOfJournalEntryId);
                  return (
                    <tr className={isReversal ? "reversal" : ""} key={journal.id} onClick={() => openDetail(journal.id)}>
                      <td>
                        <strong>{displayJournalName(journal)}</strong>
                        <div className="journal-id-hint">
                          <small>ID: {journal.id}</small>
                          <button onClick={(event) => { event.stopPropagation(); void navigator.clipboard?.writeText(journal.id); }} title="Copy Journal ID" type="button"><Copy size={13} /></button>
                        </div>
                      </td>
                      <td>{journal.eventType ?? "Journal"}</td>
                      <td>{formatDateTime(journal.postedAt)}</td>
                      <td className="numeric">{formatMinorToMajor(journal.totalDebitMinorUnits)}</td>
                      <td className="numeric">{formatMinorToMajor(journal.totalCreditMinorUnits)}</td>
                      <td>{isReversal ? <Ban size={14} /> : <span className="dot" />}</td>
                      <td>
                        <div>
                          <button onClick={(event) => { event.stopPropagation(); openDetail(journal.id); }} title="Open" type="button"><ExternalLink size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <footer className="journal-entry-pagination">
            <span>Showing {journals.length} entries</span>
            <div>
              <button disabled type="button"><ChevronLeft size={14} /></button>
              <button type="button">1</button>
              <button disabled type="button"><ChevronRight size={14} /></button>
            </div>
          </footer>
        </div>
      ) : (
        <div className="journal-entry-detail-wrap">
          {detailStatus === "error" ? <div className="journal-entry-error">Unable to load journal detail: {detailError}</div> : null}
          <header>
            <div>
              <button onClick={backToList} type="button">← Back to Journals</button>
              <span>Journal Entry</span>
              <h1>{displayJournalDetailName(detail, journalId)}</h1>
              <p>ID: {detail?.id ?? journalId ?? "-"}</p>
            </div>
            <div className="journal-entry-header-actions" role="group" aria-label="Journal detail actions">
              <button className="primary" onClick={() => navigate("/internal/operations/ledger/opening-journal")} type="button">Post Journal</button>
              <button disabled={!detail?.id} onClick={openReversalModal} type="button"><Undo2 size={14} /> Initiate Reversal</button>
              <button type="button"><Download size={14} /> Export PDF</button>
            </div>
          </header>

          <section className="meta-grid">
            <article><span>Event Type</span><p>{detail?.eventType ?? "-"}</p></article>
            <article><span>Posted At</span><p>{formatDateTime(detail?.postedAt)}</p></article>
            <article><span>Correlation ID</span><p>{detail?.correlationId ?? "-"}</p></article>
            <article><span>Status</span><p>{detail?.reversalOfJournalEntryId ? "Reversal" : "Posted"}</p></article>
          </section>

          <section className="line-table-wrap">
            <div className="line-table-head">
              <span>Ledger Account</span>
              <span>ADA Name</span>
              <span>Asset</span>
              <span>Debit</span>
              <span>Credit</span>
            </div>
            {(detail?.lines ?? []).map((line) => (
              <div className="line-row" key={line.id}>
                <span>{line.ledgerAccountCode} - {line.ledgerAccountName}</span>
                <span>{displayAdaName(line.accountOfDigitalAssetId, adaAccounts)}</span>
                <span>{line.assetCode ?? "USDC"}</span>
                <span className="numeric">{formatMinorToMajor(line.debitMinorUnits)}</span>
                <span className="numeric">{formatMinorToMajor(line.creditMinorUnits)}</span>
              </div>
            ))}
            {detailStatus === "loading" ? <p className="detail-empty">Loading journal lines...</p> : null}
            {detailStatus !== "loading" && (detail?.lines?.length ?? 0) === 0 ? <p className="detail-empty">No journal lines available.</p> : null}
          </section>
        </div>
      )}

      {reversalModalOpen ? (
        <div className="journal-reversal-overlay">
          <div className="journal-reversal-modal">
            <header>
              <h2>Reverse Journal Entry: {detail?.id}</h2>
              <button onClick={() => setReversalModalOpen(false)} type="button"><X size={18} /></button>
            </header>
            <p>This action creates a net-zero reversing entry. Provide a reason and authorization confirmation.</p>
            <label className="reason-field">
              <span>Reversal Reason</span>
              <select onChange={(event) => setReversalReason(event.target.value)} value={reversalReason}>
                <option value="">Select a reason...</option>
                <option value="duplicate">Duplicate Entry</option>
                <option value="mapping">Incorrect Account Mapping</option>
                <option value="amount">Incorrect Amount</option>
                <option value="dispute">Counterparty Dispute</option>
                <option value="error">Operational Error</option>
              </select>
            </label>
            <label>
              <span>Detailed Justification</span>
              <textarea onChange={(event) => setReversalDescription(event.target.value)} rows={16} value={reversalDescription} />
            </label>
            <label className="confirm">
              <input checked={reversalConfirmed} onChange={(event) => setReversalConfirmed(event.target.checked)} type="checkbox" />
              <span><Check size={14} /> I confirm this reversal is authorized under accounting policy.</span>
            </label>
            {reversalError ? <div className="journal-entry-error">{reversalError}</div> : null}
            <footer>
              <button onClick={() => setReversalModalOpen(false)} type="button">Cancel</button>
              <button className="primary" disabled={!reversalConfirmed || !reversalReason || reversing} onClick={() => void submitReversal()} type="button">
                {reversing ? "Authorizing..." : "Authorize & Reverse"}
              </button>
            </footer>
          </div>
        </div>
      ) : null}

      {successOpen && reversalResult ? (
        <div className="journal-reversal-success-overlay" onClick={() => setSuccessOpen(false)}>
          <aside className="journal-reversal-success" onClick={(event) => event.stopPropagation()}>
            <header>
              <div><CheckCircle2 size={16} /> Reversal Successful</div>
              <button onClick={() => setSuccessOpen(false)} type="button"><X size={16} /></button>
            </header>
            <main>
              <p>
                A net-zero reversing entry has been posted for <code>{reversalResult.originalJournalId}</code>.
              </p>
              <section>
                <h3>Traceability Ledger</h3>
                <div><span>Original Journal</span><code>{reversalResult.originalJournalId}</code></div>
                <div><span>Reversing Journal</span><code>{reversalResult.reversalJournalId}</code></div>
              </section>
            </main>
            <footer>
              <button className="primary" onClick={() => {
                setSuccessOpen(false);
                openDetail(reversalResult.reversalJournalId);
              }} type="button">View Reversing Entry</button>
              <button onClick={() => {
                setSuccessOpen(false);
                backToList();
              }} type="button">Return to Registry</button>
            </footer>
          </aside>
        </div>
      ) : null}
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

const formatMinorToMajor = (value?: string): string => {
  if (!value) return "0.00";
  try {
    const minor = BigInt(value);
    const negative = minor < 0n;
    const abs = negative ? -minor : minor;
    const whole = abs / 1_000_000n;
    const fraction = (abs % 1_000_000n).toString().padStart(6, "0");
    return `${negative ? "-" : ""}${whole.toLocaleString()}.${fraction}`;
  } catch {
    return value;
  }
};

const formatDateTime = (value?: string): string => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} UTC`;
};

const displayJournalName = (journal: JournalListItem): string => {
  const name = journal.description?.trim();
  if (name) return name;
  return journal.eventType ? `${journal.eventType} Journal` : "Journal Entry";
};

const displayJournalDetailName = (journal: JournalDetailItem | undefined, fallbackId?: string): string => {
  const name = journal?.description?.trim();
  if (name) return name;
  if (journal?.eventType) return `${journal.eventType} Journal`;
  if (fallbackId) return `Journal Entry ${fallbackId}`;
  return "Journal Entry";
};

const displayAdaName = (adaId: string | undefined, adaAccounts: AdaAccountItem[]): string => {
  if (!adaId) return "-";
  const account = adaAccounts.find((item) => item.id === adaId);
  return account?.accountName?.trim() || adaId;
};
