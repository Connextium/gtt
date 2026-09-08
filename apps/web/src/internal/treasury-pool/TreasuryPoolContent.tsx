import { CheckCircle, Play, Plus, Search, Shuffle, X } from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import "./treasury-pool-scope.css";

type ViewMode = "rebalancing-rules" | "sweep-priority" | "priority-simulation";
type ConflictPolicy = "lexical" | "fastest" | "lowest-fee";
type RailTarget = { active: boolean; currentLiquidity: number; deltaStatus: number; id: string; railId: string; targetAllocation: number };
type EngineRules = { automatedRebalancingActive: boolean; rebalanceThresholdPercent: number; spikeSensitivity: "low" | "medium" | "high"; sweepIntervalUnit: "minutes" | "hours" | "days"; sweepIntervalValue: number; targetLiquidityFloor: number };
type AuditLogEntry = { action: string; amountMoved: number; executionId: string; id: string; status: "Success" | "Failed (Timeout)" | "Pending" | "Skipped"; timestamp: string };
type CorridorPriority = { autoOverride: boolean; destination: string; id: string; maxDailyLimit: number; priority: "P1" | "P2" | "P3" | "P4"; priorityLabel: string; source: string; triggerThreshold: string };
type SimulationParameters = { range: string; ruleSet: string; scenario: string };
type SimulationResult = {
  chartData: Array<{ actual: number; projected: number; time: string }>;
  feeSavings: number;
  latencyDeltaMs: number;
  logs: Array<{ actionTaken: string; notes: string; result: "SUCCESS" | "FAILED" | "SKIPPED"; timestamp: string; triggeredRule: string }>;
  maxDepthBuffer: number;
  optEfficiency: number;
  successRate: number;
};

const initialRails: RailTarget[] = [
  { id: "rail-1", railId: "ARC-SETTLE-01", currentLiquidity: 340000000, targetAllocation: 40, deltaStatus: 0.42, active: true },
  { id: "rail-2", railId: "ARC-FIAT-US-03", currentLiquidity: 297500000, targetAllocation: 35, deltaStatus: -0.15, active: true },
  { id: "rail-3", railId: "HYB-EU-NET-02", currentLiquidity: 170000000, targetAllocation: 20, deltaStatus: 1.05, active: true },
  { id: "rail-4", railId: "LIQ-BUFFER-99", currentLiquidity: 42500000, targetAllocation: 5, deltaStatus: -1.32, active: true }
];

const initialEngineRules: EngineRules = {
  targetLiquidityFloor: 50000000,
  rebalanceThresholdPercent: 15,
  spikeSensitivity: "medium",
  sweepIntervalValue: 4,
  sweepIntervalUnit: "hours",
  automatedRebalancingActive: true
};

const initialAuditLogs: AuditLogEntry[] = [
  { id: "log-1", executionId: "EX-9921-A", timestamp: "2024-10-24 14:32:01", action: "HYB-EU-NET-02 -> ARC-SETTLE-01", amountMoved: 4250000, status: "Success" },
  { id: "log-2", executionId: "EX-9920-B", timestamp: "2024-10-24 10:32:05", action: "LIQ-BUFFER-99 -> ARC-FIAT-US-03", amountMoved: 1100000, status: "Success" },
  { id: "log-3", executionId: "EX-9919-A", timestamp: "2024-10-24 06:32:02", action: "ARC-FIAT-US-03 -> ARC-SETTLE-01", amountMoved: 850000, status: "Success" },
  { id: "log-4", executionId: "EX-9918-F", timestamp: "2024-10-24 02:32:00", action: "HYB-EU-NET-02 -> LIQ-BUFFER-99", amountMoved: 12000000, status: "Failed (Timeout)" }
];

