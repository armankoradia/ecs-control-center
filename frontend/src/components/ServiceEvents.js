import React, { useEffect, useState, useCallback } from "react";
import apiService from "../services/apiService";

function ServiceEvents({ cluster, service, region }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchEvents = useCallback(async (forceRefresh = false) => {
    if (!cluster || !service) {
      setEvents([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getServiceEvents(cluster, service, region, forceRefresh);
      if (data && !data.error) {
        setEvents(data.events || []);
        setLastRefresh(new Date());
      } else {
        setError(data?.error || "Failed to fetch service events");
        setEvents([]);
      }
    } catch (err) {
      console.error("Failed to fetch service events:", err);
      setError("Failed to fetch service events: " + (err?.response?.data?.detail || err.message));
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [cluster, service, region]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Auto-refresh every 30 seconds if enabled
  useEffect(() => {
    if (!autoRefresh || !cluster || !service) return;

    const interval = setInterval(() => {
      fetchEvents(true);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [autoRefresh, cluster, service, fetchEvents]);

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return "Unknown";
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getEventIcon = (message) => {
    const msg = message.toLowerCase();
    if (msg.includes("failed") || msg.includes("error") || msg.includes("unable")) {
      return (
        <svg className="w-5 h-5 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    } else if (msg.includes("warning") || msg.includes("draining") || msg.includes("placement")) {
      return (
        <svg className="w-5 h-5 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    } else if (msg.includes("steady state") || msg.includes("started") || msg.includes("registered")) {
      return (
        <svg className="w-5 h-5 text-success-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    return (
      <svg className="w-5 h-5 text-info-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    );
  };


  return (
    <div className="card h-[500px] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-secondary-200">
        <div>
          <h2 className="text-xl font-bold text-secondary-900 flex items-center">
            <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Service Events
          </h2>
          {events.length > 0 && (
            <p className="text-sm text-secondary-500 mt-1">
              {events.length} event{events.length !== 1 ? 's' : ''} found
            </p>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`text-sm py-2 px-4 rounded-lg border transition-colors flex items-center space-x-2 ${
              autoRefresh
                ? "bg-primary-50 border-primary-300 text-primary-700 hover:bg-primary-100"
                : "bg-secondary-50 border-secondary-200 text-secondary-700 hover:bg-secondary-100"
            }`}
            title={autoRefresh ? "Auto-refresh enabled (updates every 30 seconds)" : "Click to enable auto-refresh (updates every 30 seconds)"}
          >
            {autoRefresh ? (
              <>
                <svg className="w-4 h-4 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">Auto-refresh: ON</span>
                <span className="text-xs opacity-75">(30s)</span>
              </>
            ) : (
              <>
                <svg className="w-4 h-4 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">Auto-refresh: OFF</span>
              </>
            )}
          </button>
          <button
            onClick={() => fetchEvents(true)}
            disabled={loading}
            className="btn-secondary text-sm py-2 px-4 flex items-center space-x-2"
            title="Manually refresh events now"
          >
            {loading ? (
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            <span>Refresh Now</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto scrollbar-thin pr-2 -mr-2">
        {loading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12">
            <svg className="animate-spin h-10 w-10 text-primary-600 mb-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm font-medium text-secondary-600">Loading events...</span>
          </div>
        )}

        {error && (
          <div className="mb-4 p-4 bg-danger-50 border border-danger-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-danger-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm font-medium text-danger-800">{error}</div>
            </div>
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary-100 flex items-center justify-center">
              <svg className="w-8 h-8 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-base font-medium text-secondary-700">No events found</p>
            <p className="text-sm text-secondary-500 mt-1">Service events will appear here when available</p>
          </div>
        )}

        {events.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-secondary-200">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-secondary-600 uppercase tracking-wider w-40">
                    Date & Time
                  </th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-secondary-600 uppercase tracking-wider">
                    Event Message
                  </th>
                </tr>
              </thead>
              <tbody>
                {events.map((event, index) => (
                  <tr
                    key={event.id || index}
                    className={`border-b border-secondary-100 hover:bg-secondary-50 transition-colors ${
                      index % 2 === 0 ? 'bg-white' : 'bg-secondary-50/30'
                    }`}
                  >
                    <td className="py-2 px-3 text-xs text-secondary-600 whitespace-nowrap">
                      {formatTimestamp(event.created_at)}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex items-start space-x-2">
                        <div className="flex-shrink-0 mt-0.5">
                          {getEventIcon(event.message)}
                        </div>
                        <div className="text-sm text-secondary-900 flex-1">
                          {event.message}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {lastRefresh && (
          <div className="mt-4 pt-4 border-t border-secondary-200 text-xs text-secondary-500 text-center">
            Last refreshed: {formatTimestamp(lastRefresh)}
          </div>
        )}
      </div>
    </div>
  );
}

export default ServiceEvents;