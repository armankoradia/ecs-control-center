import React, { createContext, useContext } from 'react';

const AuthContext = createContext();

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  // Mock user for open source version - no authentication required
  const mockUser = {
    name: "ECS DeployMate User",
    email: "user@ecsdeploymate.com",
    sub: "open-source-user"
  };

  const value = {
    user: mockUser,
    isAuthenticated: true, // Always authenticated in open source version
    loading: false, // No loading needed
    accessDenied: false,
    accessDeniedMessage: '',
    login: () => {
      console.log('Login not required in open source version');
    },
    logout: () => {
      console.log('Logout not required in open source version');
    }
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
