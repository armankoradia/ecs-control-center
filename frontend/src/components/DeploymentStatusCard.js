import React, { useState, useEffect, useCallback, useMemo } from "react";
import apiService from "../services/apiService";

function DeploymentStatusCard({ deploymentData, cluster, service, profile, region, authMethod, onClose }) {
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
          const response = await apiService.getDeploymentStatus(cluster, service, profile, region, authMethod);
          
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
  }, [deploymentData, cluster, service, profile, region, authMethod]);

  const getStatusColor = (stepStatus) => {
    switch (stepStatus) {
      case "completed":
        return "text-green-600 dark:text-green-400";
      case "in_progress":
        return "text-blue-600 dark:text-blue-400";
      case "pending":
        return "text-gray-500 dark:text-gray-400";
      default:
        return "text-gray-500 dark:text-gray-400";
    }
  };

  const getStatusIcon = (stepStatus) => {
    switch (stepStatus) {
      case "completed":
        return "✅";
      case "in_progress":
        return "⏳";
      case "pending":
        return "⏸️";
      default:
        return "⏸️";
    }
  };

  const getOverallStatusColor = () => {
    switch (status) {
      case "COMPLETED":
        return "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800";
      case "IN_PROGRESS":
        return "bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800";
      case "PENDING":
        return "bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800";
      default:
        return "bg-gray-50 dark:bg-gray-900/20 border-gray-200 dark:border-gray-800";
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

  return (
    <div className={`mb-4 p-4 rounded-lg border ${getOverallStatusColor()}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="text-lg">
            {status === "COMPLETED" ? "🎉" : status === "IN_PROGRESS" ? "🚀" : "⏳"}
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800 dark:text-gray-200">
              {getOverallStatusText()}
            </div>
            {deploymentData && (
              <div className="text-xs text-gray-600 dark:text-gray-400">
                Image: {deploymentData.latest_image_uri}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-3">
          <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">Deployment Steps</div>
          {steps.map((step) => (
            <div key={step.id} className="flex items-center space-x-3 p-2 bg-white dark:bg-gray-800 rounded border">
              <div className="text-lg">{getStatusIcon(step.status)}</div>
              <div className="flex-1">
                <div className={`text-sm font-medium ${getStatusColor(step.status)}`}>
                  {step.name}
                </div>
                {step.timestamp && (
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </div>
                )}
              </div>
            </div>
          ))}
          
          {deploymentStatus && (
            <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-700 rounded border">
              <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Service Status</div>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Desired Count:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.desired_count}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Running Count:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.running_count}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Pending Count:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.pending_count}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Tasks with Current TD:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.tasks_with_current_td}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Status:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.status}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Deployments in Progress:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.deployments_in_progress}</span>
                </div>
                <div>
                  <span className="text-gray-500 dark:text-gray-400">Deployment Completed:</span>
                  <span className="ml-1 font-medium">{deploymentStatus.deployment_completed ? "Yes" : "No"}</span>
                </div>
              </div>
              
              {deploymentStatus.recent_events && deploymentStatus.recent_events.length > 0 && (
                <div className="mt-3">
                  <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Recent Events</div>
                  <div className="space-y-1">
                    {deploymentStatus.recent_events.map((event, index) => (
                      <div key={index} className="text-xs text-gray-600 dark:text-gray-400">
                        <div className="font-mono">{event.message}</div>
                        {event.createdAt && (
                          <div className="text-gray-500 dark:text-gray-500">
                            {new Date(event.createdAt).toLocaleString()}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default DeploymentStatusCard;
