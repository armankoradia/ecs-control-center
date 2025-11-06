import React, { useState, useEffect } from 'react';

function TimeRangeSelector({ onTimeRangeChange, onModeChange, currentMode = "live" }) {
  const [selectedRange, setSelectedRange] = useState("30m");
  const [customStartTime, setCustomStartTime] = useState("");
  const [customEndTime, setCustomEndTime] = useState("");

  const quickRanges = [
    { value: "30m", label: "Last 30 minutes" },
    { value: "1h", label: "Last 1 hour" },
    { value: "2h", label: "Last 2 hours" },
    { value: "6h", label: "Last 6 hours" },
    { value: "12h", label: "Last 12 hours" },
    { value: "24h", label: "Last 24 hours" }
  ];

  const calculateTimeRange = (range) => {
    const now = new Date();
    const endTime = now.toISOString();
    
    let startTime;
    switch (range) {
      case "30m":
        startTime = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
        break;
      case "1h":
        startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
        break;
      case "2h":
        startTime = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
        break;
      case "6h":
        startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
        break;
      case "12h":
        startTime = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
        break;
      case "24h":
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        break;
      default:
        startTime = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    }
    
    return { startTime, endTime };
  };

  const handleQuickRangeChange = (range) => {
    setSelectedRange(range);
    const { startTime, endTime } = calculateTimeRange(range);
    console.log("Quick range selected:", { range, startTime, endTime });
    onTimeRangeChange({ startTime, endTime, range });
  };

  const handleCustomTimeChange = () => {
    if (customStartTime && customEndTime) {
      // Convert datetime-local format (YYYY-MM-DDTHH:mm) to ISO string
      // datetime-local doesn't include timezone, so we need to add it
      const startISO = new Date(customStartTime).toISOString();
      const endISO = new Date(customEndTime).toISOString();
      
      console.log("Custom time selected:", { 
        customStartTime, 
        customEndTime, 
        startISO, 
        endISO 
      });
      onTimeRangeChange({ 
        startTime: startISO, 
        endTime: endISO, 
        range: "custom" 
      });
    }
  };

  const handleModeChange = (mode) => {
    onModeChange(mode);
    if (mode === "live") {
      // Reset to live mode
      setSelectedRange("30m");
      setCustomStartTime("");
      setCustomEndTime("");
    }
  };

  // Set default values for custom time inputs
  useEffect(() => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    if (!customStartTime) {
      setCustomStartTime(oneHourAgo.toISOString().slice(0, 16)); // Remove seconds and Z
    }
    if (!customEndTime) {
      setCustomEndTime(now.toISOString().slice(0, 16)); // Remove seconds and Z
    }
  }, []);

  return (
    <div className="space-y-2">
      {/* Mode Selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-600">Mode:</span>
        <div className="flex bg-gray-100 rounded">
          <button
            onClick={() => handleModeChange("live")}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              currentMode === "live" 
                ? "bg-blue-500 text-white" 
                : "bg-transparent text-gray-600 hover:bg-gray-200"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => handleModeChange("historical")}
            className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
              currentMode === "historical" 
                ? "bg-blue-500 text-white" 
                : "bg-transparent text-gray-600 hover:bg-gray-200"
            }`}
          >
            Historical
          </button>
        </div>
      </div>

      {currentMode === "historical" && (
        <div className="space-y-2">
          {/* Quick Range Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Quick:</span>
            <select
              value={selectedRange}
              onChange={(e) => handleQuickRangeChange(e.target.value)}
              className="px-2 py-1 rounded border border-gray-300 bg-white text-gray-900 text-xs min-w-0"
            >
              {quickRanges.map((range) => (
                <option key={range.value} value={range.value}>
                  {range.label}
                </option>
              ))}
            </select>
          </div>

          {/* Custom Time Range */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-xs text-gray-600">Custom:</span>
            <div className="flex flex-col sm:flex-row sm:items-center gap-1 min-w-0">
              <input
                type="datetime-local"
                value={customStartTime}
                onChange={(e) => setCustomStartTime(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs min-w-0"
                placeholder="Start time"
              />
              <span className="text-gray-400 text-xs hidden sm:inline">to</span>
              <input
                type="datetime-local"
                value={customEndTime}
                onChange={(e) => setCustomEndTime(e.target.value)}
                className="px-2 py-1 border border-gray-300 rounded text-xs min-w-0"
                placeholder="End time"
              />
              <button
                onClick={handleCustomTimeChange}
                className="px-3 py-1 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 whitespace-nowrap"
              >
                Load
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TimeRangeSelector;
