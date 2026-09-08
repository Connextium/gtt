import { CheckCircle, Play, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import "./netting-waterfall-scope.css";

type NavTab = "netting" | "waterfall" | "priority";
type NettingStatus = "Matched" | "Pending" | "Settling" | "Settled";
type PriorityLevel = "High (Sr)" | "Normal (Jr)" | "Low (Res)";
type WaterfallStatus = "SETTLED" | "PENDING" | "RESERVED" | "EXECUTING";

type CounterpartyQueueItem = {
  code: string;
  efficiency: number;
  grossObligations: number;
  id: string;
  name: string;
  netPosition: number;
  status: NettingStatus;
  updatedAt: string;
};

type ExecutionLogItem = {
  beneficiaryDAA: string;
  executionId: string;
  finalPayout: number;
  grossAmount: number;
  nettedAdj: number;
  priorityLevel: PriorityLevel;
  sourceADA: string;
  status: WaterfallStatus;
  timestamp: string;
};

type NettingConfig = {
  autoSettlement: boolean;
  efficiencyTarget: number;
  liquidityBuffer: number;
  minimumThreshold: number;
  nettingWindow: "Hourly" | "Daily" | "End of Day";
  settlementPriority: "Standard" | "Accelerated";
  strategyType: "Continuous Netting" | "Multilateral Netting" | "Bilateral Netting";
};

type PriorityConfig = {
  coverageThreshold: string;
  globalBuffer: number;
  juniorWeight: number;
  proRataScaling: boolean;
  seniorWeight: number;
};

const initialCounterparties: CounterpartyQueueItem[] = [
  { id: "cty-1", name: "Apex Financial", code: "CTY-8821", grossObligations: 45200000, netPosition: 12400000, efficiency: 72.56, status: "Matched", updatedAt: "14:02:45 UTC" },
  { id: "cty-2", name: "Meridian Bank", code: "CTY-3390", grossObligations: 82150000, netPosition: 18900000, efficiency: 77.12, status: "Pending", updatedAt: "14:02:40 UTC" },
  { id: "cty-3", name: "Standard & Chartered", code: "CTY-1102", grossObligations: 15150000, netPosition: 6900000, efficiency: 54.45, status: "Settling", updatedAt: "14:02:30 UTC" },
  { id: "cty-4", name: "J.P. Morgan Chase", code: "CTY-7740", grossObligations: 64800000, netPosition: 14200000, efficiency: 78.09, status: "Matched", updatedAt: "14:01:55 UTC" },
  { id: "cty-5", name: "Goldman Sachs Int.", code: "CTY-9912", grossObligations: 112000000, netPosition: 28400000, efficiency: 74.64, status: "Matched", updatedAt: "14:00:12 UTC" },
  { id: "cty-6", name: "BNP Paribas Treasury", code: "CTY-4401", grossObligations: 38900000, netPosition: 9100000, efficiency: 76.6, status: "Pending", updatedAt: "13:58:20 UTC" },
  { id: "cty-7", name: "UBS AG Infrastructure", code: "CTY-5230", grossObligations: 53100000, netPosition: 11800000, efficiency: 77.78, status: "Settled", updatedAt: "13:55:00 UTC" }
];

const initialExecutionLogs: ExecutionLogItem[] = [
  { executionId: "EX-948A2B", timestamp: "14:02:45.101", priorityLevel: "High (Sr)", sourceADA: "AD-MAIN-01", beneficiaryDAA: "DAA-YIELD-44", grossAmount: 450000000, nettedAdj: -5000000, finalPayout: 445000000, status: "SETTLED" },
  { executionId: "EX-948A2C", timestamp: "14:02:45.152", priorityLevel: "Normal (Jr)", sourceADA: "AD-MAIN-01", beneficiaryDAA: "DAA-SUPP-89", grossAmount: 120500000, nettedAdj: -500000, finalPayout: 120000000, status: "SETTLED" },
  { executionId: "EX-948A2D", timestamp: "14:02:45.210", priorityLevel: "High (Sr)", sourceADA: "AD-MAIN-02", beneficiaryDAA: "DAA-YIELD-12", grossAmount: 85000000, nettedAdj: 0, finalPayout: 85000000, status: "PENDING" },
  { executionId: "EX-948A2E", timestamp: "14:02:45.305", priorityLevel: "Low (Res)", sourceADA: "AD-MAIN-01", beneficiaryDAA: "DAA-FEE-01", grossAmount: 4200000, nettedAdj: -200000, finalPayout: 4000000, status: "RESERVED" },
  { executionId: "EX-948A2F", timestamp: "14:02:45.340", priorityLevel: "Normal (Jr)", sourceADA: "AD-MAIN-03", beneficiaryDAA: "DAA-SUPP-11", grossAmount: 65750000, nettedAdj: -1750000, finalPayout: 64000000, status: "SETTLED" },
  { executionId: "EX-948A30", timestamp: "14:02:44.890", priorityLevel: "High (Sr)", sourceADA: "AD-MAIN-01", beneficiaryDAA: "DAA-YIELD-02", grossAmount: 210000000, nettedAdj: -2000000, finalPayout: 208000000, status: "SETTLED" },
  { executionId: "EX-948A31", timestamp: "14:02:44.112", priorityLevel: "Normal (Jr)", sourceADA: "AD-MAIN-02", beneficiaryDAA: "DAA-SUPP-55", grossAmount: 98400000, nettedAdj: -400000, finalPayout: 98000000, status: "SETTLED" }
];

const defaultNettingConfig: NettingConfig = {
  strategyType: "Continuous Netting",
  nettingWindow: "Hourly",
  minimumThreshold: 500000,
  settlementPriority: "Standard",
  efficiencyTarget: 75,
  liquidityBuffer: 2500000,
  autoSettlement: true
};

const defaultPriorityConfig: PriorityConfig = {
  seniorWeight: 1,
  juniorWeight: 0.85,
  globalBuffer: 10000000,
  proRataScaling: true,
  coverageThreshold: "1.5x Over-collateralized"
};

const formatCurrency = (value: number, short = false) => {
  if (short) {
    if (Math.abs(value) >= 1000000000) return `$${(value / 1000000000).toFixed(2)}B`;
    if (Math.abs(value) >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  }
  return new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 2, style: "currency" }).format(value);
};

