import React from 'react';
import { useAuth } from '../contexts/AuthContext';

function UserProfile() {
  const { user, logout } = useAuth();

  if (!user) return null;

  return (
    <div className="flex items-center space-x-3 px-3 py-2 bg-secondary-50 rounded-lg border border-secondary-200 hover:bg-secondary-100 transition-colors group">
      <div className="flex-shrink-0">
        <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center shadow-md group-hover:shadow-lg transition-shadow">
          <span className="text-sm font-semibold text-white">
            {user.name ? user.name.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase()}
          </span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-secondary-900 truncate">
          {user.name || user.email}
        </p>
        <p className="text-xs text-secondary-500 truncate">
          {user.email}
        </p>
      </div>
      <button
        onClick={logout}
        className="flex-shrink-0 p-2 text-secondary-400 hover:text-secondary-600 hover:bg-secondary-200 rounded-lg transition-all duration-200"
        title="Sign out"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>
    </div>
  );
}

export default UserProfile;
