import React, { useEffect, useState } from "react";
import axios from "axios";
import { API_BASE } from "../api";

function ProfileSelector({ setProfile }) {
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    axios.get(`${API_BASE}/profiles`)
      .then(res => {
        if (res.data.length > 0) {
          setProfiles(res.data);
          setSelected(res.data[0]);
          setProfile(res.data[0]); // default selection
        }
      })
      .catch(err => console.error("Error fetching profiles:", err));
  }, [setProfile]);

  useEffect(() => {
    const saved = localStorage.getItem('ecs-profile');
    if (saved && profiles.includes(saved)) {
      setSelected(saved);
      setProfile(saved);
    }
  }, [profiles, setProfile]);

  return (
    <div>
  <label className="block text-base font-bold text-blue-700 dark:text-blue-300 mb-1">Profile</label>
      <select
        className="mt-1 block p-2 rounded-md shadow-sm focus:outline-none min-w-[12rem]
                   bg-white text-gray-900 border border-gray-300 focus:ring-indigo-500 focus:border-indigo-500
                   dark:bg-white/10 dark:text-white dark:border-white/20 dark:focus:ring-white dark:focus:border-white"
        onChange={(e) => { setSelected(e.target.value); setProfile(e.target.value); localStorage.setItem('ecs-profile', e.target.value); }}
        value={selected}
      >
        {profiles.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}

export default ProfileSelector;

