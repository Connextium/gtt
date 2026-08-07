import { ArrowRightLeft, CircleCheckBig, Coins, Landmark, RefreshCw, ShieldCheck, Wallet, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader, StatusBadge, SummaryLine } from "../panel.js";
import { buildMintHistoryCsv, buildMintHistoryQuery, formatMintHistoryMinorUnits } from "./sprint52-mint-history-utils.js";

type Sprint52Mode = "settlement" | "disbursements" | "wire";

interface FundingReservation {
  id: string;
  settlementObligationId?: string;
  accountOfDigitalAssetId?: string;
  amountMinorUnits?: string;
  status?: string;
  createdAt?: string;
}

interface FiatWireAccount {
  id: string;
  businessClientId?: string;
  bankName?: string;
  accountNumberLast4?: string;
  routingNumber?: string;
  status?: string;
}

interface AccountOfDigitalAsset {
  id: string;
  businessClientId?: string;
  accountName?: string;
  status?: string;
  businessClientName?: string;
  usePurpose?: string;
  assetCode?: string;
}

interface BusinessClient {
  id: string;
  legalName?: string;
  onboardingStatus?: string;
}

interface AccountBalanceProjection {
  accountId: string;
  balances?: Array<{
    assetCode?: string;
    availableMinorUnits?: string;
    pendingMinorUnits?: string;
    reservedMinorUnits?: string;
    lockedMinorUnits?: string;
  }>;
}

interface TenantAdaBalances {
  availableMinorUnits?: string;
  pendingMinorUnits?: string;
  reservedMinorUnits?: string;
  lockedMinorUnits?: string;
}

interface LinkedInstrumentRail {
  instrumentType?: string;
  reference?: string;
  status?: string;
  metadata?: {
    walletId?: string;
    address?: string;
    walletAddress?: string;
  };
}

interface LinkedInstrumentsPayload {
  circleWallets?: LinkedInstrumentRail[];
}

interface MintResult {
  id: string;
  wireAccountId: string;
  targetAccountOfDigitalAssetId: string;
  amountMinorUnits: string;
  status: string;
  createdAt: string;
}

interface MintHistoryRecord {
  id: string;
  wireAccountId: string;
  targetAccountOfDigitalAssetId: string;
  amountMinorUnits: string;
  status: string;
  providerMintId?: string;
  createdAt: string;
}

interface MintHistoryResponse {
  mints?: MintHistoryRecord[];
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
}

interface MintExportProgress {
  currentPage: number;
  totalPages: number;
}

interface TenantActivationResponse {
  circleIntegration?: {
    status?: string;
    tenantWalletId?: string;
    walletSetId?: string;
  };
}

interface Sprint52SettlementContentProps {
  mode: Sprint52Mode;
  navigate: (path: string) => void;
}

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";
const tenantInternalClientLegalName = "Platform Internal Treasury Client";