const initialCorridors: CorridorPriority[] = [
  { id: "corridor-1", source: "HYB-EU-NET-02", destination: "ARC-SETTLE-01", priority: "P1", priorityLabel: "Critical", triggerThreshold: "Dest < $50M / Source > $200M", maxDailyLimit: 500000000, autoOverride: true },
  { id: "corridor-2", source: "US-FED-WIRE-01", destination: "HYB-US-NET-01", priority: "P2", priorityLabel: "High", triggerThreshold: "Dest < $100M", maxDailyLimit: 250000000, autoOverride: false },
  { id: "corridor-3", source: "APAC-CHAPS-04", destination: "EU-SEPA-02", priority: "P3", priorityLabel: "Standard", triggerThreshold: "Source > $500M", maxDailyLimit: 100000000, autoOverride: false }
];

const initialSimulation: SimulationResult = {
  successRate: 98.4,
  latencyDeltaMs: -140,
  feeSavings: 12400,
  optEfficiency: 94.2,
  maxDepthBuffer: 82500000,
  chartData: [
    { time: "T-48H", projected: 32000000, actual: 30000000 },
    { time: "T-36H", projected: 45000000, actual: 38000000 },
    { time: "T-24H", projected: 42000000, actual: 35000000 },
    { time: "T-18H", projected: 58000000, actual: 52000000 },
    { time: "T-12H", projected: 30000000, actual: 18000000 },
    { time: "T-6H", projected: 75000000, actual: 68000000 },
    { time: "NOW", projected: 98000000, actual: 95000000 }
  ],
  logs: [
    { timestamp: "2024-10-24 14:32:01", triggeredRule: "HYB-EU-NET-02", actionTaken: "Sweep $12M", result: "SUCCESS", notes: "Conflict Resolved by Speed Priority" },
    { timestamp: "2024-10-24 14:35:12", triggeredRule: "US-FED-WIRE-01", actionTaken: "Sweep $45M", result: "SUCCESS", notes: "-" },
    { timestamp: "2024-10-24 14:41:05", triggeredRule: "APAC-LIQ-MIN-04", actionTaken: "Hold $8M", result: "SKIPPED", notes: "Below Threshold" },
    { timestamp: "2024-10-24 14:45:22", triggeredRule: "EU-SEPA-INST-01", actionTaken: "Sweep $22M", result: "SUCCESS", notes: "Optimized Routing Path" }
  ]
};

const money = (value: number) => `$${value.toLocaleString("en-US")}`;

