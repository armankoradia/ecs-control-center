// frontend/src/components/ClusterSelector.js
import React from "react";

export default function ClusterSelector({ clusters, selectedCluster, setSelectedCluster }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-secondary-900 mb-2 flex items-center">
        <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
        Select Cluster
      </label>
      <select
        className="select-field"
        value={selectedCluster}
        onChange={(e) => setSelectedCluster(e.target.value)}
      >
        <option value="">-- Select Cluster --</option>
        {clusters.map((c) => (
          <option key={c} value={c.split("/").pop()}>{c.split("/").pop()}</option>
        ))}
      </select>
    </div>
  );
}

