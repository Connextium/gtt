import { CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../shared/apiClient.js";
import { ProvisionFiatAdaScreen } from "./source/components/ProvisionFiatAdaScreen.js";
import { ProvisionWalletAdaScreen } from "./source/components/ProvisionWalletAdaScreen.js";
import { RegisterFiatRailScreen } from "./source/components/RegisterFiatRailScreen.js";
import { RegisterWalletRailScreen } from "./source/components/RegisterWalletRailScreen.js";
import { type FiatAdaItem, type FiatRailItem, type ScreenType, type WalletAdaItem, type WalletRailItem } from "./source/types.js";
import "./source/index.css";

type BusinessAdaApi = {
  id: string;
  accountCode?: string;
  accountName: string;
  status: string;
  usePurpose: string;
  assetCode?: string;
  assetRail?: string;
  balances?: {
    availableMinorUnits?: string;
    updatedAt?: string;
  };
};

type LinkedInstrumentApi = {
  id: string;
  instrumentType: string;
  purpose?: string;
  railCode?: string;
  railName?: string;
  railType?: string;
  assetCode?: string;
  status: string;
  networkCode?: string;
  isDefault?: boolean;
  provider?: string;
  verificationStatus?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

type LinkedByAccount = Record<string, LinkedInstrumentApi[]>;

type AdaDraftKind = "fiat-rail" | "fiat-ada" | "wallet-rail" | "wallet-ada";

type AdaDraftEntry = {
  id: string;
  kind: AdaDraftKind;
  isNew: boolean;
  createdAt: string;
  item: FiatRailItem | FiatAdaItem | WalletRailItem | WalletAdaItem;
  lastError?: string;
};

const ADA_DRAFTS_STORAGE_KEY = "gtt:business-client-ada:drafts:v1";

const usd = (minor?: string): string => {
  const parsed = Number(minor ?? "0");
  if (!Number.isFinite(parsed)) return "$0.00 USD";
  return `$${(parsed / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
};

const shortDate = (iso?: string): string => {
  if (!iso) return "Just now";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").slice(0, 16);
};

const isFiatInstrument = (item: LinkedInstrumentApi): boolean =>
  item.railType === "fiat" || item.instrumentType.includes("fiat");

const toFiatPurpose = (purpose?: string): FiatRailItem["settlementPurpose"] => {
  const value = (purpose ?? "").toLowerCase();
  if (value.includes("dual") || value.includes("both") || value.includes("bidirectional")) return "DUAL_ACTIVE";
  if (value.includes("redemption") || value.includes("off")) return "OFF_RAMP";
  return "ON_RAMP";
};

const toLinkedPurpose = (purpose: FiatRailItem["settlementPurpose"]): string => {
  if (purpose === "DUAL_ACTIVE") return "bidirectional";
  if (purpose === "OFF_RAMP") return "redemption";
  return "minting";
};

const statusToFiatAda = (status: string): FiatAdaItem["status"] => {
  if (status === "active") return "ACTIVE_ON_LEDGER";
  if (status === "pending_activation") return "PROVISIONING";
  return "RESTRICTED_SWEEP";
};

const statusToWalletAda = (status: string): WalletAdaItem["status"] => {
  if (status === "active") return "ACTIVE_ON_LEDGER";
  if (status === "pending_activation") return "PENDING_KEY_ASSIGNMENT";
  return "FROZEN";
};

const splitCompositeId = (id: string): { accountId: string; linkedInstrumentId: string } | null => {
  const index = id.indexOf("::");
  if (index <= 0) return null;
  return {
    accountId: id.slice(0, index),
    linkedInstrumentId: id.slice(index + 2)
  };
};

export function BusinessClientAdaModule({ token }: { token: string }) {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>("REGISTER_FIAT_RAIL");
  const [accounts, setAccounts] = useState<BusinessAdaApi[]>([]);
  const [linkedByAccount, setLinkedByAccount] = useState<LinkedByAccount>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const [draftCount, setDraftCount] = useState(0);

  const readDrafts = (): AdaDraftEntry[] => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(ADA_DRAFTS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed as AdaDraftEntry[];
    } catch {
      return [];
    }
  };

  const writeDrafts = (entries: AdaDraftEntry[]) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(ADA_DRAFTS_STORAGE_KEY, JSON.stringify(entries));
    setDraftCount(entries.length);
  };

  const enqueueDraft = (entry: Omit<AdaDraftEntry, "id" | "createdAt">, errorMessage: string) => {
    const next: AdaDraftEntry = {
      ...entry,
      id: `${entry.kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      lastError: errorMessage
    };
    const drafts = readDrafts();
    writeDrafts([next, ...drafts]);
  };

  const removeDraftById = (id: string) => {
    const drafts = readDrafts();
    writeDrafts(drafts.filter((item) => item.id !== id));
  };

  const showNotification = (message: string) => {
    setNotification(message);
    setTimeout(() => {
      setNotification((prev) => (prev === message ? null : prev));
    }, 4500);
  };

  const loadLiveData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError("");
    try {
      const accountResponse = await apiRequest<{ accounts?: BusinessAdaApi[] }>("/business/accounts-of-digital-asset", { token });
      const resolvedAccounts = accountResponse.accounts ?? [];
      const linkedPairs = await Promise.all(
        resolvedAccounts.map(async (account) => {
          const payload = await apiRequest<{ linkedInstruments?: LinkedInstrumentApi[] }>(
            `/business/accounts-of-digital-asset/${encodeURIComponent(account.id)}/linked-instruments`,
            { token }
          ).catch(() => ({ linkedInstruments: [] }));
          return [account.id, payload.linkedInstruments ?? []] as const;
        })
      );
      const nextLinkedByAccount: LinkedByAccount = {};
      for (const [accountId, linked] of linkedPairs) nextLinkedByAccount[accountId] = linked;
      setAccounts(resolvedAccounts);
      setLinkedByAccount(nextLinkedByAccount);
    } catch (error) {
      setAccounts([]);
      setLinkedByAccount({});
      setLoadError(error instanceof Error ? error.message : "ada_registry_live_load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadLiveData();
  }, [loadLiveData]);

  useEffect(() => {
    setDraftCount(readDrafts().length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fiatRails = useMemo<FiatRailItem[]>(() => {
    const rows: FiatRailItem[] = [];
    for (const account of accounts) {
      const linked = linkedByAccount[account.id] ?? [];
      for (const rail of linked.filter(isFiatInstrument)) {
        const metadata = rail.metadata ?? {};
        const routing = typeof metadata.routingNumber === "string" ? metadata.routingNumber : (rail.networkCode ?? "000000000");
        const masked = typeof metadata.accountNumberLast4 === "string" ? metadata.accountNumberLast4 : "0000";
        rows.push({
          id: `${account.id}::${rail.id}`,
          railNickname: rail.railName ?? rail.railCode ?? "Linked Fiat Rail",
          bankingInstitution: typeof metadata.bankName === "string" ? metadata.bankName : "Linked Financial Institution",
          routingTransitId: routing,
          accountNumber: masked,
          settlementPurpose: toFiatPurpose(rail.purpose),
          currencyCode: rail.assetCode ?? account.assetCode ?? "USD",
          beneficiaryName: account.accountName,
          taxId: "N/A",
          streetAddress: "On File",
          city: "N/A",
          state: "N/A",
          zipCode: "N/A",
          country: "N/A",
          autoProvisionAda: true,
          status: rail.status === "active" ? "ACTIVE_VERIFIED" : rail.status === "disabled" ? "DEACTIVATED" : "PENDING_ATTESTATION",
          clearingProtocol: rail.provider === "bank" ? "FEDWIRE_DIRECT" : "SWIFT_MT103",
          lastActive: shortDate(rail.updatedAt ?? rail.createdAt)
        });
      }
    }
    return rows;
  }, [accounts, linkedByAccount]);

  const walletRails = useMemo<WalletRailItem[]>(() => {
    const rows: WalletRailItem[] = [];
    for (const account of accounts) {
      const linked = linkedByAccount[account.id] ?? [];
      for (const rail of linked.filter((item) => !isFiatInstrument(item))) {
        const metadata = rail.metadata ?? {};
        const address = typeof metadata.address === "string"
          ? metadata.address
          : (typeof metadata.walletAddress === "string" ? metadata.walletAddress : "0x");
        const purpose = (rail.purpose ?? "").toLowerCase();
        rows.push({
          id: `${account.id}::${rail.id}`,
          railId: rail.railCode ?? rail.id,
          walletLabel: rail.railName ?? account.accountName,
          networkProtocol: rail.networkCode ?? account.assetRail ?? "Ethereum Mainnet",
          addressSecurityType: "Institutional Custody (MPC)",
          destinationAddress: address,
          allowMintExternalization: purpose !== "internal_only",
          allowIntraClientTransfer: purpose.includes("transfer") || purpose.includes("settlement") || purpose === "",
          allowInterClientPayment: purpose.includes("payment") || purpose.includes("bidirectional"),
          signaturePayload: typeof metadata.walletId === "string" ? metadata.walletId : "0x",
          autoBindWalletAda: Boolean(rail.isDefault),
          status: rail.status === "active" ? "WHITELIST_ACTIVE" : rail.status === "disabled" ? "SUSPENDED" : "AWAITING_QUORUM",
          travelRuleStatus: rail.verificationStatus ?? "IVMS101_ATTESTED",
          registeredAt: shortDate(rail.createdAt)
        });
      }
    }
    return rows;
  }, [accounts, linkedByAccount]);

  const fiatAdas = useMemo<FiatAdaItem[]>(() =>
    accounts
      .filter((account) => {
        const linked = linkedByAccount[account.id] ?? [];
        return account.assetRail?.includes("wire") || linked.some(isFiatInstrument);
      })
      .map((account) => ({
        id: account.id,
        accountId: account.accountCode ?? account.id,
        accountDisplayName: account.accountName,
        underlyingCurrency: `${(account.assetCode ?? "USD").toUpperCase()} (Configured)`,
        settlementVehicle: account.assetRail ?? "commercial_wire",
        selectedRail: (linkedByAccount[account.id] ?? []).find(isFiatInstrument)?.railName ?? "No linked fiat rail",
        balance: usd(account.balances?.availableMinorUnits),
        minOperatingBalance: "250,000.00",
        targetSweepTrigger: "5,000,000.00",
        allowFunding: true,
        allowRedemption: true,
        status: statusToFiatAda(account.status),
        ledgerNode: "GTT-LIVE",
        lastReconciliation: shortDate(account.balances?.updatedAt)
      })),
    [accounts, linkedByAccount]
  );

  const walletAdas = useMemo<WalletAdaItem[]>(() =>
    accounts
      .filter((account) => {
        const linked = linkedByAccount[account.id] ?? [];
        return account.assetRail?.includes("wallet") || linked.some((item) => !isFiatInstrument(item));
      })
      .map((account) => {
        const primaryRail = (linkedByAccount[account.id] ?? []).find((item) => !isFiatInstrument(item));
        const metadata = primaryRail?.metadata ?? {};
        const address = typeof metadata.address === "string"
          ? metadata.address
          : (typeof metadata.walletAddress === "string" ? metadata.walletAddress : "0x");
        const purpose = (primaryRail?.purpose ?? "").toLowerCase();
        return {
          id: account.id,
          accountId: account.accountCode ?? account.id,
          accountDisplayName: account.accountName,
          denominationAsset: `${(account.assetCode ?? "USDC").toUpperCase()} (On-Chain Digital Dollar)`,
          settlementNetwork: primaryRail?.networkCode ?? account.assetRail ?? "wallet_blockchain",
          selectedWalletRail: primaryRail?.railName ?? "No linked wallet rail",
          boundAddress: address,
          balance: usd(account.balances?.availableMinorUnits).replace(" USD", " USDC"),
          allowTransfer: purpose.includes("transfer") || purpose.includes("settlement") || purpose === "",
          allowPayment: purpose.includes("payment") || purpose.includes("bidirectional"),
          status: statusToWalletAda(account.status),
          isolationLevel: "TIER_1_MPC_ENCLAVE",
          lastAttestation: shortDate(primaryRail?.updatedAt ?? primaryRail?.createdAt)
        };
      }),
    [accounts, linkedByAccount]
  );

  const upsertLinkedInstrument = async (accountId: string, payload: Record<string, unknown>, linkedInstrumentId?: string) => {
    const path = linkedInstrumentId
      ? `/business/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments/${encodeURIComponent(linkedInstrumentId)}`
      : `/business/accounts-of-digital-asset/${encodeURIComponent(accountId)}/linked-instruments`;
    await apiRequest(path, {
      method: linkedInstrumentId ? "PATCH" : "POST",
      token,
      body: payload
    });
  };

  const handleSaveFiatRail = async (item: FiatRailItem, isNew: boolean) => {
    const existing = splitCompositeId(item.id);
    const accountId = existing?.accountId ?? fiatAdas[0]?.id ?? accounts[0]?.id;
    if (!accountId) throw new Error("No ADA account available for fiat rail operation.");
    await upsertLinkedInstrument(accountId, {
      instrumentType: "fiat_wire_bank_account",
      railType: "fiat",
      purpose: toLinkedPurpose(item.settlementPurpose),
      railCode: item.railNickname.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      railName: item.railNickname,
      assetCode: item.currencyCode || "USD",
      provider: "bank",
      status: item.status === "DEACTIVATED" ? "disabled" : "active",
      networkCode: item.routingTransitId,
      metadata: {
        bankName: item.bankingInstitution,
        routingNumber: item.routingTransitId,
        accountNumberLast4: item.accountNumber.slice(-4)
      },
      bankingInstitution: item.bankingInstitution,
      routingNumber: item.routingTransitId,
      accountNumber: item.accountNumber
    }, isNew ? undefined : existing?.linkedInstrumentId);
    await loadLiveData();
  };

  const handleDeleteFiatRail = async (id: string) => {
    const existing = splitCompositeId(id);
    if (!existing) return;
    await upsertLinkedInstrument(existing.accountId, { status: "disabled" }, existing.linkedInstrumentId);
    await loadLiveData();
  };

  const handleSaveFiatAda = async (item: FiatAdaItem, isNew: boolean) => {
    if (isNew) {
      await apiRequest("/business/accounts-of-digital-asset", {
        method: "POST",
        token,
        body: {
          accountName: item.accountDisplayName,
          usePurpose: "settlement",
          topology: "fiat-linked",
          assetCode: "USD",
          assetRail: "commercial_wire"
        }
      });
    } else {
      await apiRequest(`/business/accounts-of-digital-asset/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        token,
        body: {
          accountName: item.accountDisplayName,
          assetRail: item.settlementVehicle,
          status: item.status === "ACTIVE_ON_LEDGER" ? "active" : item.status === "PROVISIONING" ? "pending_activation" : "restricted"
        }
      });
    }
    await loadLiveData();
  };

  const handleDeleteFiatAda = async (id: string) => {
    await apiRequest(`/business/accounts-of-digital-asset/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: { status: "restricted" }
    });
    await loadLiveData();
  };

  const handleSaveWalletRail = async (item: WalletRailItem, isNew: boolean) => {
    const existing = splitCompositeId(item.id);
    const accountId = existing?.accountId ?? walletAdas[0]?.id ?? accounts[0]?.id;
    if (!accountId) throw new Error("No ADA account available for wallet rail operation.");
    await upsertLinkedInstrument(accountId, {
      instrumentType: "on_chain_wallet",
      railType: "on-chain",
      purpose: item.allowInterClientPayment ? "payment" : (item.allowIntraClientTransfer ? "settlement" : "custody"),
      railCode: item.railId,
      railName: item.walletLabel,
      assetCode: "USDC",
      networkCode: item.networkProtocol,
      isDefault: item.autoBindWalletAda,
      status: item.status === "SUSPENDED" ? "disabled" : "active",
      metadata: {
        walletAddress: item.destinationAddress,
        address: item.destinationAddress,
        walletId: item.signaturePayload
      },
      destinationAddress: item.destinationAddress,
      walletAddress: item.destinationAddress,
      walletId: item.signaturePayload
    }, isNew ? undefined : existing?.linkedInstrumentId);
    await loadLiveData();
  };

  const handleDeleteWalletRail = async (id: string) => {
    const existing = splitCompositeId(id);
    if (!existing) return;
    await upsertLinkedInstrument(existing.accountId, { status: "disabled" }, existing.linkedInstrumentId);
    await loadLiveData();
  };

  const handleSaveWalletAda = async (item: WalletAdaItem, isNew: boolean) => {
    if (isNew) {
      await apiRequest("/business/accounts-of-digital-asset", {
        method: "POST",
        token,
        body: {
          accountName: item.accountDisplayName,
          usePurpose: "settlement",
          topology: "wallet-linked",
          assetCode: "USDC",
          assetRail: "wallet_blockchain"
        }
      });
    } else {
      await apiRequest(`/business/accounts-of-digital-asset/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        token,
        body: {
          accountName: item.accountDisplayName,
          assetRail: item.settlementNetwork,
          status: item.status === "ACTIVE_ON_LEDGER" ? "active" : item.status === "PENDING_KEY_ASSIGNMENT" ? "pending_activation" : "restricted"
        }
      });
    }
    await loadLiveData();
  };

  const executeDraft = async (draft: AdaDraftEntry) => {
    switch (draft.kind) {
      case "fiat-rail":
        await handleSaveFiatRail(draft.item as FiatRailItem, draft.isNew);
        return;
      case "fiat-ada":
        await handleSaveFiatAda(draft.item as FiatAdaItem, draft.isNew);
        return;
      case "wallet-rail":
        await handleSaveWalletRail(draft.item as WalletRailItem, draft.isNew);
        return;
      case "wallet-ada":
        await handleSaveWalletAda(draft.item as WalletAdaItem, draft.isNew);
        return;
      default:
        return;
    }
  };

  const retryDrafts = useCallback(async () => {
    const drafts = readDrafts();
    if (!drafts.length) return;
    const remaining: AdaDraftEntry[] = [];
    let recovered = 0;

    for (const draft of drafts) {
      try {
        await executeDraft(draft);
        recovered += 1;
      } catch (error) {
        remaining.push({
          ...draft,
          lastError: error instanceof Error ? error.message : "retry_failed"
        });
      }
    }

    writeDrafts(remaining);
    if (recovered > 0) {
      await loadLiveData();
      showNotification(
        remaining.length > 0
          ? `${recovered} draft item(s) recovered. ${remaining.length} still pending.`
          : `${recovered} draft item(s) recovered.`
      );
    }
  }, [loadLiveData]);

  const handleDeleteWalletAda = async (id: string) => {
    await apiRequest(`/business/accounts-of-digital-asset/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: { status: "restricted" }
    });
    await loadLiveData();
  };

  const runAction = async (
    successMessage: string,
    action: () => Promise<void>,
    draft?: Omit<AdaDraftEntry, "id" | "createdAt">
  ) => {
    try {
      await action();
      showNotification(successMessage);
    } catch (error) {
      const message = error instanceof Error ? error.message : "operation_failed";
      if (draft) {
        enqueueDraft(draft, message);
        showNotification(`Unable to complete action: ${message}. Saved as draft for retry.`);
      } else {
        showNotification(`Unable to complete action: ${message}`);
      }
    }
  };

  useEffect(() => {
    if (!token) return;
    void retryDrafts();
  }, [retryDrafts, token]);

  return (
    <div className="bc-ada-source-scope">
      {loadError ? (
        <div className="mx-4 mt-4 border border-[#d7c4c4] bg-[#fff5f5] text-[#832727] px-3 py-2 text-xs font-mono">
          LIVE DATA LOAD ERROR: {loadError}
        </div>
      ) : null}

      <div className="border-b border-[#ddd7cd] px-4 py-3 bg-[#f7f4ed] flex flex-wrap items-center gap-2">
        <button
          className={`px-3 py-1 text-[10px] font-mono uppercase border ${currentScreen === "REGISTER_FIAT_RAIL" ? "bg-black text-white border-black" : "bg-white text-[#4b4546] border-[#d4cdc2]"}`}
          onClick={() => setCurrentScreen("REGISTER_FIAT_RAIL")}
          type="button"
        >
          Fiat Rails
        </button>
        <button
          className={`px-3 py-1 text-[10px] font-mono uppercase border ${currentScreen === "PROVISION_FIAT_ADA" ? "bg-black text-white border-black" : "bg-white text-[#4b4546] border-[#d4cdc2]"}`}
          onClick={() => setCurrentScreen("PROVISION_FIAT_ADA")}
          type="button"
        >
          Fiat ADA
        </button>
        <button
          className={`px-3 py-1 text-[10px] font-mono uppercase border ${currentScreen === "REGISTER_WALLET_RAIL" ? "bg-black text-white border-black" : "bg-white text-[#4b4546] border-[#d4cdc2]"}`}
          onClick={() => setCurrentScreen("REGISTER_WALLET_RAIL")}
          type="button"
        >
          Wallet Rails
        </button>
        <button
          className={`px-3 py-1 text-[10px] font-mono uppercase border ${currentScreen === "PROVISION_WALLET_ADA" ? "bg-black text-white border-black" : "bg-white text-[#4b4546] border-[#d4cdc2]"}`}
          onClick={() => setCurrentScreen("PROVISION_WALLET_ADA")}
          type="button"
        >
          Wallet ADA
        </button>
        <span className="ml-auto text-[10px] font-mono uppercase text-[#746c62]">
          {loading ? "Syncing live data..." : `${accounts.length} live ADA accounts`}
        </span>
        <button
          className="px-3 py-1 text-[10px] font-mono uppercase border bg-white text-[#4b4546] border-[#d4cdc2]"
          onClick={() => { void retryDrafts(); }}
          type="button"
        >
          Retry Drafts ({draftCount})
        </button>
      </div>

      <div className="bc-ada-content-host">
        {currentScreen === "REGISTER_FIAT_RAIL" ? (
          <RegisterFiatRailScreen
            items={fiatRails}
            onDeleteItem={(id) => { void runAction("Fiat rail deactivated.", async () => handleDeleteFiatRail(id)); }}
            onNavigate={setCurrentScreen}
            onSaveItem={(item, isNew) => {
              void runAction(
                isNew ? "Fiat rail created." : "Fiat rail updated.",
                async () => handleSaveFiatRail(item, isNew),
                { kind: "fiat-rail", isNew, item }
              );
            }}
            onShowNotification={showNotification}
          />
        ) : null}

        {currentScreen === "PROVISION_FIAT_ADA" ? (
          <ProvisionFiatAdaScreen
            fiatRails={fiatRails}
            items={fiatAdas}
            onDeleteItem={(id) => { void runAction("Fiat ADA restricted.", async () => handleDeleteFiatAda(id)); }}
            onNavigate={setCurrentScreen}
            onSaveItem={(item, isNew) => {
              void runAction(
                isNew ? "Fiat ADA provisioned." : "Fiat ADA updated.",
                async () => handleSaveFiatAda(item, isNew),
                { kind: "fiat-ada", isNew, item }
              );
            }}
            onShowNotification={showNotification}
          />
        ) : null}

        {currentScreen === "REGISTER_WALLET_RAIL" ? (
          <RegisterWalletRailScreen
            items={walletRails}
            onDeleteItem={(id) => { void runAction("Wallet rail suspended.", async () => handleDeleteWalletRail(id)); }}
            onNavigate={setCurrentScreen}
            onSaveItem={(item, isNew) => {
              void runAction(
                isNew ? "Wallet rail created." : "Wallet rail updated.",
                async () => handleSaveWalletRail(item, isNew),
                { kind: "wallet-rail", isNew, item }
              );
            }}
            onShowNotification={showNotification}
          />
        ) : null}

        {currentScreen === "PROVISION_WALLET_ADA" ? (
          <ProvisionWalletAdaScreen
            items={walletAdas}
            onDeleteItem={(id) => { void runAction("Wallet ADA restricted.", async () => handleDeleteWalletAda(id)); }}
            onNavigate={setCurrentScreen}
            onSaveItem={(item, isNew) => {
              void runAction(
                isNew ? "Wallet ADA provisioned." : "Wallet ADA updated.",
                async () => handleSaveWalletAda(item, isNew),
                { kind: "wallet-ada", isNew, item }
              );
            }}
            onShowNotification={showNotification}
            walletRails={walletRails}
          />
        ) : null}
      </div>

      {notification ? (
        <div className="fixed bottom-6 right-6 z-50 bg-black text-white px-4 py-3 border border-black shadow-2xl flex items-center gap-3 text-xs font-mono max-w-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="leading-snug">{notification}</span>
          <button
            className="text-[#888] hover:text-white ml-auto text-xs uppercase"
            onClick={() => setNotification(null)}
            type="button"
          >
            &times;
          </button>
        </div>
      ) : null}
    </div>
  );
}