export const NettingWaterfallContent = () => {
  const [tab, setTab] = useState<NavTab>("netting");
  const [counterparties, setCounterparties] = useState(initialCounterparties);
  const [executionLogs, setExecutionLogs] = useState(initialExecutionLogs);
  const [nettingConfig, setNettingConfig] = useState(defaultNettingConfig);
  const [priorityConfig, setPriorityConfig] = useState(defaultPriorityConfig);
  const [nettingActive, setNettingActive] = useState(false);
  const [simulatingWaterfall, setSimulatingWaterfall] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 3000);
  };

  const addExecution = (log: ExecutionLogItem) => setExecutionLogs((items) => [log, ...items]);

  const runManualNet = () => {
    setNettingActive(true);
    window.setTimeout(() => {
      setCounterparties((items) => items.map((item) => {
        if (item.status === "Pending") return { ...item, efficiency: Math.min(95, item.efficiency + 3.5), netPosition: Math.round(item.grossObligations * 0.22), status: "Matched" };
        if (item.status === "Matched") return { ...item, status: "Settling" };
        if (item.status === "Settling") return { ...item, status: "Settled" };
        return item;
      }));
      addExecution(createLog("High (Sr)", 142500000, "SETTLED"));
      setNettingActive(false);
      showToast("Manual netting completed and execution log updated.");
    }, 1200);
  };

  const simulateWaterfall = () => {
    setSimulatingWaterfall(true);
    window.setTimeout(() => {
      addExecution(createLog(priorityConfig.juniorWeight > 0.8 ? "High (Sr)" : "Normal (Jr)", 95000000, "SETTLED"));
      setSimulatingWaterfall(false);
      showToast("Waterfall simulation completed.");
    }, 1000);
  };

  const submitTransaction = (input: { counterparty: string; grossAmount: number; priorityLevel: PriorityLevel; type: "Netting" | "Waterfall" }) => {
    const netPosition = Math.round(input.grossAmount * 0.28);
    setCounterparties((items) => [{ id: `cty-${Date.now()}`, name: input.counterparty, code: `CTY-${Math.floor(1000 + Math.random() * 8999)}`, grossObligations: input.grossAmount, netPosition, efficiency: Number((((input.grossAmount - netPosition) / input.grossAmount) * 100).toFixed(2)), status: "Pending", updatedAt: "Just now" }, ...items]);
    addExecution(createLog(input.priorityLevel, input.grossAmount, "PENDING", netPosition));
    setExecuteOpen(false);
    showToast(`${input.type} transaction queued.`);
  };

  return (
    <section className="netting-waterfall-scope">
      {toast ? <div className="nw-toast"><CheckCircle size={16} />{toast}<button onClick={() => setToast("")} type="button"><X size={14} /></button></div> : null}
      <header className="nw-appbar">
        <div><span>Algorithmic Treasury Division</span><h1>{tab === "netting" ? "Automatic Netting" : tab === "waterfall" ? "Settlement Waterfall" : "Priority Weighting Configuration"}</h1></div>
        <button className="primary" onClick={() => setExecuteOpen(true)} type="button"><Plus size={14} />Execute Transaction</button>
      </header>
      <nav className="nw-tabs" aria-label="Netting waterfall views">
        <button className={tab === "netting" ? "active" : ""} onClick={() => setTab("netting")} type="button">Automatic Netting</button>
        <button className={tab === "waterfall" ? "active" : ""} onClick={() => setTab("waterfall")} type="button">Settlement Waterfall</button>
        <button className={tab === "priority" ? "active" : ""} onClick={() => setTab("priority")} type="button">Priority Config</button>
      </nav>
      {tab === "netting" ? <NettingView counterparties={counterparties} config={nettingConfig} isNettingActive={nettingActive} onNavigateToWaterfall={() => setTab("waterfall")} onRunManualNet={runManualNet} onUpdateConfig={setNettingConfig} showToast={showToast} /> : null}
      {tab === "waterfall" ? <WaterfallView isSimulating={simulatingWaterfall} logs={executionLogs} onNavigateToPriority={() => setTab("priority")} onSimulateWaterfall={simulateWaterfall} /> : null}
      {tab === "priority" ? <PriorityConfigView config={priorityConfig} isSimulating={simulatingWaterfall} onSaveConfig={setPriorityConfig} onSimulate={simulateWaterfall} showToast={showToast} /> : null}
      {executeOpen ? <ExecuteTransactionModal onClose={() => setExecuteOpen(false)} onSubmit={submitTransaction} /> : null}
    </section>
  );
};

