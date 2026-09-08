import { ChevronDown, ChevronLeft, ChevronRight, Code, Filter, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./route-bindings-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type RouteBindingScope = "default" | "instruction_type" | "segment" | "region" | "asset";

type RouteProfile = {
  id: string;
  profileCode: string;
  profileName: string;
  status: string;
};

type RouteBinding = {
  id: string;
  profileId: string;
  profileCode?: string;
  routeCode: string;
  bindingScope: RouteBindingScope;
  matchExpression: string;
  priority: number;
  active: boolean;
};

type BindingFormState = {
  profileId: string;
  routeCode: string;
  bindingScope: RouteBindingScope;
  instructionIdentifier: string;
  assetFilter: string;
  advancedMatchExpression: string;
  priority: number;
  active: boolean;
};

const defaultFormState: BindingFormState = {
  profileId: "",
  routeCode: "",
  bindingScope: "instruction_type",
  instructionIdentifier: "",
  assetFilter: "",
  advancedMatchExpression: "",
  priority: 100,
  active: true
};

const labelForScope = (scope: RouteBindingScope): string => {
  if (scope === "instruction_type") return "Instruction Type";
  if (scope === "default") return "Default";
  if (scope === "segment") return "Segment";
  if (scope === "region") return "Region";
  return "Asset";
};

const parseMatchExpression = (expression: string): {
  instructionIdentifier: string;
  assetFilter: string;
} => {
  const trimmed = expression.trim();
  if (!trimmed || trimmed === "*") {
    return { instructionIdentifier: "", assetFilter: "" };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const instructionIdentifier = String(parsed.instruction_type ?? parsed.instructionType ?? "").trim();
      const assetFilter = String(parsed.currency ?? parsed.asset ?? "").trim();
      return { instructionIdentifier, assetFilter };
    }
  } catch {
    // Keep fallback token parsing for non-JSON expressions.
  }

  const tokens = trimmed.split(/[|,]/).map((token) => token.trim());
  let instructionIdentifier = "";
  let assetFilter = "";
  for (const token of tokens) {
    const separator = token.includes("=") ? "=" : token.includes(":") ? ":" : "";
    if (!separator) continue;
    const [rawKey, rawValue] = token.split(separator, 2);
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.trim();
    if (key === "instruction" || key === "instruction_type" || key === "instructiontype") {
      instructionIdentifier = value;
    }
    if (key === "currency" || key === "asset") {
      assetFilter = value;
    }
  }
  return { instructionIdentifier, assetFilter };
};

const buildMatchExpression = (form: BindingFormState): string => {
  const advanced = form.advancedMatchExpression.trim();
  if (advanced) return advanced;
  if (form.bindingScope === "default") return "*";

  const expression: Record<string, string> = {};
  if (form.instructionIdentifier.trim()) {
    expression.instruction_type = form.instructionIdentifier.trim();
  }
  if (form.assetFilter.trim()) {
    expression.currency = form.assetFilter.trim().toUpperCase();
  }
  return Object.keys(expression).length ? JSON.stringify(expression) : "*";
};

