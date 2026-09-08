import { ChevronRight, FlaskConical, RefreshCw, Upload } from "lucide-react";
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
  createdAt?: string;
  updatedAt?: string;
};

type RegistryStatusTab = "active" | "draft" | "deprecated" | "all";

type StrategyFilter = "all" | "weighted" | "standard";

type ScopeFilter = "all" | "global" | "instruction" | "segment" | "custom";

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

export const RouteProfileContent = ({
  mode = "list",
  navigate,
  profileId
}: {
  mode?: "list" | "create" | "edit";
  navigate?: (path: string) => void;
  profileId?: string;
}) => {
  const isCreateScreen = mode === "create";
  const isEditScreen = mode === "edit";
  const [profiles, setProfiles] = useState<RouteProfileRecord[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileDescription, setProfileDescription] = useState("");
  const [scopeType, setScopeType] = useState("global");
  const [strategyType, setStrategyType] = useState<"standard" | "weighted">("weighted");
  const [statusTab, setStatusTab] = useState<RegistryStatusTab>("active");
  const [strategyFilter, setStrategyFilter] = useState<StrategyFilter>("all");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [registrySearch, setRegistrySearch] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [isRescoring, setIsRescoring] = useState(false);
  const [rescoreTimestamp, setRescoreTimestamp] = useState("14:02:18.912 UTC");
  const [didHydrateEditForm, setDidHydrateEditForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [weights, setWeights] = useState<RouteWeights>({
    cost: 0.40,
    latency: 0.25,
    liquidity: 0.20,
    reliability: 0.15
  });
  const totalWeightValue = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const totalWeight = totalWeightValue.toFixed(2);

  const loadProfiles = async (): Promise<void> => {
    setLoadingProfiles(true);
    try {
      const payload = await apiFetch<{ profiles?: RouteProfileRecord[] }>("/internal/treasury/route-profiles");
      const nextProfiles = payload.profiles ?? [];
      setProfiles(nextProfiles);
      if (!selectedProfileId && nextProfiles.length > 0) {
        setSelectedProfileId(nextProfiles[0].id);
      }
    } catch {
      setProfiles([]);
    } finally {
      setLoadingProfiles(false);
    }
  };

  useEffect(() => {
    void loadProfiles();
  }, []);

  const filteredProfiles = useMemo(() => {
    const term = registrySearch.trim().toLowerCase();
    return profiles.filter((profile) => {
      const matchesStatus =
        statusTab === "all" ? true : profile.status.toLowerCase() === statusTab;
      if (!matchesStatus) return false;
      if (strategyFilter !== "all" && profile.strategyType.toLowerCase() !== strategyFilter) {
        return false;
      }
      if (scopeFilter !== "all" && profile.scopeType.toLowerCase() !== scopeFilter) {
        return false;
      }
      if (!term) return true;
      const haystack = [
        profile.profileCode,
        profile.profileName,
        profile.scopeType,
        profile.strategyType
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [profiles, registrySearch, scopeFilter, statusTab, strategyFilter]);

  const activeCount = useMemo(
    () => profiles.filter((profile) => profile.status.toLowerCase() === "active").length,
    [profiles]
  );
  const draftCount = useMemo(
    () => profiles.filter((profile) => profile.status.toLowerCase() === "draft").length,
    [profiles]
  );

  const deprecatedCount = useMemo(
    () => profiles.filter((profile) => profile.status.toLowerCase() === "deprecated").length,
    [profiles]
  );

  const selectedProfile = useMemo(() => {
    if (!profiles.length) return null;
    if (!selectedProfileId) return profiles[0];
    return profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0];
  }, [profiles, selectedProfileId]);

  const editingProfile = useMemo(() => {
    if (!profileId) return null;
    return profiles.find((profile) => profile.id === profileId) ?? null;
  }, [profileId, profiles]);

  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(filteredProfiles.length / pageSize));
  const paginatedProfiles = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredProfiles.slice(start, start + pageSize);
  }, [currentPage, filteredProfiles]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleRescore = () => {
    setIsRescoring(true);
    setTimeout(() => {
      const now = new Date();
      setRescoreTimestamp(
        `${now.getUTCHours().toString().padStart(2, "0")}:${now
          .getUTCMinutes()
          .toString()
          .padStart(2, "0")}:${now
          .getUTCSeconds()
          .toString()
          .padStart(2, "0")}.${now
          .getUTCMilliseconds()
          .toString()
          .padStart(3, "0")} UTC`
      );
      setIsRescoring(false);
    }, 600);
  };

  const exportRegistryJson = () => {
    const payload = JSON.stringify(filteredProfiles, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "route-profile-registry.json";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const jumpToPreview = () => {
    const node = document.getElementById("route-profile-preview");
    node?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (isEditScreen) {
      setDidHydrateEditForm(false);
    }
  }, [isEditScreen, profileId]);

  useEffect(() => {
    if (!isEditScreen || !editingProfile || didHydrateEditForm) {
      return;
    }
    setProfileName(editingProfile.profileName);
    setProfileDescription(editingProfile.profileDescription ?? "");
    setScopeType(editingProfile.scopeType);
    setStrategyType(editingProfile.strategyType.toLowerCase() === "standard" ? "standard" : "weighted");
    setWeights({
      cost: editingProfile.weightCost,
      latency: editingProfile.weightLatency,
      liquidity: editingProfile.weightLiquidity,
      reliability: editingProfile.weightReliability
    });
    setDidHydrateEditForm(true);
  }, [didHydrateEditForm, editingProfile, isEditScreen]);

  const handleWeightChange = (key: keyof RouteWeights, value: number) => {
    setWeights((current) => ({ ...current, [key]: value }));
  };

  const submitProfile = async (status: "active" | "draft") => {
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
      const isEditing = isEditScreen && Boolean(profileId);
      const payload = await apiFetch<{ profile?: { profileCode?: string; profileName?: string } }>(
        isEditing
          ? `/internal/treasury/route-profiles/${encodeURIComponent(profileId ?? "")}`
          : "/internal/treasury/route-profiles",
        {
          method: isEditing ? "PATCH" : "POST",
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
      const createdProfileName = payload.profile?.profileName ?? profileName.trim();
      const createdProfileCode = payload.profile?.profileCode;
      setSuccess(
        isEditing
          ? `Profile updated: ${createdProfileName}${createdProfileCode ? ` (${createdProfileCode})` : ""}.`
          : status === "active"
            ? `Profile published: ${createdProfileName}${createdProfileCode ? ` (${createdProfileCode})` : ""}.`
            : `Draft saved: ${createdProfileName}${createdProfileCode ? ` (${createdProfileCode})` : ""}.`
      );
      if (isEditing) {
        navigate?.("/internal/operations/route-profiles");
      }
      void loadProfiles();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to submit route profile.");
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <section className="route-profile-scope">
      <div className="route-profile-canvas">
        {!isCreateScreen ? (
          <section className="route-profile-registry-block">
          <div className="route-profile-registry-crumbs">
            <span>Route Management</span>
            <span>/</span>
            <span>Router Profiles (Registry)</span>
          </div>

          <div className="route-profile-registry-masthead">
            <div>
              <p>Algorithmic Liquidity Orchestration Engine</p>
              <h3>Router Profiles: Policy Configuration Registry</h3>
            </div>
            <div className="route-profile-registry-tools">
              <button className="route-profile-ghost-btn" onClick={exportRegistryJson} type="button">Export Spec (JSON)</button>
              <button className="route-profile-solid-ghost-btn" onClick={jumpToPreview} type="button">Simulator</button>
              <div className="route-profile-registry-search">
                <input
                  onChange={(event) => setRegistrySearch(event.target.value)}
                  placeholder="Filter by profile code, profile name, scope, strategy"
                  type="text"
                  value={registrySearch}
                />
              </div>
              {!isCreateScreen ? (
                <a
                  className="route-profile-create-link"
                  href="/internal/operations/route-profiles/create"
                  onClick={(event) => {
                    event.preventDefault();
                    if (navigate) {
                      navigate("/internal/operations/route-profiles/create");
                      return;
                    }
                    window.location.href = "/internal/operations/route-profiles/create";
                  }}
                >
                  Create Route Profile
                </a>
              ) : null}
            </div>
          </div>

          <div className="route-profile-registry-kpis">
            <article>
              <span>Registry Inventory</span>
              <strong>{activeCount} Active</strong>
              <small>{draftCount} draft / {deprecatedCount} deprecated</small>
            </article>
            <article>
              <span>Traffic Routing Coverage</span>
              <strong>100.0%</strong>
              <small>Deterministic single-winner guarantee</small>
            </article>
            <article>
              <span>Mean Evaluation Latency</span>
              <strong>0.28ms</strong>
              <small>p99 = 0.62ms</small>
            </article>
            <article>
              <span>Active Route Bindings</span>
              <strong>{Math.max(0, activeCount * 4)} Bound Scopes</strong>
              <small>internal transfer and treasury corridors</small>
            </article>
          </div>

          <div className="route-profile-registry-toolbar">
            <div className="route-profile-toolbar-row">
              <div className="route-profile-filter-group">
                <label htmlFor="strategy_filter">Strategy</label>
                <select
                  id="strategy_filter"
                  onChange={(event) => {
                    setStrategyFilter(event.target.value as StrategyFilter);
                    setCurrentPage(1);
                  }}
                  value={strategyFilter}
                >
                  <option value="all">All Strategies</option>
                  <option value="weighted">Advanced Weighted Scoring</option>
                  <option value="standard">Deterministic Least-Cost</option>
                </select>
              </div>
              <div className="route-profile-registry-tabs" role="tablist" aria-label="Profile status filter">
                <button
                  aria-selected={statusTab === "active"}
                  className={statusTab === "active" ? "active" : ""}
                  onClick={() => {
                    setStatusTab("active");
                    setCurrentPage(1);
                  }}
                  role="tab"
                  type="button"
                >
                  Active ({activeCount})
                </button>
                <button
                  aria-selected={statusTab === "draft"}
                  className={statusTab === "draft" ? "active" : ""}
                  onClick={() => {
                    setStatusTab("draft");
                    setCurrentPage(1);
                  }}
                  role="tab"
                  type="button"
                >
                  Draft ({draftCount})
                </button>
                <button
                  aria-selected={statusTab === "deprecated"}
                  className={statusTab === "deprecated" ? "active" : ""}
                  onClick={() => {
                    setStatusTab("deprecated");
                    setCurrentPage(1);
                  }}
                  role="tab"
                  type="button"
                >
                  Retired ({deprecatedCount})
                </button>
                <button
                  aria-selected={statusTab === "all"}
                  className={statusTab === "all" ? "active" : ""}
                  onClick={() => {
                    setStatusTab("all");
                    setCurrentPage(1);
                  }}
                  role="tab"
                  type="button"
                >
                  All ({profiles.length})
                </button>
              </div>
            </div>

            <div className="route-profile-scope-strip" role="tablist" aria-label="Scope filter">
              {[
                { id: "all", label: "All Scopes" },
                { id: "global", label: "Global Default" },
                { id: "instruction", label: "Instruction-Specific" },
                { id: "segment", label: "High-Value Tier" },
                { id: "custom", label: "Custom Entity" }
              ].map((scope) => (
                <button
                  key={scope.id}
                  aria-selected={scopeFilter === scope.id}
                  className={scopeFilter === scope.id ? "active" : ""}
                  onClick={() => {
                    setScopeFilter(scope.id as ScopeFilter);
                    setCurrentPage(1);
                  }}
                  role="tab"
                  type="button"
                >
                  {scope.label}
                </button>
              ))}
              <span>Showing {filteredProfiles.length} of {profiles.length} profiles</span>
            </div>
          </div>

          <div className="route-profile-registry-table-wrap">
            <table className="route-profile-registry-table">
              <thead>
                <tr>
                  <th>Profile Code &amp; Title</th>
                  <th>Scope</th>
                  <th>Weight Vector (Wc, Wl, Wv, Wr)</th>
                  <th>Strategy</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedProfiles.map((profile) => {
                  const isSelected = selectedProfileId === profile.id;
                  const rawWeightTotal =
                    profile.weightCost + profile.weightLatency + profile.weightLiquidity + profile.weightReliability;
                  const weightTotal = rawWeightTotal > 0 ? rawWeightTotal : 1;
                  const statusClassName = profile.status.toLowerCase() === "active" ? "active" : "draft";
                  return (
                  <tr key={profile.id} className={isSelected ? "selected" : ""} onClick={() => setSelectedProfileId(profile.id)}>
                    <td>
                      <b>{profile.profileCode}</b>
                      <span>{profile.profileName}</span>
                    </td>
                    <td>
                      <span className="route-profile-scope-tag">{profile.scopeType}</span>
                    </td>
                    <td>
                      <div className="route-profile-weight-row">
                        C:{profile.weightCost.toFixed(2)} / L:{profile.weightLatency.toFixed(2)} / V:{profile.weightLiquidity.toFixed(2)} / R:{profile.weightReliability.toFixed(2)}
                      </div>
                      <div className="route-profile-weight-bar" aria-label="Weight distribution">
                        <i style={{ width: `${Math.max(0, Math.round((profile.weightCost / weightTotal) * 100))}%` }} />
                        <i style={{ width: `${Math.max(0, Math.round((profile.weightLatency / weightTotal) * 100))}%` }} />
                        <i style={{ width: `${Math.max(0, Math.round((profile.weightLiquidity / weightTotal) * 100))}%` }} />
                        <i style={{ width: `${Math.max(0, Math.round((profile.weightReliability / weightTotal) * 100))}%` }} />
                      </div>
                    </td>
                    <td>
                      {profile.strategyType}
                    </td>
                    <td>
                      <em className={statusClassName}>{profile.status}</em>
                    </td>
                    <td>
                      <div className="route-profile-actions-inline">
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedProfileId(profile.id);
                            jumpToPreview();
                          }}
                          type="button"
                        >
                          Inspect
                        </button>
                        <button
                          className="primary"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (navigate) {
                              navigate(`/internal/operations/route-profiles/${encodeURIComponent(profile.id)}/edit`);
                              return;
                            }
                            window.location.href = `/internal/operations/route-profiles/${encodeURIComponent(profile.id)}/edit`;
                          }}
                          type="button"
                        >
                          Edit Policy
                        </button>
                      </div>
                    </td>
                  </tr>
                );
                })}
                {!loadingProfiles && filteredProfiles.length === 0 ? (
                  <tr>
                    <td className="route-profile-empty" colSpan={6}>No profiles found for the current filter.</td>
                  </tr>
                ) : null}
                {loadingProfiles ? (
                  <tr>
                    <td className="route-profile-empty" colSpan={6}>Loading profile registry...</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="route-profile-pagination-strip">
            <div>
              PAGE {currentPage} OF {totalPages} (TOTAL {filteredProfiles.length} POLICIES)
            </div>
            <div className="route-profile-pagination-buttons">
              <button
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                type="button"
              >
                PREV
              </button>
              {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
                <button
                  className={page === currentPage ? "active" : ""}
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  type="button"
                >
                  {page}
                </button>
              ))}
              <button
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                type="button"
              >
                NEXT
              </button>
            </div>
          </div>

          {selectedProfile ? (
            <section className="route-profile-preview-panel" id="route-profile-preview">
              <div className="route-profile-preview-head">
                <div>
                  <p>Active Inspection View</p>
                  <h4>{selectedProfile.profileCode} Candidate Venue Evaluation</h4>
                </div>
                <div>
                  <span>EVAL TIMESTAMP: {rescoreTimestamp}</span>
                  <button disabled={isRescoring} onClick={handleRescore} type="button">
                    {isRescoring ? "Re-Scoring..." : "Re-Score All Venues"}
                  </button>
                </div>
              </div>

              <div className="route-profile-preview-grid">
                <article className="winner">
                  <small>Rank #1 Winner</small>
                  <h5>Global Prime Rail</h5>
                  <strong>{(selectedProfile.weightCost * 100 + 52).toFixed(1)} / 100</strong>
                  <div>
                    <span>Latency</span>
                    <span>11ms</span>
                  </div>
                  <div>
                    <span>Net Fee</span>
                    <span>2.1 bps</span>
                  </div>
                </article>
                <article>
                  <small>Rank #2</small>
                  <h5>Institutional OTC Grid</h5>
                  <strong>{(selectedProfile.weightLiquidity * 100 + 45).toFixed(1)} / 100</strong>
                  <div>
                    <span>Latency</span>
                    <span>17ms</span>
                  </div>
                  <div>
                    <span>Net Fee</span>
                    <span>2.4 bps</span>
                  </div>
                </article>
                <article>
                  <small>Rank #3</small>
                  <h5>Reserve Corridor</h5>
                  <strong>{(selectedProfile.weightReliability * 100 + 39).toFixed(1)} / 100</strong>
                  <div>
                    <span>Latency</span>
                    <span>26ms</span>
                  </div>
                  <div>
                    <span>Net Fee</span>
                    <span>1.9 bps</span>
                  </div>
                </article>
              </div>
            </section>
          ) : null}
          </section>
        ) : null}

        {isCreateScreen || isEditScreen ? (
          <>
            <div className="route-profile-heading">
              <nav aria-label="Breadcrumb">
                <ol>
                  <li><a href="#">Route Management</a></li>
                  <li><ChevronRight size={16} /><a href="#">Router Profiles</a></li>
                  <li aria-current="page"><ChevronRight size={16} /><span>{isEditScreen ? "Edit" : "Create"}</span></li>
                </ol>
              </nav>
              <h2>{isEditScreen ? "Edit Router Profile" : "Create Router Profile"}</h2>
              <p>Define policy configurations and decision engine parameters to optimize liquidity routing and execution pathways.</p>
            </div>

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

            <section className="route-profile-panel">
              <h3>4. Hard Constraints (Guardrails)</h3>
              <p className="route-profile-meta">Binary filters applied prior to scoring. Routes failing these constraints are immediately culled.</p>
              <div className="route-profile-grid two compact">
                <label className="route-profile-checkbox"><input defaultChecked type="checkbox" /><span>Route must be Verified</span></label>
                <label className="route-profile-checkbox"><input defaultChecked type="checkbox" /><span>Regional Compliance Match</span></label>
                <label className="route-profile-checkbox"><input type="checkbox" /><span>Exclude OTC Venues</span></label>
                <label className="route-profile-checkbox liquidity"><input defaultChecked type="checkbox" /><span>Min Liquidity ($)</span><input defaultValue="5,000,000" type="text" /></label>
              </div>
            </section>
              </div>

              <SimulationPreview />
            </div>
          </>
        ) : null}
      </div>

      {(isCreateScreen || isEditScreen) && error ? <p className="route-profile-feedback error">{error}</p> : null}
      {(isCreateScreen || isEditScreen) && !error && success ? <p className="route-profile-feedback success">{success}</p> : null}

      {isCreateScreen || isEditScreen ? (
        <footer className="route-profile-actions">
          <button onClick={() => navigate?.("/internal/operations/route-profiles")} type="button">Cancel</button>
          <div>
            <button disabled={submitting} onClick={() => { void submitProfile("draft"); }} type="button">
              {submitting ? "Submitting..." : isEditScreen ? "Save Changes" : "Save Draft"}
            </button>
            <button className="primary" disabled={submitting} onClick={() => { void submitProfile("active"); }} type="button">
              <Upload size={16} />
              {submitting ? "Publishing..." : isEditScreen ? "Update Profile" : "Publish Profile"}
            </button>
          </div>
        </footer>
      ) : null}
    </section>
  );
};

