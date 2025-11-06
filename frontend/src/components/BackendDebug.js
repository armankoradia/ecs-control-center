import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../api';

function BackendDebug() {
  const [backendStatus, setBackendStatus] = useState(null);
  const [profilesTest, setProfilesTest] = useState(null);
  const [clustersTest, setClustersTest] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const testBackendHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🔍 Testing backend health...');
      console.log('API Base URL:', API_BASE);
      
      const response = await axios.get(`${API_BASE}/`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      console.log('✅ Backend health response:', response);
      setBackendStatus({
        status: response.status,
        data: response.data,
        headers: response.headers
      });
    } catch (err) {
      console.error('❌ Backend health error:', err);
      setError({
        message: err.message,
        code: err.code,
        response: err.response ? {
          status: err.response.status,
          statusText: err.response.statusText,
          data: err.response.data,
          headers: err.response.headers
        } : null
      });
    } finally {
      setLoading(false);
    }
  };

  const testProfiles = async () => {
    try {
      console.log('🔍 Testing /profiles endpoint...');
      const response = await axios.get(`${API_BASE}/profiles`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      console.log('✅ Profiles response:', response);
      setProfilesTest({
        status: response.status,
        data: response.data,
        success: true
      });
    } catch (err) {
      console.error('❌ Profiles error:', err);
      setProfilesTest({
        success: false,
        error: {
          message: err.message,
          code: err.code,
          response: err.response ? {
            status: err.response.status,
            statusText: err.response.statusText,
            data: err.response.data
          } : null
        }
      });
    }
  };

  const testClusters = async () => {
    try {
      console.log('🔍 Testing /clusters endpoint...');
      
      // First get available profiles
      const profilesResponse = await axios.get(`${API_BASE}/profiles`);
      const profiles = profilesResponse.data;
      
      if (profiles.length === 0) {
        setClustersTest({
          success: false,
          error: {
            message: 'No AWS profiles available',
            code: 'NO_PROFILES'
          }
        });
        return;
      }
      
      // Use the first available profile
      const testProfile = profiles[0];
      console.log(`🔍 Using profile: ${testProfile}`);
      
      const response = await axios.get(`${API_BASE}/clusters?profile=${testProfile}&region=us-east-1&auth_method=profile`, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      console.log('✅ Clusters response:', response);
      setClustersTest({
        status: response.status,
        data: response.data,
        success: true,
        profileUsed: testProfile
      });
    } catch (err) {
      console.error('❌ Clusters error:', err);
      setClustersTest({
        success: false,
        error: {
          message: err.message,
          code: err.code,
          response: err.response ? {
            status: err.response.status,
            statusText: err.response.statusText,
            data: err.response.data
          } : null
        }
      });
    }
  };

  const testAllEndpoints = async () => {
    await testBackendHealth();
    await testProfiles();
    await testClusters();
  };

  useEffect(() => {
    testAllEndpoints();
  }, []);

  return (
    <div className="p-4 bg-red-50 border border-red-200 rounded-md">
      <h3 className="text-sm font-medium text-red-800 mb-2">Backend Connection Debug</h3>
      
      <div className="space-y-3 text-sm">
        <div>
          <strong>API Base URL:</strong> 
          <code className="ml-2 bg-gray-100 px-2 py-1 rounded text-xs">{API_BASE}</code>
        </div>
        
        <div>
          <strong>Backend Health:</strong>
          {loading ? (
            <span className="text-blue-600">Testing...</span>
          ) : (
            <pre className="mt-1 text-xs bg-white p-2 rounded border max-h-32 overflow-auto">
              {JSON.stringify(backendStatus, null, 2)}
            </pre>
          )}
        </div>
        
        <div>
          <strong>Profiles Test:</strong>
          <pre className="mt-1 text-xs bg-white p-2 rounded border max-h-32 overflow-auto">
            {JSON.stringify(profilesTest, null, 2)}
          </pre>
        </div>
        
        <div>
          <strong>Clusters Test:</strong>
          <pre className="mt-1 text-xs bg-white p-2 rounded border max-h-32 overflow-auto">
            {JSON.stringify(clustersTest, null, 2)}
          </pre>
        </div>
        
        {error && (
          <div className="text-red-600">
            <strong>Error Details:</strong>
            <pre className="mt-1 text-xs bg-white p-2 rounded border max-h-32 overflow-auto">
              {JSON.stringify(error, null, 2)}
            </pre>
          </div>
        )}
        
        <div className="space-x-2">
          <button
            onClick={testAllEndpoints}
            disabled={loading}
            className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test All'}
          </button>
          
          <button
            onClick={testBackendHealth}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            Test Backend
          </button>
          
          <button
            onClick={testProfiles}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
          >
            Test Profiles
          </button>
          
          <button
            onClick={testClusters}
            className="px-3 py-1 bg-purple-600 text-white rounded text-xs hover:bg-purple-700"
          >
            Test Clusters
          </button>
        </div>
      </div>
    </div>
  );
}

export default BackendDebug;
