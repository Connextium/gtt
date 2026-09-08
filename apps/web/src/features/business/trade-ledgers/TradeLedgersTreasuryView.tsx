import { useMemo } from "react";

type LedgerCurrency = "USDC" | "EURC" | "USD";

type LedgerStatus = "active" | "pending_internal_approval" | "draft";

export interface TradeLedgersAccount {
  id: string;
  code: string;
  displayName: string;
  purpose: string;
  currency: LedgerCurrency;
  status: LedgerStatus;
  balance: number;
}

export interface TradeLedgersTransfer {
  id: string;
  fromAdaId: string;
  toAdaId: string;
  amount: number;
  currency: LedgerCurrency;
  timestamp: string;
  referenceNote?: string;
}

export function TradeLedgersTreasuryView({
  accounts,
  onInitiateTransfer,
  onOpenProvisionWizard,
  transfers
}: {
  accounts: TradeLedgersAccount[];
  onInitiateTransfer: () => void;
  onOpenProvisionWizard: () => void;
  transfers: TradeLedgersTransfer[];
}) {
  const moneyFormat = useMemo(
    () => new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    []
  );

  const usdcAccounts = accounts.filter((account) => account.currency === "USDC");
  const eurcAccounts = accounts.filter((account) => account.currency === "EURC");
  const usdAccounts = accounts.filter((account) => account.currency === "USD");

  const usdcTotal = usdcAccounts.reduce((sum, account) => sum + account.balance, 0);
  const eurcTotal = eurcAccounts.reduce((sum, account) => sum + account.balance, 0);
  const usdTotal = usdAccounts.reduce((sum, account) => sum + account.balance, 0);
  const grandTotalUsdEq = usdcTotal + eurcTotal * 1.08 + usdTotal;

  return (
    <section className="bc-ledger-root" id="trade-ledgers">
      <article className="bc-ledger-header bc-ledger-frame">
        <div>
          <p className="bc-ledger-meta">CLIENT PORTAL // TREASURY CONSOLE</p>
          <h2>Institutional Client Treasury</h2>
          <p className="bc-ledger-subtitle">
            Multi-currency liquidity position, active subledgers, and netted settlement rails.
          </p>
        </div>
        <div className="bc-ledger-actions">
          <button className="bc-ledger-button bc-ledger-button-secondary" onClick={onInitiateTransfer} type="button">
            Virtual Transfer
          </button>
          <button className="bc-ledger-button bc-ledger-button-primary" onClick={onOpenProvisionWizard} type="button">
            + Open ADA
          </button>
        </div>
      </article>

      <article className="bc-ledger-stats">
        <section className="bc-ledger-stat bc-ledger-stat-primary">
          <p>NET LIQUIDITY POSITION</p>
          <strong>${moneyFormat.format(grandTotalUsdEq)}</strong>
          <small>100% SEC-OPS VERIFIED</small>
        </section>
        <section className="bc-ledger-stat">
          <header>
            <span>USDC SUBLEDGERS</span>
            <b>{usdcAccounts.length} ACCOUNTS</b>
          </header>
          <strong>${moneyFormat.format(usdcTotal)}</strong>
          <small>Circle Native Mint</small>
        </section>
        <section className="bc-ledger-stat">
          <header>
            <span>EURC SUBLEDGERS</span>
            <b>{eurcAccounts.length} ACCOUNTS</b>
          </header>
          <strong>EUR {moneyFormat.format(eurcTotal)}</strong>
          <small>Euro Token Subledger</small>
        </section>
        <section className="bc-ledger-stat">
          <header>
            <span>USD FIAT LEDGER</span>
            <b>{usdAccounts.length} ACCOUNTS</b>
          </header>
          <strong>${moneyFormat.format(usdTotal)}</strong>
          <small>Pending Wire Approvals</small>
        </section>
      </article>

      <article className="bc-ledger-grid">
        <section className="bc-ledger-frame bc-ledger-main">
          <header>
            <h3>Active Subledger Position</h3>
            <span>{accounts.length} TOTAL ADA</span>
          </header>
          <div className="bc-ledger-list">
            {accounts.length === 0 ? (
              <p className="bc-ledger-empty">No ADA accounts have been provisioned yet.</p>
            ) : (
              accounts.map((account) => {
                const statusLabel = account.status.replaceAll("_", " ").toUpperCase();
                return (
                  <div className="bc-ledger-row" key={account.id}>
                    <div>
                      <div className="bc-ledger-row-title">
                        <strong>{account.code}</strong>
                        <mark>{account.currency}</mark>
                        <span className={`bc-ledger-pill bc-ledger-pill-${account.status}`}>{statusLabel}</span>
                      </div>
                      <p>{account.displayName}</p>
                    </div>
                    <div className="bc-ledger-balance">
                      <strong>${moneyFormat.format(account.balance)}</strong>
                      <small>{account.purpose}</small>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="bc-ledger-frame bc-ledger-transfers">
          <header>
            <h3>Internal Transfer Activity</h3>
            <span>NETTING</span>
          </header>
          <div className="bc-ledger-transfer-list">
            {transfers.length === 0 ? (
              <p className="bc-ledger-empty">No transfers executed yet.</p>
            ) : (
              transfers.map((transfer) => (
                <article className="bc-ledger-transfer-row" key={transfer.id}>
                  <div>
                    <strong>{transfer.id}</strong>
                    <b>
                      ${moneyFormat.format(transfer.amount)} {transfer.currency}
                    </b>
                  </div>
                  <p>
                    From: <strong>{transfer.fromAdaId}</strong> to <strong>{transfer.toAdaId}</strong>
                  </p>
                  <small>
                    {transfer.timestamp}
                    {transfer.referenceNote ? ` - ${transfer.referenceNote}` : ""}
                  </small>
                </article>
              ))
            )}
          </div>
        </section>
      </article>
    </section>
  );
}