export const RouteBindingsContent = () => {
  const [profiles, setProfiles] = useState<RouteProfile[]>([]);
  const [bindings, setBindings] = useState<RouteBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedBindingId, setSelectedBindingId] = useState("");
  const [form, setForm] = useState<BindingFormState>(defaultFormState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const selectedBinding = useMemo(
    () => bindings.find((binding) => binding.id === selectedBindingId),
    [bindings, selectedBindingId]
  );

  const activeBindings = useMemo(
    () => bindings.filter((binding) => binding.active),
    [bindings]
  );

  const filteredBindings = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return activeBindings;
    return activeBindings.filter((binding) => {
      const haystack = [
        binding.routeCode,
        binding.profileCode ?? "",
        binding.bindingScope,
        binding.matchExpression
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [activeBindings, search]);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const [profilesPayload, bindingsPayload] = await Promise.all([
        apiFetch<{ profiles: RouteProfile[] }>("/internal/treasury/route-profiles"),
        apiFetch<{ bindings: RouteBinding[] }>("/internal/treasury/route-bindings")
      ]);
      setProfiles(profilesPayload.profiles ?? []);
      setBindings(bindingsPayload.bindings ?? []);
      if (!form.profileId && profilesPayload.profiles?.length) {
        setForm((current) => ({ ...current, profileId: profilesPayload.profiles[0]!.id }));
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load route bindings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resetForCreate = () => {
    setSelectedBindingId("");
    setSuccess("");
    setError("");
    setForm((current) => ({
      ...defaultFormState,
      profileId: current.profileId || profiles[0]?.id || ""
    }));
  };

  const selectBinding = (binding: RouteBinding) => {
    const parsed = parseMatchExpression(String(binding.matchExpression ?? "*"));
    setSelectedBindingId(binding.id);
    setError("");
    setSuccess("");
    setForm({
      profileId: binding.profileId,
      routeCode: binding.routeCode,
      bindingScope: binding.bindingScope,
      instructionIdentifier: parsed.instructionIdentifier,
      assetFilter: parsed.assetFilter,
      advancedMatchExpression: String(binding.matchExpression ?? "*"),
      priority: binding.priority,
      active: binding.active
    });
  };

  const submitForm = async () => {
    if (!form.profileId) {
      setError("Target Profile is required.");
      setSuccess("");
      return;
    }
    if (!selectedBinding && !form.routeCode.trim()) {
      setError("Route Code is required for a new binding.");
      setSuccess("");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = {
        profileId: form.profileId,
        bindingScope: form.bindingScope,
        matchExpression: buildMatchExpression(form),
        priority: form.priority,
        active: form.active,
        ...(selectedBinding ? {} : { routeCode: form.routeCode.trim() })
      };

      if (selectedBinding) {
        await apiFetch<{ binding: RouteBinding }>(
          `/internal/treasury/route-bindings/${encodeURIComponent(selectedBinding.id)}`,
          { method: "PATCH", body: payload }
        );
        setSuccess(`Binding updated: ${selectedBinding.routeCode}`);
      } else {
        const created = await apiFetch<{ binding: RouteBinding }>(
          "/internal/treasury/route-bindings",
          { method: "POST", body: payload }
        );
        setSuccess(`Binding created: ${created.binding?.routeCode ?? form.routeCode.trim()}`);
      }

      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save binding.");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteBinding = async () => {
    if (!selectedBinding) return;
    const confirmed = window.confirm(`Delete binding ${selectedBinding.routeCode}? This action cannot be undone.`);
    if (!confirmed) return;

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch<{ deleted: boolean }>(
        `/internal/treasury/route-bindings/${encodeURIComponent(selectedBinding.id)}`,
        { method: "DELETE" }
      );
      setSuccess(`Binding deleted: ${selectedBinding.routeCode}`);
      resetForCreate();
      await loadData();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to delete binding.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="route-bindings-scope">
      <main className="route-bindings-main">
        <div className="route-bindings-hero">
          <h1>Router Bindings</h1>
          <p>Establish deterministic mappings between instruction scopes and routing policies. Resolution logic applies the highest priority active binding.</p>
        </div>

        {error ? <p className="route-bindings-feedback error">{error}</p> : null}
        {!error && success ? <p className="route-bindings-feedback success">{success}</p> : null}

        <div className="route-bindings-grid">
          <section className="route-bindings-registry">
            <header>
              <h2>Active Bindings Registry</h2>
              <div className="route-bindings-controls">
                <label>
                  <Search size={12} />
                  <input
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search bindings..."
                    type="text"
                    value={search}
                  />
                </label>
                <button aria-label="Filter bindings" type="button"><Filter size={14} /></button>
              </div>
            </header>

            <div className="route-bindings-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Binding Name</th>
                    <th>Applied Profile</th>
                    <th>Scope Type</th>
                    <th>Criteria</th>
                    <th className="right">Priority</th>
                    <th className="center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td className="route-bindings-empty" colSpan={6}>Loading active bindings...</td>
                    </tr>
                  ) : filteredBindings.length ? (
                    filteredBindings.map((row) => (
                      <tr
                        className={`${row.id === selectedBindingId ? "selected" : ""}`}
                        key={row.id}
                        onClick={() => selectBinding(row)}
                      >
                        <td className="mono linkish">{row.routeCode}</td>
                        <td className="strong">{row.profileCode ?? "-"}</td>
                        <td>{labelForScope(row.bindingScope)}</td>
                        <td className="mono small">{row.matchExpression || "*"}</td>
                        <td className="mono right">{row.priority}</td>
                        <td className="center"><span className={row.active ? "active" : ""}>{row.active ? "ACTIVE" : "INACTIVE"}</span></td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="route-bindings-empty" colSpan={6}>No active bindings found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <footer>
              <span>Showing {filteredBindings.length} of {activeBindings.length} Active Bindings</span>
              <div>
                <button disabled type="button"><ChevronLeft size={14} /></button>
                <button disabled type="button"><ChevronRight size={14} /></button>
              </div>
            </footer>
          </section>

          <aside className="route-bindings-form">
            <header><h2>{selectedBinding ? "View / Edit Binding" : "Define New Binding"}</h2></header>
            <form onSubmit={(event) => { event.preventDefault(); void submitForm(); }}>
              <label className="route-bindings-field">
                <span>Target Profile</span>
                <div className="route-bindings-select">
                  <select
                    onChange={(event) => setForm((current) => ({ ...current, profileId: event.target.value }))}
                    value={form.profileId}
                  >
                    {!profiles.length ? <option value="">No profiles available</option> : null}
                    {profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{profile.profileCode}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} />
                </div>
              </label>

              <label className="route-bindings-field">
                <span>Route Code</span>
                <input
                  disabled={Boolean(selectedBinding)}
                  onChange={(event) => setForm((current) => ({ ...current, routeCode: event.target.value.toUpperCase() }))}
                  placeholder="e.g., LOCAL"
                  type="text"
                  value={form.routeCode}
                />
                <small>{selectedBinding ? "Route code is immutable after creation." : "Unique route code used by routing decisions."}</small>
              </label>

              <label className="route-bindings-field">
                <span>Binding Type</span>
                <div className="route-bindings-select">
                  <select
                    onChange={(event) => setForm((current) => ({ ...current, bindingScope: event.target.value as RouteBindingScope }))}
                    value={form.bindingScope}
                  >
                    <option value="default">Default</option>
                    <option value="instruction_type">Instruction Type</option>
                    <option value="segment">Segment</option>
                    <option value="region">Region</option>
                    <option value="asset">Asset</option>
                  </select>
                  <ChevronDown size={12} />
                </div>
              </label>

              <section className="route-bindings-scope-box">
                <div><Code size={12} /><span>Scope Configuration</span></div>
                <label>
                  <span>Instruction Identifier</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, instructionIdentifier: event.target.value }))}
                    placeholder="e.g., internal_ada_settlement"
                    type="text"
                    value={form.instructionIdentifier}
                  />
                </label>
                <label>
                  <span>Asset / Currency Filter (Optional)</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, assetFilter: event.target.value.toUpperCase() }))}
                    placeholder="e.g., USD"
                    type="text"
                    value={form.assetFilter}
                  />
                </label>
                <label>
                  <span>Advanced Match Expression</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, advancedMatchExpression: event.target.value }))}
                    placeholder='JSON or token expression (e.g., {"instruction_type":"internal_ada_settlement"})'
                    type="text"
                    value={form.advancedMatchExpression}
                  />
                </label>
              </section>

              <label className="route-bindings-field">
                <span>Resolution Priority</span>
                <input
                  onChange={(event) => setForm((current) => ({ ...current, priority: Number.parseInt(event.target.value, 10) || 0 }))}
                  placeholder="Enter numeric value (e.g., 100)"
                  type="number"
                  value={form.priority}
                />
                <small>Higher numbers resolve first during collisions.</small>
              </label>

              <div className="route-bindings-toggle-row">
                <span>Set As Active Mapping</span>
                <label aria-label="Set as active mapping">
                  <input
                    checked={form.active}
                    onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                    type="checkbox"
                  />
                  <i />
                </label>
              </div>

              <button className="route-bindings-submit" disabled={submitting} type="submit">
                {submitting ? "Saving..." : selectedBinding ? "Save Binding Changes" : "Activate Binding"}
              </button>
              {selectedBinding ? (
                <>
                  <button className="route-bindings-secondary route-bindings-danger" disabled={submitting} onClick={() => { void deleteBinding(); }} type="button">
                    {submitting ? "Deleting..." : "Delete Binding"}
                  </button>
                  <button className="route-bindings-secondary" disabled={submitting} onClick={resetForCreate} type="button">
                    Create New Binding
                  </button>
                </>
              ) : null}
            </form>
          </aside>
        </div>
      </main>

      <footer className="route-bindings-footer">
        <strong>© 2024 Ledger & Lineage. Institutional Grade Treasury Systems.</strong>
        <nav aria-label="Route binding footer links">
          <a href="#">Privacy Policy</a>
          <a href="#">Terms of Service</a>
          <a href="#">Regulatory Disclosures</a>
        </nav>
      </footer>
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    body?: Record<string, unknown>;
  } = {}
): Promise<T> => {
  const correlationId = crypto.randomUUID();
  const idempotencyKey = crypto.randomUUID();
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${gttApiKey}`,
      "x-gtt-api-key": gttApiKey,
      "x-correlation-id": correlationId,
      "idempotency-key": idempotencyKey
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === "string"
      ? payload.error
      : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload as T;
};