const createLog = (priorityLevel: PriorityLevel, grossAmount: number, status: WaterfallStatus, forcedNetPosition?: number): ExecutionLogItem => {
  const netPosition = forcedNetPosition ?? Math.round(grossAmount * 0.97);
  return {
    executionId: `EX-${Math.floor(1000 + Math.random() * 9000)}X${Math.floor(10 + Math.random() * 89)}`,
    timestamp: `${new Date().toISOString().substring(11, 23)} UTC`,
    priorityLevel,
    sourceADA: "AD-MAIN-01",
    beneficiaryDAA: "DAA-MANUAL-01",
    grossAmount,
    nettedAdj: netPosition - grossAmount,
    finalPayout: netPosition,
    status
  };
};

const NettingView = ({ counterparties, config, isNettingActive, onNavigateToWaterfall, onRunManualNet, onUpdateConfig, showToast }: { counterparties: CounterpartyQueueItem[]; config: NettingConfig; isNettingActive: boolean; onNavigateToWaterfall: () => void; onRunManualNet: () => void; onUpdateConfig: (config: NettingConfig) => void; showToast: (message: string) => void }) => {
  const [localConfig, setLocalConfig] = useState(config);
  const [search, setSearch] = useState("");
  const totalGross = counterparties.reduce((sum, item) => sum + item.grossObligations, 0);
  const totalNet = counterparties.reduce((sum, item) => sum + item.netPosition, 0);
  const settlementReduction = totalGross > 0 ? ((totalGross - totalNet) / totalGross) * 100 : 0;
  const filtered = useMemo(() => counterparties.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(search.toLowerCase())), [counterparties, search]);
  return <div className="nw-stack"><section className="nw-heading"><div><span>Optimization Engine</span><h2>Automatic Netting</h2><p>Configure and monitor pre-settlement netting logic to maximize capital efficiency across active counterparty channels.</p></div><div><button onClick={() => showToast("Netting ledger exported.")} type="button">Export Log</button><button className="primary" disabled={isNettingActive} onClick={onRunManualNet} type="button"><Play size={14} />{isNettingActive ? "Processing Netting..." : "Run Manual Net"}</button></div></section><div className="nw-kpis"><Metric label="Total Gross Volume" value={formatCurrency(totalGross, true)} /><Metric label="Total Net Settlement" value={formatCurrency(totalNet, true)} /><Metric label="Settlement Reduction" highlight value={`${settlementReduction.toFixed(1)}%`} /><Metric label="Active Counterparties" value={String(counterparties.length)} /></div><div className="nw-grid"><aside className="nw-panel nw-config"><header><h3>Netting Strategy</h3></header><label><span>Strategy Type</span><select onChange={(event) => setLocalConfig({ ...localConfig, strategyType: event.target.value as NettingConfig["strategyType"] })} value={localConfig.strategyType}><option>Continuous Netting</option><option>Multilateral Netting</option><option>Bilateral Netting</option></select></label><label><span>Netting Window</span><div className="segmented">{(["Hourly", "Daily", "End of Day"] as const).map((win) => <button className={localConfig.nettingWindow === win ? "active" : ""} key={win} onClick={() => setLocalConfig({ ...localConfig, nettingWindow: win })} type="button">{win}</button>)}</div></label><label><span>Minimum Threshold</span><input onChange={(event) => setLocalConfig({ ...localConfig, minimumThreshold: Number.parseFloat(event.target.value.replace(/,/g, "")) || 0 })} value={localConfig.minimumThreshold.toLocaleString("en-US")} /></label><label><span>Settlement Priority</span><div className="segmented">{(["Standard", "Accelerated"] as const).map((priority) => <button className={localConfig.settlementPriority === priority ? "active" : ""} key={priority} onClick={() => setLocalConfig({ ...localConfig, settlementPriority: priority })} type="button">{priority}</button>)}</div></label><label><span>Efficiency Target</span><input max="95" min="50" onChange={(event) => setLocalConfig({ ...localConfig, efficiencyTarget: Number(event.target.value) })} type="range" value={localConfig.efficiencyTarget} /><b>{localConfig.efficiencyTarget}%</b></label><button className="primary" onClick={() => { onUpdateConfig(localConfig); showToast("Netting parameters applied to live engine."); }} type="button">Apply Netting Parameters</button></aside><main className="nw-panel"><header><h3>Counterparty Netting Queue</h3><label><Search size={14} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search counterparty" value={search} /></label></header><div className="nw-diagram"><NettingNodeGraphic active={isNettingActive} /></div><div className="nw-table-wrap"><table><thead><tr><th>Counterparty</th><th>Gross Obligations</th><th>Net Position</th><th>Efficiency</th><th>Status</th><th>Updated</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><b>{item.name}</b><small>{item.code}</small></td><td>{formatCurrency(item.grossObligations, true)}</td><td>{formatCurrency(item.netPosition, true)}</td><td>{item.efficiency.toFixed(2)}%</td><td><StatusBadge value={item.status} /></td><td>{item.updatedAt}</td></tr>)}</tbody></table></div><footer><button onClick={onNavigateToWaterfall} type="button">View Waterfall Execution</button></footer></main></div></div>;
};

