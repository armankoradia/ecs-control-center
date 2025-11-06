import React, { useState, useEffect, useCallback, useMemo } from "react";
import apiService from "../services/apiService";

function DeploymentStatusCard({ deploymentData, cluster, service, region, onClose }) {
  const [status, setStatus] = useState("PENDING");
  const [steps, setSteps] = useState([
    { id: 1, name: "Fetching latest Image URI from ECR", status: "completed", timestamp: null },
    { id: 2, name: "Updating Task Definition with latest Image URI", status: "completed", timestamp: null },
    { id: 3, name: "Updating ECS Service with latest Task Definition version", status: "completed", timestamp: null },
    { id: 4, name: "New ECS Task Created", status: "in_progress", timestamp: null }
  ]);
  const [deploymentStatus, setDeploymentStatus] = useState(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (deploymentData) {
      // Mark first 3 steps as completed since deployment was initiated
      setSteps(prev => prev.map(step => {
        if (step.id <= 3) {
          return { ...step, status: "completed", timestamp: new Date().toISOString() };
        }
        return step;
      }));
      
      // Start polling for deployment status
      let pollCount = 0;
      const maxPolls = 60; // Poll for up to 2 minutes (60 * 2 seconds)
      
      const interval = setInterval(async () => {
        pollCount++;
        try {
          const response = await apiService.getDeploymentStatus(cluster, service, region);
          
          if (response && !response.error) {
            setDeploymentStatus(response);
            console.log("Deployment status check:", response);
            
            if (response.status === "COMPLETED") {
              setStatus("COMPLETED");
              setSteps(prev => prev.map(step => {
                if (step.id === 4) {
                  return { ...step, status: "completed", timestamp: new Date().toISOString() };
                }
                return step;
              }));
              clearInterval(interval);
            } else if (response.status === "IN_PROGRESS") {
              setStatus("IN_PROGRESS");
            } else if (response.status === "PENDING") {
              setStatus("PENDING");
            }
          }
          
          // Stop polling after max attempts
          if (pollCount >= maxPolls) {
            console.log("Stopping deployment status polling after max attempts");
            clearInterval(interval);
          }
        } catch (error) {
          console.error("Error checking deployment status:", error);
          // Stop polling on repeated errors
          if (pollCount >= 5) {
            clearInterval(interval);
          }
        }
      }, 2000); // Poll every 2 seconds

      return () => clearInterval(interval);
    }
  }, [deploymentData, cluster, service, region]);

  const getStatusColor = (stepStatus) => {
    switch (stepStatus) {
      case "completed":
        return "text-accent-700";
      case "in_progress":
        return "text-info-700";
      case "pending":
        return "text-secondary-600";
      default:
        return "text-secondary-600";
    }
  };

  const getStatusIcon = (stepStatus) => {
    switch (stepStatus) {
      case "completed":
        return (
          <svg className="w-5 h-5 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "in_progress":
        return (
          <svg className="w-5 h-5 text-info-600 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case "pending":
        return (
          <svg className="w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  const getOverallStatusText = () => {
    switch (status) {
      case "COMPLETED":
        return "Deployment completed successfully";
      case "IN_PROGRESS":
        return "Deployment in progress";
      case "PENDING":
        return "Deployment pending";
      default:
        return "Deployment status unknown";
    }
  };

  const statusConfig = {
    COMPLETED: { color: 'accent', icon: '🎉', bg: 'bg-accent-50', border: 'border-accent-200' },
    IN_PROGRESS: { color: 'info', icon: '🚀', bg: 'bg-info-50', border: 'border-info-200' },
    PENDING: { color: 'warning', icon: '⏳', bg: 'bg-warning-50', border: 'border-warning-200' },
  };
  
  const config = statusConfig[status] || { color: 'secondary', icon: '⏸️', bg: 'bg-secondary-50', border: 'border-secondary-200' };

  return (
    <div className={`mb-4 p-5 rounded-xl border ${config.bg} ${config.border} shadow-soft`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-2xl">{config.icon}</div>
          <div>
            <div className="text-sm font-bold text-secondary-900">
              {getOverallStatusText()}
            </div>
            {deploymentData && (
              <div className="text-xs text-secondary-600 mt-1 bg-white px-2 py-1 rounded border border-secondary-200 inline-block">
                {deploymentData.latest_image_uri}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-all duration-200"
          >
            <svg className={`w-4 h-4 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-2 text-secondary-500 hover:text-secondary-700 hover:bg-secondary-100 rounded-lg transition-all duration-200"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-5 pt-5 border-t border-secondary-200 space-y-4">
          <div className="text-sm font-bold text-secondary-900 mb-4 flex items-center">
            <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Deployment Steps
          </div>
          <div className="space-y-2">
            {steps.map((step) => (
              <div key={step.id} className="flex items-center space-x-3 p-3 bg-white rounded-lg border border-secondary-200 shadow-sm">
                <div className="flex-shrink-0">{getStatusIcon(step.status)}</div>
                <div className="flex-1">
                  <div className={`text-sm font-medium ${getStatusColor(step.status)}`}>
                    {step.name}
                  </div>
                  {step.timestamp && (
                    <div className="text-xs text-secondary-500 mt-0.5">
                      {new Date(step.timestamp).toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          
          {deploymentStatus && (
            <div className="mt-5 pt-5 border-t border-secondary-200">
              <div className="card bg-secondary-50">
                <div className="text-sm font-bold text-secondary-900 mb-4 flex items-center">
                  <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  Service Status
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex justify-between p-2 bg-white rounded border border-secondary-200">
                    <span className="text-secondary-600 font-medium">Desired:</span>
                    <span className="font-semibold text-secondary-900">{deploymentStatus.desired_count}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-white rounded border border-secondary-200">
                    <span className="text-secondary-600 font-medium">Running:</span>
                    <span className="font-semibold text-secondary-900">{deploymentStatus.running_count}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-white rounded border border-secondary-200">
                    <span className="text-secondary-600 font-medium">Pending:</span>
                    <span className="font-semibold text-secondary-900">{deploymentStatus.pending_count}</span>
                  </div>
                  <div className="flex justify-between p-2 bg-white rounded border border-secondary-200">
                    <span className="text-secondary-600 font-medium">Status:</span>
                    <span className={`badge ${
                      deploymentStatus.status === 'COMPLETED' ? 'badge-success' :
                      deploymentStatus.status === 'IN_PROGRESS' ? 'badge-info' :
                      'badge-warning'
                    }`}>
                      {deploymentStatus.status}
                    </span>
                  </div>
                </div>
                
                {deploymentStatus.recent_events && deploymentStatus.recent_events.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-secondary-200">
                    <div className="text-sm font-bold text-secondary-900 mb-3">Recent Events</div>
                    <div className="space-y-2 max-h-40 overflow-y-auto scrollbar-thin">
                      {deploymentStatus.recent_events.map((event, index) => (
                        <div key={index} className="p-2 bg-white rounded border border-secondary-200">
                          <div className="text-xs text-secondary-900">{event.message}</div>
                          {event.createdAt && (
                            <div className="text-xs text-secondary-500 mt-1">
                              {new Date(event.createdAt).toLocaleString()}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DeploymentStatusCard;
