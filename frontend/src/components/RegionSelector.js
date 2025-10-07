import React from "react";

const regions = [
  "us-east-1",
  "eu-central-1",
  // Add more regions as needed
];

function RegionSelector({ region, setRegion }) {
  return (
    <div>
  <label className="block text-base font-bold text-blue-700 dark:text-blue-300 mb-1">Region</label>
      <select
        className="mt-1 block p-2 rounded-md shadow-sm focus:outline-none min-w-[12rem]
                   bg-white text-gray-900 border border-gray-300 focus:ring-indigo-500 focus:border-indigo-500
                   dark:bg-white/10 dark:text-white dark:border-white/20 dark:focus:ring-white dark:focus:border-white"
        value={region}
        onChange={(e) => { setRegion(e.target.value); localStorage.setItem('ecs-region', e.target.value); }}
      >
        {regions.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
      </select>
    </div>
  );
}

export default RegionSelector;

