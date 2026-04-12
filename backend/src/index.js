require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

// ── WebSocket Server ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');
  ws.on('close', () => console.log('[WS] Client disconnected'));
  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});

function broadcast(type, data) {
  const payload = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: true })); // Allow all origins (mobile + web)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Attach wss and broadcast to every request for route handlers to use
app.use((req, res, next) => {
  req.wss = wss;
  req.broadcast = broadcast;
  next();
});

// ── Health endpoint ────────────────────────────────────────────────────────
app.get('/api/v1/health', (req, res) => {
  res.json({
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    }
  });
});

// ── RBAC: Extract user from JWT on every request ──────────────────────────
const { extractUser } = require('./middleware/rbac');
app.use(extractUser);

// ── Audit: Log all mutations (POST/PUT/PATCH/DELETE) with hash chaining ───
const { auditMiddleware } = require('./middleware/audit');
app.use(auditMiddleware);

// ── Route modules ──────────────────────────────────────────────────────────
const authRoutes        = require('./routes/auth');
const syncRoutes        = require('./routes/sync');
const routeRoutes       = require('./routes/routes');
const meshRoutes        = require('./routes/mesh');
const deliveryRoutes    = require('./routes/delivery');
const triageRoutes      = require('./routes/triage');
const predictionsRoutes = require('./routes/predictions');
const fleetRoutes       = require('./routes/fleet');
const p2pRoutes         = require('./routes/p2p');

app.use('/api/v1/auth',        authRoutes);        // Auth handles its own guards
app.use('/api/v1/sync',        syncRoutes);
app.use('/api/v1/p2p',         p2pRoutes);
app.use('/api/v1/routes',      routeRoutes);
app.use('/api/v1/mesh',        meshRoutes);
app.use('/api/v1/delivery',    deliveryRoutes);
app.use('/api/v1/triage',      triageRoutes);
app.use('/api/v1/predictions', predictionsRoutes);
app.use('/api/v1/fleet',       fleetRoutes);

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ── Start server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[Digital Delta] Backend running on port ${PORT}`);
  console.log(`[Digital Delta] Health: http://localhost:${PORT}/api/v1/health`);
  console.log(`[Digital Delta] WebSocket: ws://localhost:${PORT}`);
});

module.exports = { app, server, wss, broadcast };
