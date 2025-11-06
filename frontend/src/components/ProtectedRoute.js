import React from 'react';

function ProtectedRoute({ children }) {
  // In open source version, always allow access - no authentication required
  return children;
}

export default ProtectedRoute;
