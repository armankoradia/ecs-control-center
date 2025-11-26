import React, { useEffect, useState, useCallback, useMemo } from "react";
import apiService from "../services/apiService";
import { groupByEnvironment, getEnvironmentDisplayName, getEnvironmentOrder, getEnvironmentColorClasses } from "../utils/sortingUtils";

function ClusterOverview({ cluster, region, onServiceSelect }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [deploying, setDeploying] = useState({});
  const [bulkDeploying, setBulkDeploying] = useState(false);
  const [bulkDeployStatus, setBulkDeployStatus] = useState({
    isActive: false,
    total: 0,
    completed: 0,
    failed: 0,
    current: '',
    results: [],
    operationType: ''
  });
  const [showForceRestartModal, setShowForceRestartModal] = useState(false);
  const [forceRestartInput, setForceRestartInput] = useState("");
  const [forceRestarting, setForceRestarting] = useState(false);
  const [collapsedEnvs, setCollapsedEnvs] = useState({});

  // Helper function to extract meaningful error messages
  const getErrorMessage = (error) => {
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null) {
      // Handle Pydantic validation errors
      if (Array.isArray(error) && error.length > 0) {
        return error.map(e => e.msg || e.message || 'Validation error').join(', ');
      }
      // Handle other object errors
      if (error.message) return error.message;
      if (error.detail) return error.detail;
      if (error.error) return error.error;
      return JSON.stringify(error);
    }
    return 'Unknown error occurred';
  };

  const fetchOverview = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiService.getClusterOverview(cluster, region, forceRefresh);
      
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
  }, [cluster, region]);

  useEffect(() => {
    if (!cluster) {
      setOverview(null);
      return;
    }

    fetchOverview();
  }, [cluster, region, fetchOverview]);

  const handleDeploy = useCallback(async (serviceName) => {
    setDeploying(prev => ({ ...prev, [serviceName]: true }));
    try {
      const result = await apiService.deploy(cluster, serviceName, null, region);
      
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
  }, [cluster, region, fetchOverview]);

  const handleBulkDeploy = useCallback(async () => {
    if (!overview || !overview.services) return;
    
    const servicesToDeploy = overview.services.filter(s => s.status === "UPDATES_AVAILABLE");
    if (servicesToDeploy.length === 0) return;
    
    // Initialize bulk deploy status
    setBulkDeployStatus({
      isActive: true,
      total: servicesToDeploy.length,
      completed: 0,
      failed: 0,
      current: '',
      results: [],
      operationType: 'deploy'
    });
    setBulkDeploying(true);
    
    const results = [];
    
    // Deploy services sequentially to avoid overwhelming the system
    for (let i = 0; i < servicesToDeploy.length; i++) {
      const service = servicesToDeploy[i];
      
      // Update current service being deployed
      setBulkDeployStatus(prev => ({
        ...prev,
        current: service.service_name
      }));
      
      try {
        const result = await apiService.deploy(cluster, service.service_name, null, region);
        
        if (result && !result.error) {
          results.push({
            service: service.service_name,
            status: 'success',
            message: result.message || 'Deployment started successfully'
          });
          
          setBulkDeployStatus(prev => ({
            ...prev,
            completed: prev.completed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'success',
              message: result.message || 'Deployment started successfully'
            }]
          }));
        } else {
          const errorMessage = getErrorMessage(result?.error) || 'Deployment failed';
          
          results.push({
            service: service.service_name,
            status: 'error',
            message: errorMessage
          });
          
          setBulkDeployStatus(prev => ({
            ...prev,
            failed: prev.failed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'error',
              message: errorMessage
            }]
          }));
        }
      } catch (err) {
        const errorMessage = getErrorMessage(err?.response?.data?.detail || err?.response?.data?.error || err.message) || 'Deployment failed';
        results.push({
          service: service.service_name,
          status: 'error',
          message: errorMessage
        });
        
        setBulkDeployStatus(prev => ({
          ...prev,
          failed: prev.failed + 1,
          results: [...prev.results, {
            service: service.service_name,
            status: 'error',
            message: errorMessage
          }]
        }));
      }
      
      // Small delay between deployments
      if (i < servicesToDeploy.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Final status update
    setBulkDeployStatus(prev => ({
      ...prev,
      isActive: false,
      current: ''
    }));
    setBulkDeploying(false);
    
    // Refresh overview after all deployments
    setTimeout(() => {
      fetchOverview(true);
    }, 3000);
  }, [overview, cluster, region, fetchOverview]);


  const handleBulkRestart = useCallback(async () => {
    if (!overview || !overview.services) return;
    
    const servicesToRestart = overview.services.filter(s => 
      s.status === "UPDATES_AVAILABLE" && s.uses_latest_tag
    );
    if (servicesToRestart.length === 0) return;
    
    // Initialize bulk restart status
    setBulkDeployStatus({
      isActive: true,
      total: servicesToRestart.length,
      completed: 0,
      failed: 0,
      current: '',
      results: [],
      operationType: 'restart'
    });
    setBulkDeploying(true);
    
    // Restart services sequentially to avoid overwhelming the system
    for (let i = 0; i < servicesToRestart.length; i++) {
      const service = servicesToRestart[i];
      
      // Update current service being restarted
      setBulkDeployStatus(prev => ({
        ...prev,
        current: service.service_name
      }));
      
      try {
        const result = await apiService.deploy(cluster, service.service_name, null, region);
        
        if (result && !result.error) {
          setBulkDeployStatus(prev => ({
            ...prev,
            completed: prev.completed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'success',
              message: result.message || 'Restart started successfully'
            }]
          }));
        } else {
          const errorMessage = getErrorMessage(result?.error) || 'Restart failed';
          
          setBulkDeployStatus(prev => ({
            ...prev,
            failed: prev.failed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'error',
              message: errorMessage
            }]
          }));
        }
      } catch (err) {
        const errorMessage = getErrorMessage(err?.response?.data?.detail || err?.response?.data?.error || err.message) || 'Restart failed';
        setBulkDeployStatus(prev => ({
          ...prev,
          failed: prev.failed + 1,
          results: [...prev.results, {
            service: service.service_name,
            status: 'error',
            message: errorMessage
          }]
        }));
      }
      
      // Small delay between restarts
      if (i < servicesToRestart.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Final status update
    setBulkDeployStatus(prev => ({
      ...prev,
      isActive: false,
      current: ''
    }));
    setBulkDeploying(false);
    
    // Refresh overview after all restarts
    setTimeout(() => {
      fetchOverview(true);
    }, 3000);
  }, [overview, cluster, region, fetchOverview]);

  const handleForceRestartAll = useCallback(async () => {
    if (!overview || !overview.services) return;
    
    // Get all services - no filtering by status
    const allServices = overview.services;
    if (allServices.length === 0) return;
    
    // Initialize bulk deploy status
    setBulkDeployStatus({
      isActive: true,
      total: allServices.length,
      completed: 0,
      failed: 0,
      current: '',
      results: [],
      operationType: 'forceRestart'
    });
    setForceRestarting(true);
    setShowForceRestartModal(false);
    setForceRestartInput("");
    
    const results = [];
    
    // Deploy services sequentially to force new deployment
    for (let i = 0; i < allServices.length; i++) {
      const service = allServices[i];
      
      // Update current service being restarted
      setBulkDeployStatus(prev => ({
        ...prev,
        current: service.service_name
      }));
      
      try {
        const result = await apiService.deploy(cluster, service.service_name, null, region);
        
        if (result && !result.error) {
          results.push({
            service: service.service_name,
            status: 'success',
            message: result.message || 'Force restart initiated successfully'
          });
          
          setBulkDeployStatus(prev => ({
            ...prev,
            completed: prev.completed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'success',
              message: result.message || 'Force restart initiated successfully'
            }]
          }));
        } else {
          const errorMessage = getErrorMessage(result?.error) || 'Force restart failed';
          
          results.push({
            service: service.service_name,
            status: 'error',
            message: errorMessage
          });
          
          setBulkDeployStatus(prev => ({
            ...prev,
            failed: prev.failed + 1,
            results: [...prev.results, {
              service: service.service_name,
              status: 'error',
              message: errorMessage
            }]
          }));
        }
      } catch (err) {
        const errorMessage = getErrorMessage(err?.response?.data?.detail || err?.response?.data?.error || err.message) || 'Force restart failed';
        results.push({
          service: service.service_name,
          status: 'error',
          message: errorMessage
        });
        
        setBulkDeployStatus(prev => ({
          ...prev,
          failed: prev.failed + 1,
          results: [...prev.results, {
            service: service.service_name,
            status: 'error',
            message: errorMessage
          }]
        }));
      }
      
      // Small delay between restarts
      if (i < allServices.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Final status update
    setBulkDeployStatus(prev => ({
      ...prev,
      isActive: false,
      current: ''
    }));
    setForceRestarting(false);
    
    // Refresh overview after all restarts
    setTimeout(() => {
      fetchOverview(true);
    }, 3000);
  }, [overview, cluster, region, fetchOverview]);

  const getStatusColor = (status) => {
    switch (status) {
      case "NO_TASKS":
        return "badge-danger";
      case "UPDATES_AVAILABLE":
        return "badge-warning";
      case "UP_TO_DATE":
        return "badge-success";
      default:
        return "badge-secondary";
    }
  };

  const toggleEnvironmentCollapse = useCallback((env) => {
    setCollapsedEnvs(prev => ({
      ...prev,
      [env]: !prev[env]
    }));
  }, []);

  const getStatusIcon = (status) => {
    switch (status) {
      case "NO_TASKS":
        return (
          <svg className="w-4 h-4 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "UPDATES_AVAILABLE":
        return (
          <svg className="w-4 h-4 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "UP_TO_DATE":
        return (
          <svg className="w-4 h-4 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3 2.925-.605.133-1.05.457-1.36.902-.51.692-1.24 1.173-2.04 1.173H8.228" />
          </svg>
        );
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
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Cluster Overview
        </h2>
        <div className="text-center py-12 text-secondary-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <div className="text-sm font-medium">Select a cluster to view overview</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Cluster Overview
        </h2>
        <div className="flex items-center justify-center py-12">
          <svg className="animate-spin h-8 w-8 text-primary-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="ml-3 text-secondary-600">Loading cluster overview...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Cluster Overview
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

  if (!overview || !overview.services) {
    return (
      <div className="card">
        <h2 className="text-xl font-bold text-secondary-900 mb-4 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Cluster Overview
        </h2>
        <div className="text-center py-12 text-secondary-500">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          <div className="text-sm font-medium">No services found in cluster</div>
        </div>
      </div>
    );
  }

  const { services, summary } = overview;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-secondary-200">
        <h2 className="text-xl font-bold text-secondary-900 flex items-center">
          <svg className="w-5 h-5 mr-2 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          Cluster Overview
        </h2>
        <div className="flex items-center space-x-3">
          <div className="text-sm text-secondary-600 font-medium">
            {summary.total} service{summary.total !== 1 ? 's' : ''}
          </div>
          <button
            onClick={fetchOverview}
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

      {/* Bulk Deployment Status */}
      {bulkDeployStatus.isActive && (
        <div className="mb-6 p-4 bg-info-50 border border-info-200 rounded-xl shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-info-800 flex items-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Bulk Deployment/Restart in Progress
            </h3>
            <div className="text-sm font-bold text-info-700">
              {bulkDeployStatus.completed + bulkDeployStatus.failed} / {bulkDeployStatus.total}
            </div>
          </div>
          
          {/* Progress Bar */}
          <div className="w-full bg-info-200 rounded-full h-2.5 mb-3">
            <div 
              className="bg-info-600 h-2.5 rounded-full transition-all duration-300"
              style={{ 
                width: `${((bulkDeployStatus.completed + bulkDeployStatus.failed) / bulkDeployStatus.total) * 100}%` 
              }}
            ></div>
          </div>
          
          {/* Current Service */}
          {bulkDeployStatus.current && (
            <div className="text-sm text-info-700 mb-2 flex items-center">
              <svg className="animate-spin h-3 w-3 text-info-600 mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {bulkDeployStatus.operationType === 'restart' || bulkDeployStatus.operationType === 'forceRestart' ? 'Currently restarting: ' : 'Currently deploying: '}<span className="font-medium">{bulkDeployStatus.current}</span>
            </div>
          )}
          
          {/* Results Summary */}
          <div className="flex space-x-4 text-xs">
            <span className="text-accent-700 font-medium flex items-center">
              <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {bulkDeployStatus.completed} successful
            </span>
            {bulkDeployStatus.failed > 0 && (
              <span className="text-danger-700 font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                {bulkDeployStatus.failed} failed
              </span>
            )}
          </div>
        </div>
      )}
      
      {/* Deployment Results */}
      {!bulkDeployStatus.isActive && bulkDeployStatus.results.length > 0 && (
        <div className="mb-6 p-4 bg-secondary-50 border border-secondary-200 rounded-xl shadow-soft">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-secondary-900 flex items-center">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Deployment Results
            </h3>
            <button
              onClick={() => setBulkDeployStatus(prev => ({ ...prev, results: [] }))}
              className="text-xs text-secondary-500 hover:text-secondary-700 transition-colors"
            >
              Clear
            </button>
          </div>
          
          <div className="space-y-2">
            {bulkDeployStatus.results.map((result, index) => (
              <div key={index} className="flex items-center justify-between p-2 bg-white rounded-lg border border-secondary-200 text-sm">
                <span className="font-medium text-secondary-900">{result.service}</span>
                <div className="flex items-center space-x-2">
                  <span className={`badge ${result.status === 'success' ? 'badge-success' : 'badge-danger'}`}>
                    {result.status === 'success' ? 'Success' : 'Failed'}
                  </span>
                  <span className="text-xs text-secondary-500 max-w-xs truncate">
                    {result.message}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card-hover bg-danger-50 border-danger-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-12 h-12 rounded-lg bg-danger-100 flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-danger-600">No Tasks</div>
                <div className="text-2xl font-bold text-danger-900">{summary.no_tasks}</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="card-hover bg-warning-50 border-warning-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-12 h-12 rounded-lg bg-warning-100 flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-warning-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium text-warning-600">Updates Available</div>
                <div className="text-2xl font-bold text-warning-900">{summary.updates_available}</div>
              </div>
            </div>
            {summary.updates_available > 0 && (
              <div className="flex flex-col space-y-2">
                {summary.latest_tag_updates > 0 && (
                  <button
                    onClick={handleBulkRestart}
                    disabled={bulkDeploying}
                    className="btn-primary text-xs py-1.5 px-3 whitespace-nowrap"
                    title={`Restart ${summary.latest_tag_updates} service(s) with latest tags`}
                  >
                    {bulkDeploying ? "Restarting..." : "Restart All"}
                  </button>
                )}
                <button
                  onClick={handleBulkDeploy}
                  disabled={bulkDeploying}
                  className="btn-success text-xs py-1.5 px-3 whitespace-nowrap"
                  title={`Deploy all ${summary.updates_available} service(s) with updates`}
                >
                  {bulkDeploying ? "Deploying..." : "Deploy All"}
                </button>
              </div>
            )}
          </div>
        </div>
        
        <div className="card-hover bg-accent-50 border-accent-200">
          <div className="flex items-center">
            <div className="w-12 h-12 rounded-lg bg-accent-100 flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-accent-600">Up to Date</div>
              <div className="text-2xl font-bold text-accent-900">{summary.up_to_date}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Force Restart All Services Card */}
      <div className="mb-6 p-4 bg-danger-50 border border-danger-200 rounded-xl shadow-soft">
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className="w-12 h-12 rounded-lg bg-danger-100 flex items-center justify-center mr-3">
              <svg className="w-6 h-6 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-medium text-danger-600">Advanced</div>
              <div className="text-xs text-danger-700 mt-0.5">Force Restart all {summary.total} Service{summary.total !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <button
            onClick={() => setShowForceRestartModal(true)}
            disabled={forceRestarting}
            className="btn-danger text-xs py-1.5 px-3 whitespace-nowrap"
            title="Force new deployment for all services in the cluster"
          >
            {forceRestarting ? "Restarting..." : "Restart All Services"}
          </button>
        </div>
      </div>

      {/* Services List */}
      <div className="space-y-3">
        {(() => {
          // Group services by environment
          const grouped = groupByEnvironment(services.map(s => s.service_name));
          const envOrder = getEnvironmentOrder();
          
          // Sort environment groups by priority - explicitly order: dev (0) → other (1) → prod (2) → qa (3) → staging (4)
          const sortedEnvs = Object.keys(grouped).sort((a, b) => {
            const orderA = envOrder[a] !== undefined ? envOrder[a] : 999;
            const orderB = envOrder[b] !== undefined ? envOrder[b] : 999;
            return orderA - orderB;
          });
          
          return sortedEnvs.map((env) => (
            <div key={env}>
              {/* Environment Group Header - Collapsible */}
              {(() => {
                const colors = getEnvironmentColorClasses(env);
                const isCollapsed = collapsedEnvs[env] || false;
                const serviceCount = grouped[env].length;
                
                return (
                  <button
                    onClick={() => toggleEnvironmentCollapse(env)}
                    className={`w-full px-4 py-3 ${colors.bg} rounded-lg border-2 ${colors.border} mb-3 shadow-sm hover:shadow-md transition-shadow text-left`}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className={`text-sm font-bold ${colors.text} uppercase tracking-widest flex items-center`}>
                        <span className="text-lg mr-2">{getEnvironmentDisplayName(env).split(' ')[0]}</span>
                        {getEnvironmentDisplayName(env).substring(2)}
                        <span className={`${colors.text} ml-2 text-xs font-normal`}>({serviceCount})</span>
                      </h3>
                      <svg 
                        className={`w-5 h-5 ${colors.text} transition-transform ${isCollapsed ? '' : 'rotate-180'}`}
                        fill="none" 
                        stroke="currentColor" 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7-7m0 0L5 14m7-7v12" />
                      </svg>
                    </div>
                  </button>
                );
              })()}
              
              {/* Services in this environment - Collapsible */}
              {!collapsedEnvs[env] && (
                <div className="space-y-3 mb-6">
                  {grouped[env].map((serviceName) => {
                  const service = services.find(s => s.service_name === serviceName);
                  if (!service) return null;
                  
                  return (
                    <div
                      key={service.service_name}
                      className="card-hover cursor-pointer"
                      onClick={() => onServiceSelect(service.service_name)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-3 flex-1">
                          <div className="flex-shrink-0">{getStatusIcon(service.status)}</div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-secondary-900 flex items-center space-x-2">
                              <span className="truncate">{service.service_name}</span>
                              {service.uses_latest_tag && (
                                <span className="badge-info text-xs flex-shrink-0">latest</span>
                              )}
                            </div>
                            <div className="text-sm text-secondary-600 mt-0.5">
                              {service.running_count}/{service.desired_count} tasks running
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center space-x-2 flex-shrink-0">
                          <span className={`badge ${getStatusColor(service.status)}`}>
                            {getStatusText(service.status)}
                          </span>
                          {service.status === "UPDATES_AVAILABLE" && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeploy(service.service_name);
                              }}
                              disabled={deploying[service.service_name]}
                              className={`btn-success text-xs py-1.5 px-3 ${
                                service.uses_latest_tag ? "btn-primary" : ""
                              }`}
                              title={service.uses_latest_tag ? "Restart to pull latest image" : "Deploy with latest version"}
                            >
                              {deploying[service.service_name] 
                                ? (service.uses_latest_tag ? "Restarting..." : "Deploying...") 
                                : (service.uses_latest_tag ? "Restart" : "Deploy")
                              }
                            </button>
                          )}
                          <svg className="w-4 h-4 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </div>
                      
                      {/* Image URI info - always show current deployed image */}
                      {service.current_image_uri && (
                        <div className="mt-3 pt-3 border-t border-secondary-200">
                          <div className="p-3 bg-secondary-50 rounded-lg border border-secondary-200">
                            <div className="text-xs text-secondary-600 font-medium mb-1">Deployed Image:</div>
                            <div className="text-xs text-secondary-900 break-all p-2 bg-white rounded border border-secondary-200 font-mono">
                              {service.current_image_uri}
                            </div>
                            {service.status === "UPDATES_AVAILABLE" && service.latest_image_uri && (
                              <>
                                <div className="text-xs text-secondary-600 font-medium mt-2 mb-1">Latest Available:</div>
                                <div className="text-xs text-accent-700 break-all p-2 bg-accent-50 rounded border border-accent-200 font-mono">
                                  {service.latest_image_uri}
                                </div>
                              </>
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
          ));
        })()}
      </div>

      {/* Force Restart Confirmation Modal */}
      {showForceRestartModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <div className="w-10 h-10 rounded-full bg-danger-100 flex items-center justify-center mr-3">
                <svg className="w-6 h-6 text-danger-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4v2m0 6H3a1 1 0 01-1-1V3a1 1 0 011-1h18a1 1 0 011 1v16a1 1 0 01-1 1z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-secondary-900">Force Restart All Services</h3>
            </div>
            
            <p className="text-sm text-secondary-700 mb-4">
              This will trigger a "Force New Deployment" for <span className="font-semibold">{summary.total} service{summary.total !== 1 ? 's' : ''}</span> in the cluster <span className="font-semibold">{cluster}</span>. This action cannot be undone from ECS DeployMate.
            </p>
            
            <div className="bg-warning-50 border border-warning-200 rounded-lg p-3 mb-4">
              <p className="text-xs text-warning-800">
                <span className="font-semibold">⚠️ Warning:</span> All services will be redeployed using Rolling Update strategy, which may cause temporary downtime if min running tasks and max running tasks percentage are not correctly configured.
              </p>
            </div>
            
            <p className="text-sm text-secondary-700 mb-3">
              To confirm, please type: <span className="font-mono font-semibold text-danger-600">restart all services</span>
            </p>
            
            <input
              type="text"
              value={forceRestartInput}
              onChange={(e) => setForceRestartInput(e.target.value)}
              placeholder="Type 'restart all services' to confirm"
              className="w-full px-3 py-2 border border-secondary-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-danger-500 focus:border-transparent mb-4"
            />
            
            <div className="flex space-x-3">
              <button
                onClick={() => {
                  setShowForceRestartModal(false);
                  setForceRestartInput("");
                }}
                disabled={forceRestarting}
                className="flex-1 btn-secondary text-sm py-2"
              >
                Cancel
              </button>
              <button
                onClick={handleForceRestartAll}
                disabled={forceRestartInput !== "restart all services" || forceRestarting}
                className="flex-1 btn-danger text-sm py-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {forceRestarting ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Restarting...
                  </span>
                ) : (
                  "Confirm Restart"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default ClusterOverview;