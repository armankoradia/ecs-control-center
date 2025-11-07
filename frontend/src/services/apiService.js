import axios from "axios";
import { API_BASE } from "../api";
import { clusterCache, serviceCache, taskCache, overviewCache, getCacheKey } from "../utils/cache";

// Create axios instance with optimized config
const apiClient = axios.create({
  timeout: 60000, // 60 second timeout (increased for large clusters)
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor removed for open source version - no authentication required

// Response interceptor for error handling
apiClient.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Check if we received HTML instead of JSON
    if (error.response && typeof error.response.data === 'string' && error.response.data.includes('<!DOCTYPE')) {
      const htmlError = new Error('Backend returned HTML instead of JSON. Check if backend is running on the correct port.');
      htmlError.isHtmlResponse = true;
      htmlError.originalError = error;
      return Promise.reject(htmlError);
    }
    
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
  async get(url, options = {}) {
    // Support POST via options.method
    if (options.method === 'POST' && options.data) {
      return apiClient.post(url, options.data);
    }
    return apiClient.get(url, options);
  }

  // Helper to add access key credentials to payload
  addCredentials(payload) {
    const akid = (localStorage.getItem('ecs-ak-id') || '').trim();
    const secret = (localStorage.getItem('ecs-ak-secret') || '').trim();
    const token = (localStorage.getItem('ecs-ak-token') || '').trim();
    if (akid) payload.aws_access_key_id = akid;
    if (secret) payload.aws_secret_access_key = secret;
    if (token) payload.aws_session_token = token;
    payload.auth_method = 'access_key';
    return payload;
  }
  // Clusters
  async getClusters(region, forceRefresh = false) {
    const cacheKey = getCacheKey('clusters', null, region, 'access_key');
    return cachedApiCall(
      clusterCache,
      cacheKey,
      () => {
        const payload = { region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/clusters`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Services
  async getServices(cluster, region, forceRefresh = false) {
    const cacheKey = getCacheKey('services', cluster, null, region, 'access_key');
    return cachedApiCall(
      serviceCache,
      cacheKey,
      () => {
        const payload = { cluster, region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/services`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Tasks
  async getTasks(cluster, service, region, forceRefresh = false) {
    const cacheKey = getCacheKey('tasks', cluster, service, null, region, 'access_key');
    return cachedApiCall(
      taskCache,
      cacheKey,
      () => {
        const payload = { cluster, service, region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/tasks`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Task Details
  async getTaskDetails(cluster, service, region, forceRefresh = false) {
    const cacheKey = getCacheKey('task_details', cluster, service, null, region, 'access_key');
    return cachedApiCall(
      taskCache,
      cacheKey,
      () => {
        const payload = { cluster, service, region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/task_details`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Cluster Overview
  async getClusterOverview(cluster, region, forceRefresh = false) {
    const cacheKey = getCacheKey('cluster_overview', cluster, null, region, 'access_key');
    return cachedApiCall(
      overviewCache,
      cacheKey,
      () => {
        const payload = { cluster, region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/cluster_overview`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Deployment Status
  async getDeploymentStatus(cluster, service, region) {
    // No caching for deployment status as it changes frequently
    const payload = { cluster, service, region };
    this.addCredentials(payload);
    return apiClient.post(`${API_BASE}/deployment_status`, payload).then(res => res.data);
  }

  // Deploy
  async deploy(cluster, service, containerName, region) {
    // Clear relevant caches after deployment
    const serviceCacheKey = getCacheKey('services', cluster, null, region, 'access_key');
    const taskCacheKey = getCacheKey('tasks', cluster, service, null, region, 'access_key');
    const overviewCacheKey = getCacheKey('cluster_overview', cluster, null, region, 'access_key');
    
    const payload = {
      cluster,
      service,
      container_name: containerName,
      region
    };
    this.addCredentials(payload);
    const result = await apiClient.post(`${API_BASE}/deploy`, payload).then(res => res.data);

    // Clear caches after successful deployment
    if (result && !result.error) {
      serviceCache.delete(serviceCacheKey);
      taskCache.delete(taskCacheKey);
      overviewCache.delete(overviewCacheKey);
    }

    return result;
  }

  // Deployment History
  async getDeploymentHistory(cluster = null, service = null, limit = 50, region = "us-east-1") {
    // Use POST for requests with credentials to avoid URL length issues
    const payload = {
      region,
      limit
    };
    if (cluster) payload.cluster = cluster;
    if (service) payload.service = service;
    this.addCredentials(payload);
    
    // Use POST to avoid URL length limits with credentials
    return await apiClient.post(`${API_BASE}/deployment_history`, payload).then(res => res.data);
  }

  async refreshDeploymentStatus(deploymentId, region) {
    const payload = {
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/deployment_history/${deploymentId}/refresh`, payload).then(res => res.data);
  }

  async getDeploymentDetails(deploymentId) {
    return await apiClient.get(`${API_BASE}/deployment_history/${deploymentId}`).then(res => res.data);
  }

  async rollbackDeployment(deploymentId, region) {
    const payload = {
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/rollback/${deploymentId}`, payload).then(res => res.data);
  }

  // Task Definition Management
  async getTaskDefinition(cluster, service, region) {
    // Use POST to avoid URL length limits with credentials
    const payload = {
      cluster,
      service,
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/task_definition`, payload).then(res => res.data);
  }

  async getServiceImageInfo(cluster, service, region) {
    // Use POST to avoid URL length limits with credentials
    const payload = {
      cluster,
      service,
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/service_image_info`, payload).then(res => res.data);
  }

  async updateTaskDefinition(updateData, region) {
    const payload = {
      ...updateData,
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/task_definition/update`, payload).then(res => res.data);
  }

  async updateTaskCount(cluster, service, desiredCount, region) {
    const payload = {
      cluster,
      service,
      desired_count: desiredCount,
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/service/update_count`, payload).then(res => res.data);
  }

  async forceNewDeployment(cluster, service, region) {
    const payload = {
      cluster,
      service,
      region
    };
    this.addCredentials(payload);
    
    return await apiClient.post(`${API_BASE}/service/force_new_deployment`, payload).then(res => res.data);
  }

  async getServiceEvents(cluster, service, region, forceRefresh = false) {
    const cacheKey = getCacheKey('service_events', cluster, service, region, 'access_key');
    return cachedApiCall(
      serviceCache,
      cacheKey,
      () => {
        const payload = { cluster, service, region };
        this.addCredentials(payload);
        return apiClient.post(`${API_BASE}/service/events`, payload).then(res => res.data);
      },
      forceRefresh
    );
  }

  // Auth Test
  async testAuth(region) {
    const payload = { region };
    this.addCredentials(payload);
    return apiClient.post(`${API_BASE}/auth_test`, payload).then(res => res.data);
  }

  // Clear all caches
  clearAllCaches() {
    clusterCache.clear();
    serviceCache.clear();
    taskCache.clear();
    overviewCache.clear();
  }

  // Clear specific caches
  clearClusterCache(region) {
    const cacheKey = getCacheKey('clusters', null, region, 'access_key');
    clusterCache.delete(cacheKey);
  }

  clearServiceCache(cluster, region) {
    const cacheKey = getCacheKey('services', cluster, null, region, 'access_key');
    serviceCache.delete(cacheKey);
  }

  clearTaskCache(cluster, service, region) {
    const taskCacheKey = getCacheKey('tasks', cluster, service, null, region, 'access_key');
    const taskDetailsCacheKey = getCacheKey('task_details', cluster, service, null, region, 'access_key');
    taskCache.delete(taskCacheKey);
    taskCache.delete(taskDetailsCacheKey);
  }
}

export default new ApiService();
