import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { API_BASE } from '../api';

function ProfileDebug() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [authTest, setAuthTest] = useState(null);

  const testProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('🔍 Testing /profiles endpoint...');
      const response = await axios.get(`${API_BASE}/profiles`);
      console.log('✅ Profiles response:', response.data);
      setProfiles(response.data);
    } catch (err) {
      console.error('❌ Profiles error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const testAuthTest = async () => {
    try {
      console.log('🔍 Testing /auth_test endpoint...');
      const response = await axios.get(`${API_BASE}/auth_test?profile=default&region=us-east-1&auth_method=profile`);
      console.log('✅ Auth test response:', response.data);
      setAuthTest(response.data);
    } catch (err) {
      console.error('❌ Auth test error:', err);
    }
  };

  const testBackendHealth = async () => {
    try {
      console.log('🔍 Testing backend health...');
      const response = await axios.get(`${API_BASE}/`);
      console.log('✅ Backend health response:', response.data);
    } catch (err) {
      console.error('❌ Backend health error:', err);
    }
  };

  useEffect(() => {
    testBackendHealth();
    testProfiles();
    testAuthTest();
  }, []);

  return (
    <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
      <h3 className="text-sm font-medium text-yellow-800 mb-2">Profile Debug</h3>
      
      <div className="space-y-2 text-sm">
        <div>
          <strong>API Base:</strong> {API_BASE}
        </div>
        
        <div>
          <strong>Profiles:</strong> 
          {loading ? 'Loading...' : (
            <pre className="mt-1 text-xs bg-white p-2 rounded border">
              {JSON.stringify(profiles, null, 2)}
            </pre>
          )}
        </div>
        
        <div>
          <strong>Auth Test:</strong>
          <pre className="mt-1 text-xs bg-white p-2 rounded border">
            {JSON.stringify(authTest, null, 2)}
          </pre>
        </div>
        
        {error && (
          <div className="text-red-600">
            <strong>Error:</strong> {error}
          </div>
        )}
        
        <div className="space-x-2">
          <button
            onClick={testProfiles}
            disabled={loading}
            className="px-3 py-1 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-700 disabled:opacity-50"
          >
            Test Profiles
          </button>
          
          <button
            onClick={testAuthTest}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
          >
            Test Auth
          </button>
          
          <button
            onClick={testBackendHealth}
            className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
          >
            Test Backend
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProfileDebug;
