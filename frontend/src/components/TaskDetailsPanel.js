import React, { useEffect, useState, useCallback } from "react";
import apiService from "../services/apiService";
import DeploymentStatusCard from "./DeploymentStatusCard";
import TaskDefinitionEditor from "./TaskDefinitionEditor";
import TaskCountEditor from "./TaskCountEditor";

function TaskDetailsPanel({ tasks, loading, cluster, service, region }) {
  const [details, setDetails] = useState([]);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [openRows, setOpenRows] = useState({});
  const [deploying, setDeploying] = useState(false);
  const [deployMsg, setDeployMsg] = useState("");
  const [deploymentData, setDeploymentData] = useState(null);
  const [editingTaskDefinition, setEditingTaskDefinition] = useState(false);
  const [updatingTaskDefinition, setUpdatingTaskDefinition] = useState(false);
  const [editingTaskCount, setEditingTaskCount] = useState(false);
  const [updatingTaskCount, setUpdatingTaskCount] = useState(false);
  const [quickUpdateDropdownOpen, setQuickUpdateDropdownOpen] = useState(false);
  const [forcingDeployment, setForcingDeployment] = useState(false);

  const fetchTaskDetails = useCallback(async (forceRefresh = false) => {
    if (!cluster || !service) { 
      setDetails([]); 
      return; 
    }
    
    setLoadingDetails(true);
    try {
      const data = await apiService.getTaskDetails(cluster, service, region, forceRefresh);
      setDetails(data || []);
    } catch (err) {
      console.error("Failed to fetch task details:", err);
      setDetails([]);
    } finally {
      setLoadingDetails(false);
    }
  }, [cluster, service, region]);

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
      const result = await apiService.deploy(cluster, service, containerName, region);
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
  }, [cluster, service, region]);

  const handleEditTaskDefinition = useCallback(() => {
    setEditingTaskDefinition(true);
  }, []);

  const handleEditTaskCount = useCallback(() => {
    setEditingTaskCount(true);
  }, []);

  const handleTaskCountUpdate = useCallback((result) => {
    setUpdatingTaskCount(false);
    
    // Show success message when task count update is successful
    if (result && result.success) {
      setDeploymentData({
        cluster: result.cluster,
        service: result.service,
        message: result.message,
        deployment_type: "task_count_update",
        service_arn: result.service_arn,
        deployment_id: `${result.cluster}-${result.service}-${Date.now()}`
      });
      setDeployMsg(`Task count updated successfully from ${result.previous_count} to ${result.new_count}`);
    } else {
      setDeployMsg("Task count update failed: " + (result?.error || "Unknown error"));
    }
    
    // Refresh task details after update
    setTimeout(() => {
      fetchTaskDetails(true);
    }, 2000);
  }, [fetchTaskDetails]);

  const handleForceNewDeployment = useCallback(async () => {
    setQuickUpdateDropdownOpen(false);
    setForcingDeployment(true);
    setDeployMsg("");
    setDeploymentData(null);
    
    try {
      const result = await apiService.forceNewDeployment(cluster, service, region);
      if (result && result.success) {
        setDeploymentData(result);
        setDeployMsg("Force new deployment initiated successfully");
      } else {
        setDeployMsg("Force new deployment failed: " + (result?.error || "Unknown error"));
      }
    } catch (err) {
      setDeployMsg("Force new deployment failed: " + (err?.response?.data?.detail || err.message));
    } finally {
      setForcingDeployment(false);
      // Refresh task details after deployment
      setTimeout(() => {
        fetchTaskDetails(true);
      }, 2000);
    }
  }, [cluster, service, region, fetchTaskDetails]);

  const handleTaskDefinitionUpdate = useCallback((result) => {
    setUpdatingTaskDefinition(false);
    
    // Show deployment status when task definition update is successful
    if (result && !result.error) {
      setDeploymentData(result);
      setDeployMsg("Task definition updated and deployment started successfully");
    } else {
      setDeployMsg("Task definition update failed: " + (result?.error || "Unknown error"));
    }
    
    // Refresh task details after deployment
    setTimeout(() => {
      fetchTaskDetails(true);
    }, 2000);
  }, [fetchTaskDetails]);

  return (
    <div className="card h-[500px] flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-secondary-200">
        <div>
          <h2 className="text-xl font-bold text-secondary-900 flex items-center">
            <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Task Details
          </h2>
          {details.length > 0 && (
            <p className="text-sm text-secondary-500 mt-1">
              {details.length} task{details.length !== 1 ? 's' : ''} found
            </p>
          )}
        </div>
        <div className="flex items-center space-x-3">
          {service && (
            <>
              <div className="relative">
                <button
                  onClick={() => setQuickUpdateDropdownOpen(!quickUpdateDropdownOpen)}
                  className="btn-secondary text-sm py-2 px-4 flex items-center space-x-2"
                  title="Quick update options"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span>Quick Update</span>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                
                {quickUpdateDropdownOpen && (
                  <>
                    <div 
                      className="fixed inset-0 z-10" 
                      onClick={() => setQuickUpdateDropdownOpen(false)}
                    ></div>
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-secondary-200 z-20 py-1">
                      <button
                        onClick={() => {
                          setQuickUpdateDropdownOpen(false);
                          handleEditTaskCount();
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50 flex items-center space-x-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                        </svg>
                        <span>Update Count</span>
                      </button>
                      <button
                        onClick={handleForceNewDeployment}
                        disabled={forcingDeployment}
                        className="w-full text-left px-4 py-2 text-sm text-secondary-700 hover:bg-secondary-50 flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>{forcingDeployment ? "Forcing Deployment..." : "Force New Deployment"}</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleEditTaskDefinition}
                className="btn-primary text-sm py-2 px-4 flex items-center space-x-2"
                title="Edit Task Definition (CPU, Memory, Environment Variables, Secrets)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
                <span>Edit Task Definition</span>
              </button>
            </>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-y-auto scrollbar-thin pr-2 -mr-2">
      
      {deploying && (
        <div className="mb-4 p-4 bg-info-50 border border-info-200 rounded-lg">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-info-600 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm font-medium text-info-800">Initiating deployment…</span>
          </div>
        </div>
      )}
      
      {updatingTaskDefinition && (
        <div className="mb-4 p-4 bg-primary-50 border border-primary-200 rounded-lg">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-primary-600 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm font-medium text-primary-800">Updating task definition and deploying…</span>
          </div>
        </div>
      )}

      {updatingTaskCount && (
        <div className="mb-4 p-4 bg-secondary-50 border border-secondary-200 rounded-lg">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-secondary-600 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm font-medium text-secondary-800">Updating task count…</span>
          </div>
        </div>
      )}

      {forcingDeployment && (
        <div className="mb-4 p-4 bg-info-50 border border-info-200 rounded-lg">
          <div className="flex items-center">
            <svg className="animate-spin h-5 w-5 text-info-600 mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-sm font-medium text-info-800">Forcing new deployment…</span>
          </div>
        </div>
      )}
      
      {deploymentData && (
        <DeploymentStatusCard
          deploymentData={deploymentData}
          cluster={cluster}
          service={service}
          region={region}
          onClose={() => {
            setDeploymentData(null);
            setDeployMsg("");
          }}
        />
      )}
      
      {deployMsg && !deploymentData && (
        <div className="mb-4 p-4 bg-danger-50 border border-danger-200 rounded-lg">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-danger-600 mt-0.5 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm font-medium text-danger-800">{deployMsg}</div>
          </div>
        </div>
      )}
      
      {loading && (
        <div className="flex flex-col items-center justify-center py-12">
          <svg className="animate-spin h-10 w-10 text-primary-600 mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm font-medium text-secondary-600">Loading tasks...</span>
        </div>
      )}
      
      {!loading && tasks.length === 0 && details.length === 0 && (
        <div className="text-center py-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-secondary-100 flex items-center justify-center">
            <svg className="w-8 h-8 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-base font-medium text-secondary-700">No tasks found</p>
          <p className="text-sm text-secondary-500 mt-1">Tasks will appear here when available</p>
        </div>
      )}
      
      {!loading && details.length > 0 && details[0]?.status === 'STOPPED' && (
        <div className="mb-4 p-4 bg-warning-50 border border-warning-200 rounded-lg">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-warning-600 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm font-medium text-warning-800">
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
              <div key={d.task_arn} className="bg-white rounded-xl border border-secondary-200 shadow-soft hover:shadow-medium transition-all duration-200 overflow-hidden">
                {/* Task Header */}
                <div className="p-5 border-b border-secondary-200 bg-gradient-to-r from-secondary-50 to-white">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="text-sm font-semibold text-secondary-900">
                        <span className="text-secondary-600 font-normal">Task ID:</span> {d.task_id}
                      </div>
                      <span className={`badge ${
                        d.status === 'RUNNING' 
                          ? 'badge-success' 
                          : 'badge-danger'
                      }`}>
                        {d.status || 'UNKNOWN'}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleRow(d.task_arn)}
                      className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-all duration-200"
                    >
                      {isOpen ? '▼' : '▶'}
                    </button>
                  </div>
                  
                  {/* Quick Info Row */}
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-secondary-600 text-xs">CPU:</span>
                      <span className="ml-2 font-semibold text-secondary-900">{d.cpu || '-'}</span>
                    </div>
                    <div>
                      <span className="text-secondary-600 text-xs">Memory:</span>
                      <span className="ml-2 font-semibold text-secondary-900">{d.memory || '-'}</span>
                    </div>
                    <div className="md:col-span-2">
                      <span className="text-secondary-600 text-xs">Task Def:</span>
                      <span className="ml-2 text-xs font-semibold text-secondary-900">{d.task_definition || '-'}</span>
                    </div>
                  </div>
                  
                  {/* Image Info */}
                  {firstImageUri && (
                    <div className="mt-4">
                      <div className="text-sm font-semibold text-secondary-700 mb-2">Image URI:</div>
                      <div className="text-sm text-secondary-900 break-all bg-secondary-50 p-2 rounded border border-secondary-200">
                        {firstImageUri}
                      </div>
                      {firstImageTag && (
                        <div className="mt-2 flex items-center space-x-2">
                          <span className="badge-info text-xs font-medium">
                            Latest: {firstImageTag}
                          </span>
                          {!firstIsLatest && (
                            <button
                              className={`text-xs font-medium transition-all duration-200 ${
                                d.service_uses_latest_tag 
                                  ? "btn-primary" 
                                  : "btn-success"
                              }`}
                              onClick={() => handleDeploy(firstImageUri, firstImageTag, firstContainerName)}
                            >
                              {d.service_uses_latest_tag ? "Restart" : "Deploy"}
                            </button>
                          )}
                          {firstIsLatest && (
                            <span className="badge-secondary text-xs font-medium">
                              Up to date
                            </span>
                          )}
                          {extraCount > 0 && (
                            <span className="text-xs text-secondary-500">
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
                  <div className="p-5 bg-secondary-50 border-t border-secondary-200">
                    <div className="space-y-4">
                      {/* Task ARN */}
                      <div>
                        <div className="text-sm font-bold text-secondary-700 mb-2">Task ARN</div>
                        <div className="flex items-center gap-2">
                          <div className="text-sm break-all text-secondary-900 flex-1 bg-white p-3 rounded-lg border border-secondary-200">
                            {d.task_arn}
                          </div>
                          <button
                            onClick={() => copy(d.task_arn)}
                            className="btn-secondary text-sm px-4 py-2"
                          >
                            Copy
                          </button>
                        </div>
                      </div>
                      
                      {/* Error Information */}
                      {(d.stopped_reason || d.container_reason || (d.exit_code !== null && d.exit_code !== undefined)) && (
                        <div className="space-y-3">
                          <div className="text-sm font-bold text-gray-700">Error Details</div>
                          {d.stopped_reason && (
                            <div className="p-3 bg-red-50/20 border border-red-200 rounded">
                              <div className="text-sm font-bold text-red-800 mb-1">Stopped Reason:</div>
                              <div className="text-sm text-red-700">{d.stopped_reason}</div>
                            </div>
                          )}
                          {d.container_reason && (
                            <div className="p-3 bg-orange-50/20 border border-orange-200 rounded">
                              <div className="text-sm font-bold text-orange-800 mb-1">Container Error:</div>
                              <div className="text-sm text-orange-700 break-words">{d.container_reason}</div>
                            </div>
                          )}
                          {d.exit_code !== null && d.exit_code !== undefined && (
                            <div className="p-3 bg-secondary-100 border border-secondary-200 rounded-lg">
                              <div className="text-sm font-bold text-secondary-800 mb-1">Exit Code:</div>
                              <div className="text-sm text-secondary-700">{d.exit_code}</div>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {/* Additional Images */}
                      {Array.isArray(d.images) && d.images.length > 1 && (
                        <div>
                          <div className="text-sm font-bold text-secondary-700 mb-3">All Images</div>
                          <div className="space-y-3">
                            {d.images.map((img, i) => {
                              const uri = img && typeof img === 'object' ? img.uri : img;
                              const tag = img && typeof img === 'object' ? img.latest_tag : null;
                              const containerName = img && typeof img === 'object' && img.container_name ? img.container_name : undefined;
                              const isLatest = img && typeof img === 'object' ? img.is_latest : false;
                              return (
                                <div key={uri || i} className="p-4 bg-white rounded-lg border border-secondary-200 shadow-sm hover:shadow-md transition-shadow">
                                  <div className="text-sm break-all text-secondary-900 mb-2 bg-secondary-50 p-2 rounded border border-secondary-200">
                                    {uri}
                                  </div>
                                  {tag && (
                                    <div className="flex items-center space-x-2">
                                      <span className="badge-info text-sm font-medium">
                                        Latest: {tag}
                                      </span>
                                      {!isLatest && (
                                        <button
                                          className={`text-sm font-medium transition-all duration-200 ${
                                            d.service_uses_latest_tag 
                                              ? "btn-primary" 
                                              : "btn-success"
                                          }`}
                                          onClick={() => handleDeploy(uri, tag, containerName)}
                                        >
                                          {d.service_uses_latest_tag ? "Restart" : "Deploy"}
                                        </button>
                                      )}
                                      {isLatest && (
                                        <span className="badge-secondary text-sm font-medium">
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

      {/* Task Definition Editor Modal */}
      {editingTaskDefinition && (
        <TaskDefinitionEditor
          cluster={cluster}
          service={service}
          region={region}
          onClose={() => setEditingTaskDefinition(false)}
          onUpdate={handleTaskDefinitionUpdate}
          onSaving={(isSaving) => setUpdatingTaskDefinition(isSaving)}
        />
      )}

      {/* Task Count Editor Modal */}
      {editingTaskCount && (
        <TaskCountEditor
          cluster={cluster}
          service={service}
          region={region}
          onClose={() => setEditingTaskCount(false)}
          onUpdate={handleTaskCountUpdate}
          onSaving={(isSaving) => setUpdatingTaskCount(isSaving)}
        />
      )}
    </div>
  );
}

export default TaskDetailsPanel;