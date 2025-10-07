// Simple in-memory cache with TTL support
class Cache {
  constructor(defaultTTL = 30000) { // 30 seconds default TTL
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  set(key, value, ttl = this.defaultTTL) {
    const expiresAt = Date.now() + ttl;
    this.cache.set(key, { value, expiresAt });
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  // Clean expired entries
  cleanup() {
    const now = Date.now();
    for (const [key, item] of this.cache.entries()) {
      if (now > item.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Create cache instances for different data types
export const clusterCache = new Cache(60000); // 1 minute
export const serviceCache = new Cache(30000); // 30 seconds
export const taskCache = new Cache(15000); // 15 seconds
export const overviewCache = new Cache(30000); // 30 seconds

// Cache key generators
export const getCacheKey = (...parts) => parts.filter(Boolean).join(':');

// Cleanup expired entries every 5 minutes
setInterval(() => {
  clusterCache.cleanup();
  serviceCache.cleanup();
  taskCache.cleanup();
  overviewCache.cleanup();
}, 300000);
