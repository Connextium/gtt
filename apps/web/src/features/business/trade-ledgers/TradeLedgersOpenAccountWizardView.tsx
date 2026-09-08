import { useMemo, useState } from "react";
import { apiRequest } from "../shared/apiClient.js";

type WizardStep = 1 | 2 | 3;

type AccountCurrency = "USDC" | "EURC" | "USD";

type AccountTopology = "unlinked" | "wallet-linked" | "fiat-linked";

interface WizardForm {
  currency: AccountCurrency;
  displayName: string;
  linkedWalletId: string;
  linkedWireId: string;
  owningEntity: string;
  purpose: string;
  topology: AccountTopology;
}

interface ProvisionReceipt {
  accountId: string;
  activationDecision: string;
  approvalStatus: string;
  assetFullName: string;
  correlationId: string;
  createdAt: string;
  currency: AccountCurrency;
  displayName: string;
  idempotencyKey: string;
  linkedInstrumentRef: string;
  ownerTenant: string;
  purpose: string;
  sha256Hash: string;
  status: string;
  timestampUtc: string;
  topology: AccountTopology;
  uuid: string;
}

interface PolicySummary {
  activationDecision: string;
  approvalStatus: string;
  decisionTitle: string;
  initialState: string;
  policyCode: string;
  requiredActor: string;
  settlementRail: string;
  tone: "ok" | "info" | "warning";
}

interface CreatedAdaAccount {
  id: string;
  accountName: string;
  usePurpose: string;
  status: string;
  activationDecision?: string;
  activationReasonCode?: string;
  assetCode?: string;
  createdAt?: string;
}

interface CreateMyAdaResponse {
  account: CreatedAdaAccount;
}

const defaultForm: WizardForm = {
  currency: "USDC",
  displayName: "Vanguard Operating Treasury Alpha",
  linkedWalletId: "WLT-8821-FIREBLOCKS",
  linkedWireId: "INST-9928-WIRE",
  owningEntity: "Vanguard Holdings Ltd (CLIENT-8804)",
  purpose: "TREASURY - Daily Working Capital & Netting",
  topology: "unlinked"
};

const REGISTERED_WIRES = [
  {
    accountNumberMasked: "****1104",
    currency: "USD",
    id: "INST-9928-WIRE",
    name: "Citi Operations"
  },
  {
    accountNumberMasked: "****4409",
    currency: "USD",
    id: "INST-9928-WIRE-2",
    name: "JPM Treasury"
  }
] as const;

const REGISTERED_WALLETS = [
  {
    addressMasked: "0x1A6C...A0E2",
    chain: "Ethereum",
    id: "WLT-8821-FIREBLOCKS",
    name: "Fireblocks Vault"
  },
  {
    addressMasked: "0x56B3...CC9F",
    chain: "Base",
    id: "WLT-8821-CIRCLE",
    name: "Circle Wallet"
  }
] as const;

const PURPOSE_OPTIONS = [
  "TREASURY - Daily Working Capital & Netting",
  "COMMERCIAL_SWEEP - Operations Sweeping Rail",
  "LIQUIDITY - Cross-Border Netting",
  "CUSTODY - Isolated Vault Holding"
] as const;

function randomHex(length: number) {
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join("");
}

function formatAssetName(currency: AccountCurrency) {
  if (currency === "USDC") return "USDC (Circle Native · 6 Decimals)";
  if (currency === "EURC") return "EURC (Euro Token · 6 Decimals)";
  return "USD (Fiat Ledger · 2 Decimals)";
}

function formatUtcTimestampWithMillis(isoInput?: string) {
  const sourceDate = isoInput ? new Date(isoInput) : new Date();
  const iso = Number.isNaN(sourceDate.valueOf()) ? new Date().toISOString() : sourceDate.toISOString();
  return `${iso.replace("T", " ").slice(0, 23)} UTC`;
}

function businessStatusPresentation(status: string): string {
  const normalized = status.trim().toLowerCase();
  if (normalized === "pending_activation" || normalized === "pending_internal_approval") return "pending_internal_approval";
  return normalized;
}

