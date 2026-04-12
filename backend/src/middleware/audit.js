const auditService = require('../services/audit-service');

/**
 * Audit middleware — auto-logs every mutation (POST, PUT, PATCH, DELETE).
 * Intercepts res.json to capture after the response status is known.
 * Only logs successful responses (status < 400).
 */
function auditMiddleware(req, res, next) {
  // Only audit mutations, not reads
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Capture the original res.json to intercept the response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Log after sending response, only if successful
    if (res.statusCode < 400) {
      try {
        const userId = req.user ? req.user.userId : null;
        const action = req.method;
        const resource = req.originalUrl || req.url;
        const payload = req.body;

        auditService.appendLog(userId, action, resource, payload);
      } catch (err) {
        // Audit logging should never break the request
        console.error('[AUDIT] Failed to log:', err.message);
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = { auditMiddleware };
