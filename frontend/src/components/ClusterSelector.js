// frontend/src/components/ClusterSelector.js
import React from "react";

export default function ClusterSelector({ clusters, selectedCluster, setSelectedCluster }) {
  return (
    <div className="mb-1">
  <label className="block text-base font-bold text-blue-700 dark:text-blue-300 mb-1">Select Cluster</label>
      <select
        className="block w-full p-2 rounded-md shadow-sm focus:outline-none
                   bg-white text-gray-900 border border-gray-300 focus:ring-indigo-500 focus:border-indigo-500
                   dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
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

