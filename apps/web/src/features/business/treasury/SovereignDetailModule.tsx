import { ArrowLeft, ArrowRight, Building2, Circle, Download, FileText, Filter } from "lucide-react";

export function SovereignDetailModule({ onBack }: { onBack: () => void }) {
  return (
    <div className="gtt-sovereign-page">
      <div className="gtt-sovereign-breadcrumb">
        <button onClick={onBack} type="button"><ArrowLeft size={15} /> Accounts</button>
        <span>/</span>
        <span>Digital Asset Account DAA-01</span>
      </div>

      <section className="gtt-sovereign-detail-hero">
        <div>
          <h1>Institutional DAA Ledger</h1>
          <p>A sovereign digital asset account managed under the Global Trade Treasury framework. This ledger facilitates instant settlement for international trade netting and factoring operations.</p>
          <dl>
            <div><dt>Account Number</dt><dd>USDC-TR-8842-1002</dd></div>
            <div><dt>Routing (USDC)</dt><dd>0x8B...F92A</dd></div>
            <div><dt>Base Currency</dt><dd>USDC</dd></div>
          </dl>
        </div>
        <aside>
          <span>Available Liquidity</span>
          <strong>12,450,280.00</strong>
          <dl>
            <div><dt>Pending In</dt><dd>+ 450,000.00</dd></div>
            <div><dt>Locked/Margin</dt><dd>(2,000,000.00)</dd></div>
          </dl>
        </aside>
      </section>

      <section className="gtt-sovereign-detail-grid">
        <aside>
          <header><h2>Linked Accounts</h2><button type="button">Link New</button></header>
          <SovereignLinkedAccount icon="bank" label="Fiat Wire" name="J.P. Morgan Chase N.A." identifier="**** 8829 (USD)" status="Active Link" />
          <SovereignLinkedAccount icon="circle" label="Circle Wallet" name="Liquidity Pool A-01" identifier="0x442...99E1 (USDC)" status="Primary Wallet" />
        </aside>

        <section>
          <header>
            <h2>Internal Ledger Activity</h2>
            <div><button type="button"><Filter size={18} /></button><button type="button"><Download size={18} /></button></div>
          </header>
          <table>
            <thead><tr><th>Date</th><th>Counterparty / Description</th><th>Type</th><th>Amount (USDC)</th></tr></thead>
            <tbody>
              <SovereignActivityRow amount="- 120,500.00" date="OCT 24, 2026" detail="Ref: SG-M-99120" name="Factoring Payout: INV-9902" type="Debit" />
              <SovereignActivityRow amount="+ 500,000.00" date="OCT 22, 2026" detail="Origin: JP Morgan Chase" name="Fiat Inflow: Mint Request" type="Credit" />
              <SovereignActivityRow amount="- 45,000.00" date="OCT 19, 2026" detail="Batch #441-A" name="Trade Netting Settlement" type="Debit" />
            </tbody>
          </table>
        </section>
      </section>
    </div>
  );
}

function SovereignLinkedAccount({ icon, label, name, identifier, status }: { icon: "bank" | "circle"; label: string; name: string; identifier: string; status: string }) {
  const Icon = icon === "bank" ? Building2 : Circle;
  return (
    <article className="gtt-sovereign-linked-account">
      <header><Icon size={23} /><span>{label}</span></header>
      <h3>{name}</h3>
      <p>{identifier}</p>
      <footer><span>{status}</span><ArrowRight size={15} /></footer>
    </article>
  );
}

function SovereignActivityRow({ amount, date, detail, name, type }: { amount: string; date: string; detail: string; name: string; type: string }) {
  return (
    <tr>
      <td>{date}</td>
      <td><strong>{name}</strong><span>{detail}</span></td>
      <td><mark>{type}</mark></td>
      <td>{amount}</td>
    </tr>
  );
}
