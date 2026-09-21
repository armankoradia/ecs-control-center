import React, { useEffect, useState, useRef } from "react";
import { API_BASE, WS_BASE } from "../api";
import apiService from "../services/apiService";
import TimeRangeSelector from "./TimeRangeSelector";

function LogsPanel({ cluster, service, region }) {
  const [logs, setLogs] = useState([]);
  const [ws, setWs] = useState(null);
  const [intervalSec, setIntervalSec] = useState(() => Number(localStorage.getItem('ecs-log-interval') || 3));
  const [lastRefresh, setLastRefresh] = useState(null);
  const [mode, setMode] = useState("live"); // "live" | "historical"
  const [timeRange, setTimeRange] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedTimezone, setSelectedTimezone] = useState("IST");

  // Dynatrace / source state
  // Defaults to CloudWatch-only so the app works fully out of the box with
  // no Dynatrace setup — Dynatrace is an opt-in extra (see README).
  const [source, setSource] = useState("cloudwatch"); // "cloudwatch" | "dynatrace" | "both"
  const [useContainerId, setUseContainerId] = useState(true);
  const [useHostgroup, setUseHostgroup] = useState(true);
  const [useImage, setUseImage] = useState(true);
  const [logContext, setLogContext] = useState(null); // {log_group, log_stream, container_id, image_uri, tenant_name}
  const [dtError, setDtError] = useState(null);

  const wsRef = useRef(null);
  const lastDtTimestampRef = useRef(0);

  const availableTimezones = [
    { value: "UTC", label: "UTC (UTC+00:00)", offset: 0 },
    { value: "CET", label: "CET (UTC+01:00)", offset: 1 },
    { value: "CEST", label: "CEST (UTC+02:00)", offset: 2 },
    { value: "EET", label: "EET (UTC+02:00)", offset: 2 },
    { value: "IST", label: "IST (UTC+05:30)", offset: 5.5 }
  ];

  const convertToTimezone = (timestamp, timezoneValue) => {
    if (!timestamp) return "";

    const timezoneMap = {
      "UTC": "UTC",
      "CET": "Europe/Berlin",
      "CEST": "Europe/Berlin",
      "EET": "Europe/Bucharest",
      "IST": "Asia/Kolkata"
    };

    const actualTimezone = timezoneMap[timezoneValue];
    if (!actualTimezone) return timestamp;

    let date;

    if (typeof timestamp === 'string') {
      if (timestamp.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        return timestamp;
      } else if (timestamp.includes('T')) {
        date = new Date(timestamp);
      } else {
        date = new Date(timestamp);
      }
    } else {
      date = new Date(timestamp);
    }

    if (isNaN(date.getTime())) return timestamp;

    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: actualTimezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    });

    const parts = formatter.formatToParts(date);
    const year   = parts.find(p => p.type === 'year').value;
    const month  = parts.find(p => p.type === 'month').value;
    const day    = parts.find(p => p.type === 'day').value;
    const hour   = parts.find(p => p.type === 'hour').value;
    const minute = parts.find(p => p.type === 'minute').value;
    const second = parts.find(p => p.type === 'second').value;

    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  };

  const nowStr = () => new Date().toISOString().replace('T', ' ').substring(0, 19);

  // Format a single raw log entry timestamp for display
  const formatEntryTs = (log) => {
    if (typeof log.timestamp === 'number' && log.timestamp > 0) {
      return convertToTimezone(log.timestamp, selectedTimezone);
    }
    if (log.formatted_time) {
      if (log.formatted_time.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
        return convertToTimezone(new Date(log.formatted_time + ' UTC').getTime(), selectedTimezone);
      }
      return log.formatted_time.split('.')[0].replace('T', ' ');
    }
    return '';
  };

  // ─── fetchHistoricalLogs ────────────────────────────────────────────────────
  const fetchHistoricalLogs = async (startTime, endTime) => {
    setLoading(true);
    setLogs([]);
    setDtError(null);

    const includeCW = source === 'cloudwatch' || source === 'both';
    const includeDT = source === 'dynatrace' || source === 'both';

    let cwRaw = [];
    let dtRaw = [];
    let dtQueryUsed;

    // CloudWatch logs
    if (includeCW) {
      try {
        const payload = { cluster, service, start_time: startTime, end_time: endTime, limit: 1000, region };
        apiService.addCredentials(payload);
        const res = await apiService.get(`${API_BASE}/historical_logs`, { method: 'POST', data: payload });
        cwRaw = res.data.logs || [];
      } catch (error) {
        console.error("CW historical logs error:", error);
        if (source === 'cloudwatch') {
          const msg = error.response?.data?.detail || error.response?.data?.error || error.message;
          setLogs([`[${nowStr()}] Error: ${msg}`]);
          setLoading(false);
          return;
        }
      }
    }

    // Dynatrace logs
    if (includeDT) {
      // Ensure we have log context for DT params; fetch if not yet cached
      let ctx = logContext;
      if (!ctx) {
        try {
          const payload = { cluster, service, region };
          apiService.addCredentials(payload);
          const ctxRes = await apiService.get(`${API_BASE}/log-target`, { method: 'POST', data: payload });
          if (ctxRes.data && (ctxRes.data.container_id || ctxRes.data.tenant_name || ctxRes.data.image_uri)) {
            ctx = ctxRes.data;
            setLogContext(ctx);
          }
        } catch (e) { /* silent */ }
      }

      if (ctx) {
        try {
          const res = await apiService.getDynatraceLogs(
            cluster, service, startTime, endTime,
            {
              useContainerId, useHostgroup, useImage,
              containerId: ctx.container_id,
              tenantName: ctx.tenant_name,
              imageUri: ctx.image_uri,
            },
            region
          );
          dtRaw = res.data.logs || [];
          dtQueryUsed = {
            query: res.data.query,
            from: res.data.from_time,
            to: res.data.to_time,
            rawCount: res.data.raw_count,
          };
        } catch (error) {
          const msg = error.response?.data?.detail || error.response?.data?.error || error.message;
          setDtError(msg);
          if (source === 'dynatrace') {
            setLogs([`[${nowStr()}] Dynatrace error: ${msg}`]);
            setLoading(false);
            return;
          }
        }
      } else if (source === 'dynatrace') {
        setLogs([`[${nowStr()}] Log context unavailable — cannot query Dynatrace.`]);
        setLoading(false);
        return;
      }
    }

    // Format and merge
    let formattedLogs = [];
    if (source === 'cloudwatch') {
      formattedLogs = cwRaw.map(l => `[${formatEntryTs(l)}] ${l.message}`);
    } else if (source === 'dynatrace') {
      formattedLogs = dtRaw.map(l => `[${formatEntryTs(l)}] ${l.message}`);
    } else {
      // Merge CW + DT, sort newest first
      const tagged = [
        ...cwRaw.map(l => ({ ...l, _src: 'CW' })),
        ...dtRaw.map(l => ({ ...l, _src: 'DT' })),
      ].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      formattedLogs = tagged.map(l => `[${l._src}] [${formatEntryTs(l)}] ${l.message}`);
    }

    if (formattedLogs.length === 0) {
      formattedLogs = [`[${nowStr()}] No logs found for the selected time range.`];
      if (dtQueryUsed !== undefined) {
        formattedLogs.push(`[DT] from=${dtQueryUsed?.from}  to=${dtQueryUsed?.to}  raw_records_from_dt=${dtQueryUsed?.rawCount ?? '?'}`);
        formattedLogs.push(`[DT] query=${dtQueryUsed?.query || '(no filter)'}`);
      }
    }

    setLogs(formattedLogs);
    setLastRefresh(new Date());
    setLoading(false);
  };

  // ─── EFFECT: Live mode — CloudWatch WebSocket ───────────────────────────────
  useEffect(() => {
    if (!cluster || !service) return;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
      setWs(null);
    }

    // Clear stale logs and errors on every source / service / mode change
    setLogs([]);
    setDtError(null);

    if (mode !== "live") return;

    let socket;
    let cancelled = false;

    (() => {
      const payload = { cluster, service, region };
      apiService.addCredentials(payload);
      return apiService.get(`${API_BASE}/log-target`, { method: 'POST', data: payload });
    })()
      .then(res => {
        if (cancelled) return;

        // Cache DT context (container_id, tenant_name, image_uri).
        // Set even when CW is unavailable so Dynatrace-only mode works.
        if (res.data && (res.data.container_id || res.data.tenant_name || res.data.image_uri)) {
          setLogContext(res.data);
        }

        // Only create WebSocket when source includes CloudWatch
        if ((source === 'cloudwatch' || source === 'both') && res.data?.log_group && res.data?.log_stream) {
          let wsUrl = `${WS_BASE}/ws/logs?log_group=${encodeURIComponent(res.data.log_group)}&log_stream=${encodeURIComponent(res.data.log_stream)}&region=${encodeURIComponent(region)}&interval=${encodeURIComponent(intervalSec)}&auth_method=access_key`;
          const akid   = (localStorage.getItem('ecs-ak-id') || '').trim();
          const secret = (localStorage.getItem('ecs-ak-secret') || '').trim();
          const token  = (localStorage.getItem('ecs-ak-token') || '').trim();
          if (akid)   wsUrl += `&aws_access_key_id=${encodeURIComponent(akid)}`;
          if (secret) wsUrl += `&aws_secret_access_key=${encodeURIComponent(secret)}`;
          if (token)  wsUrl += `&aws_session_token=${encodeURIComponent(token)}`;

          socket = new WebSocket(wsUrl);
          socket.onmessage = (event) => {
            if (cancelled) return;
            try {
              const data = JSON.parse(event.data);
              if (data.message) {
                let msg = data.message;
                if (data.timestamp) {
                  const ts = convertToTimezone(data.timestamp, selectedTimezone);
                  const prefix = source === 'both' ? '[CW] ' : '';
                  msg = `${prefix}[${ts}] ${data.message}`;
                }
                setLogs(prev => [msg, ...prev].slice(0, 2000));
                setLastRefresh(new Date());
              } else if (data.error) {
                setLogs(prev => [`[${nowStr()}] Error: ${data.error}`, ...prev].slice(0, 2000));
              }
            } catch (e) {
              setLogs(prev => [`[${nowStr()}] ${event.data}`, ...prev].slice(0, 2000));
            }
          };
          socket.onerror = console.error;
          socket.onclose = () => { wsRef.current = null; setWs(null); };
          wsRef.current = socket;
          setWs(socket);
        } else if (source !== 'dynatrace' && !res.data?.log_group) {
          // Only show CW error when the user actually wants CloudWatch logs
          setLogs(prev => [...prev, `[CW] Error: ${res.data?.error || 'Unable to resolve log target'}`]);
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
  }, [cluster, service, region, intervalSec, mode, source]); // eslint-disable-line

  // ─── EFFECT: Live mode — Dynatrace polling (every 30 s) ────────────────────
  useEffect(() => {
    if (mode !== 'live') return;
    if (source === 'cloudwatch') return;
    if (!logContext) return;

    let cancelled = false;
    // Start just before "now" so we don't miss recent entries
    lastDtTimestampRef.current = Date.now() - 2 * 60 * 1000;

    const fetchDTRecent = async () => {
      if (cancelled) return;
      const fromTime = new Date(lastDtTimestampRef.current).toISOString();
      const toTime   = new Date().toISOString();

      try {
        const resp = await apiService.getDynatraceLogs(
          cluster, service, fromTime, toTime,
          {
            useContainerId, useHostgroup, useImage,
            containerId: logContext.container_id,
            tenantName:  logContext.tenant_name,
            imageUri:    logContext.image_uri,
          },
          region
        );
        if (cancelled) return;
        const dtLogs = resp.data?.logs || [];
        if (dtLogs.length > 0) {
          const maxTs = Math.max(...dtLogs.map(l => l.timestamp || 0));
          if (maxTs > 0) lastDtTimestampRef.current = maxTs + 1;

          dtLogs.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
          dtLogs.forEach(log => {
            const ts     = convertToTimezone(log.timestamp, selectedTimezone);
            const prefix = source === 'both' ? '[DT] ' : '';
            setLogs(prev => [`${prefix}[${ts}] ${log.message}`, ...prev].slice(0, 2000));
          });
          setLastRefresh(new Date());
        }
      } catch (e) { /* silent — DT may not be configured */ }
    };

    fetchDTRecent();
    const timer = setInterval(fetchDTRecent, 30000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [mode, source, logContext, useContainerId, useHostgroup, useImage]); // eslint-disable-line

  // ─── EFFECT: Historical mode — re-fetch when source / filters change ────────
  useEffect(() => {
    if (mode === "historical" && timeRange && cluster && service) {
      fetchHistoricalLogs(timeRange.startTime, timeRange.endTime);
    }
  }, [timeRange, mode, cluster, service, region, source, useContainerId, useHostgroup, useImage]); // eslint-disable-line

  // ─── EFFECT: Re-convert displayed timestamps when timezone changes ──────────
  useEffect(() => {
    if (logs.length === 0) return;
    const converted = logs.map(line => {
      // Handle source-prefixed lines: [CW] [timestamp] message
      const srcMatch = line.match(/^(\[(?:CW|DT)\])\s\[([^\]]+)\]\s(.+)$/);
      if (srcMatch) {
        const [, srcTag, ts, msg] = srcMatch;
        if (ts.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
          const newTs = convertToTimezone(new Date(ts + ' UTC').getTime(), selectedTimezone);
          return `${srcTag} [${newTs}] ${msg}`;
        }
        return `${srcTag} [${convertToTimezone(ts, selectedTimezone)}] ${msg}`;
      }
      // Standard: [timestamp] message
      const match = line.match(/^\[([^\]]+)\]\s(.+)$/);
      if (match) {
        const [, ts, msg] = match;
        if (ts.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)) {
          const newTs = convertToTimezone(new Date(ts + ' UTC').getTime(), selectedTimezone);
          return `[${newTs}] ${msg}`;
        }
        return `[${convertToTimezone(ts, selectedTimezone)}] ${msg}`;
      }
      return line;
    });
    setLogs(converted);
  }, [selectedTimezone]); // eslint-disable-line

  const getTimezoneInfo = () => {
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const offset = now.getTimezoneOffset();
    const offsetHours   = Math.floor(Math.abs(offset) / 60);
    const offsetMinutes = Math.abs(offset) % 60;
    const offsetSign    = offset <= 0 ? '+' : '-';
    let offsetString;
    if (offsetMinutes === 0) {
      offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:00`;
    } else {
      offsetString = `UTC${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
    }
    return { timezone, offsetString, currentTime: now.toLocaleString('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) };
  };

  const timezoneInfo = getTimezoneInfo(); // eslint-disable-line no-unused-vars

  const showDTControls = source === 'dynatrace' || source === 'both';

  return (
    <div className="card h-[500px] flex flex-col overflow-hidden">
      <div className="mb-4 pb-4 border-b border-secondary-200">

        {/* Row 1: Title + status indicators + Timezone + Refresh */}
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

        {/* Row 2: Source selector + TimeRangeSelector + Download */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {/* Source segmented control */}
            <div className="flex items-center bg-secondary-100 rounded-lg p-0.5 shrink-0">
              {[
                { id: 'cloudwatch', label: 'CloudWatch' },
                { id: 'both',       label: 'Both', title: 'Requires Dynatrace to be configured (optional) — see README' },
                { id: 'dynatrace',  label: 'Dynatrace', title: 'Optional — requires DYNATRACE_ENV_URL/DYNATRACE_API_TOKEN and a compatible Dynatrace setup, see README' },
              ].map(({ id, label, title }) => (
                <button
                  key={id}
                  onClick={() => setSource(id)}
                  title={title}
                  className={`px-3 py-1 text-xs rounded-md font-medium transition-colors whitespace-nowrap ${
                    source === id
                      ? 'bg-white text-secondary-900 shadow-sm'
                      : 'text-secondary-500 hover:text-secondary-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <TimeRangeSelector
                onTimeRangeChange={setTimeRange}
                onModeChange={setMode}
                currentMode={mode}
              />
            </div>
          </div>
          <div className="ml-4 shrink-0">
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

        {/* Row 3: Dynatrace filter chips (shown when source includes Dynatrace) */}
        {showDTControls && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-secondary-500 font-medium">DT filters:</span>
            {[
              { label: 'container.id', title: 'Current running container only — disable for historical queries spanning multiple deployments', active: useContainerId, toggle: () => setUseContainerId(v => !v) },
              { label: 'dt.hostgroup.id',      title: 'Filter by ECS cluster tenant (dt.host_group.id)', active: useHostgroup,   toggle: () => setUseHostgroup(v => !v)   },
              { label: 'container.image.name', title: 'Filter by the exact image URI from the task definition', active: useImage,       toggle: () => setUseImage(v => !v)       },
            ].map(({ label, title, active, toggle }) => (
              <button
                key={label}
                title={title}
                onClick={toggle}
                className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono border transition-colors ${
                  active
                    ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100'
                    : 'bg-secondary-50 border-secondary-200 text-secondary-400 hover:bg-secondary-100'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-purple-500' : 'bg-secondary-300'}`}></span>
                <span className={active ? '' : 'line-through'}>{label}</span>
              </button>
            ))}
            {logContext?.tenant_name && (
              <span className="text-xs text-secondary-400 ml-1">
                tenant: <span className="font-mono text-purple-600">{logContext.tenant_name.toUpperCase()}</span>
              </span>
            )}
            {logContext?.container_id && (
              <span
                className="text-xs text-secondary-400 ml-1 cursor-help"
                title={`ECS Container Runtime ID (runtimeId from DescribeTasks): ${logContext.container_id}`}
              >
                container.id: <span className="font-mono text-purple-600">{logContext.container_id.slice(0, 12)}…</span>
              </span>
            )}
          </div>
        )}

        {/* DT error banner */}
        {dtError && showDTControls && (
          <div className="mt-2 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800 flex items-start gap-2">
            <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <span><span className="font-semibold">Dynatrace:</span> {dtError}</span>
          </div>
        )}
      </div>

      {/* Log output */}
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
          logs.map((line, idx) => {
            // Colour [CW] and [DT] source tags
            const cwMatch = line.match(/^(\[CW\])(\s.+)$/);
            const dtMatch = line.match(/^(\[DT\])(\s.+)$/);
            if (cwMatch) return (
              <div key={idx} className="text-secondary-200 hover:text-secondary-50 transition-colors py-0.5">
                <span className="text-blue-400 font-semibold">{cwMatch[1]}</span>
                <span>{cwMatch[2]}</span>
              </div>
            );
            if (dtMatch) return (
              <div key={idx} className="text-secondary-200 hover:text-secondary-50 transition-colors py-0.5">
                <span className="text-purple-400 font-semibold">{dtMatch[1]}</span>
                <span>{dtMatch[2]}</span>
              </div>
            );
            return (
              <div key={idx} className="text-secondary-200 hover:text-secondary-50 transition-colors py-0.5">{line}</div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default LogsPanel;
