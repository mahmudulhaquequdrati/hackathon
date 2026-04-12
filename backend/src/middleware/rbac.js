const authService = require('../services/auth-service');

// ──────────────────────────────────────────────────
// Permission Matrix
// 5 roles × 3 actions (read, write, execute)
// '*' = unrestricted, [] = specific resources allowed
// ──────────────────────────────────────────────────
const PERMISSIONS = {
  commander:   { read: '*', write: '*', execute: '*' },
  dispatcher:  { read: '*', write: ['supplies', 'deliveries', 'triage'], execute: ['routes'] },
  field_agent: { read: ['supplies', 'deliveries', 'nodes'], write: ['deliveries', 'pod_receipts'], execute: [] },
  drone_pilot: { read: ['routes', 'deliveries', 'nodes'], write: ['deliveries'], execute: ['fleet'] },
  observer:    { read: '*', write: [], execute: [] },
};

/**
 * Extract user from JWT and attach to req.user.
 * If no token is present, req.user stays null (doesn't block — use requireRole/requirePermission to block).
 */
function extractUser(req, res, next) {
  req.user = null;
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  try {
    const token = authHeader.split(' ')[1];
    const payload = authService.verifyToken(token);
    req.user = {
      userId: payload.userId,
      deviceId: payload.deviceId,
      role: payload.role,
      name: payload.name,
    };
  } catch {
    // Invalid/expired token — req.user stays null
  }
  next();
}

/**
 * Require the user to be authenticated.
 * Returns 401 if no valid JWT.
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Require the user to have one of the specified roles.
 * Must be used after extractUser + requireAuth.
 *
 * Usage: router.post('/preempt', requireRole('commander', 'dispatcher'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: req.user.role,
      });
    }
    next();
  };
}

/**
 * Require the user to have a specific permission (resource + action).
 * Checks against the PERMISSIONS matrix.
 *
 * Usage: router.post('/find-path', requirePermission('routes', 'execute'), handler)
 */
function requirePermission(resource, action) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const perms = PERMISSIONS[req.user.role];
    if (!perms) {
      return res.status(403).json({ error: 'Unknown role' });
    }
    const allowed = perms[action];
    if (allowed === '*' || (Array.isArray(allowed) && allowed.includes(resource))) {
      return next();
    }
    return res.status(403).json({
      error: 'Insufficient permissions',
      required: { resource, action },
      current: req.user.role,
    });
  };
}

module.exports = { extractUser, requireAuth, requireRole, requirePermission, PERMISSIONS };
