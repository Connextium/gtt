import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Landmark,
  Pencil,
  XCircle
} from "lucide-react";
import {
  buildInternalTreasuryInstructionCreateRequest,
  evaluateExternalizationIntentPolicy,
  type ExternalizationIntent
} from "./internal-funding-intent-policy.js";
import "./internal-funding-instruction-scope.css";

type FlowStep = "create" | "preview" | "success";

type AccountApi = {
  id: string;
  accountName?: string;
  assetCode?: string;
  usePurpose?: string;
  metadata?: Record<string, unknown>;
};

type RouteProfileApi = {
  id: string;
  profileCode?: string;
  profileName?: string;
};

type RouteBindingApi = {
  id: string;
  profileId: string;
  profileCode?: string;
  profileName?: string;
  routeCode: string;
  bindingScope?: string;
  matchExpression?: string;
  priority?: number;
  active?: boolean;
};

type RouteDecisionCandidateApi = {
  bindingId?: string;
  profileId?: string;
  profileCode?: string;
  profileName?: string;
  routeCode?: string;
  bindingScope?: string;
  matchExpression?: string;
  priority?: number;
};

type RoutingDecisionApi = {
  selectedRouteCode?: string;
  selectedProfileId?: string;
  candidateScores?: {
    candidates?: RouteDecisionCandidateApi[];
    selected?: {
      bindingId?: string;
      profileId?: string;
      routeCode?: string;
    };
  };
};

type LinkedInstrumentsSummary = {
  fiatLinks?: Array<{
    purpose?: string;
    status?: string;
  }>;
  circleWallets?: Array<{
    status?: string;
    verificationStatus?: string;
  }>;
};

type PaymentInstructionApi = {
  id: string;
  status?: string;
  instructionType?: string;
  routeType?: string;
  routeCode?: string;
  sourceAccountOfDigitalAssetId?: string;
  destinationAccountOfDigitalAssetId?: string;
  amountMinorUnits?: string;
  routingDecision?: RoutingDecisionApi;
  createdAt?: string;
  updatedAt?: string;
};

type FormState = {
  sourceAccountId: string;
  destinationAccountId: string;
  amountMinorUnits: string;
  purpose: string;
  routePreference: string;
  externalizationIntent: ExternalizationIntent;
};

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";
const defaultFormState: FormState = {
  sourceAccountId: "",
  destinationAccountId: "",
  amountMinorUnits: "",
  purpose: "",
  routePreference: "System Optimal",
  externalizationIntent: "none"
};

const routeOptions = ["System Optimal", "Wire Priority", "Wallet Priority"];
const externalizationIntentOptions: Array<{ value: ExternalizationIntent; label: string }> = [
  { value: "none", label: "No external leg (Virtual Transfer only)" },
  { value: "wallet", label: "Add wallet externalization leg" },
  { value: "fiat", label: "Add fiat externalization leg" }
];
const amountPresetOptions: Array<{ label: string; value: string }> = [
  { label: "$250k", value: "250000000000" },
  { label: "$1M", value: "1000000000000" },
  { label: "$1.5M", value: "1500000000000" },
  { label: "$5M", value: "5000000000000" },
  { label: "$10M", value: "10000000000000" }
];

