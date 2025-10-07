import React, { useEffect, useState } from "react";
import { API_BASE, WS_BASE } from "../api";
import apiService from "../services/apiService";

function LogsPanel({ cluster, service, profile, region, authMethod = "profile" }) {
  const [logs, setLogs] = useState([]);
  const [ws, setWs] = useState(null);
  const [intervalSec, setIntervalSec] = useState(() => Number(localStorage.getItem('ecs-log-interval') || 3));

  useEffect(() => {
    if (!cluster || !service) return;

    let socket;
    let cancelled = false;

    apiService.get(`${API_BASE}/log-target?cluster=${encodeURIComponent(cluster)}&service=${encodeURIComponent(service)}&profile=${encodeURIComponent(profile)}&region=${encodeURIComponent(region)}&auth_method=${encodeURIComponent(authMethod)}`)
      .then(res => {
        if (cancelled) return;
        if (res.data && res.data.log_group && res.data.log_stream) {
          socket = new WebSocket(`${WS_BASE}/ws/logs?log_group=${encodeURIComponent(res.data.log_group)}&log_stream=${encodeURIComponent(res.data.log_stream)}&profile=${encodeURIComponent(profile)}&region=${encodeURIComponent(region)}&interval=${encodeURIComponent(intervalSec)}`);
          socket.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.message) {
                setLogs(prev => [data.message, ...prev].slice(0, 2000));
              } else if (data.error) {
                setLogs(prev => [...prev, `Error: ${data.error}`]);
              }
            } catch (e) {
              setLogs(prev => [event.data, ...prev].slice(0, 2000));
            }
          };
          socket.onerror = console.error;
          setWs(socket);
        } else {
          setLogs(prev => [...prev, `Error: ${res.data.error || 'Unable to resolve log target'}`]);
        }
      })
      .catch(err => setLogs(prev => [...prev, `Error resolving log target: ${err}`]));

    return () => {
      cancelled = true;
      if (socket) socket.close();
      setLogs([]);
    };
  }, [cluster, service, profile, region, intervalSec]);

  return (
    <div className="flex-1 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
      <div className="px-4 py-2 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h2 className="font-semibold text-gray-800 dark:text-gray-200">Logs</h2>
        <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300">
          <span>Refresh</span>
          <select
            className="p-1 rounded border border-gray-300 bg-white text-gray-900 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600"
            value={intervalSec}
            onChange={(e) => { const v = Number(e.target.value); setIntervalSec(v); localStorage.setItem('ecs-log-interval', String(v)); }}
          >
            <option value={1}>1s</option>
            <option value={2}>2s</option>
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
          </select>
          <button
            onClick={() => {
              const content = logs.join('\n');
              const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              const ts = new Date().toISOString().replace(/[:]/g, '-');
              const nameCluster = (cluster || 'cluster').toString().replace(/[^a-zA-Z0-9-_\.]/g, '_');
              const nameService = (service || 'service').toString().replace(/[^a-zA-Z0-9-_\.]/g, '_');
              a.href = url;
              a.download = `logs_${nameCluster}_${nameService}_${ts}.txt`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-600"
          >
            Download
          </button>
        </div>
      </div>
      <div className="h-[460px] bg-gray-900 text-gray-100 p-3 text-xs font-mono whitespace-pre-wrap leading-5 overflow-auto">
        {logs.map((line, idx) => (
          <div key={idx} className="text-gray-100">{line}</div>
        ))}
      </div>
    </div>
  );
}

export default LogsPanel;

