import React, { useEffect, useState, useCallback } from "react";
import apiService from "../services/apiService";
import DeploymentStatusCard from "./DeploymentStatusCard";

function TaskDetailsPanel({ tasks, loading, cluster, service, profile, region, authMethod }) {
  const [details, setDetails] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [openRows, setOpenRows] = useState({});
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState("");
  const [deploymentData, setDeploymentData] = useState(null);

  const fetchTaskDetails = useCallback(async (forceRefresh = false) => {
    if (!cluster || !service) { 
      setDetails([]); 
      return; 
    }
    
    setLoadingDetails(true);
    try {
      const data = await apiService.getTaskDetails(cluster, service, profile, region, authMethod, forceRefresh);
      setDetails(data || []);
    } catch (err) {
      console.error("Failed to fetch task details:", err);
      setDetails([]);
    } finally {
      setLoadingDetails(false);
    }
  }, [cluster, service, profile, region, authMethod]);

  useEffect(() => {
    fetchTaskDetails();
  }, [fetchTaskDetails, tasks]);

  const toggleRow = (arn) => setOpenRows(prev => ({ ...prev, [arn]: !prev[arn] }));
  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch {}
  };

  const handleDeploy = useCallback(async (repoUri, tag, containerName) => {
    setDeploying(true);
    setDeployMsg("");
    setDeploymentData(null);
    try {
      const result = await apiService.deploy(cluster, service, containerName, profile, region, authMethod);
      if (result && !result.error) {
        setDeploymentData(result);
        setDeployMsg("Deployment started successfully");
      } else {
        setDeployMsg("Deployment failed: " + (result?.error || "Unknown error"));
      }
    } catch (err) {
      setDeployMsg("Deployment failed: " + (err?.response?.data?.detail || err.message));
    }
    setDeploying(false);
  }, [cluster, service, profile, region, authMethod]);

  return (
    <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow p-4 h-[500px] overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bold text-gray-800 dark:text-gray-200">Task Details</h2>
        {details.length > 0 && (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {details.length} task{details.length !== 1 ? 's' : ''}
          </div>
        )}
      </div>
      
      {deploying && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
            <span className="text-sm text-blue-600 dark:text-blue-400">Initiating deployment…</span>
          </div>
        </div>
      )}
      
      {deploymentData && (
        <DeploymentStatusCard
          deploymentData={deploymentData}
          cluster={cluster}
          service={service}
          profile={profile}
          region={region}
          authMethod={authMethod}
          onClose={() => {
            setDeploymentData(null);
            setDeployMsg("");
          }}
        />
      )}
      
      {deployMsg && !deploymentData && (
        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="text-sm text-red-600 dark:text-red-400">{deployMsg}</div>
        </div>
      )}
      
      {loading && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600 dark:border-gray-400"></div>
          <span className="ml-2 text-gray-500 dark:text-gray-400">Loading tasks...</span>
        </div>
      )}
      
      {!loading && tasks.length === 0 && details.length === 0 && (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <div className="text-4xl mb-2">📋</div>
          <div>No tasks found</div>
        </div>
      )}
      
      {!loading && details.length > 0 && details[0]?.status === 'STOPPED' && (
        <div className="mb-4 p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg">
          <div className="flex items-center">
            <div className="text-orange-600 dark:text-orange-400 mr-2">⚠️</div>
            <span className="text-sm text-orange-600 dark:text-orange-400">
              No running tasks found. Showing last stopped tasks.
            </span>
          </div>
        </div>
      )}
      
      {!loading && details.length > 0 && (
        <div className="space-y-3">
          {details.map((d, idx) => {
            const firstImageObj = Array.isArray(d.images) && d.images.length > 0 ? d.images[0] : null;
            const firstImageUri = firstImageObj && typeof firstImageObj === 'object' ? firstImageObj.uri : firstImageObj;
            const firstImageTag = firstImageObj && typeof firstImageObj === 'object' ? firstImageObj.latest_tag : null;
            const firstContainerName = firstImageObj && typeof firstImageObj === 'object' && firstImageObj.container_name ? firstImageObj.container_name : undefined;
            const firstIsLatest = firstImageObj && typeof firstImageObj === 'object' ? firstImageObj.is_latest : false;
            const extraCount = Array.isArray(d.images) && d.images.length > 1 ? d.images.length - 1 : 0;
            const isOpen = !!openRows[d.task_arn];
            

            return (
              <div key={d.task_arn} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
                {/* Task Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-600">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        <span className="text-gray-500 dark:text-gray-400">Task ID:</span> {d.task_id}
                      </div>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        d.status === 'RUNNING' 
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' 
                          : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
                      }`}>
                        {d.status || 'UNKNOWN'}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleRow(d.task_arn)}
                      className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                    >
                      {isOpen ? '▼' : '▶'}
                    </button>
                  </div>
                  
                  {/* Quick Info Row */}
                  <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">CPU:</span>
                      <span className="ml-1 font-medium">{d.cpu || '-'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500 dark:text-gray-400">Memory:</span>
                      <span className="ml-1 font-medium">{d.memory || '-'}</span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-gray-500 dark:text-gray-400">Task Def:</span>
                      <span className="ml-1 font-mono text-xs">{d.task_definition || '-'}</span>
                    </div>
                  </div>
                  
                  {/* Image Info */}
                  {firstImageUri && (
                    <div className="mt-3">
                      <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Image URI:</div>
                      <div className="text-sm text-gray-900 dark:text-gray-100 break-all font-mono">
                        {firstImageUri}
                      </div>
                      {firstImageTag && (
                        <div className="mt-2 flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 text-xs font-medium">
                            Latest: {firstImageTag}
                          </span>
                          {!firstIsLatest && (
                            <button
                              className="px-3 py-1 rounded bg-green-600 text-white text-xs font-medium hover:bg-green-700 transition-colors"
                              onClick={() => handleDeploy(firstImageUri, firstImageTag, firstContainerName)}
                            >
                              Deploy
                            </button>
                          )}
                          {firstIsLatest && (
                            <span className="px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-300 text-xs font-medium">
                              Up to date
                            </span>
                          )}
                          {extraCount > 0 && (
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              +{extraCount} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                
                {/* Expanded Details */}
                {isOpen && (
                  <div className="p-4 bg-white dark:bg-gray-800">
                    <div className="space-y-4">
                      {/* Task ARN */}
                      <div>
                        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Task ARN</div>
                        <div className="flex items-center gap-2">
                          <div className="font-mono text-sm break-all text-gray-900 dark:text-gray-100 flex-1">
                            {d.task_arn}
                          </div>
                          <button
                            onClick={() => copy(d.task_arn)}
                            className="px-3 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-600 dark:hover:bg-gray-600 text-sm transition-colors"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      
                      {/* Error Information */}
                      {(d.stopped_reason || d.container_reason || (d.exit_code !== null && d.exit_code !== undefined)) && (
                        <div className="space-y-3">
                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300">Error Details</div>
                          {d.stopped_reason && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
                              <div className="text-sm font-bold text-red-800 dark:text-red-200 mb-1">Stopped Reason:</div>
                              <div className="text-sm text-red-700 dark:text-red-300">{d.stopped_reason}</div>
                            </div>
                          )}
                          {d.container_reason && (
                            <div className="p-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded">
                              <div className="text-sm font-bold text-orange-800 dark:text-orange-200 mb-1">Container Error:</div>
                              <div className="text-sm text-orange-700 dark:text-orange-300 break-words">{d.container_reason}</div>
                            </div>
                          )}
                          {d.exit_code !== null && d.exit_code !== undefined && (
                            <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded">
                              <div className="text-sm font-bold text-gray-800 dark:text-gray-200 mb-1">Exit Code:</div>
                              <div className="text-sm text-gray-700 dark:text-gray-300">{d.exit_code}</div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Additional Images */}
                      {Array.isArray(d.images) && d.images.length > 1 && (
                        <div>
                          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">All Images</div>
                          <div className="space-y-3">
                            {d.images.map((img, i) => {
                              const uri = img && typeof img === 'object' ? img.uri : img;
                              const tag = img && typeof img === 'object' ? img.latest_tag : null;
                              const containerName = img && typeof img === 'object' && img.container_name ? img.container_name : undefined;
                              const isLatest = img && typeof img === 'object' ? img.is_latest : false;
                              return (
                                <div key={uri || i} className="p-3 bg-gray-50 dark:bg-gray-700 rounded border">
                                  <div className="font-mono text-sm break-all text-gray-900 dark:text-gray-100 mb-2">
                                    {uri}
                                  </div>
                                  {tag && (
                                    <div className="flex items-center space-x-2">
                                      <span className="px-2 py-1 rounded bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 text-sm font-medium">
                                        Latest: {tag}
                                      </span>
                                      {!isLatest && (
                                        <button
                                          className="px-3 py-1 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                                          onClick={() => handleDeploy(uri, tag, containerName)}
                                        >
                                          Deploy
                                        </button>
                                      )}
                                      {isLatest && (
                                        <span className="px-2 py-1 rounded bg-gray-100 text-gray-600 dark:bg-gray-600 dark:text-gray-300 text-sm font-medium">
                                          Up to date
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default TaskDetailsPanel;