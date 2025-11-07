import React, { useState, useEffect, useCallback, useMemo } from "react";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import UserProfile from "./components/UserProfile";
import ErrorBoundary from "./components/ErrorBoundary";
import apiService from "./services/apiService";
import RegionSelector from "./components/RegionSelector";
import ClusterSelector from "./components/ClusterSelector";
import ServiceSelector from "./components/ServiceSelector";
import TaskDetailsPanel from "./components/TaskDetailsPanel";
import LogsPanel from "./components/LogsPanel";
import ServiceEvents from "./components/ServiceEvents";
import MetricsCards from "./components/MetricsCards";
import ClusterOverview from "./components/ClusterOverview";
import DeploymentHistory from "./components/DeploymentHistory";
import AccessKeySelector from "./components/AccessKeySelector";

function AppContent() {
  const { user } = useAuth();
  const [region, setRegion] = useState(() => localStorage.getItem('ecs-region') || "us-east-1");
  const [clusters, setClusters] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState(() => localStorage.getItem('ecs-cluster') || "");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(() => localStorage.getItem('ecs-service') || "");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState({ clusters: false, services: false, tasks: false });
  const [error, setError] = useState("");


  // Fetch clusters whenever region changes
  const fetchClusters = useCallback(async (forceRefresh = false) => {
    if (!region) return;

    setLoading(l => ({ ...l, clusters: true }));
    setError("");
    try {
      const data = await apiService.getClusters(region, forceRefresh);
      setClusters(data);
      setSelectedCluster(""); // reset cluster selection
      setServices([]);
      setSelectedService("");
      setTasks([]);
    } catch (err) {
      // Only set error if it's not an authentication issue that might be temporary
      const errorMessage = err?.response?.data?.detail || err.message;
      if (!errorMessage.includes("ExpiredToken") && !errorMessage.includes("Authentication failed")) {
        setError(`Error fetching clusters: ${errorMessage}`);
      }
    } finally {
      setLoading(l => ({ ...l, clusters: false }));
    }
  }, [region]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  // Clear errors when region is set
  useEffect(() => {
    if (region) {
      setError("");
    }
  }, [region]);

  // Clear errors when no cluster is selected
  useEffect(() => {
    if (!selectedCluster) {
      setError("");
    }
  }, [selectedCluster]);

  // Fetch services when cluster changes
  const fetchServices = useCallback(async (forceRefresh = false) => {
    if (!region || !selectedCluster) return;

    setLoading(l => ({ ...l, services: true }));
    setError(""); // Clear any previous errors
    try {
      const data = await apiService.getServices(selectedCluster, region, forceRefresh);
      setServices(data);
      setSelectedService(""); // reset service selection
      setTasks([]);
    } catch (err) {
      // Only set error if it's not an authentication issue that might be temporary
      const errorMessage = err?.response?.data?.detail || err.message;
      if (!errorMessage.includes("ExpiredToken") && !errorMessage.includes("Authentication failed")) {
        setError(`Error fetching services: ${errorMessage}`);
      }
    } finally {
      setLoading(l => ({ ...l, services: false }));
    }
  }, [region, selectedCluster]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Fetch tasks when service changes
  const fetchTasks = useCallback(async (forceRefresh = false) => {
    if (!region || !selectedCluster || !selectedService) return;

    setLoading(l => ({ ...l, tasks: true }));
    setError("");
    try {
      const data = await apiService.getTasks(selectedCluster, selectedService, region, forceRefresh);
      setTasks(data);
    } catch (err) {
      // Only set error if it's not an authentication issue that might be temporary
      const errorMessage = err?.response?.data?.detail || err.message;
      if (!errorMessage.includes("ExpiredToken") && !errorMessage.includes("Authentication failed")) {
        setError(`Error fetching tasks: ${errorMessage}`);
      }
    } finally {
      setLoading(l => ({ ...l, tasks: false }));
    }
  }, [region, selectedCluster, selectedService]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Refresh all data
  const refreshAll = useCallback(async () => {
    await Promise.all([
      fetchClusters(true),
      fetchServices(true),
      fetchTasks(true)
    ]);
  }, [fetchClusters, fetchServices, fetchTasks]);

  // Memoized loading state
  const isLoading = useMemo(() => 
    loading.clusters || loading.services || loading.tasks, 
    [loading.clusters, loading.services, loading.tasks]
  );

  return (
    <div className="min-h-screen bg-secondary-50">
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="w-72 bg-white border-r border-secondary-200 flex flex-col shadow-sm">
          <div className="px-6 py-5 border-b border-secondary-200 bg-gradient-to-br from-primary-50 to-white">
            <div className="flex justify-center">
              <img src="/images/ECSDeployMate.png" alt="ECS Deploy Mate" className="h-20 w-auto" />
            </div>
            <div className="mt-3 text-center">
              <h1 className="text-lg font-bold text-secondary-900">ECS DeployMate</h1>
              <p className="text-xs text-secondary-500 mt-0.5">AWS ECS Management</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
            <div>
              <AccessKeySelector visible={true} onSaved={() => fetchClusters(true)} />
            </div>
            <div>
              <RegionSelector region={region} setRegion={setRegion} />
            </div>
            <div className="pt-2">
              <button
                onClick={refreshAll}
                disabled={isLoading}
                className="btn-success w-full text-sm py-2.5 shadow-sm hover:shadow-md"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Refreshing...
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Refresh All
                  </span>
                )}
              </button>
            </div>
          </div>
          <div className="p-4 border-t border-secondary-200 bg-secondary-50">
            <div className="text-xs text-secondary-500 text-center">
              <p className="font-medium">Built with FastAPI & React</p>
              <p className="mt-1 text-secondary-400">v1.0.0</p>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="h-16 bg-white border-b border-secondary-200 shadow-sm flex items-center z-10">
            <div className="px-6 w-full flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md">
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-lg font-bold text-secondary-900">ECS DeployMate</h2>
                    <p className="text-xs text-secondary-500">Cloud Infrastructure Management</p>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3 px-4 py-2 bg-secondary-50 rounded-lg border border-secondary-200">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-secondary-600">Cluster:</span>
                    <span className="badge-info font-semibold">
                      {selectedCluster || 'None'}
                    </span>
                  </div>
                  <div className="w-px h-4 bg-secondary-300"></div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-medium text-secondary-600">Service:</span>
                    <span className="badge-success font-semibold">
                      {selectedService || 'None'}
                    </span>
                  </div>
                </div>
                <UserProfile />
              </div>
            </div>
          </header>

          <main className="flex-1 overflow-y-auto scrollbar-thin bg-secondary-50 p-6">
            <div className="space-y-6 animate-fade-in">
              <MetricsCards cluster={selectedCluster} service={selectedService} region={region} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="card">
                  <ClusterSelector clusters={clusters} selectedCluster={selectedCluster} setSelectedCluster={(v) => { setSelectedCluster(v); localStorage.setItem('ecs-cluster', v); }} />
                </div>
                <div className="card">
                  <ServiceSelector services={services} selectedService={selectedService} setSelectedService={(v) => { setSelectedService(v); localStorage.setItem('ecs-service', v); }} />
                </div>
              </div>

              {!region && (
                <div className="card bg-info-50 border-info-200 animate-slide-down">
                  <div className="flex items-center space-x-3">
                    <svg className="w-5 h-5 text-info-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-medium text-info-800">Select Region</p>
                  </div>
                </div>
              )}

              {region && !selectedCluster && (
                <div className="card bg-info-50 border-info-200 animate-slide-down">
                  <div className="flex items-center space-x-3">
                    <svg className="w-5 h-5 text-info-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-medium text-info-800">
                      {isLoading ? 'Connecting…' : 'Select ECS Cluster'}
                    </p>
                  </div>
                </div>
              )}
              
              {region && selectedCluster && !selectedService && (
                <div className="space-y-6">
                  <ClusterOverview 
                    cluster={selectedCluster} 
                    region={region} 
                    onServiceSelect={(serviceName) => {
                      setSelectedService(serviceName);
                      localStorage.setItem('ecs-service', serviceName);
                    }}
                  />
                  <DeploymentHistory 
                    cluster={selectedCluster} 
                    region={region} 
                  />
                  <div className="card bg-info-50 border-info-200">
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-info-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-medium text-info-800">
                        {isLoading ? 'Connecting…' : 'Select ECS Service from overview above or use the dropdown'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
              
              {error && (
                <div className="card bg-danger-50 border-danger-200 animate-slide-down">
                  <div className="flex items-start space-x-3">
                    <svg className="w-5 h-5 text-danger-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-medium text-danger-800">{error}</p>
                  </div>
                </div>
              )}

              {region && selectedCluster && selectedService && (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <TaskDetailsPanel tasks={tasks} loading={loading.tasks} cluster={selectedCluster} service={selectedService} region={region} />
                    <LogsPanel cluster={selectedCluster} service={selectedService} region={region} />
                  </div>
                  <ServiceEvents cluster={selectedCluster} service={selectedService} region={region} />
                </>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

function App() {
  // No callback route needed in open source version

  return (
    <ErrorBoundary>
      <AuthProvider>
        <ProtectedRoute>
          <AppContent />
        </ProtectedRoute>
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;