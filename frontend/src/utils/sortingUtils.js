/**
 * Extract environment from service/cluster name
 * Supports patterns like: *-dev-*, *-prod-*, *-qa-*, *-staging-*
 * @param {string} name - Service or cluster name
 * @returns {string} - Environment name (dev, prod, qa, staging, or 'other' if not matched)
 */
export const extractEnvironment = (name) => {
  if (!name) return 'other';
  
  const lowerName = name.toLowerCase();
  
  // Check for environment patterns
  if (lowerName.includes('-dev-') || lowerName.includes('-dev')) return 'dev';
  if (lowerName.includes('-prod-') || lowerName.includes('-prod')) return 'prod';
  if (lowerName.includes('-qa-') || lowerName.includes('-qa')) return 'qa';
  if (lowerName.includes('-staging-') || lowerName.includes('-staging')) return 'staging';
  
  return 'other';
};

/**
 * Sort items by environment priority and alphabetically within each environment
 * @param {string[]} items - Array of service/cluster names
 * @returns {string[]} - Sorted array
 */
export const sortByEnvironment = (items) => {
  if (!items || items.length === 0) return [];
  
  // Define environment priority
  const envPriority = {
    dev: 0,
    qa: 1,
    staging: 2,
    prod: 3,
    other: 4
  };
  
  return [...items].sort((a, b) => {
    const envA = extractEnvironment(a);
    const envB = extractEnvironment(b);
    
    // First, sort by environment priority
    const priorityDiff = (envPriority[envA] || 4) - (envPriority[envB] || 4);
    if (priorityDiff !== 0) return priorityDiff;
    
    // Within same environment, sort alphabetically
    return a.localeCompare(b);
  });
};

/**
 * Group items by environment
 * @param {string[]} items - Array of service/cluster names
 * @returns {Object} - Object with environment as key and sorted array as value
 */
export const groupByEnvironment = (items) => {
  if (!items || items.length === 0) return {};
  
  const grouped = {};
  
  items.forEach(item => {
    const env = extractEnvironment(item);
    if (!grouped[env]) {
      grouped[env] = [];
    }
    grouped[env].push(item);
  });
  
  // Sort items within each environment alphabetically
  Object.keys(grouped).forEach(env => {
    grouped[env].sort((a, b) => a.localeCompare(b));
  });
  
  return grouped;
};

/**
 * Get display name for environment group with icons and styling
 * @param {string} env - Environment name
 * @returns {string} - Display name
 */
export const getEnvironmentDisplayName = (env) => {
  const displayNames = {
    dev: '🔧 Development',
    qa: '✓ QA',
    staging: '→ Staging',
    prod: '⚡ Production',
    other: '◇ Other'
  };
  
  return displayNames[env] || `◇ ${env}`;
};

/**
 * Get color classes for environment group header
 * @param {string} env - Environment name
 * @returns {object} - Object with bg, text, and border classes
 */
export const getEnvironmentColorClasses = (env) => {
  const colorMap = {
    dev: {
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      border: 'border-blue-200',
      badge: 'badge-info'
    },
    qa: {
      bg: 'bg-yellow-50',
      text: 'text-yellow-900',
      border: 'border-yellow-200',
      badge: 'badge-warning'
    },
    staging: {
      bg: 'bg-purple-50',
      text: 'text-purple-900',
      border: 'border-purple-200',
      badge: 'badge-secondary'
    },
    prod: {
      bg: 'bg-red-50',
      text: 'text-red-900',
      border: 'border-red-200',
      badge: 'badge-danger'
    },
    other: {
      bg: 'bg-secondary-50',
      text: 'text-secondary-900',
      border: 'border-secondary-200',
      badge: 'badge-secondary'
    }
  };
  
  return colorMap[env] || colorMap.other;
};

/**
 * Get order for environment groups for display (alphabetically: dev, other, prod, qa, staging)
 * @returns {Object} - Map of environment to display order
 */
export const getEnvironmentOrder = () => {
  return {
    dev: 0,      // dev first (alphabetically)
    other: 1,    // other
    prod: 2,     // prod
    qa: 3,       // qa
    staging: 4   // staging last
  };
};