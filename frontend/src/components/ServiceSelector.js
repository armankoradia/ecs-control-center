// frontend/src/components/ServiceSelector.js
import React from "react";

export default function ServiceSelector({ services, selectedService, setSelectedService }) {
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
        {services.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

