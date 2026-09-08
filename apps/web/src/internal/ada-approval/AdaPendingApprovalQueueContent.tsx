import { useEffect, useMemo, useState } from "react";
import "./ada-pending-approval-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type PendingAdaAccount = {
  id: string;
  accountName: string;
  businessClientId: string;
  businessClientName?: string;
  assetCode?: string;
  assetRail?: string;
  status: string;
  usePurpose: string;
  createdAt?: string;
  activationDecision?: string;
  activationReasonCode?: string;
  approvalStatus?: string;
};

type DecisionAction = "approve" | "reject";

type DecisionHistoryItem = {
  action: DecisionAction;
  accountId: string;
  actorRole: string;
  createdAt: string;
  nextStatus: string;
  reasonCode: string;
  reasonNote: string;
};

const defaultReasonCodes: Record<DecisionAction, string[]> = {
  approve: [
    "fiat_link_review_passed",
    "compliance_controls_verified",
    "ops_dual_control_approved"
  ],
  reject: [
    "missing_linked_instrument_evidence",
    "compliance_risk_unresolved",
    "client_information_incomplete"
  ]
};

const normalizeStatus = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, "_");

const statusDisplay = (value: string): string => {
  const normalized = normalizeStatus(value);
  if (normalized === "pending_activation" || normalized === "pending_internal_approval") return "pending_internal_approval";
  return normalized;
};

