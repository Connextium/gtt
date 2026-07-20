import {
  ArrowLeftRight,
  CheckCircle2,
  Code,
  Database,
  Key,
  Landmark,
  RefreshCcw,
  Settings,
  User,
  Users,
  Zap
} from "lucide-react";
import type { ComponentType } from "react";
import InternalAdminFooter from "../admin/InternalAdminFooter.js";

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

export const InternalCommandCenterDashboard = ({ navigate }: { navigate: (path: string) => void }) => (
  <div className="command-center-screen">
    <header className="command-center-header">
      <div className="command-center-header-inner">
        <div className="command-center-brand-row">
          <span className="command-center-brand">Treasury Architect</span>
          <nav className="command-center-header-nav" aria-label="Command center sections">
            <button className="active" onClick={() => navigate("/internal/operations/commandcentre")} type="button">Command Center</button>
            <button onClick={() => navigate("/internal/operations/rebalancing")} type="button">Liquidity</button>
            <button onClick={() => navigate("/internal/operations/audit")} type="button">Compliance</button>
          </nav>
        </div>
        <div className="command-center-header-actions">
          <button className="icon-button" title="Command settings" type="button"><Settings size={18} /></button>
          <button className="icon-button" title="Operator profile" type="button"><User size={18} /></button>
        </div>
      </div>
    </header>

    <div className="command-center-body">
      <aside className="command-center-sidepanel" aria-label="Command center navigation">
        <div>
          <div className="command-center-sidepanel-label">System Operations</div>
          <nav className="command-center-sidepanel-nav">
            <button className="active" onClick={() => navigate("/internal/operations/commandcentre")} type="button">
              <Database size={20} />
              <span>Command Center</span>
            </button>
            <button onClick={() => navigate("/internal/operations/admin/users")} type="button">
              <Users size={20} />
              <span>User Management</span>
            </button>
            <button onClick={() => navigate("/internal/operations/ledger/chart-of-accounts")} type="button">
              <Landmark size={20} />
              <span>Ledger Registry</span>
            </button>
            <button onClick={() => navigate("/internal/operations/api-keys")} type="button">
              <Code size={20} />
              <span>API Management</span>
            </button>
            <button onClick={() => navigate("/internal/operations/admin/roles")} type="button">
              <Key size={20} />
              <span>Security & Keys</span>
            </button>
          </nav>
        </div>

        <div className="command-center-sidepanel-env">
          <div className="command-center-sidepanel-label">Environment Info</div>
          <div><span>TENANT_ID:</span><span className="command-center-env-value">TA-ADMIN-01</span></div>
          <div><span>CLUSTER_ID:</span><span className="command-center-env-value">EKS-US-EAST-1</span></div>
          <div><span>VERSION:</span><span className="command-center-env-value">v2.4.8-STABLE</span></div>
        </div>
      </aside>

      <main className="command-center-main">
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
      </main>
    </div>
    <InternalAdminFooter label="Command center legal links" />
  </div>
);
