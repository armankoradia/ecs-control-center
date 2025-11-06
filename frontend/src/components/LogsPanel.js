import React, { useEffect, useState, useRef } from "react";
import { API_BASE, WS_BASE } from "../api";
import apiService from "../services/apiService";
import TimeRangeSelector from "./TimeRangeSelector";

function LogsPanel({ cluster, service, region }) {
  const [logs, setLogs] = useState([]);
  const [ws, setWs] = useState(null);
  const [intervalSec, setIntervalSec] = useState(() => Number(localStorage.getItem('ecs-log-interval') || 3));
  const [lastRefresh, setLastRefresh] = useState(null);
  const [mode, setMode] = useState("live"); // "live" or "historical"
  const [timeRange, setTimeRange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState("IST"); // Default to IST
  const wsRef = useRef(null);

  // Available timezones
  const availableTimezones = [
    { value: "UTC", label: "UTC (UTC+00:00)", offset: 0 },
    { value: "CET", label: "CET (UTC+01:00)", offset: 1 },
    { value: "CEST", label: "CEST (UTC+02:00)", offset: 2 },
    { value: "EET", label: "EET (UTC+02:00)", offset: 2 },
    { value: "IST", label: "IST (UTC+05:30)", offset: 5.5 }
  ];

  // Convert UTC timestamp to selected timezone
  const convertToTimezone = (timestamp, timezoneValue) => {
    if (!timestamp) return "";
    
    // Map timezone values to actual timezone identifiers
    const timezoneMap = {
      "UTC": "UTC",
      "CET": "Europe/Berlin", // CET/CEST
      "CEST": "Europe/Berlin", // CET/CEST
      "EET": "Europe/Bucharest", // EET/EEST (Eastern European Time)
      "IST": "Asia/Kolkata"
    };
    
    const actualTimezone = timezoneMap[timezoneValue];
    if (!actualTimezone) return timestamp;
    
    let date;
    
    // Handle different timestamp formats
    if (typeof timestamp === 'string') {
      // Handle "YYYY-MM-DD HH:MM:SS" format from historical logs
      if (timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        // This is already formatted, just return it
        return timestamp;
      } else if (timestamp.includes('T')) {
        // ISO format
        date = new Date(timestamp);
      } else {
        // Try to parse as date string
        date = new Date(timestamp);
      }
    } else {
      // Handle numeric timestamp (milliseconds from CloudWatch)
      date = new Date(timestamp);
    }
    
    // Check if date is valid
    if (isNaN(date.getTime())) {
      return timestamp; // Return original if parsing failed
    }
    
    // Use Intl.DateTimeFormat for proper timezone conversion
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: actualTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
    
    // Format the date in the selected timezone
    const parts = formatter.formatToParts(date);
    const year = parts.find(part => part.type === 'year').value;
    const month = parts.find(part => part.type === 'month').value;
    const day = parts.find(part => part.type === 'day').value;
    const hour = parts.find(part => part.type === 'hour').value;
    const minute = parts.find(part => part.type === 'minute').value;
    const second = parts.find(part => part.type === 'second').value;
    
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  };

  const fetchHistoricalLogs = async (startTime, endTime) => {
    setLoading(true);
    console.log("Fetching historical logs:", { cluster, service, startTime, endTime });
    
    try {
      const payload = {
        cluster: cluster,
        service: service,
        start_time: startTime,
        end_time: endTime,
        limit: 1000,
        region
      };
      
      // Add access key credentials
      apiService.addCredentials(payload);

      console.log("API URL:", `${API_BASE}/historical_logs`);
      const response = await apiService.get(`${API_BASE}/historical_logs`, { method: 'POST', data: payload });
      console.log("Historical logs response:", response.data);
      
      const historicalLogs = response.data.logs || [];
      
      // Format logs with timestamps converted to selected timezone
      const formattedLogs = historicalLogs.map(log => {
        // For historical logs, convert the timestamp to the selected timezone
        const timestamp = log.formatted_time || log.timestamp;
        let convertedTime;
        
        if (typeof timestamp === 'number') {
          // Numeric timestamp from CloudWatch - convert to timezone
          convertedTime = convertToTimezone(timestamp, selectedTimezone);
        } else if (typeof timestamp === 'string' && timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
          // Already formatted timestamp - convert to timezone
          const date = new Date(timestamp + ' UTC'); // Assume UTC if no timezone info
          convertedTime = convertToTimezone(date.getTime(), selectedTimezone);
        } else {
          // Fallback - try to convert whatever we have
          convertedTime = convertToTimezone(timestamp, selectedTimezone);
        }
        
        return `[${convertedTime}] ${log.message}`;
      });
      
      console.log("Formatted logs:", formattedLogs.length, "entries");
      
      if (formattedLogs.length === 0) {
        console.warn("No logs returned from API. Response:", response.data);
        setLogs([`[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] No logs found for the selected time range.`]);
      } else {
        setLogs(formattedLogs);
      }
      setLastRefresh(new Date());
    } catch (error) {
      console.error("Failed to fetch historical logs:", error);
      console.error("Error details:", {
        message: error.message,
        response: error.response?.data,
        status: error.response?.status,
        config: error.config
      });
      const errorMessage = error.response?.data?.detail || error.response?.data?.error || error.message;
      setLogs([`[${new Date().toISOString().replace('T', ' ').substring(0, 19)}] Error: ${errorMessage}`]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!cluster || !service) return;

    // Close existing WebSocket if it exists
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWs(null);
    }

    if (mode === "live") {
      // Live mode - use WebSocket streaming
      let socket;
      let cancelled = false;

      (() => {
        const payload = { cluster, service, region };
        apiService.addCredentials(payload);
        return apiService.get(`${API_BASE}/log-target`, { method: 'POST', data: payload });
      })()
        .then(res => {
          if (cancelled) return;
          if (res.data && res.data.log_group && res.data.log_stream) {
            // Create WebSocket with current interval value
            let wsUrl = `${WS_BASE}/ws/logs?log_group=${encodeURIComponent(res.data.log_group)}&log_stream=${encodeURIComponent(res.data.log_stream)}&region=${encodeURIComponent(region)}&interval=${encodeURIComponent(intervalSec)}&auth_method=access_key`;
            const akid = (localStorage.getItem('ecs-ak-id') || '').trim();
            const secret = (localStorage.getItem('ecs-ak-secret') || '').trim();
            const token = (localStorage.getItem('ecs-ak-token') || '').trim();
            if (akid) wsUrl += `&aws_access_key_id=${encodeURIComponent(akid)}`;
            if (secret) wsUrl += `&aws_secret_access_key=${encodeURIComponent(secret)}`;
            if (token) wsUrl += `&aws_session_token=${encodeURIComponent(token)}`;
            socket = new WebSocket(wsUrl);
            socket.onmessage = (event) => {
              try {
                const data = JSON.parse(event.data);
                if (data.message) {
                  // Format timestamp if available, converted to selected timezone
                  let formattedMessage = data.message;
                  if (data.timestamp) {
                    const timestamp = convertToTimezone(data.timestamp, selectedTimezone);
                    formattedMessage = `[${timestamp}] ${data.message}`;
                  }
                  setLogs(prev => [formattedMessage, ...prev].slice(0, 2000));
                  setLastRefresh(new Date());
                } else if (data.error) {
                  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                  setLogs(prev => [`[${timestamp}] Error: ${data.error}`, ...prev].slice(0, 2000));
                }
              } catch (e) {
                const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
                setLogs(prev => [`[${timestamp}] ${event.data}`, ...prev].slice(0, 2000));
              }
            };
            socket.onerror = console.error;
            socket.onclose = () => {
              wsRef.current = null;
              setWs(null);
            };
            wsRef.current = socket;
            setWs(socket);
          } else {
            setLogs(prev => [...prev, `Error: ${res.data.error || 'Unable to resolve log target'}`]);
          }
        })
        .catch(err => setLogs(prev => [...prev, `Error resolving log target: ${err}`]));

      return () => {
        cancelled = true;
        if (socket) socket.close();
        if (wsRef.current) wsRef.current.close();
        wsRef.current = null;
        setWs(null);
      };
    }
  }, [cluster, service, region, intervalSec, mode]);

  // Handle time range changes for historical mode
  useEffect(() => {
    console.log("TimeRange effect triggered:", { mode, timeRange, cluster, service });
    if (mode === "historical" && timeRange && cluster && service) {
      console.log("Fetching historical logs directly...");
      // Call historical logs API directly with cluster and service
      fetchHistoricalLogs(timeRange.startTime, timeRange.endTime);
    }
  }, [timeRange, mode, cluster, service, region]);

  // Re-convert existing logs when timezone changes
  useEffect(() => {
    if (logs.length > 0) {
      const convertedLogs = logs.map(logLine => {
        // Extract timestamp from log line format: [timestamp] message
        const match = logLine.match(/^\[([^\]]+)\]\s(.+)$/);
        if (match) {
          const [, timestamp, message] = match;
          
          // Check if timestamp is already in "YYYY-MM-DD HH:MM:SS" format
          if (timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
            // Convert existing formatted timestamp to new timezone
            const date = new Date(timestamp + ' UTC'); // Assume UTC
            const convertedTimestamp = convertToTimezone(date.getTime(), selectedTimezone);
            return `[${convertedTimestamp}] ${message}`;
          } else {
            // Try to convert the timestamp as-is
            const convertedTimestamp = convertToTimezone(timestamp, selectedTimezone);
            return `[${convertedTimestamp}] ${message}`;
          }
        }
        return logLine;
      });
      setLogs(convertedLogs);
    }
  }, [selectedTimezone]);

  // Get current timezone information
  const getTimezoneInfo = () => {
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign = offset <= 0 ? '+' : '-';
    
    // Format offset properly (e.g., UTC+05:30 instead of UTC+5:30)
    let offsetString;
    if (offsetMinutes === 0) {
      offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:00`;
    } else {
      offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
    }
    
    return {
      timezone,
      offsetString,
      currentTime: now.toLocaleString('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
    };
  };

  const timezoneInfo = getTimezoneInfo();

  return (
    <div className="card h-[500px] flex flex-col overflow-hidden">
      <div className="mb-6 pb-4 border-b border-secondary-200">
        {/* First Row: Title and Controls */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <h2 className="text-xl font-bold text-secondary-900 flex items-center">
              <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Logs
            </h2>
            {mode === "live" && ws && (
              <div className="flex items-center gap-2 px-2 py-1 bg-accent-50 border border-accent-200 rounded-full">
                <div className="w-2 h-2 bg-accent-500 rounded-full animate-pulse"></div>
                <span className="text-xs font-medium text-accent-700">Live</span>
              </div>
            )}
            {mode === "historical" && loading && (
              <div className="flex items-center gap-2 px-2 py-1 bg-info-50 border border-info-200 rounded-full">
                <svg className="w-3 h-3 text-info-600 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-xs font-medium text-info-700">Loading...</span>
              </div>
            )}
            {lastRefresh && (
              <span className="text-xs text-secondary-500 bg-secondary-50 px-2 py-1 rounded">
                Refreshed: {lastRefresh.toLocaleTimeString()}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-secondary-600 font-medium">Timezone:</span>
              <select
                className="select-field text-sm py-2 px-3 min-w-[180px]"
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
              >
                {availableTimezones.map(tz => (
                  <option key={tz.value} value={tz.value}>{tz.label}</option>
                ))}
              </select>
            </div>
            {mode === "live" && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-secondary-600 font-medium">Refresh:</span>
                <select
                  className="select-field text-sm py-2 px-3 min-w-[60px]"
                  value={intervalSec}
                  onChange={(e) => { const v = Number(e.target.value); setIntervalSec(v); localStorage.setItem('ecs-log-interval', String(v)); }}
                >
                  <option value={1}>1s</option>
                  <option value={2}>2s</option>
                  <option value={3}>3s</option>
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </div>
            )}
          </div>
        </div>
        
        {/* Second Row: Mode Selector and Download Button */}
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <TimeRangeSelector
              onTimeRangeChange={setTimeRange}
              onModeChange={setMode}
              currentMode={mode}
            />
          </div>
          <div className="ml-4">
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
              className="btn-secondary text-xs py-1.5 px-3 flex items-center space-x-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Download</span>
            </button>
          </div>
        </div>
      </div>
      
      <div className="flex-1 bg-secondary-900 text-secondary-100 p-4 text-xs whitespace-pre-wrap leading-relaxed overflow-auto scrollbar-thin rounded-lg border border-secondary-800">
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-secondary-500">
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-sm">No logs available</p>
            <p className="text-xs mt-1">Logs will appear here when available</p>
          </div>
        ) : (
          logs.map((line, idx) => (
            <div key={idx} className="text-secondary-200 hover:text-secondary-50 transition-colors py-0.5">{line}</div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogsPanel;