export const TreasuryPoolContent = () => {
  const [view, setView] = useState<ViewMode>("rebalancing-rules");
  const [search, setSearch] = useState("");
  const [rails, setRails] = useState(initialRails);
  const [engineRules, setEngineRules] = useState(initialEngineRules);
  const [auditLogs, setAuditLogs] = useState(initialAuditLogs);
  const [corridors, setCorridors] = useState(initialCorridors);
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>("lexical");
  const [simulation, setSimulation] = useState(initialSimulation);
  const [toast, setToast] = useState("");
  const [addRailOpen, setAddRailOpen] = useState(false);
  const [addCorridorOpen, setAddCorridorOpen] = useState(false);
  const [executeOpen, setExecuteOpen] = useState(false);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast((current) => current === message ? "" : current), 3000);
  };

  const executeTransaction = (sourceId: string, destId: string, amountMoved: number) => {
    const entry: AuditLogEntry = {
      id: `log-${Date.now()}`,
      executionId: `EX-${Math.floor(1000 + Math.random() * 9000)}-POOL`,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
      action: `${sourceId} -> ${destId}`,
      amountMoved,
      status: "Success"
    };
    setAuditLogs((items) => [entry, ...items]);
    setRails((items) => items.map((rail) => rail.railId === sourceId ? { ...rail, currentLiquidity: Math.max(0, rail.currentLiquidity - amountMoved) } : rail.railId === destId ? { ...rail, currentLiquidity: rail.currentLiquidity + amountMoved } : rail));
    setExecuteOpen(false);
    showToast("Liquidity transfer executed and audit log updated.");
  };

  const addRail = (railId: string, currentLiquidity: number, targetAllocation: number) => {
    setRails((items) => [...items, { id: `rail-${Date.now()}`, railId, currentLiquidity, targetAllocation, deltaStatus: 0, active: true }]);
    setAddRailOpen(false);
    showToast(`Rail ${railId} added.`);
  };

  const addCorridor = (source: string, destination: string, priority: CorridorPriority["priority"]) => {
    setCorridors((items) => [...items, { id: `corridor-${Date.now()}`, source, destination, priority, priorityLabel: priority === "P1" ? "Critical" : priority === "P2" ? "High" : "Standard", triggerThreshold: "Dest < $100M", maxDailyLimit: 100000000, autoOverride: false }]);
    setAddCorridorOpen(false);
    showToast("Corridor priority added.");
  };

  const forceManualRebalance = () => executeTransaction("ARC-FIAT-US-03", "ARC-SETTLE-01", 2500000);

  const runSimulation = (params: SimulationParameters) => {
    let multiplier = 1;
    if (params.scenario === "High Volatility Spike") multiplier = 0.92;
    if (params.scenario === "System Outage") multiplier = 0.81;
    setSimulation((current) => ({
      ...current,
      successRate: Math.min(100, 98.4 * multiplier),
      latencyDeltaMs: Math.round(-140 * multiplier),
      feeSavings: Math.round(12400 * multiplier),
      optEfficiency: Math.min(100, 94.2 * multiplier)
    }));
    showToast(`Simulation executed for ${params.scenario}.`);
  };

  return (
    <section className="treasury-pool-scope">
      {toast ? <div className="tp-toast"><CheckCircle size={16} />{toast}<button onClick={() => setToast("")} type="button"><X size={14} /></button></div> : null}
      <header className="tp-appbar">
        <div>
          <h1>TREASURY POOL</h1>
        </div>
        <div>
          <label><Search size={14} /><input onChange={(event) => setSearch(event.target.value)} placeholder="Search rails, executions, corridors" value={search} /></label>
          <button className="primary" onClick={() => setExecuteOpen(true)} type="button"><Shuffle size={14} />Execute Transaction</button>
        </div>
      </header>

      <nav className="tp-tabs" aria-label="Treasury pool views">
        <button className={view === "rebalancing-rules" ? "active" : ""} onClick={() => setView("rebalancing-rules")} type="button">Rebalancing Rules</button>
        <button className={view === "sweep-priority" ? "active" : ""} onClick={() => setView("sweep-priority")} type="button">Sweep Priority</button>
        <button className={view === "priority-simulation" ? "active" : ""} onClick={() => setView("priority-simulation")} type="button">Priority Simulation</button>
      </nav>

      {view === "rebalancing-rules" ? <RebalancingRules auditLogs={auditLogs} engineRules={engineRules} onAddRail={() => setAddRailOpen(true)} onForceManualRebalance={forceManualRebalance} onNavigate={setView} onUpdateRules={setEngineRules} rails={rails} search={search} showToast={showToast} /> : null}
      {view === "sweep-priority" ? <SweepPriority conflictPolicy={conflictPolicy} corridors={corridors} onAddCorridor={() => setAddCorridorOpen(true)} onNavigate={setView} onToggle={(id) => setCorridors((items) => items.map((item) => item.id === id ? { ...item, autoOverride: !item.autoOverride } : item))} onUpdatePolicy={setConflictPolicy} search={search} showToast={showToast} /> : null}
      {view === "priority-simulation" ? <Simulation simulation={simulation} onRun={runSimulation} search={search} /> : null}

      {executeOpen ? <ExecuteTransactionModal onClose={() => setExecuteOpen(false)} onExecute={executeTransaction} rails={rails} /> : null}
      {addRailOpen ? <AddRailModal onAdd={addRail} onClose={() => setAddRailOpen(false)} /> : null}
      {addCorridorOpen ? <AddCorridorModal onAdd={addCorridor} onClose={() => setAddCorridorOpen(false)} /> : null}
    </section>
  );
};

