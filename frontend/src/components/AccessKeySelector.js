import React, { useEffect, useState } from "react";

function AccessKeySelector({ visible, onSaved }) {
  const [accessKeyId, setAccessKeyId] = useState(() => localStorage.getItem('ecs-ak-id') || "");
  const [secretAccessKey, setSecretAccessKey] = useState(() => localStorage.getItem('ecs-ak-secret') || "");
  const [sessionToken, setSessionToken] = useState(() => localStorage.getItem('ecs-ak-token') || "");
  const [saved, setSaved] = useState(false);
  const [showSecurityWarning, setShowSecurityWarning] = useState(true);
  const [hasStoredCredentials, setHasStoredCredentials] = useState(false);

  useEffect(() => {
    // Check if credentials are already stored
    const hasCreds = !!(localStorage.getItem('ecs-ak-id') && localStorage.getItem('ecs-ak-secret'));
    setHasStoredCredentials(hasCreds);
  }, []);

  const handleSubmit = () => {
    const ak = (accessKeyId || '').trim();
    const sk = (secretAccessKey || '').trim();
    const st = (sessionToken || '').trim();
    if (ak) {
      localStorage.setItem('ecs-ak-id', ak);
      localStorage.setItem('ecs-ak-id-ts', Date.now().toString()); // Store timestamp
    } else {
      localStorage.removeItem('ecs-ak-id');
      localStorage.removeItem('ecs-ak-id-ts');
    }
    if (sk) {
      localStorage.setItem('ecs-ak-secret', sk);
      localStorage.setItem('ecs-ak-secret-ts', Date.now().toString());
    } else {
      localStorage.removeItem('ecs-ak-secret');
      localStorage.removeItem('ecs-ak-secret-ts');
    }
    if (st) {
      localStorage.setItem('ecs-ak-token', st);
      localStorage.setItem('ecs-ak-token-ts', Date.now().toString());
    } else {
      localStorage.removeItem('ecs-ak-token');
      localStorage.removeItem('ecs-ak-token-ts');
    }
    setHasStoredCredentials(!!(ak && sk));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    // Dispatch custom event to notify AuthMethodSelector
    window.dispatchEvent(new Event('ecs-ak-saved'));
    if (onSaved) onSaved();
  };

  const handleClearCredentials = () => {
    if (window.confirm('Are you sure you want to clear all stored credentials? This action cannot be undone.')) {
      localStorage.removeItem('ecs-ak-id');
      localStorage.removeItem('ecs-ak-secret');
      localStorage.removeItem('ecs-ak-token');
      localStorage.removeItem('ecs-ak-id-ts');
      localStorage.removeItem('ecs-ak-secret-ts');
      localStorage.removeItem('ecs-ak-token-ts');
      setAccessKeyId("");
      setSecretAccessKey("");
      setSessionToken("");
      setHasStoredCredentials(false);
      window.dispatchEvent(new Event('ecs-ak-saved'));
      if (onSaved) onSaved();
    }
  };

  const getCredentialAge = () => {
    const timestamp = localStorage.getItem('ecs-ak-id-ts');
    if (!timestamp) return null;
    const ageMs = Date.now() - parseInt(timestamp);
    const hours = Math.floor(ageMs / (60 * 60 * 1000));
    return hours;
  };

  if (!visible) return null;

  const credentialAge = getCredentialAge();

  return (
    <div className="card">
      <label className="block text-sm font-semibold text-secondary-900 mb-3 flex items-center">
        <svg className="w-4 h-4 mr-2 text-secondary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
        </svg>
        Access Key Credentials
      </label>
      
      {/* Security Warning */}
      {showSecurityWarning && (
        <div className="mb-4 p-3 bg-warning-50 border border-warning-200 rounded-lg">
          <div className="flex items-start justify-between">
            <div className="flex items-start">
              <svg className="w-5 h-5 text-warning-600 mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="flex-1">
                <p className="text-xs font-semibold text-warning-900 mb-1">Security Notice</p>
                <ul className="text-xs text-warning-800 space-y-1 list-disc list-inside">
                  <li>Credentials are stored in your browser's local storage (isolated per user)</li>
                  <li>Do not use on shared computers or public browsers</li>
                  <li>Ensure HTTPS is enabled in production environments</li>
                  <li>Credentials are sent to the backend with each API request</li>
                  <li>Backend does not persist credentials - they are used per-request only</li>
                </ul>
              </div>
            </div>
            <button
              onClick={() => setShowSecurityWarning(false)}
              className="text-warning-600 hover:text-warning-800 ml-2 flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Credential Age Warning */}
      {hasStoredCredentials && credentialAge !== null && credentialAge > 24 && (
        <div className="mb-4 p-3 bg-info-50 border border-info-200 rounded-lg">
          <div className="flex items-center">
            <svg className="w-5 h-5 text-info-600 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-info-800">
              Credentials have been stored for {credentialAge} hours. Consider refreshing them for security.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-secondary-700 mb-1.5">AWS Access Key ID</label>
          <input 
            type="text"
            value={accessKeyId} 
            onChange={e => setAccessKeyId(e.target.value)} 
            className="input-field text-sm" 
            placeholder="AKIA..." 
            style={{ 
              minWidth: '100%',
              textOverflow: 'clip',
              overflowX: 'auto',
              whiteSpace: 'nowrap'
            }}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-700 mb-1.5">AWS Secret Access Key</label>
          <input 
            type="password" 
            value={secretAccessKey} 
            onChange={e => setSecretAccessKey(e.target.value)} 
            className="input-field" 
            placeholder="••••••" 
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-secondary-700 mb-1.5">
            AWS Session Token <span className="text-secondary-500 font-normal">(optional)</span>
          </label>
          <input 
            type="password" 
            value={sessionToken} 
            onChange={e => setSessionToken(e.target.value)} 
            className="input-field" 
            placeholder="Optional session token" 
          />
        </div>
        <div className="pt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button onClick={handleSubmit} className="btn-primary text-sm py-2 px-4">
              Save Credentials
            </button>
            {saved && (
              <span className="text-xs text-accent-600 font-medium flex items-center">
                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Saved
              </span>
            )}
          </div>
          {hasStoredCredentials && (
            <button 
              onClick={handleClearCredentials} 
              className="btn-secondary text-sm py-2 px-4 text-danger-600 hover:text-danger-700 hover:bg-danger-50"
              title="Clear all stored credentials"
            >
              <svg className="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccessKeySelector;


