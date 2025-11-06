import React from "react";
import { useAuth } from "../contexts/AuthContext";

const regions = [
  "us-east-1",
  "eu-central-1",
  // Add more regions as needed
];

function RegionSelector({ region, setRegion }) {
  const { isAuthenticated } = useAuth();
  return (
    <div>
      <label className="block text-sm font-semibold text-secondary-900 mb-2 flex items-center">
        <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        AWS Region
      </label>
      
      <select
        className="select-field"
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

