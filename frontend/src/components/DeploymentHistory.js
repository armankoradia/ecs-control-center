import React, { useState, useEffect, useCallback } from "react";
import apiService from "../services/apiService";

function DeploymentHistory({ cluster, service, region }) {
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rollbacking, setRollbacking] = useState({});
  const [selectedDeployment, setSelectedDeployment] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const fetchDeploymentHistory = useCallback(async () => {
    if (!cluster) {
      setDeployments([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getDeploymentHistory(cluster, service, 50, region);
      
      if (data && !data.error) {
        setDeployments(data.deployments || []);
      } else {
        setError(data?.error || "Failed to fetch deployment history");
      }
    } catch (err) {
      setError("Failed to fetch deployment history: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [cluster, service, region]);

  useEffect(() => {
    fetchDeploymentHistory();
  }, [fetchDeploymentHistory]);

  // Auto-refresh for in-progress deployments
  useEffect(() => {
    const inProgressDeployments = deployments.filter(d => d.status === "IN_PROGRESS");
    
    if (inProgressDeployments.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      fetchDeploymentHistory();
    }, 10000); // Refresh every 10 seconds

    return () => clearInterval(interval);
  }, [deployments, fetchDeploymentHistory]);

  const handleRollback = useCallback(async (deploymentId) => {
    setRollbacking(prev => ({ ...prev, [deploymentId]: true }));
    try {
      const result = await apiService.rollbackDeployment(deploymentId, region);
      
      if (result && !result.error) {
        // Refresh deployment history after successful rollback
        setTimeout(() => {
          fetchDeploymentHistory();
        }, 1000);
      } else {
        console.error("Rollback failed:", result?.error);
      }
    } catch (err) {
      console.error("Rollback failed:", err?.response?.data?.detail || err.message);
    } finally {
      setRollbacking(prev => ({ ...prev, [deploymentId]: false }));
    }
  }, [region, fetchDeploymentHistory]);

  const handleViewDetails = useCallback(async (deploymentId) => {
    try {
      const details = await apiService.getDeploymentDetails(deploymentId);
      if (details && !details.error) {
        setSelectedDeployment(details);
        setShowDetails(true);
      }
    } catch (err) {
      console.error("Failed to get deployment details:", err?.response?.data?.detail || err.message);
    }
  }, []);

  const formatTimestamp = (timestamp) => {
    try {
      if (!timestamp) return timestamp;
      
      // If timestamp is an ISO string without timezone indicator, treat it as UTC
      let date;
      if (typeof timestamp === 'string') {
        // Check if it's an ISO string without timezone (e.g., "2025-01-09T10:00:00")
        if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/)) {
          // Append 'Z' to indicate UTC
          date = new Date(timestamp + 'Z');
        } else {
          // Already has timezone info or is in another format
          date = new Date(timestamp);
        }
      } else {
        date = new Date(timestamp);
      }
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return timestamp;
      }
      
      // Convert to local timezone and format
      return date.toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const getDeploymentTypeIcon = (type) => {
    switch (type) {
      case "latest_tag_restart":
        return "🔄";
      case "versioned_tag_update":
        return "🚀";
      case "rollback":
        return "↩️";
      default:
        return "📦";
    }
  };

  const getDeploymentTypeText = (type) => {
    switch (type) {
      case "latest_tag_restart":
        return "Latest Tag Restart";
      case "versioned_tag_update":
        return "Versioned Update";
      case "rollback":
        return "Rollback";
      default:
        return "Deployment";
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case "COMPLETED":
        return "badge-success";
      case "IN_PROGRESS":
        return "badge-info";
      case "FAILED":
        return "badge-danger";
      case "UNKNOWN":
        return "badge-warning";
      default:
        return "badge-secondary";
    }
  };

  if (!cluster) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Deployment History
        </h2>
        <div className="text-center py-12 text-secondary-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm font-medium">Select a cluster to view deployment history</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Deployment History
        </h2>
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-3 text-secondary-600">Loading deployment history...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Deployment History
        </h2>
        <div className="p-4 bg-danger-50 border border-danger-200 rounded-lg">
          <div className="text-sm text-danger-800 flex items-center">
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            {error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-secondary-200">
        <h2 className="text-xl font-bold text-secondary-900 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Deployment History
        </h2>
        <div className="flex items-center space-x-3">
          <div className="text-sm text-secondary-600 font-medium">
            {deployments.length} deployment{deployments.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={fetchDeploymentHistory}
            disabled={loading}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center space-x-1"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Refreshing...</span>
              </>
            ) : (
              <>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Refresh</span>
              </>
            )}
          </button>
        </div>
      </div>

      {deployments.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <div className="text-sm font-medium">No deployments found</div>
        </div>
      ) : (
        <div className="space-y-3 max-h-96 overflow-y-auto scrollbar-thin">
          {deployments.map((deployment) => (
            <div
              key={deployment.deployment_id}
              className="card-hover"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1 min-w-0">
                  <div className="text-xl flex-shrink-0">{getDeploymentTypeIcon(deployment.deployment_type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-secondary-900 flex items-center space-x-2">
                      <span className="truncate">{deployment.service || 'Unknown Service'}</span>
                      {deployment.deployment_type === 'rollback' && (
                        <span className="badge-warning text-xs flex-shrink-0">rollback</span>
                      )}
                    </div>
                    <div className="text-sm text-secondary-600 mt-0.5">
                      {getDeploymentTypeText(deployment.deployment_type)} • {formatTimestamp(deployment.timestamp)}
                    </div>
                    <div className="text-xs text-secondary-500 mt-1">
                      {deployment.message}
                      {deployment.running_count !== undefined && deployment.desired_count !== undefined && (
                        <span className="ml-2">
                          • Tasks: {deployment.running_count}/{deployment.desired_count}
                          {deployment.pending_count > 0 && ` (${deployment.pending_count} pending)`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2 flex-shrink-0">
                  <span className={`badge ${getStatusColor(deployment.status)}`}>
                    {deployment.status}
                  </span>
                  <button
                    onClick={() => handleViewDetails(deployment.deployment_id)}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center space-x-1"
                    title="View Details"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Details</span>
                  </button>
                  {deployment.deployment_type !== 'rollback' && (
                    <button
                      onClick={() => handleRollback(deployment.deployment_id)}
                      disabled={rollbacking[deployment.deployment_id]}
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center space-x-1 bg-warning-50 border-warning-200 text-warning-700 hover:bg-warning-100"
                      title="Rollback to this deployment"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                      </svg>
                      <span>{rollbacking[deployment.deployment_id] ? "Rolling back..." : "Rollback"}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deployment Details Modal */}
      {showDetails && selectedDeployment && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="card max-w-2xl w-full max-h-96 overflow-y-auto scrollbar-thin">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-secondary-200">
              <h3 className="text-lg font-bold text-secondary-900 flex items-center">
                <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Deployment Details
              </h3>
              <button
                onClick={() => setShowDetails(false)}
                className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-all duration-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Deployment ID</label>
                <div className="text-sm text-secondary-900 bg-secondary-50 p-2 rounded border border-secondary-200">{selectedDeployment.deployment_id}</div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Timestamp</label>
                <div className="text-sm text-secondary-900">{formatTimestamp(selectedDeployment.timestamp)}</div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Type</label>
                <div className="text-sm text-secondary-900">{getDeploymentTypeText(selectedDeployment.deployment_type)}</div>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Status</label>
                <span className={`badge ${getStatusColor(selectedDeployment.status)}`}>
                  {selectedDeployment.status}
                </span>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Message</label>
                <div className="text-sm text-secondary-900">{selectedDeployment.message}</div>
              </div>
              
              {selectedDeployment.new_task_definition && (
                <div>
                  <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Task Definition</label>
                  <div className="text-sm text-secondary-900 break-all bg-secondary-50 p-2 rounded border border-secondary-200">{selectedDeployment.new_task_definition}</div>
                </div>
              )}
              
              {selectedDeployment.service_arn && (
                <div>
                  <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Service ARN</label>
                  <div className="text-sm text-secondary-900 break-all bg-secondary-50 p-2 rounded border border-secondary-200">{selectedDeployment.service_arn}</div>
                </div>
              )}
              
              {selectedDeployment.stopped_tasks !== undefined && (
                <div>
                  <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Stopped Tasks</label>
                  <div className="text-sm text-secondary-900">{selectedDeployment.stopped_tasks}</div>
                </div>
              )}
              
              {selectedDeployment.running_count !== undefined && (
                <div>
                  <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Task Status</label>
                  <div className="text-sm text-secondary-900">
                    Running: {selectedDeployment.running_count} / {selectedDeployment.desired_count || 'N/A'}
                    {selectedDeployment.pending_count > 0 && ` (${selectedDeployment.pending_count} pending)`}
                  </div>
                </div>
              )}
              
              {selectedDeployment.original_deployment_id && (
                <div>
                  <label className="text-xs font-semibold text-secondary-600 uppercase tracking-wide mb-1 block">Original Deployment ID</label>
                  <div className="text-sm text-secondary-900 bg-secondary-50 p-2 rounded border border-secondary-200">{selectedDeployment.original_deployment_id}</div>
                </div>
              )}
            </div>
            
            <div className="flex justify-end space-x-3 mt-6 pt-6 border-t border-secondary-200">
              <button
                onClick={() => setShowDetails(false)}
                className="btn-secondary"
              >
                Close
              </button>
              {selectedDeployment.deployment_type !== 'rollback' && (
                <button
                  onClick={() => {
                    setShowDetails(false);
                    handleRollback(selectedDeployment.deployment_id);
                  }}
                  disabled={rollbacking[selectedDeployment.deployment_id]}
                  className="btn-secondary bg-warning-50 border-warning-200 text-warning-700 hover:bg-warning-100"
                >
                  {rollbacking[selectedDeployment.deployment_id] ? "Rolling back..." : "Rollback"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DeploymentHistory;
