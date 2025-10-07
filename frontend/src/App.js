import React, { useState, useEffect, useCallback, useMemo } from "react";
import apiService from "./services/apiService";
import ProfileSelector from "./components/ProfileSelector";
import RegionSelector from "./components/RegionSelector";
import ClusterSelector from "./components/ClusterSelector";
import ServiceSelector from "./components/ServiceSelector";
import TaskDetailsPanel from "./components/TaskDetailsPanel";
import LogsPanel from "./components/LogsPanel";
import MetricsCards from "./components/MetricsCards";
import ClusterOverview from "./components/ClusterOverview";
import AuthMethodSelector from "./components/AuthMethodSelector";

function App() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('ecs-dark');
    return saved ? saved === '1' : false;
  });
  const [profile, setProfile] = useState("");
  const [region, setRegion] = useState(() => localStorage.getItem('ecs-region') || "us-east-1");
  const [authMethod, setAuthMethod] = useState(() => localStorage.getItem('ecs-auth-method') || "profile");
  const [clusters, setClusters] = useState([]);
  const [selectedCluster, setSelectedCluster] = useState(() => localStorage.getItem('ecs-cluster') || "");
  const [services, setServices] = useState([]);
  const [selectedService, setSelectedService] = useState(() => localStorage.getItem('ecs-service') || "");
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState({ clusters: false, services: false, tasks: false });
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('ecs-dark', dark ? '1' : '0');
  }, [dark]);

  // Fetch clusters whenever profile, region, or auth method changes
  const fetchClusters = useCallback(async (forceRefresh = false) => {
    if (!profile || !region || !authMethod) return;

    setLoading(l => ({ ...l, clusters: true }));
    setError("");
    try {
      const data = await apiService.getClusters(profile, region, authMethod, forceRefresh);
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
  }, [profile, region, authMethod]);

  useEffect(() => {
    fetchClusters();
  }, [fetchClusters]);

  // Clear errors when authentication method changes (indicating successful auth)
  useEffect(() => {
    if (authMethod && profile && region) {
      setError("");
    }
  }, [authMethod, profile, region]);

  // Clear errors when no cluster is selected
  useEffect(() => {
    if (!selectedCluster) {
      setError("");
    }
  }, [selectedCluster]);

  // Fetch services when cluster changes
  const fetchServices = useCallback(async (forceRefresh = false) => {
    if (!profile || !region || !selectedCluster || !authMethod) return;

    setLoading(l => ({ ...l, services: true }));
    setError(""); // Clear any previous errors
    try {
      const data = await apiService.getServices(selectedCluster, profile, region, authMethod, forceRefresh);
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
  }, [profile, region, selectedCluster, authMethod]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  // Fetch tasks when service changes
  const fetchTasks = useCallback(async (forceRefresh = false) => {
    if (!profile || !region || !selectedCluster || !selectedService || !authMethod) return;

    setLoading(l => ({ ...l, tasks: true }));
    setError("");
    try {
      const data = await apiService.getTasks(selectedCluster, selectedService, profile, region, authMethod, forceRefresh);
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
  }, [profile, region, selectedCluster, selectedService, authMethod]);

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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <div className="flex h-screen">
        {/* Sidebar */}
        <aside className="w-72 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex flex-col">
          <div className="px-4 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex justify-center">
              <img src="/images/ECSControlCenter.png" alt="ECS Control Center" className="h-24 w-auto" />
            </div>
            {/* <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">Minimalist-driven Design</div> */}
          </div>
          <div className="p-3 space-y-3">
            <div>
              <ProfileSelector setProfile={setProfile} />
            </div>
            <div>
              <RegionSelector region={region} setRegion={setRegion} />
            </div>
            <div>
              <AuthMethodSelector 
                authMethod={authMethod} 
                setAuthMethod={(v) => { setAuthMethod(v); localStorage.setItem('ecs-auth-method', v); }} 
                profile={profile} 
                region={region} 
              />
            </div>
            <div className="pt-1 space-y-2">
              <button 
                onClick={refreshAll} 
                disabled={isLoading}
                className="w-full px-3 py-1.5 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm"
              >
                {isLoading ? 'Refreshing...' : 'Refresh All'}
              </button>
              <div className="w-28 mx-auto">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-semibold ${!dark ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>Light</span>
                  <div 
                    onClick={() => setDark(d => !d)} 
                    className="w-16 h-6 bg-gray-300 rounded-full p-0.5 cursor-pointer relative mx-3"
                    style={{ backgroundColor: dark ? '#4B5563' : '#D1D5DB' }}
                  >
                    <div 
                      className="w-5 h-5 bg-white rounded-full shadow-sm absolute top-0.5 transition-all duration-300"
                      style={{ 
                        transform: dark ? 'translateX(calc(100% - 4px))' : 'translateX(0px)',
                        left: '2px'
                      }}
                    />
                  </div>
                  <span className={`text-xs font-semibold ${dark ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>Dark</span>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-auto p-4 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-200 dark:border-gray-700">
            Built with FastAPI & React
          </div>
        </aside>

        {/* Main content */}
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white/80 dark:bg-gray-800/80 backdrop-blur border-b border-primary/20 dark:border-primary/30 flex items-center">
            <div className="px-4 w-full flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {/* <img src="/images/TalentneuronLogo.svg" alt="Talentneuron" className="h-8" /> */}
                <div className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  ECS Control Center
                </div>
              </div>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                <span className="mr-2">Cluster</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
                  {selectedCluster || 'None'}
                </span>
                <span className="mx-2">Service</span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  {selectedService || 'None'}
                </span>
              </div>
            </div>
          </header>

          <main className="p-3 space-y-3 overflow-auto">
            <MetricsCards cluster={selectedCluster} service={selectedService} profile={profile} region={region} authMethod={authMethod} />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <ClusterSelector clusters={clusters} selectedCluster={selectedCluster} setSelectedCluster={(v) => { setSelectedCluster(v); localStorage.setItem('ecs-cluster', v); }} />
              </div>
              <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                <ServiceSelector services={services} selectedService={selectedService} setSelectedService={(v) => { setSelectedService(v); localStorage.setItem('ecs-service', v); }} />
              </div>
            </div>

        {!profile && (
          <div className="mb-4 p-3 rounded bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-200 dark:border-gray-700">
            Select Profile to begin
          </div>
        )}
        
        {profile && !region && (
          <div className="mb-4 p-3 rounded bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-200 dark:border-gray-700">
            Select Region
          </div>
        )}
        
        {profile && region && !selectedCluster && (
          <div className="mb-4 p-3 rounded bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-200 dark:border-gray-700">
            {isLoading ? 'Connecting…' : 'Select ECS Cluster'}
          </div>
        )}
        
        {profile && region && selectedCluster && !selectedService && (
          <div className="space-y-4">
            <ClusterOverview 
              cluster={selectedCluster} 
              profile={profile} 
              region={region} 
              authMethod={authMethod}
              onServiceSelect={(serviceName) => {
                setSelectedService(serviceName);
                localStorage.setItem('ecs-service', serviceName);
              }}
            />
            <div className="mb-4 p-3 rounded bg-gray-50 text-gray-700 border border-gray-200 dark:bg-gray-800/40 dark:text-gray-200 dark:border-gray-700">
              {isLoading ? 'Connecting…' : 'Select ECS Service from overview above or use the dropdown'}
            </div>
          </div>
        )}
        
        {error && (
          <div className="mb-4 p-3 rounded bg-red-50 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-200 dark:border-red-800">
            {error}
          </div>
        )}

        {profile && region && selectedCluster && selectedService && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TaskDetailsPanel tasks={tasks} loading={loading.tasks} cluster={selectedCluster} service={selectedService} profile={profile} region={region} authMethod={authMethod} />
            <LogsPanel cluster={selectedCluster} service={selectedService} profile={profile} region={region} authMethod={authMethod} />
          </div>
        )}
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;