const formatIso = (value?: string): string => {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`;
};

const apiFetch = async <T,>(
  path: string,
  options: { body?: Record<string, unknown>; method?: "GET" | "POST" } = {}
): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    method: options.method ?? "GET",
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      ...(options.body ? { "content-type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({} as T & { error?: string }));
  if (!response.ok) {
    const message = typeof (payload as { error?: string }).error === "string"
      ? (payload as { error: string }).error
      : `${path}:${response.status}`;
    throw new Error(message);
  }
  return payload as T;
};

export function AdaPendingApprovalQueueContent() {
  const [queue, setQueue] = useState<PendingAdaAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [action, setAction] = useState<DecisionAction>("approve");
  const [reasonCode, setReasonCode] = useState(defaultReasonCodes.approve[0]);
  const [reasonNote, setReasonNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [history, setHistory] = useState<DecisionHistoryItem[]>([]);

  const loadQueue = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await apiFetch<{ accounts?: PendingAdaAccount[] }>("/internal/operations/accounts-of-digital-asset/pending-approval");
      const accounts = (payload.accounts ?? []).map((account) => ({
        ...account,
        status: statusDisplay(account.status)
      }));
      setQueue(accounts);
      if (!selectedId && accounts[0]) {
        setSelectedId(accounts[0].id);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "pending_approval_queue_fetch_failed");
      setQueue([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, []);

  useEffect(() => {
    setReasonCode(defaultReasonCodes[action][0]);
  }, [action]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return queue;
    return queue.filter((account) => {
      const haystack = [
        account.id,
        account.accountName,
        account.businessClientName,
        account.businessClientId,
        account.assetCode,
        account.assetRail,
        account.usePurpose
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [queue, query]);

  const selected = filtered.find((item) => item.id === selectedId) ?? filtered[0];

  const selectedHistory = useMemo(
    () => history.filter((item) => item.accountId === selected?.id),
    [history, selected?.id]
  );

  const canSubmit = Boolean(selected?.id) && reasonCode.trim().length > 0 && reasonNote.trim().length > 0 && !saving;

  async function submitDecision() {
    if (!selected || !canSubmit) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const payload = await apiFetch<{
        account: PendingAdaAccount;
        approvalDecision: "approved" | "rejected";
        reasonCode: string;
        reasonNote: string;
      }>(`/internal/operations/accounts-of-digital-asset/${encodeURIComponent(selected.id)}/${action}`, {
        method: "POST",
        body: {
          reasonCode,
          reasonNote,
          actorRole: "internal_user"
        }
      });

      setHistory((current) => [
        {
          action,
          accountId: selected.id,
          actorRole: "internal_user",
          createdAt: new Date().toISOString(),
          nextStatus: statusDisplay(payload.account.status),
          reasonCode: payload.reasonCode,
          reasonNote: payload.reasonNote
        },
        ...current
      ]);

      let nextQueue: PendingAdaAccount[] = [];
      setQueue((current) => {
        nextQueue = current.filter((item) => item.id !== selected.id);
        return nextQueue;
      });
      setSelectedId((currentSelected) => {
        if (currentSelected !== selected.id) return currentSelected;
        const next = nextQueue[0];
        return next?.id ?? "";
      });
      setReasonNote("");
      setNotice(`${payload.approvalDecision === "approved" ? "Approved" : "Rejected"} ADA ${selected.id}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "approval_decision_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ada-approval-scope">
      <div className="ada-approval-content">
        <header className="ada-approval-heading">
          <div>
            <p className="kicker">INTERNAL OPERATIONS / ADA APPROVAL WORKFLOW</p>
            <h1>Pending ADA Approval Queue</h1>
            <p>Review fiat-linked ADA requests, capture decision reason fields, and maintain local decision evidence.</p>
          </div>
          <button onClick={() => void loadQueue()} type="button">Refresh Queue</button>
        </header>

        <section className="ada-approval-filters">
          <label>
            <span>Search queue</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by ADA ID, client, name"
              type="search"
              value={query}
            />
          </label>
        </section>

        {error ? <p className="ada-approval-error">{error}</p> : null}
        {notice ? <p className="ada-approval-notice">{notice}</p> : null}

        <div className="ada-approval-layout">
          <section className="ada-approval-queue-card">
            <div className="ada-approval-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ADA ID</th>
                    <th>Client</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr><td colSpan={4}>Loading pending approvals...</td></tr> : null}
                  {!loading && filtered.length === 0 ? <tr><td colSpan={4}>No pending approvals found.</td></tr> : null}
                  {!loading && filtered.map((account) => (
                    <tr
                      className={selected?.id === account.id ? "selected" : ""}
                      key={account.id}
                      onClick={() => setSelectedId(account.id)}
                    >
                      <td>
                        <strong>{account.id}</strong>
                        <span>{account.accountName}</span>
                      </td>
                      <td>{account.businessClientName ?? account.businessClientId}</td>
                      <td><span className="status pending">{statusDisplay(account.status).replaceAll("_", " ")}</span></td>
                      <td>{formatIso(account.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ada-approval-decision-card">
            <h2>Decision Panel</h2>
            {!selected ? (
              <p className="empty">Select a queued ADA request to decide.</p>
            ) : (
              <>
                <dl className="summary">
                  <div><dt>ADA</dt><dd>{selected.id}</dd></div>
                  <div><dt>Account Name</dt><dd>{selected.accountName}</dd></div>
                  <div><dt>Client</dt><dd>{selected.businessClientName ?? selected.businessClientId}</dd></div>
                  <div><dt>Asset</dt><dd>{selected.assetCode ?? "USDC"}</dd></div>
                  <div><dt>Rail</dt><dd>{selected.assetRail ?? "n/a"}</dd></div>
                  <div><dt>Policy Code</dt><dd>{selected.activationReasonCode ?? "linked_instrument_requires_internal_approval"}</dd></div>
                </dl>

                <div className="form-grid">
                  <label>
                    <span>Decision</span>
                    <select onChange={(event) => setAction(event.target.value as DecisionAction)} value={action}>
                      <option value="approve">Approve</option>
                      <option value="reject">Reject</option>
                    </select>
                  </label>
                  <label>
                    <span>Reason Code</span>
                    <select onChange={(event) => setReasonCode(event.target.value)} value={reasonCode}>
                      {defaultReasonCodes[action].map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </label>
                  <label className="full">
                    <span>Reason Note</span>
                    <textarea
                      onChange={(event) => setReasonNote(event.target.value)}
                      placeholder="Required decision rationale"
                      rows={4}
                      value={reasonNote}
                    />
                  </label>
                </div>

                <div className="actions">
                  <button disabled={!canSubmit} onClick={() => void submitDecision()} type="button">
                    {saving ? "Submitting..." : action === "approve" ? "Approve ADA" : "Reject ADA"}
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="ada-approval-history-card">
            <h2>Decision History</h2>
            {selectedHistory.length === 0 ? (
              <p className="empty">No decision events recorded yet for selected account.</p>
            ) : (
              <ul>
                {selectedHistory.map((item) => (
                  <li key={`${item.accountId}-${item.createdAt}-${item.action}`}>
                    <strong>{item.action.toUpperCase()}</strong>
                    <p>Status: {item.nextStatus.replaceAll("_", " ")}</p>
                    <p>Reason Code: {item.reasonCode}</p>
                    <p>Reason Note: {item.reasonNote}</p>
                    <small>{formatIso(item.createdAt)} by {item.actorRole}</small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
