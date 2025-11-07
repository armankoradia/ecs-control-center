import React, { useState, useEffect, useCallback } from "react";
import apiService from "../services/apiService";

function TaskCountEditor({ cluster, service, region, onClose, onUpdate, onSaving }) {
  const [currentCount, setCurrentCount] = useState(null);
  const [newCount, setNewCount] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fetchCurrentCount = useCallback(async () => {
    if (!cluster || !service) return;

    setLoading(true);
    setError(null);
    try {
      const status = await apiService.getDeploymentStatus(cluster, service, region);
      if (status && !status.error) {
        setCurrentCount(status.desired_count);
        setNewCount(status.desired_count.toString());
      } else {
        setError(status?.error || "Failed to fetch current count");
      }
    } catch (err) {
      setError("Failed to fetch current count: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [cluster, service, region]);

  useEffect(() => {
    fetchCurrentCount();
  }, [fetchCurrentCount]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    const count = parseInt(newCount, 10);
    if (isNaN(count) || count < 0) {
      setError("Please enter a valid number (0 or greater)");
      return;
    }

    if (count === currentCount) {
      setError("New count must be different from current count");
      return;
    }

    setSaving(true);
    setError(null);
    if (onSaving) onSaving(true);
    try {
      const result = await apiService.updateTaskCount(cluster, service, count, region);
      if (result && result.success) {
        if (onUpdate) {
          onUpdate(result);
        }
        if (onSaving) onSaving(false);
        onClose();
      } else {
        setError(result?.error || "Failed to update task count");
        if (onSaving) onSaving(false);
      }
    } catch (err) {
      setError("Failed to update task count: " + (err?.response?.data?.detail || err.message));
      if (onSaving) onSaving(false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
          <div className="flex items-center justify-center py-8">
            <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="ml-3 text-secondary-700">Loading current count...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full mx-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-secondary-900">
            Update Task Count - {service}
          </h3>
          <button
            onClick={onClose}
            className="text-secondary-500 hover:text-secondary-700 text-xl"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger-50 border border-danger-200 rounded-lg">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-danger-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-sm font-medium text-danger-800">{error}</div>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-4 bg-secondary-50 rounded-lg border border-secondary-200">
            <div className="text-sm font-medium text-secondary-700 mb-2">Current Desired Count</div>
            <div className="text-2xl font-bold text-secondary-900">
              {currentCount !== null ? currentCount : "Loading..."}
            </div>
          </div>

          <div>
            <label htmlFor="newCount" className="block text-sm font-medium text-secondary-700 mb-2">
              New Desired Count
            </label>
            <input
              type="number"
              id="newCount"
              min="0"
              value={newCount}
              onChange={(e) => setNewCount(e.target.value)}
              onWheel={(e) => { e.currentTarget.blur(); }}
              onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); } }}
              className="w-full px-4 py-2 border border-secondary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-secondary-900 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              placeholder="Enter new count"
              required
              disabled={saving}
            />
            <p className="mt-1 text-xs text-secondary-500">
              Enter the number of tasks you want running for this service
            </p>
          </div>

          <div className="flex items-center justify-end space-x-3 pt-4 border-t border-secondary-200">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary px-4 py-2"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary px-4 py-2 flex items-center space-x-2"
              disabled={saving || newCount === "" || parseInt(newCount, 10) === currentCount}
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Updating...</span>
                </>
              ) : (
                <span>Update Count</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default TaskCountEditor;