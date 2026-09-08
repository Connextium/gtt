import { Ban, ChevronRight, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "./route-profile-scope.css";

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";
const gttApiKey = import.meta.env.VITE_GTT_API_KEY ?? "gtt_live_api_key_dev.dev_secret";

type RouteWeights = {
  cost: number;
  latency: number;
  liquidity: number;
  reliability: number;
};

type RouteProfileRecord = {
  id: string;
  profileCode: string;
  profileName: string;
  profileDescription?: string;
  scopeType: string;
  strategyType: string;
  weightCost: number;
  weightLatency: number;
  weightLiquidity: number;
  weightReliability: number;
  status: string;
};

const routeWeightFields: Array<{
  id: keyof RouteWeights;
  label: string;
  desc: string;
}> = [
  { id: "cost", label: "Cost Efficiency (W_c)", desc: "Prioritizes routes with lowest basis point execution cost." },
  { id: "latency", label: "P95 Latency (W_l)", desc: "Prioritizes execution speed based on 30-day historical P95 settlement times." },
  { id: "liquidity", label: "Available Liquidity (W_v)", desc: "Favors venues with deep order books to minimize slippage on block trades." },
  { id: "reliability", label: "Historical Reliability (W_r)", desc: "Weights venue uptime and historically successful settlement rates." }
];

export const RouteProfileEditContent = ({
  navigate,
  profileId
}: {
  navigate?: (path: string) => void;
  profileId: string;
}) => {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [disabling, setDisabling] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [scopeType, setScopeType] = useState("global");
  const [strategyType, setStrategyType] = useState<"standard" | "weighted">("weighted");
  const [weights, setWeights] = useState<RouteWeights>({
    cost: 0.4,
    latency: 0.25,
    liquidity: 0.2,
    reliability: 0.15
  });

  const totalWeightValue = useMemo(
    () => Object.values(weights).reduce((sum, value) => sum + value, 0),
    [weights]
  );
  const totalWeight = totalWeightValue.toFixed(2);

  useEffect(() => {
    const loadProfile = async () => {
      setLoading(true);
      setError("");
      try {
        const payload = await apiFetch<{ profiles?: RouteProfileRecord[] }>("/internal/treasury/route-profiles");
        const profile = payload.profiles?.find((item) => item.id === profileId);
        if (!profile) {
          setError("Route profile not found.");
          return;
        }
        setProfileName(profile.profileName);
        setProfileDescription(profile.profileDescription ?? "");
        setScopeType(profile.scopeType);
        setStrategyType(profile.strategyType.toLowerCase() === "standard" ? "standard" : "weighted");
        setWeights({
          cost: profile.weightCost,
          latency: profile.weightLatency,
          liquidity: profile.weightLiquidity,
          reliability: profile.weightReliability
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load route profile.");
      } finally {
        setLoading(false);
      }
    };

    void loadProfile();
  }, [profileId]);

  const handleWeightChange = (key: keyof RouteWeights, value: number) => {
    setWeights((current) => ({ ...current, [key]: value }));
  };

  const submitProfile = async (status: "active" | "draft" | "inactive") => {
    if (!profileName.trim()) {
      setError("Profile Name is required.");
      setSuccess("");
      return;
    }
    if (status === "active" && Math.abs(totalWeightValue - 1) > 0.0001) {
      setError("Engine Weights must sum exactly to 1.00 before publishing.");
      setSuccess("");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const payload = await apiFetch<{ profile?: { profileCode?: string; profileName?: string } }>(
        `/internal/treasury/route-profiles/${encodeURIComponent(profileId)}`,
        {
          method: "PATCH",
          body: {
            profileName: profileName.trim(),
            profileCode: profileName.trim(),
            profileDescription: profileDescription.trim() || undefined,
            scopeType,
            strategyType,
            weightCost: Number(weights.cost.toFixed(2)),
            weightLatency: Number(weights.latency.toFixed(2)),
            weightLiquidity: Number(weights.liquidity.toFixed(2)),
            weightReliability: Number(weights.reliability.toFixed(2)),
            status
          }
        }
      );

      const updatedProfileName = payload.profile?.profileName ?? profileName.trim();
      const updatedProfileCode = payload.profile?.profileCode;
      setSuccess(`Profile updated: ${updatedProfileName}${updatedProfileCode ? ` (${updatedProfileCode})` : ""}.`);
      navigate?.("/internal/operations/route-profiles");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to update route profile.");
    } finally {
      setSubmitting(false);
    }
  };

  const disableProfile = async () => {
    setDisabling(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/internal/treasury/route-profiles/${encodeURIComponent(profileId)}`, {
        method: "PATCH",
        body: { status: "inactive" }
      });
      setSuccess("Profile disabled.");
      navigate?.("/internal/operations/route-profiles");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to disable route profile.");
    } finally {
      setDisabling(false);
    }
  };

  const deleteProfile = async () => {
    const shouldDelete = window.confirm(
      "Delete this route profile permanently? This action cannot be undone."
    );
    if (!shouldDelete) return;

    setDeleting(true);
    setError("");
    setSuccess("");
    try {
      await apiFetch(`/internal/treasury/route-profiles/${encodeURIComponent(profileId)}`, {
        method: "DELETE"
      });
      setSuccess("Profile deleted.");
      navigate?.("/internal/operations/route-profiles");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to delete route profile.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="route-profile-scope">
      <div className="route-profile-canvas">
        <div className="route-profile-heading">
          <nav aria-label="Breadcrumb">
            <ol>
              <li><a href="#">Route Management</a></li>
              <li><ChevronRight size={16} /><a href="#">Router Profiles</a></li>
              <li aria-current="page"><ChevronRight size={16} /><span>Edit</span></li>
            </ol>
          </nav>
          <h2>Edit Router Profile</h2>
          <p>Update policy configuration and decision engine parameters for this route profile.</p>
        </div>

        {loading ? (
          <div className="route-profile-panel">
            <p className="route-profile-meta">Loading route profile...</p>
          </div>
        ) : (
          <div className="route-profile-layout">
            <div className="route-profile-form-stack">
              <section className="route-profile-panel">
                <h3>1. Profile Identity</h3>
                <div className="route-profile-grid two">
                  <label>
                    <span>Profile Name</span>
                    <input
                      id="profile_name"
                      onChange={(event) => setProfileName(event.target.value)}
                      placeholder="e.g., RP_GLOBAL_USDC_V4"
                      type="text"
                      value={profileName}
                    />
                  </label>
                  <label>
                    <span>Scope Type</span>
                    <select id="scope_type" onChange={(event) => setScopeType(event.target.value)} value={scopeType}>
                      <option value="global">Global Default</option>
                      <option value="segment">Market Segment</option>
                      <option value="instruction">Instruction Type</option>
                      <option value="custom">Custom Entity</option>
                    </select>
                  </label>
                  <label className="wide">
                    <span>Profile Description</span>
                    <textarea
                      id="profile_desc"
                      onChange={(event) => setProfileDescription(event.target.value)}
                      placeholder="Describe the operational intent of this routing policy..."
                      rows={2}
                      value={profileDescription}
                    />
                  </label>
                </div>
              </section>

              <section className="route-profile-panel">
                <h3>2. Policy Strategy</h3>
                <div className="route-profile-strategy-grid">
                  <label className={`route-profile-choice ${strategyType === "standard" ? "active" : ""}`}>
                    <input
                      checked={strategyType === "standard"}
                      name="strategy_type"
                      onChange={() => setStrategyType("standard")}
                      type="radio"
                      value="standard"
                    />
                    <span>
                      <b>Standard Heuristics</b>
                      <small>Pre-configured routing logic prioritizing primary metrics sequentially (e.g., Least Cost -&gt; Fastest Execution).</small>
                    </span>
                  </label>
                  <label className={`route-profile-choice ${strategyType === "weighted" ? "active" : ""}`}>
                    <input
                      checked={strategyType === "weighted"}
                      name="strategy_type"
                      onChange={() => setStrategyType("weighted")}
                      type="radio"
                      value="weighted"
                    />
                    <span>
                      <b>Advanced Weighted Scoring</b>
                      <small>Multivariate decision engine utilizing custom parameter weights to rank available routes.</small>
                    </span>
                    {strategyType === "weighted" ? <em>ACTIVE</em> : null}
                  </label>
                </div>
              </section>

              <section className="route-profile-panel">
                <div className="route-profile-panel-head">
                  <h3>3. Engine Weights</h3>
                  <div className="route-profile-sum"><span>Sum:</span><b>{totalWeight}</b></div>
                </div>
                <p className="route-profile-meta">Configure normalized weights for the scoring matrix. Values must sum exactly to 1.0.</p>
                <div className="route-profile-weight-stack">
                  {routeWeightFields.map((field) => (
                    <div className="route-profile-weight" key={field.id}>
                      <div>
                        <label htmlFor={`weight_${field.id}`}>{field.label}</label>
                        <input
                          max="1"
                          min="0"
                          onChange={(event) => handleWeightChange(field.id, Number.parseFloat(event.target.value) || 0)}
                          step="0.05"
                          type="number"
                          value={weights[field.id].toFixed(2)}
                        />
                      </div>
                      <input
                        id={`weight_${field.id}`}
                        max="1"
                        min="0"
                        onChange={(event) => handleWeightChange(field.id, Number.parseFloat(event.target.value))}
                        step="0.05"
                        type="range"
                        value={weights[field.id]}
                      />
                      <p>{field.desc}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>

      {error ? <p className="route-profile-feedback error">{error}</p> : null}
      {!error && success ? <p className="route-profile-feedback success">{success}</p> : null}

      <footer className="route-profile-actions">
        <button onClick={() => navigate?.("/internal/operations/route-profiles")} type="button">Cancel</button>
        <div>
          <button
            disabled={submitting || disabling || deleting || loading}
            onClick={() => { void disableProfile(); }}
            type="button"
          >
            <Ban size={16} />
            {disabling ? "Disabling..." : "Disable"}
          </button>
          <button
            className="danger"
            disabled={submitting || disabling || deleting || loading}
            onClick={() => { void deleteProfile(); }}
            type="button"
          >
            <Trash2 size={16} />
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button disabled={submitting || loading} onClick={() => { void submitProfile("draft"); }} type="button">
            {submitting ? "Submitting..." : "Save Changes"}
          </button>
          <button className="primary" disabled={submitting || loading} onClick={() => { void submitProfile("active"); }} type="button">
            <Upload size={16} />
            {submitting ? "Publishing..." : "Update Profile"}
          </button>
        </div>
      </footer>
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "PATCH" | "DELETE";
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