const apiFetch = async <T,>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
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

const SimulationPreview = () => (
  <aside className="route-profile-simulation">
    <div>
      <header>
        <FlaskConical size={16} strokeWidth={1.5} />
        <h4>Simulation Preview</h4>
      </header>
      <p>Real-time mock decision based on current engine weights against live telemetry (Sample: USDC/USD 10M).</p>
      <div className="route-profile-rank-stack">
        <RouteRank accent rank="1" score="0.892" venue={["Kraken", "Institutional"]} cost="2.1 bps" time="12s" />
        <RouteRank rank="2" score="0.841" venue={["Coinbase", "Prime"]} cost="2.8 bps" time="8s" />
        <RouteRank muted rank="3" score="0.610" venue={["Circle", "Mint"]} cost="0.0 bps" time="N/A (Cull)" />
      </div>
      <button className="route-profile-rerun" type="button"><RefreshCw size={14} />Re-run Simulation</button>
    </div>
  </aside>
);

const RouteRank = ({
  accent,
  cost,
  muted,
  rank,
  score,
  time,
  venue
}: {
  accent?: boolean;
  cost: string;
  muted?: boolean;
  rank: string;
  score: string;
  time: string;
  venue: [string, string];
}) => (
  <article className={`route-profile-rank ${accent ? "accent" : ""} ${muted ? "muted" : ""}`}>
    <span className="route-profile-rank-number">{rank}</span>
    <div className="route-profile-rank-head">
      <div><small>Venue</small><b>{venue[0]}<br />{venue[1]}</b></div>
      <div><small>Score</small><strong>{score}</strong></div>
    </div>
    <dl>
      <div><dt>Est. Cost:</dt><dd>{cost}</dd></div>
      <div><dt>P95 Time:</dt><dd>{time}</dd></div>
    </dl>
  </article>
);
