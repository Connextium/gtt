import { ArrowLeftRight, Building2, Download, Shield, X } from "lucide-react";
import { useState } from "react";

export function SovereignMoveMoneyModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [transactionType, setTransactionType] = useState<"payment" | "mint" | "redeem">("payment");
  if (!isOpen) return null;

  return (
    <div className="gtt-sovereign-modal" role="dialog" aria-modal="true" aria-label="Move Money">
      <button aria-label="Close move money modal" className="gtt-sovereign-modal-backdrop" onClick={onClose} type="button" />
      <section className="gtt-sovereign-modal-panel">
        <header>
          <div><h2>Move Money</h2><p>Transaction Initiation Terminal</p></div>
          <button aria-label="Close" onClick={onClose} type="button"><X size={28} /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); onClose(); }}>
          <div className="gtt-sovereign-move-types">
            <SovereignMoveType active={transactionType === "payment"} icon={ArrowLeftRight} label="USDC Payment" onSelect={() => setTransactionType("payment")} />
            <SovereignMoveType active={transactionType === "mint"} icon={Building2} label="Mint (Fiat-to-DAA)" onSelect={() => setTransactionType("mint")} />
            <SovereignMoveType active={transactionType === "redeem"} icon={Download} label="Redeem (DAA-to-Fiat)" onSelect={() => setTransactionType("redeem")} />
          </div>
          <div className="gtt-sovereign-field-grid">
            <label>Source Account<select><option>DAA-01 (USDC Treasury)</option><option>CHASE-8829 (Fiat USD)</option></select></label>
            <label>Destination ID<input placeholder="0x..." type="text" /></label>
            <label>Amount (USDC)<input placeholder="0.00" step="0.01" type="number" /></label>
            <aside><div><span>Network Fee (est.)</span><b>0.15 USDC</b></div><div><span>Total Settlement</span><b>0.00 USDC</b></div></aside>
          </div>
          <footer>
            <p><Shield size={15} /> Secured by Ledger Institutional</p>
            <button type="submit">Execute Instruction</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function SovereignMoveType({ active, icon: Icon, label, onSelect }: { active: boolean; icon: typeof ArrowLeftRight; label: string; onSelect: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onSelect} type="button">
      <Icon size={23} />
      <span>{label}</span>
    </button>
  );
}