const RebalancingRules = ({ auditLogs, engineRules, onAddRail, onForceManualRebalance, onNavigate, onUpdateRules, rails, search, showToast }: { auditLogs: AuditLogEntry[]; engineRules: EngineRules; onAddRail: () => void; onForceManualRebalance: () => void; onNavigate: (view: ViewMode) => void; onUpdateRules: (rules: EngineRules) => void; rails: RailTarget[]; search: string; showToast: (message: string) => void }) => {
  const [rules, setRules] = useState(engineRules);
  const filteredRails = rails.filter((rail) => rail.railId.toLowerCase().includes(search.toLowerCase()) || String(rail.currentLiquidity).includes(search));
  const filteredLogs = auditLogs.filter((log) => [log.executionId, log.action, log.status].some((value) => value.toLowerCase().includes(search.toLowerCase())));
  const totalCapacity = rails.reduce((sum, rail) => sum + rail.currentLiquidity, 0);
  return (
    <div className="tp-stack">
      <section className="tp-masthead">
        <div><span>Treasury Management</span><h2>Liquidity Rebalancing Rules</h2></div>
        <button onClick={() => { const updated = { ...rules, automatedRebalancingActive: !rules.automatedRebalancingActive }; setRules(updated); onUpdateRules(updated); showToast(`Automated Rebalancing status set to ${updated.automatedRebalancingActive ? "ACTIVE" : "PAUSED"}`); }} type="button"><i className={rules.automatedRebalancingActive ? "active" : ""} />{rules.automatedRebalancingActive ? "ACTIVE" : "PAUSED"}</button>
      </section>
      <div className="tp-kpis"><Metric label="Global Pool Capacity" value={money(totalCapacity)} /><Metric label="Status" value="Equilibrium Maintained" /><Metric label="Last Execution" mono value={auditLogs[0]?.timestamp ?? "2024-10-24 14:32:01"} /></div>
      <div className="tp-grid">
        <main className="tp-stack">
          <section className="tp-panel"><header><h3>Active Rail Targets & Allocation</h3><button onClick={onAddRail} type="button"><Plus size={14} />Add Rail</button></header><div className="tp-table-wrap"><table><thead><tr><th>Rail ID</th><th className="right">Current Liquidity</th><th className="right">Target Allocation</th><th className="right">Delta Status</th><th className="center">Act</th></tr></thead><tbody>{filteredRails.map((rail) => <tr key={rail.id}><td><b>{rail.railId}</b></td><td className="right">{money(rail.currentLiquidity)}</td><td className="right">{rail.targetAllocation.toFixed(2)}%</td><td className={rail.deltaStatus < 0 ? "right strong" : "right"}>{rail.deltaStatus >= 0 ? `+${rail.deltaStatus.toFixed(2)}%` : `${rail.deltaStatus.toFixed(2)}%`}</td><td className="center">...</td></tr>)}</tbody></table></div></section>
          <section className="tp-architecture"><header><h3>System Architecture</h3><span>T-R19 Topology</span></header><div className="tp-diagram"><article><small>Source Pool</small><b>TREASURY POOL A</b><span>$340,000,000</span></article><article className="core"><small>Core Engine</small><b>REBALANCING ENGINE</b><em /><em /><em /></article><article><small>Destination Pool</small><b>TREASURY POOL B</b><span>$297,500,000</span></article><footer><span>LIQUIDITY BUFFER: $42.5M</span><span>SWEEP STATUS: EQUILIBRIUM</span><button onClick={() => onNavigate("sweep-priority")} type="button">Configure Priority Corridors</button></footer></div></section>
          <section className="tp-panel"><header><h3>Execution Audit Log</h3><button onClick={() => showToast("Execution Audit Log exported to CSV.")} type="button">Export</button></header><div className="tp-table-wrap"><table><thead><tr><th>Execution ID</th><th>Timestamp</th><th>Action</th><th className="right">Amount Moved</th><th>Status</th></tr></thead><tbody>{filteredLogs.map((log) => <tr key={log.id}><td><b>{log.executionId}</b></td><td>{log.timestamp}</td><td>{log.action}</td><td className="right">{money(log.amountMoved)}</td><td>{log.status}</td></tr>)}</tbody></table></div></section>
        </main>
        <aside className="tp-panel tp-rules"><header><h3>Rebalancing Engine Rules</h3><p>Global parameters for automated sweeps.</p></header><label><span>Target Liquidity Floor</span><input onChange={(event) => setRules({ ...rules, targetLiquidityFloor: Number(event.target.value) })} type="number" value={rules.targetLiquidityFloor} /></label><label><span>Rebalance Threshold %</span><input onChange={(event) => setRules({ ...rules, rebalanceThresholdPercent: Number(event.target.value) })} type="number" value={rules.rebalanceThresholdPercent} /></label><label><span>Spike Sensitivity</span><select onChange={(event) => setRules({ ...rules, spikeSensitivity: event.target.value as EngineRules["spikeSensitivity"] })} value={rules.spikeSensitivity}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label><span>Sweep Interval</span><div><input onChange={(event) => setRules({ ...rules, sweepIntervalValue: Number(event.target.value) })} type="number" value={rules.sweepIntervalValue} /><select onChange={(event) => setRules({ ...rules, sweepIntervalUnit: event.target.value as EngineRules["sweepIntervalUnit"] })} value={rules.sweepIntervalUnit}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></div></label><button className="primary" onClick={() => { onUpdateRules(rules); showToast("Rebalancing engine parameters successfully applied."); }} type="button">Apply Configuration</button><button onClick={onForceManualRebalance} type="button">Force Manual Rebalance</button></aside>
      </div>
    </div>
  );
};

