import React, { useState, useEffect, useCallback } from "react";
import apiService from "../services/apiService";

// ─── helpers ────────────────────────────────────────────────────────────────

const ACTION_META = {
  versioned_tag_update:  { label: "Deploy (new version)", color: "badge-success",   icon: "🚀" },
  latest_tag_restart:    { label: "Deploy (latest tag)",  color: "badge-success",   icon: "🔄" },
  force_new_deployment:  { label: "Force Restart",        color: "badge-info",      icon: "⚡" },
  update_count:          { label: "Update Task Count",    color: "badge-secondary", icon: "🔢" },
  task_definition_update:{ label: "Edit Task Definition", color: "badge-warning",   icon: "📝" },
  global_deploy:         { label: "Global Deploy",        color: "badge-primary",   icon: "🌐" },
  cluster_deploy_all:    { label: "Deploy All (Cluster)", color: "badge-success",   icon: "🚀" },
  cluster_restart_all:   { label: "Restart All (Cluster)",color: "badge-info",      icon: "🔄" },
  rollback:              { label: "Rollback",             color: "badge-warning",   icon: "↩️" },
};

function actionMeta(type) {
  return ACTION_META[type] || { label: type || "Deployment", color: "badge-secondary", icon: "📦" };
}

const STATUS_COLOR = {
  COMPLETED:   "badge-success",
  IN_PROGRESS: "badge-info",
  PENDING:     "badge-info",
  FAILED:      "badge-danger",
  UNKNOWN:     "badge-warning",
};

function formatTs(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/) ? ts + "Z" : ts);
    return isNaN(d) ? ts : d.toLocaleString();
  } catch { return ts; }
}

