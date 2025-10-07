import React, { useEffect, useState, useCallback, useMemo } from "react";
import apiService from "../services/apiService";

function ClusterOverview({ cluster, profile, region, authMethod, onServiceSelect }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deploying, setDeploying] = useState({});
  const [bulkDeploying, setBulkDeploying] = useState(false);

  const fetchOverview = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getClusterOverview(cluster, profile, region, authMethod, forceRefresh);
      
      if (data && !data.error) {
        setOverview(data);
      } else {
        setError(data?.error || "Failed to fetch cluster overview");
      }
    } catch (err) {
      setError("Failed to fetch cluster overview: " + (err?.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [cluster, profile, region, authMethod]);

  useEffect(() => {
    if (!cluster) {
      setOverview(null);
      return;
    }

    fetchOverview();
  }, [cluster, profile, region, authMethod, fetchOverview]);

  const handleDeploy = useCallback(async (serviceName) => {
    setDeploying(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await apiService.deploy(cluster, serviceName, null, profile, region, authMethod);
      
      if (result && !result.error) {
        // Refresh overview after successful deployment
        setTimeout(() => {
          fetchOverview(true);
        }, 2000);
      } else {
        console.error("Deployment failed:", result?.error);
      }
    } catch (err) {
      console.error("Deployment failed:", err?.response?.data?.detail || err.message);
    } finally {
      setDeploying(prev => ({ ...prev, [serviceName]: false }));
    }
  }, [cluster, profile, region, authMethod, fetchOverview]);

  const handleBulkDeploy = useCallback(async () => {
    if (!overview || !overview.services) return;
    
    const servicesToDeploy = overview.services.filter(s => s.status === "UPDATES_AVAILABLE");
    if (servicesToDeploy.length === 0) return;
    
    setBulkDeploying(true);
    
    // Deploy services sequentially to avoid overwhelming the system
    for (const service of servicesToDeploy) {
      try {
        await handleDeploy(service.service_name);
        // Small delay between deployments
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to deploy ${service.service_name}:`, err);
      }
    }
    
    setBulkDeploying(false);
    // Refresh overview after all deployments
    setTimeout(() => {
      fetchOverview(true);
    }, 3000);
  }, [overview, handleDeploy, fetchOverview]);

  const handleBulkRestart = useCallback(async () => {
    if (!overview || !overview.services) return;
    
    const servicesToRestart = overview.services.filter(s => 
      s.status === "UPDATES_AVAILABLE" && s.uses_latest_tag
    );
    if (servicesToRestart.length === 0) return;
    
    setBulkDeploying(true);
    
    // Restart services sequentially to avoid overwhelming the system
    for (const service of servicesToRestart) {
      try {
        await handleDeploy(service.service_name);
        // Small delay between restarts
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (err) {
        console.error(`Failed to restart ${service.service_name}:`, err);
      }
    }
    
    setBulkDeploying(false);
    // Refresh overview after all restarts
    setTimeout(() => {
      fetchOverview(true);
    }, 3000);
  }, [overview, handleDeploy, fetchOverview]);

  const getStatusColor = (status) => {
    switch (status) {
      case "NO_TASKS":
        return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200";
      case "UPDATES_AVAILABLE":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200";
      case "UP_TO_DATE":
        return "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900/40 dark:text-gray-200";
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case "NO_TASKS":
        return "🔴";
      case "UPDATES_AVAILABLE":
        return "🟡";
      case "UP_TO_DATE":
        return "🟢";
      default:
        return "⚪";
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case "NO_TASKS":
        return "No Tasks Running";
      case "UPDATES_AVAILABLE":
        return "Updates Available";
      case "UP_TO_DATE":
        return "Up to Date";
      default:
        return "Unknown";
    }
  };

  if (!cluster) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Cluster Overview</h2>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">🏗️</div>
          <div>Select a cluster to view overview</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Cluster Overview</h2>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 dark:border-gray-400"></div>
          <span className="ml-2 text-gray-500 dark:text-gray-400">Loading cluster overview...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Cluster Overview</h2>
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!overview || !overview.services) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200 mb-4">Cluster Overview</h2>
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📊</div>
          <div>No services found in cluster</div>
        </div>
      </div>
    );
  }

  const { services, summary } = overview;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200">Cluster Overview</h2>
        <div className="flex items-center space-x-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {summary.total} service{summary.total !== 1 ? 's' : ''}
          </div>
          <button
            onClick={fetchOverview}
            disabled={loading}
            className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs font-medium rounded hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center">
            <div className="text-2xl mr-2">🔴</div>
            <div>
              <div className="text-sm font-medium text-red-800 dark:text-red-200">No Tasks</div>
              <div className="text-lg font-bold text-red-900 dark:text-red-100">{summary.no_tasks}</div>
            </div>
          </div>
        </div>
        
        <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="text-2xl mr-2">🟡</div>
              <div>
                <div className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Updates Available</div>
                <div className="text-lg font-bold text-yellow-900 dark:text-yellow-100">{summary.updates_available}</div>
              </div>
            </div>
            {summary.updates_available > 0 && (
              <div className="flex space-x-2">
                {summary.latest_tag_updates > 0 && (
                  <button
                    onClick={handleBulkRestart}
                    disabled={bulkDeploying}
                    className="px-3 py-1 bg-blue-600 text-white text-xs font-medium rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title={`Restart ${summary.latest_tag_updates} service(s) with latest tags`}
                  >
                    {bulkDeploying ? "Restarting..." : "Restart All"}
                  </button>
                )}
                <button
                  onClick={handleBulkDeploy}
                  disabled={bulkDeploying}
                  className="px-3 py-1 bg-yellow-600 text-white text-xs font-medium rounded hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={`Deploy all ${summary.updates_available} service(s) with updates`}
                >
                  {bulkDeploying ? "Deploying..." : "Deploy All"}
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <div className="flex items-center">
            <div className="text-2xl mr-2">🟢</div>
            <div>
              <div className="text-sm font-medium text-green-800 dark:text-green-200">Up to Date</div>
              <div className="text-lg font-bold text-green-900 dark:text-green-100">{summary.up_to_date}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Services List */}
      <div className="space-y-2">
        {services.map((service) => (
          <div
            key={service.service_name}
            className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors cursor-pointer"
            onClick={() => onServiceSelect(service.service_name)}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="text-lg">{getStatusIcon(service.status)}</div>
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100 flex items-center space-x-2">
                    <span>{service.service_name}</span>
                    {service.uses_latest_tag && (
                      <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 text-xs font-medium rounded">
                        latest
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {service.running_count}/{service.desired_count} tasks running
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(service.status)}`}>
                  {getStatusText(service.status)}
                </span>
                {service.status === "UPDATES_AVAILABLE" && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeploy(service.service_name);
                    }}
                    disabled={deploying[service.service_name]}
                    className={`px-2 py-1 text-white text-xs font-medium rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                      service.uses_latest_tag 
                        ? "bg-blue-600 hover:bg-blue-700" 
                        : "bg-green-600 hover:bg-green-700"
                    }`}
                    title={service.uses_latest_tag ? "Restart to pull latest image" : "Deploy with latest version"}
                  >
                    {deploying[service.service_name] 
                      ? (service.uses_latest_tag ? "Restarting..." : "Deploying...") 
                      : (service.uses_latest_tag ? "Restart" : "Deploy")
                    }
                  </button>
                )}
                <div className="text-gray-400 dark:text-gray-500">▶</div>
              </div>
            </div>
            
            {/* Image URI info for services with updates */}
            {service.status === "UPDATES_AVAILABLE" && service.current_image_uri && service.latest_image_uri && (
              <div className="mt-2 p-2 bg-white dark:bg-gray-800 rounded border">
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Current Image:</div>
                <div className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all mb-1">
                  {service.current_image_uri}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Latest Image:</div>
                <div className="font-mono text-xs text-green-600 dark:text-green-400 break-all">
                  {service.latest_image_uri}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default ClusterOverview;
