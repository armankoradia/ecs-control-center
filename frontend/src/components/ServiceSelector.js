// frontend/src/components/ServiceSelector.js
import React from "react";

export default function ServiceSelector({ services, selectedService, setSelectedService }) {
  return (
    <div className="mb-1">
  <label className="block text-base font-bold text-blue-700 dark:text-blue-300 mb-1">Select Service</label>
      <select
        className="block w-full p-2 rounded-md shadow-sm focus:outline-none
                   bg-white text-gray-900 border border-gray-300 focus:ring-indigo-500 focus:border-indigo-500
                   dark:bg-gray-800 dark:text-gray-100 dark:border-gray-600 dark:focus:ring-indigo-400 dark:focus:border-indigo-400"
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

