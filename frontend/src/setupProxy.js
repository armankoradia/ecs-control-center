const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  // Proxy REST endpoints
  app.use(
    ['/profiles', '/clusters', '/services', '/tasks', '/deploy', '/test-deploy', '/task_details', '/task_count', '/log-target', '/deployment_status', '/cluster_overview', '/auth_test'],
    createProxyMiddleware({
      target: 'http://backend:8000',
      changeOrigin: true,
      ws: false,
      logLevel: 'warn'
    })
  );

  // Proxy WebSocket endpoint
  app.use(
    '/ws',
    createProxyMiddleware({
      target: 'http://backend:8000',
      changeOrigin: true,
      ws: true,
      logLevel: 'warn'
    })
  );
};


