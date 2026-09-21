import React, { useState, useEffect, useCallback } from "react";
import apiService from "../services/apiService";

// ─── small presentational helpers ────────────────────────────────────────────

function StatusPill({ status }) {
  const map = {
    UPDATE_AVAILABLE: "bg-amber-100 text-amber-800",
    UP_TO_DATE:       "bg-green-100  text-green-800",
    NOT_DEPLOYED:     "bg-gray-100   text-gray-500",
    NO_TASKS:         "bg-purple-100 text-purple-700",
    ERROR:            "bg-red-100    text-red-700",
  };
  const label = {
    UPDATE_AVAILABLE: "Update Available",
    UP_TO_DATE:       "Up to Date",
    NOT_DEPLOYED:     "Not Deployed",
    NO_TASKS:         "No Tasks",
    ERROR:            "Error",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${map[status] || "bg-gray-100 text-gray-600"}`}>
      {label[status] || status}
    </span>
  );
}

function DeployStatusCell({ ds }) {
  if (!ds) return <span className="text-secondary-300 text-xs">—</span>;

  if (ds.status === "PENDING") return (
    <span className="flex items-center space-x-1 text-xs text-secondary-400">
      <span className="w-1.5 h-1.5 rounded-full bg-secondary-300 animate-pulse inline-block" />
      <span>Pending</span>
    </span>
  );
  if (ds.status === "IN_PROGRESS") return (
    <span className="flex items-center space-x-1 text-xs text-blue-600">
      <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
      </svg>
      <span>Deploying…</span>
    </span>
  );
  if (ds.status === "SUCCESS") return (
    <span className="flex items-center space-x-1 text-xs text-green-700 font-semibold">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
      </svg>
      <span>Deployed</span>
    </span>
  );
  if (ds.status === "FAILED") return (
    <span className="flex items-center space-x-1 text-xs text-red-700 font-semibold" title={ds.message}>
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
      </svg>
      <span>Failed</span>
    </span>
  );
  if (ds.status === "SKIPPED") return (
    <span className="flex items-center space-x-1 text-xs text-yellow-700">
      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
      </svg>
      <span>Skipped</span>
    </span>
  );
  return null;
}

// ─── main component ───────────────────────────────────────────────────────────

function CrossClusterDeploy({ clusters, region }) {
  // Service suffix list
  const [suffixes, setSuffixes]             = useState([]);
  const [loadingSuffixes, setLoadingSuffixes] = useState(false);
  const [suffixError, setSuffixError]       = useState(null);
  const [skippedClusters, setSkippedClusters] = useState([]);  // clusters that failed during scan

  // Selected suffix + environment filter
  const [selectedSuffix, setSelectedSuffix] = useState("");
  const [selectedEnv, setSelectedEnv]       = useState("all"); // "all" | "dev" | "prod"

  // Version comparison data
  const [versionData, setVersionData]       = useState(null);   // full API response
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionError, setVersionError]     = useState(null);

  // Per-cluster deploy status: { clusterName: { status, message } }
  const [deployStatuses, setDeployStatuses] = useState({});
  const [deploying, setDeploying]           = useState(false);

  // Which clusters are checked for deploy
  const [checked, setChecked]               = useState({});   // { clusterName: bool }

  const [showConfirm, setShowConfirm]       = useState(false);

  // Derive short names once
  const clusterNames = React.useMemo(
    () => clusters.map((c) => (c.includes("/") ? c.split("/").pop() : c)),
    [clusters]
  );

  // ── load suffix list ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!region) return;
    setLoadingSuffixes(true);
    setSuffixError(null);
    apiService
      .getServiceSuffixes(region)
      .then((d) => {
        setSuffixes(d.suffixes || []);
        setSkippedClusters(d.skipped || []);
      })
      .catch((e) => setSuffixError(e?.response?.data?.detail || e.message || "Failed"))
      .finally(() => setLoadingSuffixes(false));
  }, [region]);

  // ── fetch version info (called on suffix or env change) ──────────────────
  const fetchVersionInfo = useCallback(
    async (suffix, env) => {
      if (!suffix) return;
      setLoadingVersions(true);
      setVersionError(null);
      setVersionData(null);
      setDeployStatuses({});
      try {
        const envArg = env === "all" ? null : env;
        const d = await apiService.getCrossClusterServiceStatus(suffix, [], region, envArg);
        setVersionData(d);
        // Pre-check clusters that have updates available
        const initial = {};
        (d.clusters || []).forEach((r) => {
          initial[r.cluster] = r.status === "UPDATE_AVAILABLE";
        });
        setChecked(initial);
      } catch (e) {
        setVersionError(e?.response?.data?.detail || e.message || "Failed to load version info");
      } finally {
        setLoadingVersions(false);
      }
    },
    [region]
  );

  const handleSuffixChange = (v) => {
    setSelectedSuffix(v);
    setDeployStatuses({});
    if (v) fetchVersionInfo(v, selectedEnv);
    else { setVersionData(null); setChecked({}); }
  };

  const handleEnvChange = (env) => {
    setSelectedEnv(env);
    setDeployStatuses({});
    if (selectedSuffix) fetchVersionInfo(selectedSuffix, env);
    else { setVersionData(null); setChecked({}); }
  };

  // ── checkbox helpers ──────────────────────────────────────────────────────
  const toggleCluster = (name) =>
    setChecked((prev) => ({ ...prev, [name]: !prev[name] }));

  const selectAll = () => {
    const next = {};
    (versionData?.clusters || []).forEach((r) => {
      if (r.status !== "NOT_DEPLOYED") next[r.cluster] = true;
    });
    setChecked(next);
  };

  const selectUpdates = () => {
    const next = {};
    (versionData?.clusters || []).forEach((r) => {
      next[r.cluster] = r.status === "UPDATE_AVAILABLE";
    });
    setChecked(next);
  };

  const deselectAll = () => {
    const next = {};
    (versionData?.clusters || []).forEach((r) => { next[r.cluster] = false; });
    setChecked(next);
  };

  const checkedList = Object.entries(checked)
    .filter(([, v]) => v)
    .map(([k]) => k);

  // ── sequential deploy with live status updates ────────────────────────────
  const handleDeploy = async () => {
    setShowConfirm(false);
    setDeploying(true);

    // Mark all selected as PENDING
    const initial = {};
    checkedList.forEach((c) => { initial[c] = { status: "PENDING", message: "" }; });
    setDeployStatuses(initial);

    for (const cluster of checkedList) {
      // Mark current cluster as IN_PROGRESS
      setDeployStatuses((prev) => ({
        ...prev,
        [cluster]: { status: "IN_PROGRESS", message: "Deploying…" },
      }));

      try {
        const envArg = selectedEnv === "all" ? null : selectedEnv;
        const result = await apiService.deployAcrossClusters(selectedSuffix, [cluster], region, envArg);
        const r = result.results?.[0];
        setDeployStatuses((prev) => ({
          ...prev,
          [cluster]: {
            status: r?.status || "FAILED",
            message: r?.message || "",
            service: r?.service,
          },
        }));
      } catch (e) {
        setDeployStatuses((prev) => ({
          ...prev,
          [cluster]: {
            status: "FAILED",
            message: e?.response?.data?.detail || e.message || "Deployment failed",
          },
        }));
      }
    }

    setDeploying(false);
  };

  // ── derived summary for the deploy button ────────────────────────────────
  const deployDone = !deploying && Object.keys(deployStatuses).length > 0;
  const deploySucceeded = Object.values(deployStatuses).filter((d) => d.status === "SUCCESS").length;
  const deployFailed    = Object.values(deployStatuses).filter((d) => d.status === "FAILED").length;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── header ── */}
      <div className="card">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-primary-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
          </div>
          <div>
            <h2 className="text-base font-semibold text-secondary-900">Global Deploy</h2>
            <p className="text-xs text-secondary-500">
              Select a service to compare deployed vs. latest versions across every cluster,
              then deploy with one click.
            </p>
          </div>
        </div>
      </div>

      {/* ── service + environment selector row ── */}
      <div className="card">
        <div className="flex items-end gap-4 flex-wrap">

          {/* Environment segmented control */}
          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">Environment</label>
            <div className="flex rounded-lg border border-secondary-300 overflow-hidden text-sm">
              {[
                { value: "all",  label: "All" },
                { value: "dev",  label: "Dev" },
                { value: "prod", label: "Prod" },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleEnvChange(value)}
                  disabled={deploying}
                  className={`px-4 py-2 font-medium transition-colors disabled:opacity-50 ${
                    selectedEnv === value
                      ? value === "prod"
                        ? "bg-red-600 text-white"
                        : value === "dev"
                        ? "bg-blue-600 text-white"
                        : "bg-secondary-700 text-white"
                      : "bg-white text-secondary-600 hover:bg-secondary-50"
                  } ${value !== "all" ? "border-l border-secondary-300" : ""}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-48">
            <label className="block text-xs font-medium text-secondary-600 mb-1">Service</label>
            {loadingSuffixes ? (
              <div className="flex items-center space-x-2 text-xs text-secondary-400 h-9">
                <svg className="animate-spin h-4 w-4 text-primary-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                </svg>
                <span>Discovering services…</span>
              </div>
            ) : (
              <select
                value={selectedSuffix}
                onChange={(e) => handleSuffixChange(e.target.value)}
                disabled={deploying}
                className="w-full px-3 py-2 text-sm border border-secondary-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white disabled:opacity-60"
              >
                <option value="">— Select a service —</option>
                {suffixes.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {suffixError && <p className="mt-1 text-xs text-red-600">{suffixError}</p>}
          </div>

          {selectedSuffix && (
            <p className="text-xs text-secondary-400 self-end pb-2">
              Matches{" "}
              <span className="font-mono">
                *-{selectedEnv !== "all" ? `${selectedEnv}-` : ""}{selectedSuffix}
              </span>{" "}
              in each cluster
            </p>
          )}

          {selectedSuffix && !loadingVersions && (
            <button
              onClick={() => fetchVersionInfo(selectedSuffix, selectedEnv)}
              disabled={deploying}
              className="self-end btn-secondary text-xs py-2 px-3 disabled:opacity-50"
              title="Refresh version info"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* ── skipped clusters warning ── */}
      {skippedClusters.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start space-x-2">
            <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <div className="text-xs text-amber-800">
              <span className="font-semibold">{skippedClusters.length} cluster{skippedClusters.length !== 1 ? "s" : ""} could not be scanned</span>
              {" "}— services from these clusters may be missing from the dropdown.
              <details className="mt-1 cursor-pointer">
                <summary className="font-medium hover:underline">Show details</summary>
                <ul className="mt-1 space-y-0.5 pl-2">
                  {skippedClusters.map((c) => (
                    <li key={c.cluster} className="font-mono">
                      <span className="font-semibold">{c.cluster}</span>
                      {c.reason && <span className="text-amber-700 ml-1">— {c.reason}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* ── version / status table ── */}
      {selectedSuffix && (
        <div className="card overflow-hidden p-0">

          {/* table header bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-secondary-200 bg-secondary-50">
            <div className="flex items-center space-x-3">
              <span className="text-sm font-semibold text-secondary-800">
                Version Status
                {versionData && (
                  <span className="ml-2 text-xs font-normal text-secondary-500">
                    — {versionData.summary.deployed_in} cluster{versionData.summary.deployed_in !== 1 ? "s" : ""} running,{" "}
                    <span className="text-amber-700 font-medium">{versionData.summary.updates_available} with updates</span>
                  </span>
                )}
              </span>
            </div>
            {versionData && !deploying && (
              <div className="flex items-center space-x-2 text-xs">
                <button onClick={selectUpdates} className="text-amber-600 hover:text-amber-700 font-medium">
                  Select updates
                </button>
                <span className="text-secondary-300">|</span>
                <button onClick={selectAll} className="text-primary-600 hover:text-primary-700 font-medium">
                  Select all
                </button>
                <span className="text-secondary-300">|</span>
                <button onClick={deselectAll} className="text-secondary-500 hover:text-secondary-700 font-medium">
                  Deselect all
                </button>
              </div>
            )}
          </div>

          {/* loading state */}
          {loadingVersions && (
            <div className="flex items-center justify-center space-x-2 py-10 text-sm text-secondary-500">
              <svg className="animate-spin h-5 w-5 text-primary-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              <span>Checking versions across {clusterNames.length} clusters…</span>
            </div>
          )}

          {/* error state */}
          {versionError && (
            <div className="px-4 py-3 text-xs text-red-700 bg-red-50">{versionError}</div>
          )}

          {/* table */}
          {versionData && !loadingVersions && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs font-semibold text-secondary-500 uppercase tracking-wide border-b border-secondary-200">
                    <th className="px-4 py-2 text-left w-8"></th>
                    <th className="px-4 py-2 text-left">Cluster</th>
                    <th className="px-4 py-2 text-left">Service Name</th>
                    <th className="px-4 py-2 text-center">Current Version</th>
                    <th className="px-4 py-2 text-center">Latest in ECR</th>
                    <th className="px-4 py-2 text-center">ECR Status</th>
                    <th className="px-4 py-2 text-center">Deploy Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-100">
                  {versionData.clusters.map((row) => {
                    const isNotDeployed = row.status === "NOT_DEPLOYED";
                    const ds = deployStatuses[row.cluster];
                    const isActive = ds?.status === "IN_PROGRESS";

                    return (
                      <tr
                        key={row.cluster}
                        className={`transition-colors ${
                          isActive
                            ? "bg-blue-50"
                            : isNotDeployed
                            ? "opacity-50 bg-secondary-50"
                            : checked[row.cluster]
                            ? "bg-white hover:bg-primary-50/40"
                            : "bg-secondary-50/50 hover:bg-secondary-100/60"
                        }`}
                      >
                        {/* checkbox */}
                        <td className="px-4 py-2.5">
                          <input
                            type="checkbox"
                            checked={!!checked[row.cluster]}
                            disabled={isNotDeployed || deploying}
                            onChange={() => toggleCluster(row.cluster)}
                            className="accent-primary-600 cursor-pointer disabled:cursor-not-allowed"
                          />
                        </td>

                        {/* cluster name */}
                        <td className="px-4 py-2.5 font-medium text-secondary-800 whitespace-nowrap">
                          {row.cluster}
                        </td>

                        {/* full service name */}
                        <td className="px-4 py-2.5 text-xs font-mono text-secondary-500 whitespace-nowrap">
                          {row.service || <span className="italic text-secondary-400">not found</span>}
                        </td>

                        {/* current tag */}
                        <td className="px-4 py-2.5 text-center">
                          {row.current_tag ? (
                            <span className="font-mono text-xs bg-secondary-100 text-secondary-700 px-2 py-0.5 rounded">
                              {row.current_tag}
                            </span>
                          ) : (
                            <span className="text-secondary-300 text-xs">—</span>
                          )}
                        </td>

                        {/* latest ECR tag */}
                        <td className="px-4 py-2.5 text-center">
                          {row.latest_tag ? (
                            <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                              row.has_update
                                ? "bg-amber-100 text-amber-800 font-semibold"
                                : "bg-green-100 text-green-700"
                            }`}>
                              {row.latest_tag}
                            </span>
                          ) : (
                            <span className="text-secondary-300 text-xs">—</span>
                          )}
                        </td>

                        {/* ECR status pill */}
                        <td className="px-4 py-2.5 text-center">
                          <StatusPill status={row.status} />
                        </td>

                        {/* deploy status */}
                        <td className="px-4 py-2.5 text-center">
                          <DeployStatusCell ds={ds} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* deploy footer bar */}
          {versionData && !loadingVersions && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-secondary-200 bg-secondary-50">
              <div className="text-xs text-secondary-500">
                {deploying ? (
                  <span className="text-blue-600 font-medium">
                    Deploying to clusters… {Object.values(deployStatuses).filter(d => d.status === "SUCCESS").length}/{checkedList.length} done
                  </span>
                ) : deployDone ? (
                  <span>
                    <span className="text-green-700 font-semibold">{deploySucceeded} succeeded</span>
                    {deployFailed > 0 && <span className="text-red-700 font-semibold ml-2">{deployFailed} failed</span>}
                  </span>
                ) : (
                  <span>
                    {checkedList.length} cluster{checkedList.length !== 1 ? "s" : ""} selected
                  </span>
                )}
              </div>

              <button
                disabled={checkedList.length === 0 || deploying}
                onClick={() => setShowConfirm(true)}
                className="btn-primary text-sm py-2 px-5 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deploying ? (
                  <span className="flex items-center space-x-2">
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                    </svg>
                    <span>Deploying…</span>
                  </span>
                ) : (
                  <span className="flex items-center space-x-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span>Deploy to {checkedList.length} Cluster{checkedList.length !== 1 ? "s" : ""}</span>
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── confirmation modal ── */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-lg w-full mx-4 space-y-4">
            <h3 className="text-base font-semibold text-secondary-900">Confirm Global Deploy</h3>
            <p className="text-sm text-secondary-600">
              Deploy{" "}
              <span className="font-mono font-semibold text-secondary-900">
                *-{selectedEnv !== "all" ? `${selectedEnv}-` : ""}{selectedSuffix}
              </span>{" "}
              {selectedEnv !== "all" && (
                <span>
                  (<span className={`font-semibold ${selectedEnv === "prod" ? "text-red-600" : "text-blue-600"}`}>
                    {selectedEnv}
                  </span> environment){" "}
                </span>
              )}
              to{" "}
              <span className="font-semibold text-primary-700">
                {checkedList.length} cluster{checkedList.length !== 1 ? "s" : ""}
              </span>{" "}
              in <span className="font-semibold">{region}</span>?
            </p>

            {/* summary of selected clusters */}
            <div className="max-h-40 overflow-y-auto space-y-1">
              {checkedList.map((c) => {
                const row = versionData?.clusters.find((r) => r.cluster === c);
                return (
                  <div key={c} className="flex items-center justify-between text-xs bg-secondary-50 rounded px-3 py-1.5">
                    <span className="font-medium text-secondary-800">{c}</span>
                    {row && (
                      <span className="font-mono text-secondary-500">
                        {row.current_tag || "—"}
                        {row.has_update && (
                          <span className="ml-1 text-amber-700">→ {row.latest_tag}</span>
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-xs text-secondary-400">
              Deploys run one cluster at a time. Progress is shown live in the table.
            </p>
            <div className="flex justify-end space-x-3 pt-1">
              <button onClick={() => setShowConfirm(false)} className="btn-secondary text-sm py-2 px-4">
                Cancel
              </button>
              <button onClick={handleDeploy} className="btn-primary text-sm py-2 px-4">
                Deploy Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default CrossClusterDeploy;