function Avatar({ name }) {
  const initials = (name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  return (
    <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
      {initials}
    </div>
  );
}

// ─── component ──────────────────────────────────────────────────────────────

function DeploymentHistory({ cluster, service, region, globalMode = false }) {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rollbacking, setRollbacking] = useState({});
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [filterAction, setFilterAction] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // globalMode fetches all history (no cluster filter)
      const data = await apiService.getDeploymentHistory(
        globalMode ? null : cluster,
        globalMode ? null : service,
        100,
        region,
      );
      if (data && !data.error) {
        setDeployments(data.deployments || []);
      } else {
        setError(data?.error || "Failed to fetch history");
      }
    } catch (err) {
      setError(err?.response?.data?.detail || err.message);
    } finally {
      setLoading(false);
    }
  }, [cluster, service, region, globalMode]);

  useEffect(() => {
    if (globalMode || cluster) fetchHistory();
  }, [fetchHistory, globalMode, cluster]);

  // Auto-refresh while any deployment is in progress
  useEffect(() => {
    if (!deployments.some((d) => ["IN_PROGRESS", "PENDING"].includes(d.status))) return;
    const t = setInterval(fetchHistory, 10000);
    return () => clearInterval(t);
  }, [deployments, fetchHistory]);

  const handleRollback = useCallback(async (deploymentId) => {
    setRollbacking((p) => ({ ...p, [deploymentId]: true }));
    try {
      await apiService.rollbackDeployment(deploymentId, region);
      setTimeout(fetchHistory, 1000);
    } catch (err) {
      console.error("Rollback failed:", err?.response?.data?.detail || err.message);
    } finally {
      setRollbacking((p) => ({ ...p, [deploymentId]: false }));
    }
  }, [region, fetchHistory]);

  // ── filtering ──
  const filtered = deployments.filter((d) => {
    if (filterAction !== "all" && d.deployment_type !== filterAction) return false;
    if (filterStatus !== "all" && d.status !== filterStatus) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (d.service  || "").toLowerCase().includes(q) ||
        (d.cluster  || "").toLowerCase().includes(q) ||
        (d.username || "").toLowerCase().includes(q) ||
        (d.email    || "").toLowerCase().includes(q) ||
        (d.region   || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ── empty / loading / error guards ──
  if (!globalMode && !cluster) {
    return (
      <div className="card">
        <HistoryHeader />
        <div className="text-center py-12 text-secondary-500">
          <ClockIcon className="w-16 h-16 mx-auto mb-4 opacity-40" />
          <div className="text-sm font-medium">Select a cluster to view deployment history</div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      {/* ── header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5 pb-4 border-b border-secondary-200">
        <HistoryHeader count={deployments.length} />
        <button onClick={fetchHistory} disabled={loading} className="btn-secondary text-xs py-1.5 px-3 flex items-center space-x-1">
          {loading
            ? <><SpinIcon className="animate-spin h-3 w-3" /><span>Refreshing…</span></>
            : <><RefreshIcon className="w-3 h-3" /><span>Refresh</span></>}
        </button>
      </div>

      {/* ── filters ── */}
      <div className="flex flex-wrap gap-2 mb-4">
        <input
          type="text"
          placeholder="Search service, cluster, user…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-secondary-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400 w-48"
        />
        <select
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          className="border border-secondary-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="all">All actions</option>
          {Object.entries(ACTION_META).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="border border-secondary-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary-400"
        >
          <option value="all">All statuses</option>
          {["COMPLETED", "IN_PROGRESS", "PENDING", "FAILED", "UNKNOWN"].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="p-3 mb-4 bg-danger-50 border border-danger-200 rounded-lg text-xs text-danger-800">{error}</div>
      )}

      {/* ── table ── */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <ClockIcon className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <div className="text-sm font-medium">{deployments.length === 0 ? "No history yet" : "No results match your filters"}</div>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500 uppercase tracking-wide">
                <th className="pb-2 pr-3 font-semibold">Timestamp</th>
                <th className="pb-2 pr-3 font-semibold">User</th>
                <th className="pb-2 pr-3 font-semibold">Action</th>
                <th className="pb-2 pr-3 font-semibold">Service</th>
                {(globalMode || !cluster) && <th className="pb-2 pr-3 font-semibold">Cluster</th>}
                <th className="pb-2 pr-3 font-semibold">Region</th>
                <th className="pb-2 pr-3 font-semibold">Status</th>
                <th className="pb-2 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary-100">
              {filtered.map((d) => {
                const meta = actionMeta(d.deployment_type);
                return (
                  <tr key={d.deployment_id} className="hover:bg-secondary-50 transition-colors">
                    <td className="py-2.5 pr-3 text-secondary-600 whitespace-nowrap">{formatTs(d.timestamp)}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center space-x-1.5">
                        <Avatar name={d.username} />
                        <div>
                          <div className="font-medium text-secondary-900 truncate max-w-[120px]">{d.username || "unknown"}</div>
                          {d.email && d.email !== "unknown" && (
                            <div className="text-secondary-400 truncate max-w-[120px]">{d.email}</div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span className={`badge ${meta.color} flex items-center space-x-1 w-fit`}>
                        <span>{meta.icon}</span>
                        <span>{meta.label}</span>
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-secondary-800 truncate max-w-[160px]">{d.service || "—"}</td>
                    {(globalMode || !cluster) && (
                      <td className="py-2.5 pr-3 text-secondary-600 truncate max-w-[140px]">{d.cluster || "—"}</td>
                    )}
                    <td className="py-2.5 pr-3 text-secondary-500 whitespace-nowrap">{d.region || "—"}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap">
                      <span className={`badge ${STATUS_COLOR[d.status] || "badge-secondary"}`}>{d.status}</span>
                      {["IN_PROGRESS", "PENDING"].includes(d.status) && (
                        <SpinIcon className="inline animate-spin h-3 w-3 ml-1 text-primary-500" />
                      )}
                    </td>
                    <td className="py-2.5">
                      <div className="flex items-center space-x-1">
                        <button
                          onClick={() => setSelectedDeployment(d)}
                          className="btn-secondary text-xs py-1 px-2"
                          title="View details"
                        >Details</button>
                        {d.deployment_type !== "rollback" && d.deployment_type !== "update_count" && d.deployment_type !== "global_deploy" && (
                          <button
                            onClick={() => handleRollback(d.deployment_id)}
                            disabled={rollbacking[d.deployment_id]}
                            className="btn-secondary text-xs py-1 px-2 bg-warning-50 border-warning-200 text-warning-700 hover:bg-warning-100"
                            title="Rollback"
                          >
                            {rollbacking[d.deployment_id] ? "…" : "↩ Rollback"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── details modal ── */}
      {selectedDeployment && (
        <DetailsModal
          deployment={selectedDeployment}
          onClose={() => setSelectedDeployment(null)}
          onRollback={handleRollback}
          rollbacking={rollbacking}
        />
      )}
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function HistoryHeader({ count }) {
  return (
    <h2 className="text-xl font-bold text-secondary-900 flex items-center space-x-2">
      <ClockIcon className="w-5 h-5 text-primary-600" />
      <span>Deployment History</span>
      {count !== undefined && (
        <span className="text-sm font-normal text-secondary-500 ml-1">({count} records)</span>
      )}
    </h2>
  );
}

function DetailsModal({ deployment: d, onClose, onRollback, rollbacking }) {
  const meta = actionMeta(d.deployment_type);

  const rows = [
    ["Deployment ID",  d.deployment_id],
    ["Timestamp",      <span className="font-medium">{formatTs(d.timestamp)}</span>],
    ["User",           `${d.username || "unknown"}${d.email && d.email !== "unknown" ? ` (${d.email})` : ""}`],
    ["Action",         <span className={`badge ${meta.color}`}>{meta.icon} {meta.label}</span>],
    ["Cluster",        d.cluster],
    ["Service",        <span className="font-mono">{d.service}</span>],
    ["Region",         d.region],
    ["Status",         <span className={`badge ${STATUS_COLOR[d.status] || "badge-secondary"}`}>{d.status}</span>],
    ["Message",        d.message],
    d.new_task_definition && ["Task Definition", <span className="font-mono text-xs break-all">{d.new_task_definition}</span>],
    d.running_count !== undefined && ["Task counts", `running: ${d.running_count} / desired: ${d.desired_count}${d.pending_count > 0 ? ` (${d.pending_count} pending)` : ""}`],
  ].filter(Boolean);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="card max-w-2xl w-full max-h-[80vh] overflow-y-auto scrollbar-thin">
        <div className="flex items-center justify-between mb-5 pb-4 border-b border-secondary-200">
          <h3 className="text-lg font-bold text-secondary-900">Deployment Details</h3>
          <button onClick={onClose} className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-all">
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        <dl className="space-y-3">
          {rows.map(([label, value]) => value != null && (
            <div key={label} className="grid grid-cols-3 gap-2">
              <dt className="text-xs font-semibold text-secondary-500 uppercase tracking-wide pt-0.5">{label}</dt>
              <dd className="col-span-2 text-sm text-secondary-900 bg-secondary-50 rounded px-2 py-1 border border-secondary-100">{value}</dd>
            </div>
          ))}
        </dl>

        {d.details && (
          <div className="mt-4">
            <div className="text-xs font-semibold text-secondary-500 uppercase tracking-wide mb-1">Details</div>
            <pre className="text-xs bg-secondary-900 text-secondary-100 rounded-lg p-3 overflow-x-auto scrollbar-thin">
              {JSON.stringify(d.details, null, 2)}
            </pre>
          </div>
        )}

        <div className="flex justify-end space-x-2 mt-5 pt-4 border-t border-secondary-200">
          <button onClick={onClose} className="btn-secondary">Close</button>
          {d.deployment_type !== "rollback" && d.deployment_type !== "update_count" && d.deployment_type !== "global_deploy" && (
            <button
              onClick={() => { onClose(); onRollback(d.deployment_id); }}
              disabled={rollbacking[d.deployment_id]}
              className="btn-secondary bg-warning-50 border-warning-200 text-warning-700 hover:bg-warning-100"
            >
              {rollbacking[d.deployment_id] ? "Rolling back…" : "↩ Rollback"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── icon stubs ──────────────────────────────────────────────────────────────

function ClockIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function RefreshIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
function SpinIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}
function XIcon({ className }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

export default DeploymentHistory;
