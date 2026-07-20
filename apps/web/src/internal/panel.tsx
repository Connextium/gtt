export const PanelHeader = ({ title, meta }: { title: string; meta: string }) => (
  <div className="panel-header">
    <h2>{title}</h2>
    <span>{meta}</span>
  </div>
);

export const SummaryLine = ({ label, value }: { label: string; value: string }) => (
  <div className="summary-line">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export const StatusBadge = ({ label, tone }: { label: string; tone: "ready" | "attention" | "blocked" | "neutral" }) => (
  <span className={`status-badge ${tone}`}>{label}</span>
);