const SweepPriority = ({ conflictPolicy, corridors, onAddCorridor, onNavigate, onToggle, onUpdatePolicy, search, showToast }: { conflictPolicy: ConflictPolicy; corridors: CorridorPriority[]; onAddCorridor: () => void; onNavigate: (view: ViewMode) => void; onToggle: (id: string) => void; onUpdatePolicy: (policy: ConflictPolicy) => void; search: string; showToast: (message: string) => void }) => {
  const [selectedPolicy, setSelectedPolicy] = useState(conflictPolicy);
  const filtered = corridors.filter((corridor) => [corridor.source, corridor.destination, corridor.priority].some((value) => value.toLowerCase().includes(search.toLowerCase())));
  return (
    <div className="tp-stack"><section className="tp-masthead"><div><h2>Inter-Rail Sweep Priority</h2><p><i />STRATEGY: PRIORITY-BASED ALLOCATION (ACTIVE)</p></div></section><div className="tp-kpis"><Metric label="Total Configured Corridors" value={String(corridors.length + 9)} /><Metric label="System Priority Floor" value="Level 3" /><Metric label="Last Logic Sync" mono value="2024-10-24 14:32 UTC" /></div><div className="tp-grid"><main className="tp-stack"><section className="tp-panel"><header><h3>Corridor Priority Mapping</h3><button onClick={onAddCorridor} type="button"><Plus size={14} />Add Corridor Priority</button></header><div className="tp-table-wrap"><table><thead><tr><th>Corridor (Source {"->"} Dest)</th><th>Priority</th><th>Trigger Threshold</th><th className="right">Max Daily Limit</th><th className="center">Auto-Override</th><th className="center">Action</th></tr></thead><tbody>{filtered.map((corridor) => <tr key={corridor.id}><td><b>{corridor.source} {"->"} {corridor.destination}</b></td><td><b>{corridor.priority}</b> <span>({corridor.priorityLabel})</span></td><td>{corridor.triggerThreshold}</td><td className="right">{money(corridor.maxDailyLimit)}</td><td className="center"><button className={corridor.autoOverride ? "tp-toggle on" : "tp-toggle"} onClick={() => onToggle(corridor.id)} type="button"><span /></button></td><td className="center"><button type="button">Edit</button></td></tr>)}</tbody></table></div></section></main><aside className="tp-panel tp-policy"><header><h3>Conflict Resolution Policy</h3><p>Define global logic when multiple corridor rules trigger simultaneously.</p></header>{(["lexical", "fastest", "lowest-fee"] as const).map((policy) => <label className="tp-radio" key={policy} onClick={() => setSelectedPolicy(policy)}><span className={selectedPolicy === policy ? "active" : ""} /><div><b>{policy === "lexical" ? "Lexical Fallback (Default)" : policy === "fastest" ? "Fastest Path Override" : "Lowest Fee Path Override"}</b><small>{policy === "lexical" ? "Executes by alphanumeric corridor sorting." : policy === "fastest" ? "Prioritizes settlement speed." : "Prioritizes execution cost efficiency."}</small></div></label>)}<button className="primary" onClick={() => { onUpdatePolicy(selectedPolicy); showToast(`Conflict Resolution Policy set to ${selectedPolicy.toUpperCase()}`); }} type="button">Apply Logic</button><button onClick={() => onNavigate("priority-simulation")} type="button">Run Priority Simulation</button></aside></div></div>
  );
};

