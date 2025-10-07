// frontend/src/components/MetricsCards.js
import React, { useEffect, useState } from "react";
import apiService from "../services/apiService";

export default function MetricsCards({ cluster, service, profile, region, authMethod = "profile" }) {
  const [activeTasks, setActiveTasks] = useState(0);
  const [totalServices, setTotalServices] = useState(0);
  const totalClusters = cluster ? 1 : 0;

  useEffect(() => {
    if (!cluster || !profile || !region) { 
      setActiveTasks(0); 
      setTotalServices(0);
      return; 
    }
    
    const fetchMetrics = async () => {
      try {
        // Fetch task count using direct axios call since there's no specific method for it
        const taskResponse = await apiService.get(`/task_count?cluster=${encodeURIComponent(cluster)}&service=${service ? encodeURIComponent(service) : ''}&profile=${encodeURIComponent(profile)}&region=${encodeURIComponent(region)}&auth_method=${encodeURIComponent(authMethod)}`);
        setActiveTasks(taskResponse.data?.count ?? 0);

        // Fetch service count for the cluster using the proper method
        const servicesData = await apiService.getServices(cluster, profile, region, authMethod);
        setTotalServices(servicesData?.length ?? 0);
      } catch (error) {
        console.error("Error fetching metrics:", error);
        setActiveTasks(0);
        setTotalServices(0);
      }
    };

    fetchMetrics();
  }, [cluster, service, profile, region, authMethod]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-2">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Total Clusters</h3>
        <p className="text-2xl font-semibold mt-1">{totalClusters}</p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Total Services</h3>
        <p className="text-2xl font-semibold mt-1">{totalServices}</p>
      </div>
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wide">Active Tasks</h3>
        <p className="text-2xl font-semibold mt-1">{activeTasks}</p>
      </div>
    </div>
  );
}

