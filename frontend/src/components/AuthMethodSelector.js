import React, { useState, useEffect } from "react";
import axios from "axios";
import { API_BASE } from "../api";

function AuthMethodSelector({ authMethod, setAuthMethod, profile, region }) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const testAuthentication = async (method) => {
    setTesting(true);
    setTestResult(null);
    try {
      const response = await axios.get(`${API_BASE}/auth_test`, {
        params: { 
          profile: method === "profile" ? profile : "default", 
          region, 
          auth_method: method 
        }
      });
      setTestResult(response.data);
    } catch (err) {
      setTestResult({
        success: false,
        auth_method: method,
        error: err?.response?.data?.detail || err.message
      });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    if (authMethod && profile && region) {
      testAuthentication(authMethod);
    }
  }, [authMethod, profile, region]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
      <h3 className="font-bold text-gray-800 dark:text-gray-200 mb-3">Authentication Method</h3>
      
      <div className="space-y-3">
        <div className="flex items-center space-x-3">
          <input
            type="radio"
            id="profile-auth"
            name="authMethod"
            value="profile"
            checked={authMethod === "profile"}
            onChange={(e) => setAuthMethod(e.target.value)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />
          <label htmlFor="profile-auth" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            AWS Profile (Local Development)
          </label>
        </div>
        
        <div className="flex items-center space-x-3">
          <input
            type="radio"
            id="iam-role-auth"
            name="authMethod"
            value="iam_role"
            checked={authMethod === "iam_role"}
            onChange={(e) => setAuthMethod(e.target.value)}
            className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
          />
          <label htmlFor="iam-role-auth" className="text-sm font-medium text-gray-700 dark:text-gray-300">
            IAM Role (AWS Deployment)
          </label>
        </div>
      </div>

      {/* Test Results */}
      {testResult && (
        <div className="mt-4 p-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
          {testing && (
            <div className="flex items-center justify-center mb-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            </div>
          )}
          
          {testResult.success ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center text-green-600 dark:text-green-400">
                  <span className="mr-2 text-lg">✅</span>
                  <span className="text-base font-semibold">Authentication Successful</span>
                </div>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  <span className="text-sm mr-1">Details</span>
                  <svg
                    className={`w-4 h-4 transform transition-transform ${showDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              
              {showDetails && (
                <div className="text-sm text-gray-700 dark:text-gray-300 space-y-2 pt-2 border-t border-gray-200 dark:border-gray-600">
                  <div className="flex items-start">
                    <span className="font-bold text-gray-800 dark:text-gray-200 min-w-[80px]">Method:</span>
                    <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded text-xs">
                      {testResult.auth_method}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="font-bold text-gray-800 dark:text-gray-200 min-w-[80px]">Account:</span>
                    <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded text-xs">
                      {testResult.identity?.account}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="font-bold text-gray-800 dark:text-gray-200 min-w-[80px]">User ID:</span>
                    <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded text-xs break-all">
                      {testResult.identity?.user_id}
                    </span>
                  </div>
                  <div className="flex items-start">
                    <span className="font-bold text-gray-800 dark:text-gray-200 min-w-[80px]">ARN:</span>
                    <span className="ml-2 font-mono bg-gray-100 dark:bg-gray-600 px-2 py-1 rounded text-xs break-all">
                      {testResult.identity?.arn}
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center text-red-600 dark:text-red-400">
                  <span className="mr-2 text-lg">❌</span>
                  <span className="text-base font-semibold">Authentication Failed</span>
                </div>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className="flex items-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                >
                  <span className="text-sm mr-1">Details</span>
                  <svg
                    className={`w-4 h-4 transform transition-transform ${showDetails ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              
              {showDetails && (
                <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded border border-red-200 dark:border-red-800 pt-2 border-t border-gray-200 dark:border-gray-600">
                  <span className="font-bold">Error:</span> {testResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Help Text */}
      <div className="mt-4 text-sm text-gray-600 dark:text-gray-400 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
        <div className="font-bold text-gray-800 dark:text-gray-200 mb-2">When to use each method:</div>
        <div className="space-y-2">
          <div>
            <span className="font-bold text-blue-700 dark:text-blue-300">AWS Profile:</span> 
            <span className="ml-1">When running locally with AWS CLI configured profiles</span>
          </div>
          <div>
            <span className="font-bold text-blue-700 dark:text-blue-300">IAM Role:</span> 
            <span className="ml-1">When deployed on AWS (EC2, ECS, Lambda) with attached IAM roles</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AuthMethodSelector;