export const InternalFundingInstructionContent = ({
  fundingInstructionId,
  navigate
}: {
  fundingInstructionId?: string;
  navigate: (path: string) => void;
}) => {
  const [step, setStep] = useState<FlowStep>("create");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<AccountApi[]>([]);
  const [routeProfiles, setRouteProfiles] = useState<RouteProfileApi[]>([]);
  const [routeBindings, setRouteBindings] = useState<RouteBindingApi[]>([]);
  const [form, setForm] = useState<FormState>(defaultFormState);
  const [sourceProfile, setSourceProfile] = useState<LinkedInstrumentsSummary | null>(null);
  const [destinationProfile, setDestinationProfile] = useState<LinkedInstrumentsSummary | null>(null);
  const [createdInstruction, setCreatedInstruction] = useState<PaymentInstructionApi | null>(null);

  useEffect(() => {
    void loadAccounts();
    void loadRouteProfiles();
    void loadRouteBindings();
  }, []);

  useEffect(() => {
    if (!form.sourceAccountId) {
      setSourceProfile(null);
      return;
    }
    void loadLinkedInstruments(form.sourceAccountId, "source");
  }, [form.sourceAccountId]);

  useEffect(() => {
    if (!form.destinationAccountId) {
      setDestinationProfile(null);
      return;
    }
    void loadLinkedInstruments(form.destinationAccountId, "destination");
  }, [form.destinationAccountId]);

  useEffect(() => {
    if (!fundingInstructionId) return;
    void loadFundingInstruction(fundingInstructionId);
  }, [fundingInstructionId]);

  const sourceHasMintingWire = useMemo(() => {
    const links = sourceProfile?.fiatLinks ?? [];
    return links.some((link) => {
      const purpose = (link.purpose ?? "").toLowerCase();
      const status = (link.status ?? "").toLowerCase();
      return (purpose === "minting" || purpose === "bidirectional") && (status === "active" || status === "verified");
    });
  }, [sourceProfile]);

  const sourceHasCircleWallet = useMemo(() => {
    const wallets = sourceProfile?.circleWallets ?? [];
    return wallets.some((wallet) => {
      const status = (wallet.status ?? "").toLowerCase();
      const verification = (wallet.verificationStatus ?? "").toLowerCase();
      return (status === "active" || status === "verified") && (verification === "verified" || verification === "");
    });
  }, [sourceProfile]);

  const destinationHasCircleWallet = useMemo(() => {
    const wallets = destinationProfile?.circleWallets ?? [];
    return wallets.some((wallet) => {
      const status = (wallet.status ?? "").toLowerCase();
      const verification = (wallet.verificationStatus ?? "").toLowerCase();
      return (status === "active" || status === "verified") && (verification === "verified" || verification === "");
    });
  }, [destinationProfile]);

  const destinationHasFiatRoute = useMemo(() => {
    const links = destinationProfile?.fiatLinks ?? [];
    return links.some((link) => {
      const purpose = (link.purpose ?? "").toLowerCase();
      const status = (link.status ?? "").toLowerCase();
      return (purpose === "minting" || purpose === "bidirectional") && (status === "active" || status === "verified");
    });
  }, [destinationProfile]);

  const amountMinorUnits = useMemo(() => {
    const normalized = form.amountMinorUnits.replace(/[^0-9]/g, "");
    return normalized;
  }, [form.amountMinorUnits]);

  const amountDisplay = useMemo(() => {
    if (!amountMinorUnits) return "0.00";
    const asBigInt = BigInt(amountMinorUnits);
    const whole = asBigInt / 1_000_000n;
    const fractional = (asBigInt % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
    return `${whole.toLocaleString()}.${fractional}`;
  }, [amountMinorUnits]);

  const intentPolicy = useMemo(
    () => evaluateExternalizationIntentPolicy(form.externalizationIntent, destinationHasCircleWallet, destinationHasFiatRoute),
    [destinationHasCircleWallet, destinationHasFiatRoute, form.externalizationIntent]
  );

  const externalizationChecksPass = intentPolicy.externalizationChecksPass;

  const canPreview =
    form.sourceAccountId !== ""
    && form.destinationAccountId !== ""
    && amountMinorUnits !== ""
    && BigInt(amountMinorUnits) > 0n
    && form.purpose.trim().length > 0
    && externalizationChecksPass;

  const canAuthorize = canPreview;

  const railValidationBlockReason = intentPolicy.railValidationBlockReason;

  const selectedSource = accounts.find((account) => account.id === form.sourceAccountId);
  const selectedDestination = accounts.find((account) => account.id === form.destinationAccountId);
  const instructionSourceAccountId = createdInstruction?.sourceAccountOfDigitalAssetId ?? form.sourceAccountId;
  const instructionDestinationAccountId = createdInstruction?.destinationAccountOfDigitalAssetId ?? form.destinationAccountId;
  const instructionSourceAccount = accounts.find((account) => account.id === instructionSourceAccountId);
  const instructionDestinationAccount = accounts.find((account) => account.id === instructionDestinationAccountId);
  const successAmountDisplay = createdInstruction?.amountMinorUnits
    ? formatMinorUnitsAsUsdc(createdInstruction.amountMinorUnits)
    : amountDisplay;

  const expectedBindingDetails = useMemo(() => {
    const sourceAccount = accounts.find((account) => account.id === form.sourceAccountId);
    const destinationAccount = accounts.find((account) => account.id === form.destinationAccountId);

    if (!sourceAccount || !destinationAccount || !amountMinorUnits) return null;

    const instructionContext = {
      instructionType: "internal_ada_settlement",
      currency: "usd",
      sourceAccountOfDigitalAssetId: form.sourceAccountId,
      destinationAccountOfDigitalAssetId: form.destinationAccountId,
      amountMinorUnits: BigInt(amountMinorUnits),
      sourceUsePurpose: toMatchText(sourceAccount.usePurpose),
      destinationUsePurpose: toMatchText(destinationAccount.usePurpose),
      sourceRegion: metadataMatchText(sourceAccount.metadata, ["region", "country", "jurisdiction", "market"]),
      destinationRegion: metadataMatchText(destinationAccount.metadata, ["region", "country", "jurisdiction", "market"]),
      sourceExternalReference: metadataMatchText(sourceAccount.metadata, ["external_reference", "externalReference", "reference"]),
      destinationExternalReference: metadataMatchText(destinationAccount.metadata, ["external_reference", "externalReference", "reference"]),
      sourceHasVerifiedWalletLink: sourceHasCircleWallet,
      sourceHasVerifiedFiatLink: sourceHasMintingWire,
      destinationHasVerifiedWalletLink: destinationHasCircleWallet,
      destinationHasVerifiedFiatLink: destinationHasFiatRoute,
      sourceLinkedInstrumentClass: resolveLinkedInstrumentClass(sourceHasCircleWallet, sourceHasMintingWire),
      destinationLinkedInstrumentClass: resolveLinkedInstrumentClass(destinationHasCircleWallet, destinationHasFiatRoute)
    };

    const eligible = routeBindings
      .filter((binding) => binding.active === true)
      .filter((binding) => routeBindingMatches(
        binding.bindingScope ?? "default",
        binding.matchExpression ?? "*",
        instructionContext
      ))
      .sort((left, right) => {
        const priorityDiff = (right.priority ?? 100) - (left.priority ?? 100);
        if (priorityDiff !== 0) return priorityDiff;
        const profileDiff = (left.profileCode ?? "").localeCompare(right.profileCode ?? "");
        if (profileDiff !== 0) return profileDiff;
        const routeDiff = left.routeCode.localeCompare(right.routeCode);
        if (routeDiff !== 0) return routeDiff;
        return left.id.localeCompare(right.id);
      });

    const selected = eligible[0];
    if (!selected) return null;

    const profile = routeProfiles.find((item) => item.id === selected.profileId);
    return {
      profileCode: profile?.profileCode ?? selected.profileCode,
      profileName: profile?.profileName ?? selected.profileName,
      profileId: selected.profileId,
      bindingId: selected.id,
      bindingScope: selected.bindingScope,
      matchExpression: selected.matchExpression,
      routeCode: selected.routeCode,
      priority: selected.priority ?? 100
    };
  }, [
    accounts,
    amountMinorUnits,
    destinationHasCircleWallet,
    destinationHasFiatRoute,
    form.destinationAccountId,
    form.sourceAccountId,
    routeBindings,
    routeProfiles,
    sourceHasCircleWallet,
    sourceHasMintingWire
  ]);

  const resolvedBindingDetails = useMemo(() => {
    const decision = createdInstruction?.routingDecision;
    if (!decision) return null;

    const selected = decision.candidateScores?.selected;
    const candidates = Array.isArray(decision.candidateScores?.candidates)
      ? decision.candidateScores?.candidates
      : [];

    const selectedByBinding = selected?.bindingId
      ? candidates.find((candidate) => candidate.bindingId === selected.bindingId)
      : undefined;

    const selectedByProfileAndRoute = !selectedByBinding
      ? candidates.find(
        (candidate) => candidate.profileId === decision.selectedProfileId
          && candidate.routeCode === decision.selectedRouteCode
      )
      : undefined;

    const selectedCandidate = selectedByBinding ?? selectedByProfileAndRoute;
    const matchedProfile = decision.selectedProfileId
      ? routeProfiles.find((profile) => profile.id === decision.selectedProfileId)
      : undefined;

    const profileCode = matchedProfile?.profileCode ?? selectedCandidate?.profileCode ?? undefined;
    const profileName = matchedProfile?.profileName ?? selectedCandidate?.profileName ?? undefined;

    return {
      profileId: decision.selectedProfileId ?? selected?.profileId ?? undefined,
      profileCode,
      profileName,
      bindingId: selected?.bindingId ?? selectedCandidate?.bindingId,
      bindingScope: selectedCandidate?.bindingScope,
      matchExpression: selectedCandidate?.matchExpression,
      routeCode: decision.selectedRouteCode ?? selected?.routeCode ?? createdInstruction?.routeCode ?? createdInstruction?.routeType
    };
  }, [createdInstruction, routeProfiles]);

  const loadAccounts = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiFetch<{ accounts?: AccountApi[] }>("/accounts-of-digital-asset");
      const loaded = response.accounts ?? [];
      setAccounts(loaded);
      if (loaded.length >= 1) {
        setForm((current) => ({
          ...current,
          sourceAccountId: current.sourceAccountId || loaded[0]!.id,
          destinationAccountId: current.destinationAccountId || loaded[0]!.id
        }));
      }
      if (loaded.length >= 2) {
        setForm((current) => ({
          ...current,
          sourceAccountId: current.sourceAccountId || loaded[0]!.id,
          destinationAccountId: current.destinationAccountId || loaded[1]!.id
        }));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "accounts_load_failed");
    } finally {
      setLoading(false);
    }
  };

  const loadRouteProfiles = async () => {
    try {
      const response = await apiFetch<{ profiles?: RouteProfileApi[] }>("/internal/treasury/route-profiles");
      setRouteProfiles(Array.isArray(response.profiles) ? response.profiles : []);
    } catch {
      // Profile metadata is non-blocking for transfer creation.
      setRouteProfiles([]);
    }
  };

  const loadRouteBindings = async () => {
    try {
      const response = await apiFetch<{ bindings?: RouteBindingApi[] }>("/internal/treasury/route-bindings");
      setRouteBindings(Array.isArray(response.bindings) ? response.bindings : []);
    } catch {
      // Binding visibility is non-blocking for transfer creation.
      setRouteBindings([]);
    }
  };

  const loadLinkedInstruments = async (accountId: string, side: "source" | "destination") => {
    try {
      const response = await apiFetch<LinkedInstrumentsSummary>(`/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments`);
      if (side === "source") {
        setSourceProfile(response);
      } else {
        setDestinationProfile(response);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "linked_instrument_load_failed");
      if (side === "source") {
        setSourceProfile(null);
      } else {
        setDestinationProfile(null);
      }
    }
  };

  const loadFundingInstruction = async (id: string) => {
    try {
      const response = await apiFetch<{ paymentInstruction?: PaymentInstructionApi }>(`/internal/treasury/payment-instructions/${encodeURIComponent(id)}`);
      const instruction = response.paymentInstruction ?? null;
      setCreatedInstruction(instruction);
      if (instruction) setStep("success");
    } catch {
      // optional deep-link behavior
    }
  };

  const refreshFundingInstruction = async (id: string): Promise<PaymentInstructionApi | null> => {
    try {
      const response = await apiFetch<{ paymentInstruction?: PaymentInstructionApi }>(`/internal/treasury/payment-instructions/${encodeURIComponent(id)}`);
      const instruction = response.paymentInstruction ?? null;
      setCreatedInstruction(instruction);
      if (instruction) {
        setStep("success");
      }
      return instruction;
    } catch {
      // Route-level deep link is optional for this UI slice.
      return null;
    }
  };

  const submitInstruction = async () => {
    if (!canAuthorize || submitting) return;
    setSubmitting(true);
    setError("");

    try {
      const response = await apiFetch<{ paymentInstruction?: PaymentInstructionApi }>("/internal/treasury/payment-instructions", {
        method: "POST",
        body: buildInternalTreasuryInstructionCreateRequest({
          sourceAccountOfDigitalAssetId: form.sourceAccountId,
          destinationAccountOfDigitalAssetId: form.destinationAccountId,
          externalizationIntent: form.externalizationIntent,
          amountMinorUnits,
          routePreference: form.routePreference,
          purpose: form.purpose
        })
      });

      const paymentInstruction = response.paymentInstruction ?? null;
      if (paymentInstruction?.id) {
        await apiFetch(`/internal/treasury/payment-instructions/${encodeURIComponent(paymentInstruction.id)}/route`, {
          method: "POST",
          body: {}
        });
        await apiFetch(`/internal/treasury/payment-instructions/${encodeURIComponent(paymentInstruction.id)}/execute`, {
          method: "POST",
          body: {}
        });
        await refreshFundingInstruction(paymentInstruction.id);
      } else {
        setCreatedInstruction(paymentInstruction);
      }
      setStep("success");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "funding_instruction_create_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const resetFlow = () => {
    setStep("create");
    setCreatedInstruction(null);
    setError("");
    setForm((current) => ({
      ...defaultFormState,
      sourceAccountId: current.sourceAccountId,
      destinationAccountId: current.destinationAccountId,
      routePreference: "System Optimal"
    }));
  };

  const checkIcon = (passed: boolean) =>
    passed
      ? <CheckCircle2 size={16} className="ifc5-check-pass" />
      : <XCircle size={16} className="ifc5-check-fail" />;

  if (step === "success") {
    return (
      <section className="ifc5-page">
        <div className="ifc5-banner">
          <CheckCircle2 size={16} />
          <span>EXECUTED</span>
          <strong>{createdInstruction?.id ?? "Pending response"}</strong>
        </div>

        <header className="ifc5-success-header">
          <h1>Instruction Authorized And Initialized</h1>
          <p>
            The ADA Virtual Transfer instruction has been submitted, routed, and executed under
            the Sprint 7-1 policy layer.
          </p>
        </header>

        <div className="ifc5-success-grid">
          <article className="ifc5-card">
            <h2>Instruction Details</h2>
            <dl>
              <div>
                <dt>Instruction ID</dt>
                <dd>{createdInstruction?.id ?? "-"}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{formatStatus(createdInstruction?.status ?? "draft")}</dd>
              </div>
              <div>
                <dt>Instruction Type</dt>
                <dd>{formatStatus(createdInstruction?.instructionType ?? "internal_ada_settlement")}</dd>
              </div>
              <div>
                <dt>Amount</dt>
                <dd>{successAmountDisplay} USDC</dd>
              </div>
              <div>
                <dt>Externalization Intent</dt>
                <dd>{formatStatus(form.externalizationIntent)}</dd>
              </div>
              <div>
                <dt>Source ADA</dt>
                <dd>{instructionSourceAccount?.accountName ?? instructionSourceAccountId}</dd>
              </div>
              <div>
                <dt>Destination ADA</dt>
                <dd>{instructionDestinationAccount?.accountName ?? instructionDestinationAccountId}</dd>
              </div>
              <div>
                <dt>Resolved Route</dt>
                <dd>
                  {resolvedBindingDetails?.routeCode
                    ? formatStatus(resolvedBindingDetails.routeCode)
                    : createdInstruction?.routeCode
                      ? formatStatus(createdInstruction.routeCode)
                      : createdInstruction?.routeType
                        ? formatStatus(createdInstruction.routeType)
                        : "Pending Route"}
                </dd>
              </div>
              <div>
                <dt>Binding Profile</dt>
                <dd>
                  {resolvedBindingDetails?.profileCode
                    ? `${resolvedBindingDetails.profileCode}${resolvedBindingDetails.profileName ? ` · ${resolvedBindingDetails.profileName}` : ""}`
                    : resolvedBindingDetails?.profileId ?? "Pending Route Decision"}
                </dd>
              </div>
              <div>
                <dt>Binding Rule</dt>
                <dd>{resolvedBindingDetails?.bindingId ?? "Pending Route Decision"}</dd>
              </div>
              <div>
                <dt>Binding Scope</dt>
                <dd>{resolvedBindingDetails?.bindingScope ? formatStatus(resolvedBindingDetails.bindingScope) : "Pending Route Decision"}</dd>
              </div>
              <div>
                <dt>Binding Match</dt>
                <dd>{resolvedBindingDetails?.matchExpression ?? "Pending Route Decision"}</dd>
              </div>
            </dl>
          </article>

          <article className="ifc5-card">
            <h2>Orchestration Plan</h2>
            <div className="ifc5-order-box">
              <span className="ifc5-chip">ORDER 1</span>
              <strong>ada_virtual_transfer</strong>
              <p>Primary leg posts ADA Virtual Transfer. Optional second leg follows selected externalization intent.</p>
            </div>
            <div className="ifc5-actions">
              <button className="ifc5-btn-secondary" onClick={resetFlow} type="button">
                Create Another
              </button>
              <button className="ifc5-btn-primary" onClick={() => navigate("/internal/operations/funding-instructions")} type="button">
                Back To Create
              </button>
            </div>
          </article>
        </div>

        {error ? <p className="ifc5-error">{error}</p> : null}
      </section>
    );
  }

  if (step === "preview") {
    return (
      <section className="ifc5-page ifc5-page-preview">
        <header className="ifc5-header">
          <div>
            <p>TREASURY FUNDING INSTRUCTION</p>
            <h1>Validation And Preview</h1>
          </div>
          <div className="ifc5-id-box">
            <span>INSTRUCTION TYPE</span>
            <strong>internal_ada_settlement</strong>
          </div>
        </header>

        <div className="ifc5-grid">
          <div className="ifc5-left-stack">
            <article className="ifc5-card">
              <h2>Instruction Summary</h2>
              <div className="ifc5-summary-grid">
                <div>
                  <span>Source ADA</span>
                  <strong>{selectedSource?.accountName ?? form.sourceAccountId}</strong>
                  <small>{form.sourceAccountId}</small>
                </div>
                <div>
                  <span>Destination ADA</span>
                  <strong>{selectedDestination?.accountName ?? form.destinationAccountId}</strong>
                  <small>{form.destinationAccountId}</small>
                </div>
              </div>
              <div className="ifc5-amount-bar">
                <div>
                  <span>Principal Amount</span>
                  <strong>{amountDisplay} USDC</strong>
                </div>
                <ArrowRight size={20} />
              </div>
              <div className="ifc5-purpose">
                <span>Business Purpose</span>
                <p>{form.purpose}</p>
              </div>
            </article>

            <article className="ifc5-card">
              <h2>Projected Ledger Impacts</h2>
              <table className="ifc5-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Debit</th>
                    <th>Credit</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>10020 - Circle Business Account USDC</td>
                    <td>Asset</td>
                    <td>{amountDisplay}</td>
                    <td>-</td>
                  </tr>
                  <tr>
                    <td>20430 - Customer ADA Available Liability</td>
                    <td>Liability</td>
                    <td>-</td>
                    <td>{amountDisplay}</td>
                  </tr>
                </tbody>
              </table>
              <p className="ifc5-gate-note">
                Externalization intent: <strong>{formatStatus(form.externalizationIntent)}</strong>
              </p>
            </article>
          </div>

          <aside className="ifc5-right-stack">
            <article className="ifc5-card ifc5-muted">
              <h2>Orchestration Plan</h2>
              <div className="ifc5-order-box">
                <span className="ifc5-chip">ORDER 1</span>
                <strong>ada_virtual_transfer</strong>
                <p>Status initializes in draft, then routes and executes under policy checks.</p>
              </div>
              <div className="ifc5-order-box">
                <span className="ifc5-chip">EXPECTED BINDING</span>
                <strong>
                  {expectedBindingDetails?.profileCode
                    ? `${expectedBindingDetails.profileCode}${expectedBindingDetails.profileName ? ` · ${expectedBindingDetails.profileName}` : ""}`
                    : "No eligible binding found"}
                </strong>
                <p>
                  {expectedBindingDetails
                    ? `Route ${expectedBindingDetails.routeCode} via ${formatStatus(expectedBindingDetails.bindingScope ?? "default")} (priority ${expectedBindingDetails.priority}).`
                    : "Expected binding cannot be determined from current active rules."}
                </p>
              </div>
            </article>

            <article className="ifc5-card">
              <h2>Governance Gate</h2>
              <ul className="ifc5-check-list">
                <li>
                  {checkIcon(true)}
                  <div>
                    <strong>Constraint 01</strong>
                    <span>Virtual Transfer leg is always allowed for ADA-to-ADA flow.</span>
                  </div>
                </li>
                <li>
                  {checkIcon(form.externalizationIntent !== "wallet" || destinationHasCircleWallet)}
                  <div>
                    <strong>Constraint 02</strong>
                    <span>Wallet intent requires verified destination wallet route.</span>
                  </div>
                </li>
                <li>
                  {checkIcon(form.externalizationIntent !== "fiat" || destinationHasFiatRoute)}
                  <div>
                    <strong>Constraint 03</strong>
                    <span>Fiat intent requires active or verified destination fiat route.</span>
                  </div>
                </li>
                <li>
                  {checkIcon(form.purpose.trim().length > 0)}
                  <div>
                    <strong>Policy Check</strong>
                    <span>Business purpose is documented for audit traceability.</span>
                  </div>
                </li>
              </ul>
            </article>

            <div className="ifc5-actions">
              <button className="ifc5-btn-primary" disabled={!canAuthorize || submitting} onClick={() => void submitInstruction()} type="button">
                {submitting ? "Authorizing..." : "Authorize And Execute"}
              </button>
              <button className="ifc5-btn-secondary" onClick={() => setStep("create")} type="button">
                <Pencil size={14} />
                Back To Edit
              </button>
            </div>
          </aside>
        </div>

        {error ? <p className="ifc5-error">{error}</p> : null}
      </section>
    );
  }

  return (
    <section className="ifc5-page ifc5-page-create">
      <header className="ifc5-header-create">
        <p className="ifc5-eyebrow">TREASURY OPERATIONS / PAYMENT INSTRUCTIONS / FORM 702-B</p>
        <h1>Create ADA Virtual Transfer Instruction</h1>
        <p>
          Sprint 7-1 policy flow. Create ADA-to-ADA Virtual Transfer and optionally request a destination
          externalization leg by explicit intent.
        </p>
      </header>

      <div className="ifc5-governance-strip" role="presentation">
        <span><i aria-hidden="true" /> Governance Engine: Pre-check passed (#881-A)</span>
        <span>Double-entry parity: Balanced delta 0.00 USDC</span>
        <span>MPC quorum: 3-of-5 threshold ready</span>
      </div>

      <div className="ifc5-grid">
        <div className="ifc5-left-stack">
          <article className="ifc5-card">
            <h2>Account Topography</h2>
            <div className="ifc5-field-stack">
              <label>
                <span>Source ADA Account</span>
                <div className="ifc5-select-wrap">
                  <select
                    disabled={loading}
                    onChange={(event) => setForm((current) => ({ ...current, sourceAccountId: event.target.value }))}
                    value={form.sourceAccountId}
                  >
                    {accounts.length === 0 ? <option value="">No ADA available</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>

              <label>
                <span>Destination ADA Account</span>
                <div className="ifc5-select-wrap">
                  <select
                    disabled={loading}
                    onChange={(event) => setForm((current) => ({ ...current, destinationAccountId: event.target.value }))}
                    value={form.destinationAccountId}
                  >
                    {accounts.length === 0 ? <option value="">No ADA available</option> : null}
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{accountLabel(account)}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
            </div>
          </article>

          <article className="ifc5-card">
            <h2>Instruction Parameters</h2>
            <div className="ifc5-form-grid">
              <label>
                <span>Funding Type</span>
                <input readOnly value="internal_ada_settlement" />
              </label>
              <label>
                <span>Externalization Intent</span>
                <div className="ifc5-select-wrap">
                  <select
                    onChange={(event) => setForm((current) => ({
                      ...current,
                      externalizationIntent: event.target.value as FormState["externalizationIntent"]
                    }))}
                    value={form.externalizationIntent}
                  >
                    {externalizationIntentOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
              <label>
                <span>Amount (minor units)</span>
                <input
                  inputMode="numeric"
                  onChange={(event) => setForm((current) => ({ ...current, amountMinorUnits: event.target.value }))}
                  placeholder="1000000"
                  value={form.amountMinorUnits}
                />
                <small>Minor units x 1,000,000 per USDC</small>
                <strong className="ifc5-amount-readout">{amountDisplay} USDC</strong>
              </label>
              <label>
                <span>Route Preference</span>
                <div className="ifc5-select-wrap">
                  <select
                    onChange={(event) => setForm((current) => ({ ...current, routePreference: event.target.value }))}
                    value={form.routePreference}
                  >
                    {routeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </div>
              </label>
            </div>

            <label className="ifc5-textarea-wrap">
              <span>Business Purpose Or Description</span>
              <textarea
                onChange={(event) => setForm((current) => ({ ...current, purpose: event.target.value }))}
                placeholder="Detail the business justification for this internal mint operation"
                value={form.purpose}
              />
            </label>

            <div className="ifc5-amount-presets" role="group" aria-label="Amount quick presets">
              <span>Quick presets</span>
              {amountPresetOptions.map((option) => (
                <button
                  key={option.value}
                  className={form.amountMinorUnits === option.value ? "active" : ""}
                  onClick={() => setForm((current) => ({ ...current, amountMinorUnits: option.value }))}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </article>

          <div className="ifc5-footer-actions">
            <button className="ifc5-btn-primary" disabled={!canPreview} onClick={() => setStep("preview")} type="button">
              Validation And Preview
              <ArrowRight size={14} />
            </button>
          </div>
          {!canPreview && railValidationBlockReason ? <p className="ifc5-gate-note">{railValidationBlockReason}</p> : null}
        </div>

        <aside className="ifc5-right-stack">
          <article className="ifc5-card ifc5-muted">
            <h2>
              <Landmark size={16} />
              Governance Rules
            </h2>
            <ul className="ifc5-check-list">
              <li>
                {checkIcon(true)}
                <div>
                  <strong>Constraint 01</strong>
                  <span>ADA Virtual Transfer base leg is always eligible.</span>
                </div>
              </li>
              <li>
                {checkIcon(form.externalizationIntent !== "wallet" || destinationHasCircleWallet)}
                <div>
                  <strong>Constraint 02</strong>
                  <span>Wallet intent requires verified destination wallet route.</span>
                </div>
              </li>
              <li>
                {checkIcon(form.externalizationIntent !== "fiat" || destinationHasFiatRoute)}
                <div>
                  <strong>Constraint 03</strong>
                  <span>Fiat intent requires active or verified destination fiat route.</span>
                </div>
              </li>
              <li>
                {checkIcon(form.purpose.trim().length > 0)}
                <div>
                  <strong>Constraint 04</strong>
                  <span>Purpose text is required for policy audit evidence.</span>
                </div>
              </li>
            </ul>
          </article>

          <article className="ifc5-card">
            <h2>
              <ClipboardCheck size={16} />
              Snapshot
            </h2>
            <dl className="ifc5-snapshot">
              <div>
                <dt>Amount Preview</dt>
                <dd>{amountDisplay} USDC</dd>
              </div>
              <div>
                <dt>Route Preference</dt>
                <dd>{form.routePreference}</dd>
              </div>
              <div>
                <dt>Externalization Intent</dt>
                <dd>{formatStatus(form.externalizationIntent)}</dd>
              </div>
              <div>
                <dt>Expected Binding Profile</dt>
                <dd>
                  {expectedBindingDetails?.profileCode
                    ? `${expectedBindingDetails.profileCode}${expectedBindingDetails.profileName ? ` · ${expectedBindingDetails.profileName}` : ""}`
                    : "No eligible binding found"}
                </dd>
              </div>
              <div>
                <dt>Expected Binding Rule</dt>
                <dd>{expectedBindingDetails?.bindingId ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedSource?.accountName ?? "-"}</dd>
              </div>
              <div>
                <dt>Destination</dt>
                <dd>{selectedDestination?.accountName ?? "-"}</dd>
              </div>
            </dl>
          </article>
        </aside>
      </div>

      {error ? <p className="ifc5-error">{error}</p> : null}
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
  } = {}
): Promise<T> => {
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "x-correlation-id": correlationId,
      "idempotency-key": idempotencyKey
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};

const accountLabel = (account: AccountApi): string => {
  const name = account.accountName?.trim() || "Unnamed ADA";
  const code = account.assetCode?.trim() || "USDC";
  return `${name} (${code})`;
};

const normalizeStatus = (status: string | undefined): string => (status ?? "").trim().toLowerCase();

const toMatchText = (value: unknown): string => String(value ?? "").trim().toLowerCase();

const metadataMatchText = (metadata: Record<string, unknown> | undefined, keys: string[]): string => {
  if (!metadata) return "";
  for (const key of keys) {
    const candidate = toMatchText(metadata[key]);
    if (candidate) return candidate;
  }
  return "";
};

type LinkedInstrumentClass = "none" | "wallet" | "fiat" | "wallet_and_fiat";
type LinkedInstrumentSelector = LinkedInstrumentClass | "wallet_or_fiat";

const resolveLinkedInstrumentClass = (hasWallet: boolean, hasFiat: boolean): LinkedInstrumentClass => {
  if (hasWallet && hasFiat) return "wallet_and_fiat";
  if (hasWallet) return "wallet";
  if (hasFiat) return "fiat";
  return "none";
};

const parseLinkedInstrumentSelector = (value: string): LinkedInstrumentSelector | undefined => {
  const normalized = normalizeStatus(value).replaceAll("-", "_");
  if (["wallet", "circle_wallet", "on_chain_wallet"].includes(normalized)) return "wallet";
  if (["fiat", "fiat_route", "fiat_link", "wire", "fiat_wire"].includes(normalized)) return "fiat";
  if (["none", "virtual_only", "no_linked_instrument"].includes(normalized)) return "none";
  if (["wallet_or_fiat", "wallet_or_wire", "any", "either"].includes(normalized)) return "wallet_or_fiat";
  if (["wallet_and_fiat", "both"].includes(normalized)) return "wallet_and_fiat";
  return undefined;
};

const linkedInstrumentSelectorMatches = (selector: LinkedInstrumentSelector, actualClass: LinkedInstrumentClass): boolean => {
  if (selector === "wallet") return actualClass === "wallet" || actualClass === "wallet_and_fiat";
  if (selector === "fiat") return actualClass === "fiat" || actualClass === "wallet_and_fiat";
  if (selector === "wallet_or_fiat") return actualClass === "wallet" || actualClass === "fiat" || actualClass === "wallet_and_fiat";
  if (selector === "wallet_and_fiat") return actualClass === "wallet_and_fiat";
  return actualClass === "none";
};

const parseBooleanToken = (value: string): boolean | undefined => {
  const normalized = toMatchText(value);
  if (["true", "1", "yes", "y", "active", "required"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "inactive", "optional"].includes(normalized)) return false;
  return undefined;
};

const evaluateExpectedBoolean = (expectedValue: string, actual: boolean): boolean => {
  const expected = parseBooleanToken(expectedValue);
  if (expected === undefined) return true;
  return actual === expected;
};

const routeBindingMatches = (
  bindingScope: string,
  matchExpression: string,
  instruction: {
    instructionType: string;
    currency: string;
    sourceAccountOfDigitalAssetId: string;
    destinationAccountOfDigitalAssetId: string;
    amountMinorUnits: bigint;
    sourceUsePurpose: string;
    destinationUsePurpose: string;
    sourceRegion: string;
    destinationRegion: string;
    sourceExternalReference: string;
    destinationExternalReference: string;
    sourceHasVerifiedWalletLink: boolean;
    sourceHasVerifiedFiatLink: boolean;
    destinationHasVerifiedWalletLink: boolean;
    destinationHasVerifiedFiatLink: boolean;
    sourceLinkedInstrumentClass: LinkedInstrumentClass;
    destinationLinkedInstrumentClass: LinkedInstrumentClass;
  }
): boolean => {
  const normalizedExpression = matchExpression.trim();
  if (!normalizedExpression || normalizedExpression === "*") return true;

  if (normalizeStatus(bindingScope) === "default") return true;

  try {
    const parsed = JSON.parse(normalizedExpression) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed);
      if (!entries.length) return true;
      return entries.every(([rawKey, expected]) => {
        const key = normalizeStatus(rawKey);
        const expectedValue = toMatchText(expected);
        if (!expectedValue || expectedValue === "*") return true;
        if (key === "instructiontype" || key === "instruction_type") {
          return toMatchText(instruction.instructionType) === expectedValue;
        }
        if (key === "currency") {
          return toMatchText(instruction.currency) === expectedValue;
        }
        if (key === "sourceaccountofdigitalassetid" || key === "source_account_of_digital_asset_id") {
          return toMatchText(instruction.sourceAccountOfDigitalAssetId) === expectedValue;
        }
        if (key === "destinationaccountofdigitalassetid" || key === "destination_account_of_digital_asset_id") {
          return toMatchText(instruction.destinationAccountOfDigitalAssetId) === expectedValue;
        }
        if (key === "sourceusepurpose" || key === "source_use_purpose" || key === "source_account_use_purpose") {
          return instruction.sourceUsePurpose === expectedValue;
        }
        if (key === "destinationusepurpose" || key === "destination_use_purpose" || key === "destination_account_use_purpose") {
          return instruction.destinationUsePurpose === expectedValue;
        }
        if (key === "sourceregion" || key === "source_region") {
          return instruction.sourceRegion === expectedValue;
        }
        if (key === "destinationregion" || key === "destination_region") {
          return instruction.destinationRegion === expectedValue;
        }
        if (key === "sourceexternalreference" || key === "source_external_reference") {
          return instruction.sourceExternalReference === expectedValue;
        }
        if (key === "destinationexternalreference" || key === "destination_external_reference") {
          return instruction.destinationExternalReference === expectedValue;
        }
        if (["linkedinstrument", "linked_instrument", "linkedinstrumenttype", "linked_instrument_type", "destinationlinkedinstrument", "destination_linked_instrument", "destinationlinkedinstrumenttype", "destination_linked_instrument_type"].includes(key)) {
          const selector = parseLinkedInstrumentSelector(expectedValue);
          if (!selector) return true;
          return linkedInstrumentSelectorMatches(selector, instruction.destinationLinkedInstrumentClass);
        }
        if (["sourcelinkedinstrument", "source_linked_instrument", "sourcelinkedinstrumenttype", "source_linked_instrument_type"].includes(key)) {
          const selector = parseLinkedInstrumentSelector(expectedValue);
          if (!selector) return true;
          return linkedInstrumentSelectorMatches(selector, instruction.sourceLinkedInstrumentClass);
        }
        if (["destinationhaswalletlink", "destination_has_wallet_link", "destination_has_verified_wallet_link"].includes(key)) {
          return evaluateExpectedBoolean(expectedValue, instruction.destinationHasVerifiedWalletLink);
        }
        if (["destinationhasfiatlink", "destination_has_fiat_link", "destination_has_verified_fiat_link"].includes(key)) {
          return evaluateExpectedBoolean(expectedValue, instruction.destinationHasVerifiedFiatLink);
        }
        if (["sourcehaswalletlink", "source_has_wallet_link", "source_has_verified_wallet_link"].includes(key)) {
          return evaluateExpectedBoolean(expectedValue, instruction.sourceHasVerifiedWalletLink);
        }
        if (["sourcehasfiatlink", "source_has_fiat_link", "source_has_verified_fiat_link"].includes(key)) {
          return evaluateExpectedBoolean(expectedValue, instruction.sourceHasVerifiedFiatLink);
        }
        if (key === "minamountminorunits" || key === "min_amount_minor_units") {
          return instruction.amountMinorUnits >= BigInt(String(expected));
        }
        if (key === "maxamountminorunits" || key === "max_amount_minor_units") {
          return instruction.amountMinorUnits <= BigInt(String(expected));
        }
        return true;
      });
    }
  } catch {
    // Fall through to token parser.
  }

  const tokens = normalizedExpression
    .split(/[|,]/)
    .map((token) => token.trim())
    .filter(Boolean);

  return tokens.every((token) => {
    const separator = token.includes("=") ? "=" : token.includes(":") ? ":" : "";
    if (!separator) {
      const normalizedToken = toMatchText(token);
      return toMatchText(instruction.instructionType).includes(normalizedToken)
        || toMatchText(instruction.currency).includes(normalizedToken);
    }

    const [rawKey, rawValue] = token.split(separator, 2);
    const key = normalizeStatus(rawKey);
    const value = toMatchText(rawValue);
    if (!value || value === "*") return true;

    if (key === "instruction" || key === "instructiontype" || key === "instruction_type") {
      return toMatchText(instruction.instructionType) === value;
    }
    if (key === "currency" || key === "asset") {
      return toMatchText(instruction.currency) === value;
    }
    if (key === "source" || key === "source_account_of_digital_asset_id") {
      return toMatchText(instruction.sourceAccountOfDigitalAssetId) === value;
    }
    if (key === "destination" || key === "destination_account_of_digital_asset_id") {
      return toMatchText(instruction.destinationAccountOfDigitalAssetId) === value;
    }
    if (key === "source_use_purpose" || key === "sourceusepurpose" || key === "source_account_use_purpose") {
      return instruction.sourceUsePurpose === value;
    }
    if (key === "destination_use_purpose" || key === "destinationusepurpose" || key === "destination_account_use_purpose") {
      return instruction.destinationUsePurpose === value;
    }
    if (key === "source_region" || key === "sourceregion") {
      return instruction.sourceRegion === value;
    }
    if (key === "destination_region" || key === "destinationregion") {
      return instruction.destinationRegion === value;
    }
    if (key === "source_external_reference" || key === "sourceexternalreference") {
      return instruction.sourceExternalReference === value;
    }
    if (key === "destination_external_reference" || key === "destinationexternalreference") {
      return instruction.destinationExternalReference === value;
    }
    if (["linked_instrument", "linkedinstrument", "linked_instrument_type", "linkedinstrumenttype", "destination_linked_instrument", "destinationlinkedinstrument", "destination_linked_instrument_type", "destinationlinkedinstrumenttype"].includes(key)) {
      const selector = parseLinkedInstrumentSelector(value);
      if (!selector) return true;
      return linkedInstrumentSelectorMatches(selector, instruction.destinationLinkedInstrumentClass);
    }
    if (["source_linked_instrument", "sourcelinkedinstrument", "source_linked_instrument_type", "sourcelinkedinstrumenttype"].includes(key)) {
      const selector = parseLinkedInstrumentSelector(value);
      if (!selector) return true;
      return linkedInstrumentSelectorMatches(selector, instruction.sourceLinkedInstrumentClass);
    }
    if (["destination_has_wallet_link", "destinationhaswalletlink", "destination_has_verified_wallet_link"].includes(key)) {
      return evaluateExpectedBoolean(value, instruction.destinationHasVerifiedWalletLink);
    }
    if (["destination_has_fiat_link", "destinationhasfiatlink", "destination_has_verified_fiat_link"].includes(key)) {
      return evaluateExpectedBoolean(value, instruction.destinationHasVerifiedFiatLink);
    }
    if (["source_has_wallet_link", "sourcehaswalletlink", "source_has_verified_wallet_link"].includes(key)) {
      return evaluateExpectedBoolean(value, instruction.sourceHasVerifiedWalletLink);
    }
    if (["source_has_fiat_link", "sourcehasfiatlink", "source_has_verified_fiat_link"].includes(key)) {
      return evaluateExpectedBoolean(value, instruction.sourceHasVerifiedFiatLink);
    }
    if (key === "scope") {
      return normalizeStatus(bindingScope) === value;
    }
    return true;
  });
};

const formatStatus = (status: string): string =>
  status.replaceAll("_", " ").replace(/\b\w/g, (match) => match.toUpperCase());

const formatTimestamp = (value: string | undefined): string => {
  if (!value) return "Timestamp unavailable";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatMinorUnitsAsUsdc = (value: string | undefined): string => {
  if (!value) return "0.00";
  const normalized = value.replace(/[^0-9-]/g, "");
  if (!normalized || normalized === "-") return "0.00";
  const negative = normalized.startsWith("-");
  const digits = negative ? normalized.slice(1) : normalized;
  if (!digits) return "0.00";
  const units = BigInt(digits);
  const whole = units / 1_000_000n;
  const fractional = (units % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${negative ? "-" : ""}${whole.toLocaleString()}.${fractional}`;
};
