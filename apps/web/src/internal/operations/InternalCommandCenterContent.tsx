import { ArrowLeftRight, CheckCircle2, Database, Key, RefreshCcw, Zap } from "lucide-react";
import type { ComponentType } from "react";

interface ServiceStatus {
  name: string;
  value: string;
  detail: string;
  status: string;
  latency: string;
  icon: ComponentType<{ size?: number }>;
  tone?: "blocked";
}

interface WebhookEvent {
  ts: string;
  event: string;
  status: string;
  latency: string;
  id: string;
  error?: boolean;
}

const BG_URL = "https://lh3.googleusercontent.com/aida/AP1WRLt6Oeb_mYoWweqsujJgD7h8ivBfuZ6JueM-CSFUbTT5RYJgqxbsEpkm9RgHzxkK2Nn1ofE82_uVY0cO5KZpxU96XDGmbeBYlJABV64Zii_BWZSH6qDzS4AJ4MzTQb1D39M910WSVLKQJme4qrdxkhwPP5DeSzzFpfO6Bd1qa6hM7M9HMZ7k5fsPwP_rxGVag15HgHk8a77rUu2mF8ixVS5Qz7umPZmwYW515r7NWf6lQ94Z2BJ3fvYii2A";

const services: ServiceStatus[] = [
  { name: "Circle API", value: "99.98%", detail: "Uptime (30d)", status: "Operational", latency: "482ms", icon: RefreshCcw },
  { name: "PostgreSQL Cluster", value: "99.99%", detail: "Synchronized", status: "Operational", latency: "4ms", icon: Database },
  { name: "Redis Cache", value: "100.0%", detail: "Cache hit rate", status: "Operational", latency: "0.2ms", icon: Zap },
  { name: "Webhook Listener", value: "98.2%", detail: "Degraded (throttled)", status: "Degraded", latency: "1.2s", icon: ArrowLeftRight, tone: "blocked" },
  { name: "IDP/Auth Service", value: "99.99%", detail: "Stable entropy", status: "Operational", latency: "22ms", icon: Key }
];

const ledgerRows = [
  { internal: "Operational Float", external: "Primary Minting Account", value: "$1,240,582.44" },
  { internal: "Customer Escrow", external: "USDC Treasury Hub", value: "$42,900,115.82" },
  { internal: "Reserve Vault", external: "Vault Cold Wallet", value: "$15,000,000.00" }
] as const;

const webhookEvents: WebhookEvent[] = [
  { ts: "14:32:01.004", event: "transfer.created", status: "200 OK", latency: "12ms", id: "tx_8832_aef9011" },
  { ts: "14:31:58.291", event: "wallet.balance.updated", status: "200 OK", latency: "45ms", id: "wb_1120_cc02881" },
  { ts: "14:31:45.112", event: "transfer.failed", status: "429 RATE", latency: "1200ms", id: "tx_0019_ff33221", error: true },
  { ts: "14:31:40.005", event: "payment.succeeded", status: "200 OK", latency: "18ms", id: "pm_9921_bc99100" },
  { ts: "14:31:32.441", event: "payout.created", status: "202 ACPT", latency: "22ms", id: "po_2288_xz00119" },
  { ts: "14:31:22.001", event: "compliance.screened", status: "200 OK", latency: "156ms", id: "sc_5512_pp92113" },
  { ts: "14:31:18.882", event: "account.created", status: "200 OK", latency: "14ms", id: "ac_7711_gg00122" }
];

export const InternalCommandCenterContent = () => (
  <>
    <div className="command-center-backdrop" style={{ backgroundImage: `url("${BG_URL}")` }} />

    <div className="command-center-content">
      <div className="command-center-status">
        <div>
          <span className="command-center-pulse" />
          <div>
            <h1>System operational</h1>
            <p>All services reporting within tolerance</p>
          </div>
        </div>
        <div>
          <span>Last heartbeat: 2024-05-24 14:32:01.004 UTC</span>
          <span>Idle latency: 14ms (optimal)</span>
        </div>
      </div>

      <div className="command-center-grid">
        {services.map((service) => {
          const Icon = service.icon;
          return (
            <article className={`command-center-service ${service.tone ?? ""}`} key={service.name}>
              <div>
                <span>{service.name}</span>
                <Icon size={18} />
              </div>
              <span className="command-center-service-value">{service.value}</span>
              <small>{service.detail}</small>
              <footer>
                <span>{service.status}</span>
                <span>{service.latency}</span>
              </footer>
            </article>
          );
        })}
      </div>

      <section className="command-center-section">
        <h2>Ledger Parity Matrix</h2>
        <div className="command-center-ledger-card">
          <div className="command-center-ledger-columns">
            <div className="command-center-ledger-panel">
              <div className="command-center-section-label">Internal Account Ledger (DB-01)</div>
              <div className="command-center-ledger-list">
                {ledgerRows.map((row) => (
                  <div className="command-center-ledger-row" key={row.internal}>
                    <span>{row.internal}</span>
                    <span className="command-center-ledger-value">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="command-center-ledger-panel external">
              <div className="command-center-section-label">External Wallet Balances (Circle)</div>
              <div className="command-center-ledger-list">
                {ledgerRows.map((row) => (
                  <div className="command-center-ledger-row" key={row.external}>
                    <span>{row.external}</span>
                    <span className="command-center-ledger-value"><CheckCircle2 size={16} />{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="command-center-parity-footer">
            <span>Parity status: perfect (no discrepancies detected)</span>
            <button type="button">Re-Verify Matrix</button>
          </div>
        </div>
      </section>

      <section className="command-center-section">
        <h2>Live Webhook Feed</h2>
        <div className="command-center-webhook-table">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>Status</th>
                <th>Latency</th>
                <th>Correlation ID</th>
              </tr>
            </thead>
            <tbody>
              {webhookEvents.map((event) => (
                <tr className={event.error ? "error" : ""} key={event.id}>
                  <td>{event.ts}</td>
                  <td>{event.event}</td>
                  <td><span>{event.status}</span></td>
                  <td>{event.latency}</td>
                  <td>{event.id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </>
);