const WaterfallView = ({ isSimulating, logs, onNavigateToPriority, onSimulateWaterfall }: { isSimulating: boolean; logs: ExecutionLogItem[]; onNavigateToPriority: () => void; onSimulateWaterfall: () => void }) => {
  const [search, setSearch] = useState("");
  const filtered = logs.filter((log) => `${log.executionId} ${log.sourceADA} ${log.beneficiaryDAA} ${log.priorityLevel}`.toLowerCase().includes(search.toLowerCase()));
  const totalVolume = logs.reduce((sum, item) => sum + item.grossAmount, 0);
  return <div className="nw-stack"><section className="nw-heading"><div><span>Treasury / Settlement Operations / Waterfall</span><h2>Settlement Waterfall: Execution Logs</h2></div><div><button onClick={onNavigateToPriority} type="button">Adjust Priority Rules</button><button className="primary" disabled={isSimulating} onClick={onSimulateWaterfall} type="button"><Play size={14} />{isSimulating ? "Executing Simulation..." : "Simulate Waterfall"}</button></div></section><div className="nw-kpis five"><Metric label="Total Netted Volume" value={formatCurrency(totalVolume, true)} /><Metric label="Waterfall Efficiency" value="99.4%" /><Metric label="Total Beneficiaries" value="1,402" /><Metric label="Last Execution Time" value={logs[0]?.timestamp ?? "14:02:45 UTC"} /><Metric label="Remaining Liquidity" highlight value="$12.4M" /></div><div className="nw-grid waterfall"><aside className="nw-panel"><header><h3>Logic Flow</h3><span>ACTIVE</span></header><WaterfallDiagram active={isSimulating} /></aside><main className="nw-panel"><header><h3>Execution Logs</h3><label><Search size={14} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search ID..." value={search} /></label></header><div className="nw-table-wrap"><table><thead><tr><th>Execution ID</th><th>Timestamp</th><th>Priority Level</th><th>Source ADA</th><th>Beneficiary DAA</th><th className="right">Gross Amount</th><th className="right">Netted Adj.</th><th className="right">Final Payout</th><th>Status</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.executionId}><td><b>{row.executionId}</b></td><td>{row.timestamp}</td><td><PriorityPill value={row.priorityLevel} /></td><td>{row.sourceADA}</td><td>{row.beneficiaryDAA}</td><td className="right">{formatCurrency(row.grossAmount, true)}</td><td className="right">{row.nettedAdj < 0 ? `-${formatCurrency(Math.abs(row.nettedAdj), true)}` : formatCurrency(row.nettedAdj, true)}</td><td className="right"><b>{formatCurrency(row.finalPayout, true)}</b></td><td><WaterfallStatusBadge value={row.status} /></td></tr>)}</tbody></table></div></main></div></div>;
};

