// frontend/src/components/MetricsCards.js
import React, { useEffect, useState } from "react";
import apiService from "../services/apiService";
import { API_BASE } from "../api";

export default function MetricsCards({ cluster, service, region }) {
  const [activeTasks, setActiveTasks] = useState(0);
  const [totalServices, setTotalServices] = useState(0);
  const totalClusters = cluster ? 1 : 0;

  useEffect(() => {
    if (!cluster || !region) { 
      setActiveTasks(0); 
      setTotalServices(0);
      return; 
    }
    
    const fetchMetrics = async () => {
      try {
        // Fetch task count
        const taskPayload = {
          cluster,
          service: service || '',
          region
        };
        apiService.addCredentials(taskPayload);
        const taskResponse = await apiService.get(`${API_BASE}/task_count`, { method: 'POST', data: taskPayload });
        setActiveTasks(taskResponse.data?.count ?? 0);

        // Fetch service count for the cluster
        const servicesData = await apiService.getServices(cluster, region);
        setTotalServices(servicesData?.length ?? 0);
      } catch (error) {
        console.error("Error fetching metrics:", error);
        setActiveTasks(0);
        setTotalServices(0);
      }
    };

    fetchMetrics();
  }, [cluster, service, region]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
      <div className="card-hover group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-secondary-600 mb-1">Total Clusters</p>
            <p className="text-3xl font-bold text-primary-600 group-hover:text-primary-700 transition-colors">{totalClusters}</p>
          </div>
          <div className="w-12 h-12 rounded-lg bg-primary-100 flex items-center justify-center group-hover:bg-primary-200 transition-colors">
            <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
        </div>
      </div>
      <div className="card-hover group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-secondary-600 mb-1">Total Services</p>
            <p className="text-3xl font-bold text-accent-600 group-hover:text-accent-700 transition-colors">{totalServices}</p>
          </div>
          <div className="w-12 h-12 rounded-lg bg-accent-100 flex items-center justify-center group-hover:bg-accent-200 transition-colors">
            <svg className="w-6 h-6 text-accent-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
      </div>
      <div className="card-hover group">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-secondary-600 mb-1">Active Tasks</p>
            <p className="text-3xl font-bold text-info-600 group-hover:text-info-700 transition-colors">{activeTasks}</p>
          </div>
          <div className="w-12 h-12 rounded-lg bg-info-100 flex items-center justify-center group-hover:bg-info-200 transition-colors">
            <svg className="w-6 h-6 text-info-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