export const Sprint52SettlementContent = ({ mode, navigate }: Sprint52SettlementContentProps) => {
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");

  const [reservations, setReservations] = useState<FundingReservation[]>([]);
  const [wireAccounts, setWireAccounts] = useState<FiatWireAccount[]>([]);
  const [adaAccounts, setAdaAccounts] = useState<AccountOfDigitalAsset[]>([]);
  const [businessClients, setBusinessClients] = useState<BusinessClient[]>([]);
  const [mintHistory, setMintHistory] = useState<MintHistoryRecord[]>([]);

  const [reservationAmount, setReservationAmount] = useState("250.000000");
  const [reservationObligationId, setReservationObligationId] = useState("obligation_sprint52");
  const [reservationAdaId, setReservationAdaId] = useState("");

  const [wireBusinessClientId, setWireBusinessClientId] = useState("");
  const [wireBankName, setWireBankName] = useState("Platform Treasury Bank");
  const [wireLast4, setWireLast4] = useState("2401");
  const [wireRouting, setWireRouting] = useState("011000015");

  const [mintWireAccountId, setMintWireAccountId] = useState("");
  const [mintTargetAdaId, setMintTargetAdaId] = useState("");
  const [mintAmount, setMintAmount] = useState("100.000000");
  const [mintActionError, setMintActionError] = useState("");
  const [lastMint, setLastMint] = useState<MintResult | undefined>();
  const [mintSearch, setMintSearch] = useState("");
  const [mintStatusFilter, setMintStatusFilter] = useState("all");
  const [mintHistoryPage, setMintHistoryPage] = useState(1);
  const [mintHistoryPageSize, setMintHistoryPageSize] = useState(10);
  const [mintHistoryTotal, setMintHistoryTotal] = useState(0);
  const [mintHistoryTotalPages, setMintHistoryTotalPages] = useState(1);
  const [mintHistoryHasNextPage, setMintHistoryHasNextPage] = useState(false);
  const [mintHistoryHasPreviousPage, setMintHistoryHasPreviousPage] = useState(false);
  const [mintExportProgress, setMintExportProgress] = useState<MintExportProgress | undefined>();
  const [tenantActivation, setTenantActivation] = useState<TenantActivationResponse | undefined>();
  const [tenantAdaBalances, setTenantAdaBalances] = useState<TenantAdaBalances | undefined>();
  const [tenantAdaWalletId, setTenantAdaWalletId] = useState<string | undefined>();
  const [tenantAdaWalletAddress, setTenantAdaWalletAddress] = useState<string | undefined>();
  const [mintDestinationWalletAddress, setMintDestinationWalletAddress] = useState<string | undefined>();

  const [busyAction, setBusyAction] = useState<string | undefined>();
  const [actionError, setActionError] = useState("");

  const tenantWalletSetId = tenantActivation?.circleIntegration?.walletSetId;
  const tenantWalletAssigned = Boolean(tenantAdaWalletId);
  const tenantAdaSelected = Boolean(mintTargetAdaId);
  const platformMintGateReady = tenantWalletAssigned && tenantAdaSelected;

  const refreshAll = async () => {
    setLoadStatus("loading");
    setLoadError("");
    try {
      const [reservationsPayload, wireAccountsPayload, adaAccountsPayload, businessClientsPayload] = await Promise.all([
        apiFetch<{ reservations?: FundingReservation[] }>("/funding-reservations"),
        apiFetch<{ wireAccounts?: FiatWireAccount[] }>("/fiat/wire-accounts"),
        apiFetch<{ accounts?: AccountOfDigitalAsset[] }>("/accounts-of-digital-asset"),
        apiFetch<{ businessClients?: BusinessClient[] }>("/business-clients")
      ]);
      const nextReservations = reservationsPayload.reservations ?? [];
      const nextWireAccounts = wireAccountsPayload.wireAccounts ?? [];
      const nextAdaAccounts = adaAccountsPayload.accounts ?? [];
      const nextBusinessClients = businessClientsPayload.businessClients ?? [];

      setReservations(nextReservations);
      setWireAccounts(nextWireAccounts);
      setAdaAccounts(nextAdaAccounts);
      setBusinessClients(nextBusinessClients);

      if (!reservationAdaId && nextAdaAccounts.length) {
        setReservationAdaId(nextAdaAccounts[0]!.id);
      }
      if (!mintTargetAdaId && nextAdaAccounts.length) {
        setMintTargetAdaId(nextAdaAccounts[0]!.id);
      }
      if (!mintWireAccountId && nextWireAccounts.length) {
        setMintWireAccountId(nextWireAccounts[0]!.id);
      }

      setLoadStatus("ready");
    } catch (error) {
      setLoadStatus("error");
      setLoadError(error instanceof Error ? error.message : "sprint52_load_failed");
    }
  };

  const refreshTenantActivation = async () => {
    try {
      const payload = await apiFetch<TenantActivationResponse>("/tenants/current/activation");
      setTenantActivation(payload);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "tenant_activation_load_failed");
    }
  };

  const refreshMintHistory = async () => {
    try {
      const query = buildMintHistoryQuery({
        page: mintHistoryPage,
        pageSize: mintHistoryPageSize,
        search: mintSearch,
        status: mintStatusFilter
      });
      const payload = await apiFetch<MintHistoryResponse>(`/fiat/mints?${query}`);
      setMintHistory(payload.mints ?? []);
      setMintHistoryTotal(payload.total ?? 0);
      setMintHistoryTotalPages(payload.totalPages ?? 1);
      setMintHistoryHasNextPage(Boolean(payload.hasNextPage));
      setMintHistoryHasPreviousPage(Boolean(payload.hasPreviousPage));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "mint_history_load_failed");
    }
  };

  const exportAllFilteredMintHistoryCsv = async () => {
    setBusyAction("export-all-mints");
    setActionError("");
    setMintExportProgress(undefined);
    try {
      const rows: MintHistoryRecord[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const query = buildMintHistoryQuery({
          page,
          pageSize: 200,
          search: mintSearch,
          status: mintStatusFilter
        });
        const payload = await apiFetch<MintHistoryResponse>(`/fiat/mints?${query}`);
        rows.push(...(payload.mints ?? []));
        totalPages = Math.max(1, payload.totalPages ?? 1);
        setMintExportProgress({ currentPage: page, totalPages });
        page += 1;
      } while (page <= totalPages);

      exportMintHistoryCsv(rows);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "mint_history_export_failed");
    } finally {
      setMintExportProgress(undefined);
      setBusyAction(undefined);
    }
  };

  useEffect(() => {
    void Promise.all([refreshAll(), refreshMintHistory(), refreshTenantActivation()]);
  }, []);

  useEffect(() => {
    void refreshMintHistory();
  }, [mintHistoryPage, mintHistoryPageSize, mintSearch, mintStatusFilter]);

  const reservationCounts = useMemo(() => {
    const reserved = reservations.filter((item) => item.status === "active").length;
    const released = reservations.filter((item) => item.status === "released").length;
    const expired = reservations.filter((item) => item.status === "expired").length;
    return { reserved, released, expired };
  }, [reservations]);

  const tenantInternalBusinessClient = useMemo(
    () =>
      businessClients.find((item) => (item.legalName ?? "").trim().toLowerCase() === tenantInternalClientLegalName.toLowerCase()),
    [businessClients]
  );

  const tenantCentralAda = useMemo(
    () =>
      adaAccounts.find(
        (item) =>
          item.usePurpose === "tenant_central"
          || (item.accountName ?? "").trim().toLowerCase() === "tenant ada (central)"
      ),
    [adaAccounts]
  );

  useEffect(() => {
    const accountId = tenantCentralAda?.id;
    if (!accountId) {
      setTenantAdaBalances(undefined);
      return;
    }

    let cancelled = false;
    const loadTenantAdaBalance = async () => {
      try {
        const payload = await apiFetch<AccountBalanceProjection>(`/accounts-of-digital-asset/${encodeURIComponent(accountId)}/balances`);
        const usdcBalance = (payload.balances ?? []).find((item) => (item.assetCode ?? "").toUpperCase() === "USDC");
        const fallbackBalance = (payload.balances ?? [])[0];
        const selectedBalance = usdcBalance ?? fallbackBalance;
        if (!cancelled) {
          setTenantAdaBalances({
            availableMinorUnits: selectedBalance?.availableMinorUnits,
            pendingMinorUnits: selectedBalance?.pendingMinorUnits,
            reservedMinorUnits: selectedBalance?.reservedMinorUnits,
            lockedMinorUnits: selectedBalance?.lockedMinorUnits
          });
        }
      } catch {
        if (!cancelled) setTenantAdaBalances(undefined);
      }
    };

    void loadTenantAdaBalance();
    return () => {
      cancelled = true;
    };
  }, [tenantCentralAda?.id]);

  useEffect(() => {
    const accountId = tenantCentralAda?.id;
    if (!accountId) {
      setTenantAdaWalletId(undefined);
      setTenantAdaWalletAddress(undefined);
      return;
    }

    let cancelled = false;
    const loadTenantAdaWallet = async () => {
      try {
        const payload = await apiFetch<LinkedInstrumentsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments`);
        const wallet = (payload.circleWallets ?? [])[0];
        if (!cancelled) {
          setTenantAdaWalletId(wallet?.metadata?.walletId);
          setTenantAdaWalletAddress(wallet?.metadata?.address ?? wallet?.metadata?.walletAddress);
        }
      } catch {
        if (!cancelled) {
          setTenantAdaWalletId(undefined);
          setTenantAdaWalletAddress(undefined);
        }
      }
    };

    void loadTenantAdaWallet();
    return () => {
      cancelled = true;
    };
  }, [tenantCentralAda?.id]);

  const tenantCentralAdaBusinessClientId = tenantCentralAda?.businessClientId;
  const mintTargetAdaOptions = useMemo(
    () => (tenantCentralAda ? [tenantCentralAda] : adaAccounts),
    [tenantCentralAda, adaAccounts]
  );
  const selectedMintTargetAda = useMemo(
    () => adaAccounts.find((item) => item.id === mintTargetAdaId),
    [adaAccounts, mintTargetAdaId]
  );

  useEffect(() => {
    const accountId = selectedMintTargetAda?.id;
    if (!accountId) {
      setMintDestinationWalletAddress(undefined);
      return;
    }

    let cancelled = false;
    const loadMintDestinationWallet = async () => {
      try {
        const payload = await apiFetch<LinkedInstrumentsPayload>(`/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments`);
        const wallet = (payload.circleWallets ?? [])[0];
        if (!cancelled) {
          setMintDestinationWalletAddress(wallet?.metadata?.address ?? wallet?.metadata?.walletAddress);
        }
      } catch {
        if (!cancelled) setMintDestinationWalletAddress(undefined);
      }
    };

    void loadMintDestinationWallet();
    return () => {
      cancelled = true;
    };
  }, [selectedMintTargetAda?.id]);
  const isWireClientUsingTenantInternal = Boolean(
    wireBusinessClientId
      && tenantInternalBusinessClient?.id
      && wireBusinessClientId === tenantInternalBusinessClient.id
  );

  const wireBusinessClientOptions = useMemo(
    () => {
      const options: Array<{ id: string; label: string }> = [];

      const preferredInternalId = tenantCentralAdaBusinessClientId ?? tenantInternalBusinessClient?.id;
      if (preferredInternalId) {
        options.push({
          id: preferredInternalId,
          label: `${tenantCentralAda?.businessClientName ?? tenantInternalClientLegalName} (Tenant ADA internal client)`
        });
      }

      return options;
    },
    [tenantCentralAda, tenantCentralAdaBusinessClientId, tenantInternalBusinessClient]
  );

  useEffect(() => {
    const preferredId = tenantCentralAdaBusinessClientId ?? tenantInternalBusinessClient?.id;
    if (preferredId && wireBusinessClientId !== preferredId) {
      setWireBusinessClientId(preferredId);
      return;
    }
    if (!preferredId && wireBusinessClientId) {
      setWireBusinessClientId("");
      return;
    }
    if (!wireBusinessClientId && wireBusinessClientOptions.length) {
      setWireBusinessClientId(wireBusinessClientOptions[0]!.id);
    }
  }, [wireBusinessClientId, wireBusinessClientOptions, tenantCentralAdaBusinessClientId, tenantInternalBusinessClient]);

  useEffect(() => {
    const targetTenantAdaId = tenantCentralAda?.id;
    if (targetTenantAdaId && mintTargetAdaId !== targetTenantAdaId) {
      setMintTargetAdaId(targetTenantAdaId);
      return;
    }
    if (!targetTenantAdaId && !mintTargetAdaId && adaAccounts.length) {
      setMintTargetAdaId(adaAccounts[0]!.id);
    }
  }, [tenantCentralAda?.id, mintTargetAdaId, adaAccounts]);

  const createReservation = async () => {
    if (!reservationAdaId) return;
    setBusyAction("create-reservation");
    setActionError("");
    try {
      await apiFetch<{ reservation: FundingReservation }>("/funding-reservations", {
        method: "POST",
        headers: idempotencyHeader("reserve"),
        body: JSON.stringify({
          settlementObligationId: reservationObligationId,
          accountOfDigitalAssetId: reservationAdaId,
          amountMinorUnits: toMinorUnitsString(reservationAmount)
        })
      });
      await Promise.all([refreshAll(), refreshMintHistory()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "reservation_create_failed");
    } finally {
      setBusyAction(undefined);
    }
  };

  const transitionReservation = async (id: string, action: "activate" | "release" | "expire") => {
    setBusyAction(`${action}-${id}`);
    setActionError("");
    try {
      await apiFetch<{ reservation: FundingReservation }>(`/funding-reservations/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: idempotencyHeader(`reservation-${action}`)
      });
      await Promise.all([refreshAll(), refreshMintHistory()]);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : `reservation_${action}_failed`);
    } finally {
      setBusyAction(undefined);
    }
  };

  const createWireAccount = async () => {
    setBusyAction("create-wire-account");
    setActionError("");
    try {
      const payload: Record<string, string> = {
        bankName: wireBankName,
        accountNumberLast4: wireLast4,
        routingNumber: wireRouting
      };
      if (wireBusinessClientId) {
        payload.businessClientId = wireBusinessClientId;
      }
      if (mintTargetAdaId) {
        payload.targetAccountOfDigitalAssetId = mintTargetAdaId;
      }
      await apiFetch<{ wireAccount: FiatWireAccount }>("/fiat/wire-accounts", {
        method: "POST",
        headers: idempotencyHeader("wire-account"),
        body: JSON.stringify(payload)
      });
      await refreshAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "wire_account_create_failed");
    } finally {
      setBusyAction(undefined);
    }
  };

  const mintFromWire = async () => {
    if (!mintWireAccountId || !mintTargetAdaId) return;
    setBusyAction("mint-from-wire");
    setActionError("");
    setMintActionError("");
    setLastMint(undefined);
    try {
      const payload = await apiFetch<{ mint: MintResult }>(`/fiat/wire-accounts/${encodeURIComponent(mintWireAccountId)}/mint`, {
        method: "POST",
        headers: idempotencyHeader("wire-mint"),
        body: JSON.stringify({
          targetAccountOfDigitalAssetId: mintTargetAdaId,
          amountMinorUnits: toMinorUnitsString(mintAmount)
        })
      });
      setLastMint(payload.mint);
      await Promise.all([refreshAll(), refreshMintHistory()]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "mint_failed";
      setMintActionError(message);
      setActionError(message);
    } finally {
      setBusyAction(undefined);
    }
  };

  return (
    <section className={`s52-shell${mode === "wire" ? " s52-wire-dense" : ""}`}>
      <header className="s52-header panel">
        <PanelHeader title="Sprint 5-2 Settlement Advance Orchestration" meta="Settlement advance business flow" />
        <p>
          Business client fiat is mock-paid to Platform Wire Account only. Direct client wire to Circle payee is blocked in this sprint.
        </p>
        <div className="s52-actions">
          <button className="action-button" onClick={() => void Promise.all([refreshAll(), refreshMintHistory(), refreshTenantActivation()])} type="button">
            <RefreshCw size={16} />
            Refresh
          </button>
          <button className="action-button" onClick={() => navigate("/internal/operations/admin/tenant-activation")} type="button">
            <ShieldCheck size={16} />
            Open Tenant Activation
          </button>
        </div>
      </header>

      <div className="metric-grid">
        <div className="metric-tile ready">
          <span>Reserved</span>
          <strong>{String(reservationCounts.reserved)}</strong>
        </div>
        <div className="metric-tile attention">
          <span>Released</span>
          <strong>{String(reservationCounts.released)}</strong>
        </div>
        <div className="metric-tile blocked">
          <span>Expired</span>
          <strong>{String(reservationCounts.expired)}</strong>
        </div>
        <div className="metric-tile ready">
          <span>Wire Accounts</span>
          <strong>{String(wireAccounts.length)}</strong>
        </div>
      </div>

      <div className="s52-tabs panel">
        <button className={mode === "settlement" ? "active" : ""} onClick={() => navigate("/internal/operations/settlement-advance")} type="button">
          <Coins size={16} />
          Reservation and Activation
        </button>
        <button className={mode === "disbursements" ? "active" : ""} onClick={() => navigate("/internal/operations/tenant-disbursements")} type="button">
          <Wallet size={16} />
          Tenant Activation Gate
        </button>
        <button className={mode === "wire" ? "active" : ""} onClick={() => navigate("/internal/operations/platform-wire-mint")} type="button">
          <Landmark size={16} />
          Platform Wire Setup
        </button>
      </div>

      {loadStatus === "error" ? <div className="panel s52-error">Load failed: {loadError}</div> : null}
      {actionError ? <div className="panel s52-error">Action failed: {actionError}</div> : null}

      {(mode === "settlement" || mode === "disbursements") && (
        <div className="s52-grid">
          <article className="panel">
            <PanelHeader title="Pre-Funding Reservation" meta="Provisioning -> Reserved" />
            <div className="s52-form-grid">
              <label>
                <span>Settlement Obligation Id</span>
                <input onChange={(event) => setReservationObligationId(event.target.value)} value={reservationObligationId} />
              </label>
              <label>
                <span>Source ADA</span>
                <select onChange={(event) => setReservationAdaId(event.target.value)} value={reservationAdaId}>
                  {adaAccounts.map((item) => (
                    <option key={item.id} value={item.id}>{item.accountName ?? item.id}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Amount (USDC)</span>
                <input onChange={(event) => setReservationAmount(event.target.value)} value={reservationAmount} />
              </label>
            </div>
            <div className="panel-actions">
              <button className="action-button primary" disabled={busyAction === "create-reservation" || !reservationAdaId} onClick={() => void createReservation()} type="button">
                <CircleCheckBig size={16} />
                Create Reservation
              </button>
            </div>
          </article>

          <article className="panel">
            <PanelHeader title="Wire Match Activation" meta="Reserved -> Available" />
            <div className="table">
              <div className="table-row table-head">
                <span>Reservation</span>
                <span>ADA</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Actions</span>
              </div>
              {reservations.slice(0, 8).map((item) => (
                <div className="table-row s52-table-row" key={item.id}>
                  <span>{item.id}</span>
                  <span>{item.accountOfDigitalAssetId ?? "-"}</span>
                  <span>{formatMinorUnits(item.amountMinorUnits)}</span>
                  <StatusBadge label={item.status ?? "unknown"} tone={statusTone(item.status)} />
                  <div className="button-pair">
                    <button className="icon-button positive" disabled={busyAction === `activate-${item.id}`} onClick={() => void transitionReservation(item.id, "activate")} title="Activate" type="button">
                      <CircleCheckBig size={16} />
                    </button>
                    <button className="icon-button negative" disabled={busyAction === `release-${item.id}`} onClick={() => void transitionReservation(item.id, "release")} title="Release" type="button">
                      <ArrowRightLeft size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {!reservations.length ? <div className="table-row">No reservations yet.</div> : null}
            </div>
          </article>
        </div>
      )}

      {(mode === "disbursements" || mode === "wire") && (
        <div className="s52-grid">
          <article className="panel">
            <PanelHeader title="Tenant Activation Gate" meta="Tenant ADA (central) required" />
            <div className="summary-stack">
              <SummaryLine label="Gate" value="Platform mint only: Tenant ADA + tenant wallet assignment" />
              <SummaryLine label="Tenant wallet set" value={tenantWalletSetId ?? "Not assigned"} />
              <SummaryLine label="Tenant wallet" value={tenantAdaWalletId ?? "Not assigned"} />
              <SummaryLine label="Tenant internal client" value={tenantInternalBusinessClient?.id ?? "Not found"} />
              <SummaryLine label="Internal client status" value={tenantInternalBusinessClient?.onboardingStatus ?? "Not created"} />
              <SummaryLine label="Tenant ADA (central)" value={tenantCentralAda?.id ?? "Not created"} />
              <SummaryLine label="Required fields" value="destination_ada_id + destination_ada_wallet_id" />
              <SummaryLine label="Policy" value={platformMintGateReady ? "Platform mint gate satisfied" : "Platform mint blocked until tenant wallet is assigned and target ADA selected"} />
            </div>
            <div className="panel-actions">
              <button className="action-button" onClick={() => navigate("/internal/operations/admin/tenant-activation")} type="button">
                <ShieldCheck size={16} />
                Configure Tenant Activation
              </button>
            </div>
          </article>

          <article className="panel">
            <PanelHeader title="Tenant ADA Preview" meta="Activation output" />
            {tenantCentralAda ? (
              <div className="summary-stack">
                <SummaryLine label="Account" value={tenantCentralAda.id} />
                <SummaryLine label="Name" value={tenantCentralAda.accountName ?? "Tenant ADA (central)"} />
                <SummaryLine label="Use purpose" value={tenantCentralAda.usePurpose ?? "tenant_central"} />
                <SummaryLine label="Asset" value={tenantCentralAda.assetCode ?? "USDC"} />
                <SummaryLine label="Wallet ID" value={tenantAdaWalletId ?? "Not provisioned"} />
                <SummaryLine label="Wallet address" value={tenantAdaWalletAddress ?? "Not available"} />
                <SummaryLine label="Available balance" value={tenantAdaBalances?.availableMinorUnits ? formatMinorUnits(tenantAdaBalances.availableMinorUnits) : "Not available"} />
                <SummaryLine label="Pending balance" value={tenantAdaBalances?.pendingMinorUnits ? formatMinorUnits(tenantAdaBalances.pendingMinorUnits) : "Not available"} />
                <SummaryLine label="Reserved balance" value={tenantAdaBalances?.reservedMinorUnits ? formatMinorUnits(tenantAdaBalances.reservedMinorUnits) : "Not available"} />
                <SummaryLine label="Locked balance" value={tenantAdaBalances?.lockedMinorUnits ? formatMinorUnits(tenantAdaBalances.lockedMinorUnits) : "Not available"} />
                <SummaryLine label="Linked client" value={tenantCentralAda.businessClientName ?? tenantCentralAda.businessClientId ?? "Not linked"} />
                <div className="summary-line">
                  <span>Status</span>
                  <StatusBadge label={tenantCentralAda.status ?? "unknown"} tone={statusTone(tenantCentralAda.status)} />
                </div>
              </div>
            ) : (
              <div className="close-banner blocked">
                <X size={17} />
                Tenant ADA (central) not found. Run Tenant Activation to provision it.
              </div>
            )}
          </article>

          <article className="panel">
            <PanelHeader title="Platform Wire Account Setup" meta="Mock payee only" />
            <div className="s52-form-grid">
              <label>
                <span>Business Client Id</span>
                <select
                  disabled={wireBusinessClientOptions.length <= 1}
                  onChange={(event) => setWireBusinessClientId(event.target.value)}
                  value={wireBusinessClientId}
                >
                  {!wireBusinessClientOptions.length ? <option value="">Tenant internal client not provisioned</option> : null}
                  {wireBusinessClientOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Bank Name</span>
                <input onChange={(event) => setWireBankName(event.target.value)} value={wireBankName} />
              </label>
              <label>
                <span>Routing Number</span>
                <input onChange={(event) => setWireRouting(event.target.value)} value={wireRouting} />
              </label>
              <label>
                <span>Account Last 4</span>
                <input onChange={(event) => setWireLast4(event.target.value)} value={wireLast4} />
              </label>
            </div>
            <div className="panel-actions">
              <button className="action-button primary" disabled={busyAction === "create-wire-account"} onClick={() => void createWireAccount()} type="button">
                <Landmark size={16} />
                Add Platform Wire Account
              </button>
            </div>
            <div className="summary-line">
              <span>Policy</span>
              <strong>{isWireClientUsingTenantInternal ? "Using Tenant ADA internal client" : "Select the same internal client used by Tenant ADA"}</strong>
            </div>
            <div className="summary-line">
              <span>Internal client</span>
              <strong>{tenantInternalBusinessClient?.id ?? "Not found"}</strong>
            </div>
            <div className="summary-line">
              <span>Internal client status</span>
              <strong>{tenantInternalBusinessClient?.onboardingStatus ?? "Not created"}</strong>
            </div>
            <div className="s52-wire-list">
              {wireAccounts.map((item) => (
                <div className="summary-line" key={item.id}>
                  <span>{item.bankName} ••••{item.accountNumberLast4}</span>
                  <strong>{item.status ?? "active"}</strong>
                </div>
              ))}
              {!wireAccounts.length ? <div className="summary-line"><span>No wire accounts configured.</span><strong>Missing</strong></div> : null}
            </div>
          </article>
        </div>
      )}

      {mode === "wire" && (
        <>
          <article className="panel">
            <PanelHeader title="Fiat to USDC Mint" meta="Platform wire account -> Platform ADA" />
            {!platformMintGateReady ? (
              <div className="close-banner blocked">
                <X size={17} />
                Platform mint blocked: provision Tenant Activation and assign tenant wallet, then select Target ADA.
              </div>
            ) : null}
            <div className="s52-form-grid">
              <label>
                <span>Wire Account</span>
                <select onChange={(event) => setMintWireAccountId(event.target.value)} value={mintWireAccountId}>
                  {wireAccounts.map((item) => (
                    <option key={item.id} value={item.id}>{item.bankName} ••••{item.accountNumberLast4}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Target ADA</span>
                <select
                  disabled={Boolean(tenantCentralAda)}
                  onChange={(event) => setMintTargetAdaId(event.target.value)}
                  value={mintTargetAdaId}
                >
                  {mintTargetAdaOptions.map((item) => (
                    <option key={item.id} value={item.id}>{item.accountName ?? item.id}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Mint Amount (USDC)</span>
                <input onChange={(event) => setMintAmount(event.target.value)} value={mintAmount} />
              </label>
            </div>
            <div className="panel-actions">
              <button className="action-button primary" disabled={busyAction === "mint-from-wire" || !mintWireAccountId || !mintTargetAdaId || !platformMintGateReady} onClick={() => void mintFromWire()} type="button">
                <Coins size={16} />
                Execute Mint
              </button>
            </div>
            {mintActionError ? (
              <div className="close-banner blocked">
                <X size={17} />
                Mint failed: {mintActionError}
              </div>
            ) : null}
            {lastMint ? (
              <div className="close-banner ready">
                <CircleCheckBig size={17} />
                Mint complete: {formatMinorUnits(lastMint.amountMinorUnits)} credited to {lastMint.targetAccountOfDigitalAssetId}.
              </div>
            ) : null}
            <div className="summary-line">
              <span>Mint destination (ADA / Code)</span>
              <strong>{selectedMintTargetAda ? `${selectedMintTargetAda.accountName ?? selectedMintTargetAda.id} / ${selectedMintTargetAda.assetCode ?? "USDC"}` : "Not selected"}</strong>
            </div>
            <div className="summary-line">
              <span>Mint destination wallet address</span>
              <strong>{mintDestinationWalletAddress ?? "Not linked"}</strong>
            </div>
          </article>

          <article className="panel">
            <PanelHeader title="Mint History" meta="Dedicated historical mint collection" />
            <div className="s52-history-filters">
              <label>
                <span>Search</span>
                <input
                  onChange={(event) => {
                    setMintHistoryPage(1);
                    setMintSearch(event.target.value);
                  }}
                  placeholder="Search by mint id, wire, ADA, provider, amount"
                  value={mintSearch}
                />
              </label>
              <label>
                <span>Status</span>
                <select
                  onChange={(event) => {
                    setMintHistoryPage(1);
                    setMintStatusFilter(event.target.value);
                  }}
                  value={mintStatusFilter}
                >
                  <option value="all">All</option>
                  <option value="completed">Completed</option>
                  <option value="failed">Failed</option>
                </select>
              </label>
              <label>
                <span>Page Size</span>
                <select
                  onChange={(event) => {
                    setMintHistoryPage(1);
                    setMintHistoryPageSize(Number(event.target.value));
                  }}
                  value={String(mintHistoryPageSize)}
                >
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
            </div>
            <div className="panel-actions">
              <button className="action-button" disabled={!mintHistory.length} onClick={() => exportMintHistoryCsv(mintHistory)} type="button">
                Export Page CSV
              </button>
              <button className="action-button" disabled={busyAction === "export-all-mints"} onClick={() => void exportAllFilteredMintHistoryCsv()} type="button">
                Export All Filtered CSV
              </button>
              {busyAction === "export-all-mints" && mintExportProgress ? (
                <span className="s52-history-export-progress" aria-live="polite">
                  Exporting {mintExportProgress.currentPage}/{mintExportProgress.totalPages} pages...
                </span>
              ) : null}
              <span className="s52-history-summary">
                Page {mintHistoryPage} of {mintHistoryTotalPages} • {mintHistoryTotal} records
              </span>
            </div>
            <div className="table">
              <div className="table-row table-head">
                <span>Mint</span>
                <span>Wire</span>
                <span>Target ADA</span>
                <span>Amount</span>
                <span>Status</span>
                <span>Created</span>
              </div>
              {mintHistory.map((item) => (
                <div className="table-row s52-table-row" key={item.id}>
                  <span>{item.id}</span>
                  <span>{item.wireAccountId}</span>
                  <span>{item.targetAccountOfDigitalAssetId}</span>
                  <span>{formatMinorUnits(item.amountMinorUnits)}</span>
                  <StatusBadge label={item.status ?? "unknown"} tone={statusTone(item.status)} />
                  <span>{new Date(item.createdAt).toLocaleString()}</span>
                </div>
              ))}
              {!mintHistory.length ? <div className="table-row">No mint records match current filters.</div> : null}
            </div>
            <div className="panel-actions">
              <button
                className="action-button"
                disabled={!mintHistoryHasPreviousPage || mintHistoryPage <= 1}
                onClick={() => setMintHistoryPage(1)}
                type="button"
              >
                First
              </button>
              <button
                className="action-button"
                disabled={!mintHistoryHasPreviousPage}
                onClick={() => setMintHistoryPage((value) => Math.max(1, value - 1))}
                type="button"
              >
                Previous
              </button>
              <button
                className="action-button"
                disabled={!mintHistoryHasNextPage}
                onClick={() => setMintHistoryPage((value) => value + 1)}
                type="button"
              >
                Next
              </button>
              <button
                className="action-button"
                disabled={!mintHistoryHasNextPage || mintHistoryPage >= mintHistoryTotalPages}
                onClick={() => setMintHistoryPage(mintHistoryTotalPages)}
                type="button"
              >
                Last
              </button>
            </div>
          </article>
        </>
      )}

      <footer className="panel s52-footer">
        <SummaryLine label="Policy" value="Client fiat must mock-pay Platform wire account only" />
        <SummaryLine label="Guardrail" value="No direct client to Circle payee path in Sprint 5-2" />
      </footer>
    </section>
  );
};

const statusTone = (status?: string): "ready" | "attention" | "blocked" | "neutral" => {
  if (!status) return "neutral";
  if (["active", "available", "completed"].includes(status)) return "ready";
  if (["expired", "failed", "cancelled"].includes(status)) return "blocked";
  if (["released", "provisioning", "reserved", "requested", "submitted"].includes(status)) return "attention";
  return "neutral";
};

const toMinorUnitsString = (value: string): string => {
  const [wholeRaw, fractionRaw = ""] = value.trim().split(".");
  const whole = wholeRaw.replace(/[^0-9-]/g, "") || "0";
  const fraction = fractionRaw.replace(/[^0-9]/g, "").slice(0, 6).padEnd(6, "0");
  return `${whole}${fraction}`;
};

const formatMinorUnits = (value?: string): string => formatMintHistoryMinorUnits(value);

const exportMintHistoryCsv = (rows: MintHistoryRecord[]) => {
  const csv = buildMintHistoryCsv(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = `mint-history-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
};

const idempotencyHeader = (prefix: string): Record<string, string> => ({
  "idempotency-key": `${prefix}-${crypto.randomUUID()}`
});

const apiFetch = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${apiBaseUrl.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${gttApiKey}`,
      ...(init.headers ?? {})
    }
  });
  const payload = await response.json() as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error([payload.error ?? `request_failed:${response.status}`, payload.detail].filter(Boolean).join(": "));
  }
  return payload;
};