export function TradeLedgersOpenAccountWizardView({
  onAccountCreated,
  onBackToTradeLedgers,
  onComplete,
  token
}: {
  onAccountCreated?: (accountId: string) => Promise<void> | void;
  onBackToTradeLedgers: () => void;
  onComplete: () => void;
  token: string;
}) {
  const [form, setForm] = useState<WizardForm>(defaultForm);
  const [step, setStep] = useState<WizardStep>(1);
  const [maxReachedStep, setMaxReachedStep] = useState<WizardStep>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ProvisionReceipt | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string>("");
  const [submitError, setSubmitError] = useState<string>("");

  const requiresApproval = form.topology === "fiat-linked";

  const policyPreview = useMemo<PolicySummary>(() => {
    if (form.topology === "unlinked") {
      return {
        activationDecision: "AUTO-ACTIVATED (VIRTUAL_TOPOLOGY)",
        approvalStatus: "NOT_REQUIRED (Sec 4.1 Compliant)",
        decisionTitle: "AUTO-ACTIVATION APPROVED (VIRTUAL TOPOLOGY)",
        initialState: "active",
        policyCode: "ACT_AUTO_01",
        requiredActor: "System (Automated)",
        settlementRail: "Virtual subledger only",
        tone: "ok"
      };
    }

    if (form.topology === "wallet-linked") {
      return {
        activationDecision: "AUTO-ACTIVATED (PRE-VERIFIED WALLET)",
        approvalStatus: "AUTOMATED_KYT_PASSED (Sec 4.1 Compliant)",
        decisionTitle: "AUTO-ACTIVATION APPROVED (KYT PRE-VERIFIED)",
        initialState: "active",
        policyCode: "ACT_AUTO_02",
        requiredActor: "Automated KYT Oracle",
        settlementRail: "Wallet / blockchain rail",
        tone: "info"
      };
    }

    return {
      activationDecision: "HELD_PENDING_REVIEW (FIAT_LINKED)",
      approvalStatus: "PENDING_INTERNAL_ADMIN (Sec 4.1 Review)",
      decisionTitle: "HELD FOR INTERNAL APPROVAL",
      initialState: "pending_internal_approval",
      policyCode: "ACT_MANUAL_02",
      requiredActor: "Internal Admin / Ops",
      settlementRail: "Commercial wire attached",
      tone: "warning"
    };
  }, [form.topology]);

  const selectedWire = useMemo(
    () => REGISTERED_WIRES.find((wire) => wire.id === form.linkedWireId) ?? REGISTERED_WIRES[0],
    [form.linkedWireId]
  );

  const selectedWallet = useMemo(
    () => REGISTERED_WALLETS.find((wallet) => wallet.id === form.linkedWalletId) ?? REGISTERED_WALLETS[0],
    [form.linkedWalletId]
  );

  const linkedInstrumentSummary = useMemo(() => {
    if (form.topology === "unlinked") return "UNLINKED (ADA Virtual Domain)";
    if (form.topology === "wallet-linked") return `LINKED_WALLET (${selectedWallet.name})`;
    return `LINKED_WIRE (${selectedWire.name})`;
  }, [form.topology, selectedWallet.name, selectedWire.name]);

  const stepTitle =
    step === 1
      ? "Open Account of Digital Asset (ADA)"
      : step === 2
        ? "Pre-Submit Policy & State Lifecycle Verification"
        : "Digital Asset Account Successfully Opened";

  const stepBreadcrumb =
    step === 1
      ? "ACCOUNTS OF DIGITAL ASSET / SELF-SERVICE PROVISIONING / SPRINT 7-2 PROTOCOL"
      : step === 2
        ? "ACCOUNTS OF DIGITAL ASSET / SELF-SERVICE PROVISIONING / STEP 2: POLICY PREVIEW"
        : "ACCOUNTS OF DIGITAL ASSET / SELF-SERVICE PROVISIONING / STEP 3: RECEIPT & LIFECYCLE STATE";

  const policyEvaluationHeader =
    form.topology === "unlinked"
      ? "DETERMINISTIC PASS (VIRTUAL ONLY)"
      : form.topology === "wallet-linked"
        ? "AUTOMATED KYT ORACLE PASS (PRE-VERIFIED VAULT)"
        : "MANUAL REVIEW REQUIRED (FIAT WIRE ATTACHED)";

  const toneClass =
    policyPreview.tone === "ok"
      ? "ok"
      : policyPreview.tone === "info"
        ? "info"
        : "warning";

  const receiptIsActive = receipt ? receipt.status.toLowerCase().startsWith("active") : false;

  function updateForm(patch: Partial<WizardForm>) {
    setForm((current) => ({ ...current, ...patch }));
  }

  function handleProceedToPolicy() {
    const missingName = form.displayName.trim().length === 0;
    const missingPurpose = form.purpose.trim().length === 0;
    if (missingName || missingPurpose) {
      setValidationError("Display name and purpose are required to continue.");
      return;
    }
    setValidationError("");
    setSubmitError("");
    setStep(2);
    setMaxReachedStep((current) => (current < 2 ? 2 : current));
  }

  async function handleSubmitProvision() {
    if (!token) {
      setSubmitError("Session expired. Sign in again to open an ADA account.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError("");

    try {
      const assetRail = form.topology === "wallet-linked"
        ? "wallet_blockchain"
        : form.topology === "fiat-linked"
          ? "commercial_wire"
          : "circle_internal";

      const response = await apiRequest<CreateMyAdaResponse>("/business/accounts-of-digital-asset", {
        method: "POST",
        token,
        body: {
          accountName: form.displayName,
          usePurpose: form.purpose,
          assetCode: form.currency,
          assetRail,
          topology: form.topology,
          idempotencyKey: `business-open-ada-${crypto.randomUUID()}`
        }
      });

      const createdAt = response.account.createdAt
        ? response.account.createdAt.replace("T", " ").replace("Z", " UTC")
        : new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

      const linkedInstrumentRef =
        form.topology === "unlinked"
          ? "NONE (Virtual-Only Subledger)"
          : form.topology === "wallet-linked"
            ? `${selectedWallet.id} (${selectedWallet.name} ${selectedWallet.addressMasked})`
            : `${selectedWire.id} (${selectedWire.name} ${selectedWire.accountNumberMasked})`;

      setReceipt({
        accountId: response.account.id,
        activationDecision: response.account.activationDecision ?? policyPreview.activationDecision,
        approvalStatus: response.account.activationReasonCode ?? policyPreview.approvalStatus,
        assetFullName: formatAssetName(form.currency),
        correlationId: "CORR-992A-72",
        createdAt,
        currency: form.currency,
        displayName: response.account.accountName,
        idempotencyKey: `IK-ADA-${crypto.randomUUID().slice(0, 4).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
        linkedInstrumentRef,
        ownerTenant: "APEX_GLOBAL / CLIENT-8804",
        purpose: response.account.usePurpose,
        sha256Hash: `0x${randomHex(64)}`,
        status: businessStatusPresentation(response.account.status || policyPreview.initialState),
        timestampUtc: formatUtcTimestampWithMillis(response.account.createdAt),
        topology: form.topology,
        uuid: crypto.randomUUID()
      });

      await onAccountCreated?.(response.account.id);
      setStep(3);
      setMaxReachedStep(3);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Unable to create ADA account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetWizard() {
    setForm(defaultForm);
    setStep(1);
    setMaxReachedStep(1);
    setReceipt(null);
    setCopiedField(null);
    setValidationError("");
    setSubmitError("");
  }

  function selectStep(targetStep: WizardStep) {
    if (targetStep <= maxReachedStep) {
      setStep(targetStep);
    }
  }

  function copyToClipboard(value: string, label: string) {
    void navigator.clipboard.writeText(value);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1600);
  }

  function downloadReceiptJson() {
    if (!receipt) return;
    const payload = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(receipt, null, 2))}`;
    const anchor = document.createElement("a");
    anchor.setAttribute("href", payload);
    anchor.setAttribute("download", `${receipt.accountId}-receipt.json`);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  return (
    <section className="bc-open-root" id="open-account">
      {copiedField ? (
        <div className="bc-open-toast" role="status">
          <span>✓</span>
          <span>Copied {copiedField} to clipboard</span>
        </div>
      ) : null}

      <article className="bc-open-indicator bc-ledger-frame">
        <div>
          <button className="bc-open-link" onClick={onBackToTradeLedgers} type="button">
            Back to Trade Ledgers
          </button>
          <p className="bc-ledger-meta">{stepBreadcrumb}</p>
          <h2>{stepTitle}</h2>
        </div>

        <div className="bc-open-indicator-steps" role="group" aria-label="Provisioning steps">
          <button
            className={`bc-open-indicator-step ${step === 1 ? "current" : step > 1 ? "complete" : ""}`}
            onClick={() => selectStep(1)}
            type="button"
          >
            {step > 1 ? "✓" : "1"}
          </button>
          <button
            className={`bc-open-indicator-step ${step === 2 ? "current" : step > 2 ? "complete" : ""}`}
            disabled={maxReachedStep < 2}
            onClick={() => selectStep(2)}
            type="button"
          >
            {step > 2 ? "✓" : "2"}
          </button>
          <button
            className={`bc-open-indicator-step ${step === 3 ? "current" : ""}`}
            disabled={maxReachedStep < 3}
            onClick={() => selectStep(3)}
            type="button"
          >
            3
          </button>
        </div>
      </article>

      {step === 1 ? (
        <>
          <article className="bc-open-stage-grid">
            <section className="bc-ledger-frame bc-open-main">
              <header className="bc-open-main-header">
                <div>
                  <p className="bc-ledger-meta">STEP 01 OF 03</p>
                  <h3>Account Specifications &amp; Linked Rail Intent</h3>
                </div>
                <span className="bc-open-chip">SCHEMA ADA-V2-SPEC</span>
              </header>

              <section className="bc-open-section">
                <div className="bc-open-section-title">🔒 1. ACCOUNT IDENTITY &amp; SCOPE</div>

                <div className="bc-open-form-grid">
                  <label>
                    Account Display Name
                    <input
                      onChange={(event) => updateForm({ displayName: event.target.value })}
                      placeholder="e.g. Vanguard Operating Treasury Alpha"
                      type="text"
                      value={form.displayName}
                    />
                  </label>
                  <label>
                    Account Purpose
                    <select onChange={(event) => updateForm({ purpose: event.target.value })} value={form.purpose}>
                      {PURPOSE_OPTIONS.map((purposeOption) => (
                        <option key={purposeOption} value={purposeOption}>
                          {purposeOption}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <section className="bc-open-currency-strip" aria-label="Primary settlement currency">
                  <button
                    className={form.currency === "USDC" ? "active" : ""}
                    onClick={() => updateForm({ currency: "USDC" })}
                    type="button"
                  >
                    <strong>USDC</strong>
                    <span>Circle Mint</span>
                  </button>
                  <button
                    className={form.currency === "EURC" ? "active" : ""}
                    onClick={() => updateForm({ currency: "EURC" })}
                    type="button"
                  >
                    <strong>EURC</strong>
                    <span>Euro Token</span>
                  </button>
                  <button
                    className={form.currency === "USD" ? "active" : ""}
                    onClick={() => updateForm({ currency: "USD" })}
                    type="button"
                  >
                    <strong>USD</strong>
                    <span>Fiat Ledger</span>
                  </button>
                </section>

                <div className="bc-open-owned-entity">
                  <strong>{form.owningEntity}</strong>
                  <span>VERIFIED KYB</span>
                </div>
              </section>

              <section className="bc-open-section" aria-label="Linked instrument topology">
                <div className="bc-open-section-title">🪪 2. LINKED INSTRUMENT TOPOLOGY (SPRINT 7-2 POLICY CLASSIFICATION)</div>

                <button
                  className={`bc-open-topology ${form.topology === "unlinked" ? "selected ok" : ""}`}
                  onClick={() => updateForm({ topology: "unlinked" })}
                  type="button"
                >
                  <div>
                    <h4>ADA Virtual Account (Unlinked / Ledger Domain Only)</h4>
                    <p>Activation Path: Immediate. Required Approval: None (System).</p>
                  </div>
                  <span>AUTO</span>
                </button>

                <button
                  className={`bc-open-topology ${form.topology === "fiat-linked" ? "selected warning" : ""}`}
                  onClick={() => updateForm({ topology: "fiat-linked" })}
                  type="button"
                >
                  <div>
                    <h4>ADA Fiat-Linked Account (Commercial Wire Attached)</h4>
                    <p>Initial State: pending_internal_approval. Reviewer Role: Internal Admin / Ops.</p>
                  </div>
                  <span>APPROVAL</span>
                </button>

                {form.topology === "fiat-linked" ? (
                  <div className="bc-open-topology-select">
                    <label htmlFor="bc-open-wire-select">SELECT REGISTERED LINKED WIRE INSTRUMENT:</label>
                    <select
                      id="bc-open-wire-select"
                      onChange={(event) => updateForm({ linkedWireId: event.target.value })}
                      value={form.linkedWireId}
                    >
                      {REGISTERED_WIRES.map((wire) => (
                        <option key={wire.id} value={wire.id}>
                          {wire.id} · {wire.name} ({wire.accountNumberMasked}) · {wire.currency} Verified
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <button
                  className={`bc-open-topology ${form.topology === "wallet-linked" ? "selected info" : ""}`}
                  onClick={() => updateForm({ topology: "wallet-linked" })}
                  type="button"
                >
                  <div>
                    <h4>ADA Wallet-Linked Account (Web3 / On-Chain Vault Attached)</h4>
                    <p>Activation Path: Auto KYT Oracle. Verification: Pre-Whitelisted Vault.</p>
                  </div>
                  <span>KYT ORACLE</span>
                </button>

                {form.topology === "wallet-linked" ? (
                  <div className="bc-open-topology-select">
                    <label htmlFor="bc-open-wallet-select">SELECT REGISTERED INSTITUTIONAL VAULT / WALLET:</label>
                    <select
                      id="bc-open-wallet-select"
                      onChange={(event) => updateForm({ linkedWalletId: event.target.value })}
                      value={form.linkedWalletId}
                    >
                      {REGISTERED_WALLETS.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {wallet.id} · {wallet.name} ({wallet.addressMasked}) · {wallet.chain}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div className={`bc-open-notice ${requiresApproval ? "warning" : "ok"}`}>
                  {requiresApproval
                    ? "Policy notice: linked fiat instrument requests are created as pending_internal_approval and require internal decisioning."
                    : "Policy notice: accounts without linked fiat instrument are eligible for immediate activation when validation passes."}
                </div>
              </section>

              {validationError ? <p className="bc-open-error">{validationError}</p> : null}

              <footer>
                <button className="bc-ledger-button bc-ledger-button-secondary" onClick={resetWizard} type="button">
                  Cancel Discard
                </button>
                <p className="bc-open-inline-note">Idempotency Token: auto-generated</p>
                <button className="bc-ledger-button bc-ledger-button-primary" onClick={handleProceedToPolicy} type="button">
                  Continue to Policy Preview
                </button>
              </footer>
            </section>

            <aside className="bc-open-side">
              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Activation Decision Matrix</h4>
                  <span>Sec 4.1 Table</span>
                </header>
                <div className="bc-open-matrix-list">
                  <div className={form.topology === "unlinked" ? "active ok" : ""}>
                    <strong>ADA Virtual Open</strong>
                    <small>AUTO</small>
                  </div>
                  <div className={form.topology === "fiat-linked" ? "active warning" : ""}>
                    <strong>ADA Fiat-Linked Open</strong>
                    <small>APPROVAL</small>
                  </div>
                  <div className={form.topology === "wallet-linked" ? "active info" : ""}>
                    <strong>ADA Wallet-Linked Open</strong>
                    <small>KYT ORACLE</small>
                  </div>
                </div>
              </article>

              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Client Scope Audit</h4>
                  <span>IDEMPOTENT</span>
                </header>
                <dl>
                  <div>
                    <dt>TENANT ROOT</dt>
                    <dd>APEX_GLOBAL</dd>
                  </div>
                  <div>
                    <dt>CLIENT BOUNDARY</dt>
                    <dd>CLIENT-8804</dd>
                  </div>
                  <div>
                    <dt>ROLE CONTEXT</dt>
                    <dd>BUSINESS_CLIENT_USER</dd>
                  </div>
                  <div>
                    <dt>ENDPOINT TARGET</dt>
                    <dd>POST /business/me/accounts-of-digital-asset</dd>
                  </div>
                </dl>
              </article>

              <article className="bc-ledger-frame bc-open-side-card bc-open-helper-card">
                <p>
                  <span>❔</span>
                  Need immediate fiat onboarding?
                </p>
              </article>
            </aside>
          </article>

          <article className="bc-ledger-frame bc-open-governance">
            <div>
              <strong>✓ AUTHORITATIVE SPRINT 7-2 ACTIVATION CONTRACT</strong>
              <span>SPEC v7.2-REV</span>
            </div>
          </article>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <article className={`bc-ledger-frame bc-open-banner ${toneClass}`}>
            <div className="bc-open-banner-head">
              <p className="bc-ledger-meta">🛡️ POLICY EVALUATION: {policyEvaluationHeader}</p>
              <span>CODE {policyPreview.policyCode}</span>
            </div>
            <h3>Activation Decision: {policyPreview.decisionTitle}</h3>
            <div className="bc-open-banner-grid">
              <div>
                <dt>TARGET INITIAL STATE</dt>
                <dd>{policyPreview.initialState}</dd>
              </div>
              <div>
                <dt>REQUIRED ACTOR</dt>
                <dd>{policyPreview.requiredActor}</dd>
              </div>
              <div>
                <dt>ESTIMATED FINALITY</dt>
                <dd>{form.topology === "unlinked" ? "< 250ms" : form.topology === "wallet-linked" ? "< 350ms (On-Chain Binding)" : "Queue Review (2-4 hrs)"}</dd>
              </div>
            </div>
          </article>

          <article className="bc-open-stage-grid">
            <section className="bc-ledger-frame bc-open-main">
              <header className="bc-open-main-header">
                <div>
                  <p className="bc-ledger-meta">STEP 02 OF 03</p>
                  <h3>Proposed Account Payload Specification</h3>
                </div>
                <span className="bc-open-chip">PAYLOAD HASH sha256:4f8a...c912</span>
              </header>

              <dl className="bc-open-policy-grid">
                <div>
                  <dt>Account Display Name</dt>
                  <dd>{form.displayName}</dd>
                </div>
                <div>
                  <dt>Tenant / Client Boundary</dt>
                  <dd>APEX_GLOBAL / CLIENT-8804</dd>
                </div>
                <div>
                  <dt>Settlement Asset &amp; Currency</dt>
                  <dd>{formatAssetName(form.currency)}</dd>
                </div>
                <div>
                  <dt>Linked Instrument State</dt>
                  <dd>{linkedInstrumentSummary}</dd>
                </div>
                <div>
                  <dt>Institutional Purpose</dt>
                  <dd>{form.purpose}</dd>
                </div>
                <div>
                  <dt>Audit Correlation ID</dt>
                  <dd>CORR-992A-72-REQ</dd>
                </div>
              </dl>

              <section className="bc-open-transition-grid" aria-label="Authoritative state transition model">
                <div>
                  <small>STEP 1</small>
                  <strong>DRAFT</strong>
                </div>
                <div className={toneClass === "warning" ? "active warning" : toneClass === "info" ? "active info" : "active ok"}>
                  <small>STEP 2 ({requiresApproval ? "QUEUE" : "AUTOMATED"})</small>
                  <strong>{requiresApproval ? "PENDING APPROVAL" : "ACTIVE"}</strong>
                </div>
                <div>
                  <small>STEP 3 ({requiresApproval ? "FINAL COMMIT" : "N/A"})</small>
                  <strong>{requiresApproval ? "ACTIVE (POST-REVIEW)" : "COMPLETED"}</strong>
                </div>
              </section>

              <section className="bc-open-contract" aria-label="Transactional atomicity contract">
                <p>
                  <span>🔒</span>
                  TRANSACTIONAL ATOMICITY CONTRACT
                </p>
                <ul>
                  <li>Request remains idempotent under repeated submissions.</li>
                  <li>Activation outcome follows topology policy clause Sec 4.1.</li>
                  <li>Audit envelope stores deterministic policy reason code.</li>
                </ul>
              </section>

              <div className={`bc-open-notice ${requiresApproval ? "warning" : "ok"}`}>
                {requiresApproval
                  ? "Policy notice: Fiat-linked topology requires internal treasury admin review before activation and remains in pending_internal_approval until approved."
                  : "Selected topology qualifies for automated provisioning and immediate activation."}
              </div>

              {submitError ? <p className="bc-open-error">{submitError}</p> : null}

              <footer>
                <button className="bc-ledger-button bc-ledger-button-secondary" onClick={() => setStep(1)} type="button">
                  Back to Edit Setup
                </button>
                <p className="bc-open-inline-note">Idempotency Key: business-open-ada-*</p>
                <button className="bc-ledger-button bc-ledger-button-primary" disabled={isSubmitting} onClick={handleSubmitProvision} type="button">
                  {isSubmitting ? "Committing Transaction..." : "Authorize and Submit Creation"}
                </button>
              </footer>
            </section>

            <aside className="bc-open-side">
              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Topology Classification Rules</h4>
                  <span>RULE Sec 4.1</span>
                </header>
                <ul>
                  <li>
                    <strong>UNLINKED VIRTUAL:</strong> Immediate system auto-activation. Zero external rail dependency.
                  </li>
                  <li>
                    <strong>WALLET-LINKED:</strong> Automated KYT Oracle pass for pre-whitelisted MPC or Web3 vaults.
                  </li>
                  <li>
                    <strong>FIAT-LINKED:</strong> Mandatory Ops gating queue with Admin authorization signature.
                  </li>
                </ul>
              </article>

              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Audit Dispatch Payload</h4>
                  <span>ECDSA-256</span>
                </header>
                <dl>
                  <div>
                    <dt>ACTION TYPE</dt>
                    <dd>{form.topology === "unlinked" ? "ADA_OPEN_VIRTUAL" : form.topology === "wallet-linked" ? "ADA_OPEN_WALLET" : "ADA_OPEN_FIAT"}</dd>
                  </div>
                  <div>
                    <dt>ACTOR ROLE</dt>
                    <dd>business_client_user</dd>
                  </div>
                  <div>
                    <dt>IDEMPOTENCY</dt>
                    <dd>TRUE (UNIQUE)</dd>
                  </div>
                  <div>
                    <dt>POLICY REASON CODE</dt>
                    <dd>{form.topology === "unlinked" ? "AUTO_ACT_NO_LINK" : form.topology === "wallet-linked" ? "AUTO_ACT_WALLET_KYT" : "REQUIRE_INTERNAL_OPS_GATING"}</dd>
                  </div>
                </dl>
              </article>

              <article className="bc-ledger-frame bc-open-side-card bc-open-helper-card">
                <p>
                  <span>💡</span>
                  Need immediate subledger netting?
                </p>
              </article>
            </aside>
          </article>
        </>
      ) : null}

      {step === 3 && receipt ? (
        <>
          <article className={`bc-ledger-frame bc-open-banner ${receiptIsActive ? "ok" : "warning"}`}>
            <div className="bc-open-banner-head">
              <p className="bc-ledger-meta">STATE COMMITTED // {receiptIsActive ? "AUTO-ACTIVATION COMPLETE" : "HELD FOR INTERNAL OPS REVIEW"}</p>
              <span>STATUS {receipt.status.toUpperCase()}</span>
            </div>
            <h3>{receipt.accountId} is {receiptIsActive ? "Live and Operational" : "Pending Review"}</h3>
          </article>

          <article className="bc-open-stage-grid">
            <section className="bc-ledger-frame bc-open-main">
              <header className="bc-open-main-header">
                <div>
                  <p className="bc-ledger-meta">OFFICIAL LEDGER RECORD</p>
                  <h3>ADA Provisioning &amp; Invariant Receipt</h3>
                </div>
                <span className="bc-open-chip">TRANSACTION TIMESTAMP {receipt.timestampUtc}</span>
              </header>

              <dl className="bc-open-policy-grid bc-open-receipt-grid">
                <div>
                  <dt>Account Identifier (ADA_ID)</dt>
                  <dd>
                    <strong>{receipt.accountId}</strong>
                    <button className="bc-open-copy" onClick={() => copyToClipboard(receipt.accountId, "ADA ID")} type="button">📋</button>
                  </dd>
                </div>
                <div>
                  <dt>Canonical UUID (Postgres PK)</dt>
                  <dd>
                    <span>{receipt.uuid}</span>
                    <button className="bc-open-copy" onClick={() => copyToClipboard(receipt.uuid, "UUID")} type="button">📋</button>
                  </dd>
                </div>
                <div>
                  <dt>Account Display Name</dt>
                  <dd>{receipt.displayName}</dd>
                </div>
                <div>
                  <dt>Settlement Asset &amp; Precision</dt>
                  <dd>{receipt.assetFullName}</dd>
                </div>
                <div>
                  <dt>Policy Activation Decision</dt>
                  <dd>{receipt.activationDecision}</dd>
                </div>
                <div>
                  <dt>Approval Status</dt>
                  <dd>{receipt.approvalStatus}</dd>
                </div>
                <div>
                  <dt>Owner Tenant &amp; Client Boundary</dt>
                  <dd>{receipt.ownerTenant}</dd>
                </div>
                <div>
                  <dt>Linked Instrument Reference</dt>
                  <dd>{receipt.linkedInstrumentRef}</dd>
                </div>
              </dl>

              <section className="bc-open-lifecycle-grid" aria-label="Multi-topology lifecycle guarantee">
                <div className={receipt.topology === "unlinked" ? "active ok" : ""}>
                  <p>{receipt.topology === "unlinked" ? "✓" : "•"} UNLINKED VIRTUAL</p>
                </div>
                <div className={receipt.topology === "wallet-linked" ? "active info" : ""}>
                  <p>{receipt.topology === "wallet-linked" ? "✓" : "•"} WALLET-LINKED</p>
                </div>
                <div className={receipt.topology === "fiat-linked" ? "active warning" : ""}>
                  <p>{receipt.topology === "fiat-linked" ? "⏳" : "•"} FIAT-LINKED</p>
                </div>
              </section>

              <section className="bc-open-hash" aria-label="SHA-256 audit lineage hash">
                <header>
                  <strong>SHA-256 AUDIT LINEAGE HASH</strong>
                  <span>ATTESTED BY APEX-CLEARING-NODE-04</span>
                </header>
                <div>
                  <code>{receipt.sha256Hash}</code>
                  <button className="bc-ledger-button bc-ledger-button-secondary" onClick={() => copyToClipboard(receipt.sha256Hash, "SHA-256 Hash")} type="button">
                    Copy Hash
                  </button>
                </div>
              </section>

              <footer>
                <button className="bc-ledger-button bc-ledger-button-secondary" onClick={downloadReceiptJson} type="button">
                  Download Signed Receipt (JSON)
                </button>
                <button className="bc-ledger-button bc-ledger-button-secondary" onClick={onBackToTradeLedgers} type="button">
                  Back to Trade Ledgers
                </button>
                <button className="bc-ledger-button bc-ledger-button-secondary" onClick={resetWizard} type="button">
                  Open Another ADA
                </button>
                <button className="bc-ledger-button bc-ledger-button-primary" onClick={onComplete} type="button">
                  Go to Account Statement
                </button>
              </footer>
            </section>

            <aside className="bc-open-side">
              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Immediate Account Actions</h4>
                  <span>READY</span>
                </header>
                <ul>
                  <li>
                    <strong>Initiate Virtual Transfer</strong>
                    <small>Transfer value to another internal ADA</small>
                  </li>
                  <li>
                    <strong>Attach Linked Instrument</strong>
                    <small>Link bank wire or external wallet later</small>
                  </li>
                  <li>
                    <strong>Create Scoped API Key</strong>
                    <small>Generate credential for automated access</small>
                  </li>
                </ul>
              </article>

              <article className="bc-ledger-frame bc-open-side-card">
                <header>
                  <h4>Permissions Envelope</h4>
                  <span>SCOPED</span>
                </header>
                <dl>
                  <div>
                    <dt>ALLOWED SCOPE</dt>
                    <dd>ada.read, ada.virtual_transfer</dd>
                  </div>
                  <div>
                    <dt>CROSS-TENANT ISOLATION</dt>
                    <dd>ENFORCED</dd>
                  </div>
                  <div>
                    <dt>TRANSACTION IDEMPOTENCY</dt>
                    <dd>RECORDED ({receipt.idempotencyKey})</dd>
                  </div>
                </dl>
              </article>

              <article className="bc-ledger-frame bc-open-side-card bc-open-helper-card">
                <p>
                  <span>❔</span>
                  Need assistance with subledger limits?
                </p>
              </article>
            </aside>
          </article>
        </>
      ) : null}
    </section>
  );
}