const Simulation = ({ onRun, search, simulation }: { onRun: (params: SimulationParameters) => void; search: string; simulation: SimulationResult }) => {
  const [params, setParams] = useState<SimulationParameters>({ range: "Last 30 Days", scenario: "Normal Throughput", ruleSet: "Current Active Rules" });
  const [running, setRunning] = useState(false);
  const filteredLogs = simulation.logs.filter((log) => [log.triggeredRule, log.actionTaken, log.notes].some((value) => value.toLowerCase().includes(search.toLowerCase())));
  const run = () => {
    setRunning(true);
    window.setTimeout(() => {
      onRun(params);
      setRunning(false);
    }, 500);
  };
  return <div className="tp-stack"><section className="tp-sim-params"><label><span>Simulation Range</span><select onChange={(event) => setParams({ ...params, range: event.target.value })} value={params.range}><option>Last 30 Days</option><option>Q3 2024</option><option>Custom Range...</option></select></label><label><span>Scenario Selection</span><select onChange={(event) => setParams({ ...params, scenario: event.target.value })} value={params.scenario}><option>Normal Throughput</option><option>High Volatility Spike</option><option>System Outage</option></select></label><label><span>Rule Set</span><select onChange={(event) => setParams({ ...params, ruleSet: event.target.value })} value={params.ruleSet}><option>Current Active Rules</option><option>Draft: Q4 Optimization</option></select></label><button className="primary" disabled={running} onClick={run} type="button"><Play size={14} />{running ? "Simulating..." : "Run Simulation"}</button></section><section className="tp-masthead"><div><h2>Priority Simulation:<br />Corridor Stress Test</h2><p>Test sweep rules against historical data to validate liquidity outcomes.</p></div></section><div className="tp-kpis five"><Metric label="Success Rate" value={`${simulation.successRate.toFixed(1)}%`} /><Metric label="Latency Delta" value={`${simulation.latencyDeltaMs}ms`} /><Metric label="Fee Savings" value={`$${(simulation.feeSavings / 1000).toFixed(1)}k`} /><Metric label="Opt. Efficiency" value={`${simulation.optEfficiency.toFixed(1)}%`} /><Metric label="Max Depth Buffer" value={`$${(simulation.maxDepthBuffer / 1000000).toFixed(1)}M`} /></div><section className="tp-panel"><header><h3>Projected vs Actual Liquidity</h3><span>Timeline: UTC</span></header><div className="tp-chart"><svg preserveAspectRatio="none" viewBox="0 0 100 100"><path d="M 0,70 Q 15,62 30,65 T 60,82 T 85,25 T 100,10" fill="none" stroke="#5e5e5e" strokeOpacity="0.4" strokeWidth="2" /><path d="M 0,72 Q 15,55 30,60 T 60,75 T 85,15 T 100,2" fill="none" stroke="#000000" strokeWidth="3.5" /></svg></div><div className="tp-chart-axis">{simulation.chartData.map((point) => <span key={point.time}>{point.time}</span>)}</div></section><section className="tp-panel"><header><h3>Simulated Sweep Log</h3></header><div className="tp-table-wrap"><table><thead><tr><th>Timestamp (UTC)</th><th>Triggered Rule</th><th>Action Taken</th><th>Result</th><th>Notes</th></tr></thead><tbody>{filteredLogs.map((log, index) => <tr key={index}><td>{log.timestamp}</td><td><b>{log.triggeredRule}</b></td><td>{log.actionTaken}</td><td><b>{log.result}</b></td><td>{log.notes}</td></tr>)}</tbody></table></div></section></div>;
};