const PriorityConfigView = ({ config, isSimulating, onSaveConfig, onSimulate, showToast }: { config: PriorityConfig; isSimulating: boolean; onSaveConfig: (config: PriorityConfig) => void; onSimulate: () => void; showToast: (message: string) => void }) => {
  const [localConfig, setLocalConfig] = useState(config);
  const save = () => {
    onSaveConfig(localConfig);
    showToast("Priority Weighting Parameters Saved and Waterfall Simulation Triggered.");
    onSimulate();
  };
  return <div className="nw-priority-layout"><aside className="nw-engine-nav"><div><b>Waterfall Priority</b><span>V2.4 Logic Engine</span></div>{["Engine", "Allocation", "Thresholds", "Simulations", "Audit", "History"].map((item, index) => <button className={index === 0 ? "active" : ""} key={item} type="button">{item}</button>)}</aside><main className="nw-stack"><section className="nw-heading"><div><h2>Priority Weighting Configuration</h2><p>Waterfall Logic - Active Node</p></div><button className="primary" disabled={isSimulating} onClick={save} type="button"><Play size={14} />{isSimulating ? "Simulating..." : "Save & Simulate"}</button></section><section className="nw-panel"><header><h3>Tier Weighting Matrix</h3><span>LIVE CONFIG</span></header><div className="nw-tier"><b>Senior Tier (High/Sr)</b><div><span style={{ width: "100%" }} /></div><strong>1.00x</strong></div><div className="nw-tier active"><b>Junior Tier (Normal/Jr)</b><input max="100" min="0" onChange={(event) => setLocalConfig({ ...localConfig, juniorWeight: Number(event.target.value) / 100 })} type="range" value={Math.round(localConfig.juniorWeight * 100)} /><strong>{localConfig.juniorWeight.toFixed(2)}x</strong></div><div className="nw-tier"><b>Residual Tier (Low/Res)</b><div className="dashed" /><strong>AUTO</strong></div></section><div className="nw-kpis"><ConfigCard label="Global Liquidity Buffer" value={localConfig.globalBuffer.toLocaleString("en-US")} onChange={(value) => setLocalConfig({ ...localConfig, globalBuffer: Number.parseFloat(value.replace(/,/g, "")) || 0 })} /><article className="nw-config-card"><span>Pro-Rata Scaling (Jr)</span><button className={localConfig.proRataScaling ? "toggle on" : "toggle"} onClick={() => setLocalConfig({ ...localConfig, proRataScaling: !localConfig.proRataScaling })} type="button"><i /></button><b>{localConfig.proRataScaling ? "ENABLED" : "DISABLED"}</b></article><article className="nw-config-card"><span>Coverage Threshold</span><select onChange={(event) => setLocalConfig({ ...localConfig, coverageThreshold: event.target.value })} value={localConfig.coverageThreshold}><option>1.5x Over-collateralized</option><option>1.2x Standard Coverage</option><option>2.0x Conservative</option></select></article></div><section className="nw-panel"><header><h3>Waterfall Impact Preview</h3></header><WaterfallDiagram active={isSimulating} /><div className="nw-kpis"><Metric label="Estimated Cleared" value={`$${(4.28 * localConfig.juniorWeight).toFixed(2)}B`} /><Metric label="Junior Weight" value={`${Math.round(localConfig.juniorWeight * 100)}%`} /><Metric label="Global Buffer" value={formatCurrency(localConfig.globalBuffer, true)} /></div></section></main></div>;
};

