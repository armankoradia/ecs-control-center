// frontend/src/components/ServiceSelector.js
import React from "react";
import { groupByEnvironment, getEnvironmentDisplayName, getEnvironmentOrder } from "../utils/sortingUtils";

export default function ServiceSelector({ services, selectedService, setSelectedService }) {
  // Group services by environment
  const grouped = groupByEnvironment(services);
  const envOrder = getEnvironmentOrder();
  
  // Sort environment groups by priority - dev first, then others alphabetically
  const sortedEnvs = Object.keys(grouped).sort((a, b) => {
    const orderA = envOrder[a] !== undefined ? envOrder[a] : 999;
    const orderB = envOrder[b] !== undefined ? envOrder[b] : 999;
    return orderA - orderB;
  });

  return (
    <div>
      <label className="block text-sm font-semibold text-secondary-900 mb-2 flex items-center">
        <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Select Service
      </label>
      <select
        className="select-field"
        value={selectedService}
        onChange={(e) => setSelectedService(e.target.value)}
      >
        <option value="">-- Select Service --</option>
        {sortedEnvs.map((env) => (
          <optgroup key={env} label={getEnvironmentDisplayName(env)}>
            {grouped[env].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