const Metric = ({ label, mono, value }: { label: string; mono?: boolean; value: string }) => <article><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></article>;

const ExecuteTransactionModal = ({ onClose, onExecute, rails }: { onClose: () => void; onExecute: (sourceId: string, destId: string, amountMoved: number) => void; rails: RailTarget[] }) => {
  const [source, setSource] = useState(rails[0]?.railId ?? "");
  const [dest, setDest] = useState(rails[1]?.railId ?? "");
  const [amount, setAmount] = useState("2500000");
  return <Modal onClose={onClose} title="Execute Liquidity Transfer"><label><span>Source Rail</span><select onChange={(event) => setSource(event.target.value)} value={source}>{rails.map((rail) => <option key={rail.id}>{rail.railId}</option>)}</select></label><label><span>Destination Rail</span><select onChange={(event) => setDest(event.target.value)} value={dest}>{rails.map((rail) => <option key={rail.id}>{rail.railId}</option>)}</select></label><label><span>Amount Moved</span><input onChange={(event) => setAmount(event.target.value)} value={amount} /></label><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={() => onExecute(source, dest, Number.parseFloat(amount) || 0)} type="button">Execute</button></footer></Modal>;
};

const AddRailModal = ({ onAdd, onClose }: { onAdd: (railId: string, currentLiquidity: number, targetAllocation: number) => void; onClose: () => void }) => {
  const [railId, setRailId] = useState("NEW-RAIL-01");
  const [liquidity, setLiquidity] = useState("50000000");
  const [target, setTarget] = useState("10");
  return <Modal onClose={onClose} title="Add Rail Target"><label><span>Rail ID</span><input onChange={(event) => setRailId(event.target.value)} value={railId} /></label><label><span>Current Liquidity</span><input onChange={(event) => setLiquidity(event.target.value)} value={liquidity} /></label><label><span>Target Allocation</span><input onChange={(event) => setTarget(event.target.value)} value={target} /></label><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={() => onAdd(railId, Number.parseFloat(liquidity) || 0, Number.parseFloat(target) || 0)} type="button">Add Rail</button></footer></Modal>;
};

const AddCorridorModal = ({ onAdd, onClose }: { onAdd: (source: string, destination: string, priority: CorridorPriority["priority"]) => void; onClose: () => void }) => {
  const [source, setSource] = useState("ARC-FIAT-US-03");
  const [destination, setDestination] = useState("ARC-SETTLE-01");
  const [priority, setPriority] = useState<CorridorPriority["priority"]>("P2");
  return <Modal onClose={onClose} title="Add Corridor Priority"><label><span>Source Rail</span><input onChange={(event) => setSource(event.target.value)} value={source} /></label><label><span>Destination Rail</span><input onChange={(event) => setDestination(event.target.value)} value={destination} /></label><label><span>Priority</span><select onChange={(event) => setPriority(event.target.value as CorridorPriority["priority"])} value={priority}><option>P1</option><option>P2</option><option>P3</option><option>P4</option></select></label><footer><button onClick={onClose} type="button">Cancel</button><button className="primary" onClick={() => onAdd(source, destination, priority)} type="button">Add Corridor</button></footer></Modal>;
};

const Modal = ({ children, onClose, title }: { children: ReactNode; onClose: () => void; title: string }) => <div className="tp-modal-backdrop"><div className="tp-modal"><header><h3>{title}</h3><button onClick={onClose} type="button"><X size={18} /></button></header><div className="tp-modal-body">{children}</div></div></div>;