const Metric = ({ highlight, label, value }: { highlight?: boolean; label: string; value: string }) => <article className={highlight ? "highlight" : ""}><span>{label}</span><strong>{value}</strong></article>;
const ConfigCard = ({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) => <article className="nw-config-card"><span>{label}</span><input onChange={(event) => onChange(event.target.value)} value={value} /></article>;
const StatusBadge = ({ value }: { value: NettingStatus }) => <span className={`nw-status ${value.toLowerCase()}`}>{value}</span>;
const PriorityPill = ({ value }: { value: PriorityLevel }) => <span className={`nw-priority ${value.startsWith("High") ? "high" : value.startsWith("Normal") ? "normal" : "low"}`}>{value}</span>;
const WaterfallStatusBadge = ({ value }: { value: WaterfallStatus }) => <span className={`nw-status ${value.toLowerCase()}`}>{value}</span>;

const NettingNodeGraphic = ({ active }: { active: boolean }) => <div className={active ? "nw-net-graphic active" : "nw-net-graphic"}><span>Gross Obligations</span><i /><b>Netting Engine</b><i /><span>Net Settlement</span></div>;
const WaterfallDiagram = ({ active }: { active: boolean }) => <div className={active ? "nw-waterfall-diagram active" : "nw-waterfall-diagram"}>{["Senior Yield", "Junior Principal", "Residual Fees", "Reserve Buffer"].map((item, index) => <article key={item}><span>{index + 1}</span><b>{item}</b></article>)}</div>;

const ExecuteTransactionModal = ({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: { counterparty: string; grossAmount: number; priorityLevel: PriorityLevel; type: "Netting" | "Waterfall" }) => void }) => {
  const [counterparty, setCounterparty] = useState("New Counterparty");
  const [grossAmount, setGrossAmount] = useState("25000000");
  const [priorityLevel, setPriorityLevel] = useState<PriorityLevel>("Normal (Jr)");
  const [type, setType] = useState<"Netting" | "Waterfall">("Netting");
  return <div className="nw-modal-backdrop"><div className="nw-modal"><header><h3>Execute Transaction</h3><button onClick={onClose} type="button"><X size={18} /></button></header><div className="nw-modal-body"><label><span>Counterparty</span><input onChange={(event) => setCounterparty(event.target.value)} value={counterparty} /></label><label><span>Gross Amount</span><input onChange={(event) => setGrossAmount(event.target.value)} value={grossAmount} /></label><label><span>Priority Level</span><select onChange={(event) => setPriorityLevel(event.target.value as PriorityLevel)} value={priorityLevel}><option>High (Sr)</option><option>Normal (Jr)</option><option>Low (Res)</option></select></label><label><span>Type</span><select onChange={(event) => setType(event.target.value as "Netting" | "Waterfall")} value={type}><option>Netting</option><option>Waterfall</option></select></label></div><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={() => onSubmit({ counterparty, grossAmount: Number.parseFloat(grossAmount) || 0, priorityLevel, type })} type="button">Submit Transaction</button></footer></div></div>;
};
