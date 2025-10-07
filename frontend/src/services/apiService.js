import axios from "axios";
import { API_BASE } from "../api";
import { clusterCache, serviceCache, taskCache, overviewCache, getCacheKey } from "../utils/cache";

// Create axios instance with optimized config
const apiClient = axios.create({
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor for logging
apiClient.interceptors.request.use(
  (config) => {
    console.log(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('API Request Error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    console.log(`API Response: ${response.status} ${response.config.url}`);
    return response;
  },
  (error) => {
    console.error('API Response Error:', error.response?.status, error.message);
    return Promise.reject(error);
  }
);

// Generic cached API call
const cachedApiCall = async (cache, cacheKey, apiCall, forceRefresh = false) => {
  if (!forceRefresh) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  console.log(`Cache miss: ${cacheKey}`);
  const result = await apiCall();
  cache.set(cacheKey, result);
  return result;
};

// API Service class
class ApiService {
  // Generic GET method for endpoints not covered by specific methods
  async get(url) {
    return apiClient.get(url);
  }
  // Clusters
  async getClusters(profile, region, authMethod, forceRefresh = false) {
    const cacheKey = getCacheKey('clusters', profile, region, authMethod);
    return cachedApiCall(
      clusterCache,
      cacheKey,
      () => apiClient.get(`${API_BASE}/clusters`, {
        params: { profile, region, auth_method: authMethod }
      }).then(res => res.data),
      forceRefresh
    );
  }

  // Services
  async getServices(cluster, profile, region, authMethod, forceRefresh = false) {
    const cacheKey = getCacheKey('services', cluster, profile, region, authMethod);
    return cachedApiCall(
      serviceCache,
      cacheKey,
      () => apiClient.get(`${API_BASE}/services`, {
        params: { cluster, profile, region, auth_method: authMethod }
      }).then(res => res.data),
      forceRefresh
    );
  }

  // Tasks
  async getTasks(cluster, service, profile, region, authMethod, forceRefresh = false) {
    const cacheKey = getCacheKey('tasks', cluster, service, profile, region, authMethod);
    return cachedApiCall(
      taskCache,
      cacheKey,
      () => apiClient.get(`${API_BASE}/tasks`, {
        params: { cluster, service, profile, region, auth_method: authMethod }
      }).then(res => res.data),
      forceRefresh
    );
  }

  // Task Details
  async getTaskDetails(cluster, service, profile, region, authMethod, forceRefresh = false) {
    const cacheKey = getCacheKey('task_details', cluster, service, profile, region, authMethod);
    return cachedApiCall(
      taskCache,
      cacheKey,
      () => apiClient.get(`${API_BASE}/task_details`, {
        params: { cluster, service, profile, region, auth_method: authMethod }
      }).then(res => res.data),
      forceRefresh
    );
  }

  // Cluster Overview
  async getClusterOverview(cluster, profile, region, authMethod, forceRefresh = false) {
    const cacheKey = getCacheKey('cluster_overview', cluster, profile, region, authMethod);
    return cachedApiCall(
      overviewCache,
      cacheKey,
      () => apiClient.get(`${API_BASE}/cluster_overview`, {
        params: { cluster, profile, region, auth_method: authMethod }
      }).then(res => res.data),
      forceRefresh
    );
  }

  // Deployment Status
  async getDeploymentStatus(cluster, service, profile, region, authMethod) {
    // No caching for deployment status as it changes frequently
    return apiClient.get(`${API_BASE}/deployment_status`, {
      params: { cluster, service, profile, region, auth_method: authMethod }
    }).then(res => res.data);
  }

  // Deploy
  async deploy(cluster, service, containerName, profile, region, authMethod) {
    // Clear relevant caches after deployment
    const serviceCacheKey = getCacheKey('services', cluster, profile, region, authMethod);
    const taskCacheKey = getCacheKey('tasks', cluster, service, profile, region, authMethod);
    const overviewCacheKey = getCacheKey('cluster_overview', cluster, profile, region, authMethod);
    
    const result = await apiClient.post(`${API_BASE}/deploy`, {
      cluster,
      service,
      container_name: containerName,
      profile,
      region,
      auth_method: authMethod
    }).then(res => res.data);

    // Clear caches after successful deployment
    if (result && !result.error) {
      serviceCache.delete(serviceCacheKey);
      taskCache.delete(taskCacheKey);
      overviewCache.delete(overviewCacheKey);
    }

    return result;
  }

  // Auth Test
  async testAuth(profile, region, authMethod) {
    return apiClient.get(`${API_BASE}/auth_test`, {
      params: { profile, region, auth_method: authMethod }
    }).then(res => res.data);
  }

  // Clear all caches
  clearAllCaches() {
    clusterCache.clear();
    serviceCache.clear();
    taskCache.clear();
    overviewCache.clear();
  }

  // Clear specific caches
  clearClusterCache(profile, region, authMethod) {
    const cacheKey = getCacheKey('clusters', profile, region, authMethod);
    clusterCache.delete(cacheKey);
  }

  clearServiceCache(cluster, profile, region, authMethod) {
    const cacheKey = getCacheKey('services', cluster, profile, region, authMethod);
    serviceCache.delete(cacheKey);
  }

  clearTaskCache(cluster, service, profile, region, authMethod) {
    const taskCacheKey = getCacheKey('tasks', cluster, service, profile, region, authMethod);
    const taskDetailsCacheKey = getCacheKey('task_details', cluster, service, profile, region, authMethod);
    taskCache.delete(taskCacheKey);
    taskCache.delete(taskDetailsCacheKey);
  }
}

export default new ApiService();
