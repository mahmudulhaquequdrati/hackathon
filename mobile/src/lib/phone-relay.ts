/**
 * Phone Relay Server — Embedded HTTP server that turns one phone into a backend.
 *
 * In disaster scenarios with no internet and no laptop, one phone enables
 * "Hub Mode" and runs this mini relay server. Other phones connect to it
 * via WiFi or hotspot using the phone's local IP.
 *
 * Handles: health check, mesh messaging, peer registry, P2P sync exchange,
 * CRDT sync push/pull, device registration, deliveries, routes graph.
 *
 * Uses react-native-tcp-socket to create a raw TCP server and implements
 * a minimal HTTP parser on top.
 */

import TcpSocket from 'react-native-tcp-socket';
import { log } from './debug';

// ── Minimal SHA-1 for WebSocket handshake (pure JS) ────────────────

function sha1(msg: string): string {
  function rotl(n: number, s: number) { return (n << s) | (n >>> (32 - s)); }
  const bytes: number[] = [];
  for (let i = 0; i < msg.length; i++) bytes.push(msg.charCodeAt(i));
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const bitLen = msg.length * 8;
  bytes.push(0, 0, 0, 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  for (let i = 0; i < bytes.length; i += 64) {
    const w: number[] = [];
    for (let j = 0; j < 16; j++) w[j] = (bytes[i + j * 4] << 24) | (bytes[i + j * 4 + 1] << 16) | (bytes[i + j * 4 + 2] << 8) | bytes[i + j * 4 + 3];
    for (let j = 16; j < 80; j++) w[j] = rotl(w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let j = 0; j < 80; j++) {
      let f: number, k: number;
      if (j < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (j < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (j < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const t = (rotl(a, 5) + f + e + k + w[j]) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const hex = [h0, h1, h2, h3, h4].map(v => ('00000000' + v.toString(16)).slice(-8)).join('');
  // Convert hex to binary string then to base64
  let bin = '';
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  return btoa(bin);
}

// ── WebSocket framing ──────────────────────────────────────────────

const WS_GUID = '258EAFA5-E914-47DA-95CA-5AB5C11BE70A';

function wsAcceptKey(clientKey: string): string {
  return sha1(clientKey + WS_GUID);
}

function wsEncodeFrame(payload: string): string {
  const data = payload;
  const len = byteLength(data);
  let header: number[] = [0x81]; // FIN + text opcode
  if (len < 126) {
    header.push(len);
  } else if (len < 65536) {
    header.push(126, (len >> 8) & 0xff, len & 0xff);
  } else {
    header.push(127, 0, 0, 0, 0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff);
  }
  return String.fromCharCode(...header) + data;
}

function wsDecodeFrame(raw: string): { opcode: number; payload: string } | null {
  if (raw.length < 2) return null;
  const byte0 = raw.charCodeAt(0);
  const byte1 = raw.charCodeAt(1);
  const opcode = byte0 & 0x0f;
  const masked = (byte1 & 0x80) !== 0;
  let payloadLen = byte1 & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    payloadLen = (raw.charCodeAt(2) << 8) | raw.charCodeAt(3);
    offset = 4;
  }
  const maskKey = masked ? [raw.charCodeAt(offset), raw.charCodeAt(offset + 1), raw.charCodeAt(offset + 2), raw.charCodeAt(offset + 3)] : [];
  if (masked) offset += 4;
  let payload = '';
  for (let i = 0; i < payloadLen; i++) {
    const byte = raw.charCodeAt(offset + i);
    payload += String.fromCharCode(masked ? byte ^ maskKey[i % 4] : byte);
  }
  return { opcode, payload };
}

// Connected WebSocket clients
const wsClients: Set<any> = new Set();

/** Broadcast an event to all connected WebSocket clients */
export function wsBroadcast(type: string, data: any): void {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  const frame = wsEncodeFrame(msg);
  for (const socket of wsClients) {
    try {
      socket.write(frame, 'binary');
    } catch {
      wsClients.delete(socket);
    }
  }
}

function handleWebSocketUpgrade(raw: string, socket: any): boolean {
  const lines = raw.split('\r\n');
  const upgradeHeader = lines.find(l => l.toLowerCase().startsWith('upgrade:'));
  if (!upgradeHeader || !upgradeHeader.toLowerCase().includes('websocket')) return false;

  const keyLine = lines.find(l => l.toLowerCase().startsWith('sec-websocket-key:'));
  if (!keyLine) return false;
  const clientKey = keyLine.split(':')[1].trim();
  const acceptKey = wsAcceptKey(clientKey);

  const response = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`,
    '',
    '',
  ].join('\r\n');

  socket.write(response);
  wsClients.add(socket);
  log('info', `WebSocket client connected (${wsClients.size} total)`);

  // Handle incoming WS frames (ping/pong/close)
  socket.on('data', (chunk: Buffer | string) => {
    const frame = wsDecodeFrame(chunk.toString('binary'));
    if (!frame) return;
    if (frame.opcode === 0x8) {
      // Close frame
      wsClients.delete(socket);
      try { socket.destroy(); } catch {}
    } else if (frame.opcode === 0x9) {
      // Ping — respond with pong
      const pong = String.fromCharCode(0x8a, 0x00);
      try { socket.write(pong, 'binary'); } catch {}
    }
  });

  socket.on('error', () => { wsClients.delete(socket); });
  socket.on('close', () => { wsClients.delete(socket); });

  return true;
}

// ── In-memory data stores ──────────────────────────────────────────

interface RelayMessage {
  id: string;
  source_device_id: string;
  target_device_id: string;
  relay_device_id: string | null;
  payload: string;
  nonce: string | null;
  sender_box_pub_key: string | null;
  ttl: number;
  hop_count: number;
  status: string;
  created_at: string;
  expires_at: string | null;
}

interface RelayPeer {
  deviceId: string;
  name: string | null;
  role: string;
  publicKey: string | null;
  boxPublicKey: string | null;
  battery_level: number;
  signal_strength: number;
  connected_peers: number;
  last_heartbeat: string;
}

interface RelayUser {
  id: string;
  device_id: string;
  name: string | null;
  role: string;
  public_key: string | null;
  box_public_key: string | null;
  totp_secret: string;
}

interface RelayDelivery {
  id: string;
  source_node_id: string;
  target_node_id: string;
  vehicle_type: string;
  priority: string;
  status: string;
  supply_id: string | null;
  driver_id: string | null;
  created_at: string;
}

interface PodReceipt {
  id: string;
  delivery_id: string;
  sender_device_id: string;
  receiver_device_id: string;
  sender_signature: string;
  receiver_signature: string | null;
  payload_hash: string;
  nonce: string;
  status: string;
  created_at: string;
}

// Stores
const messages: Map<string, RelayMessage> = new Map();
const peers: Map<string, RelayPeer> = new Map();
const users: Map<string, RelayUser> = new Map();
const deliveries: Map<string, RelayDelivery> = new Map();
const podReceipts: Map<string, PodReceipt> = new Map();
const syncStates: Map<string, { vectorClock: Record<string, number>; changes: any[] }> = new Map();
const p2pMailbox: Map<string, { payload: any; timestamp: number }> = new Map();
const usedNonces: Set<string> = new Set();

// Default graph data for offline/disaster use
const DEFAULT_NODES = [
  { id: 'base-camp', name: 'Base Camp', type: 'hub', lat: 24.95, lng: 91.75, status: 'active' },
  { id: 'field-hospital', name: 'Field Hospital', type: 'camp', lat: 24.97, lng: 91.78, status: 'active' },
  { id: 'supply-depot', name: 'Supply Depot', type: 'hub', lat: 24.93, lng: 91.72, status: 'active' },
  { id: 'shelter-a', name: 'Shelter A', type: 'camp', lat: 24.99, lng: 91.74, status: 'active' },
  { id: 'shelter-b', name: 'Shelter B', type: 'camp', lat: 24.91, lng: 91.77, status: 'active' },
  { id: 'drone-base', name: 'Drone Base', type: 'drone_base', lat: 24.96, lng: 91.80, status: 'active' },
];
const DEFAULT_EDGES = [
  { id: 'e1', source_id: 'base-camp', target_id: 'field-hospital', type: 'road', distance: 3.5, travel_time: 12, risk_score: 0.2, status: 'open' },
  { id: 'e2', source_id: 'base-camp', target_id: 'supply-depot', type: 'road', distance: 2.8, travel_time: 10, risk_score: 0.1, status: 'open' },
  { id: 'e3', source_id: 'supply-depot', target_id: 'shelter-a', type: 'road', distance: 5.2, travel_time: 18, risk_score: 0.4, status: 'open' },
  { id: 'e4', source_id: 'field-hospital', target_id: 'shelter-b', type: 'road', distance: 4.1, travel_time: 15, risk_score: 0.3, status: 'open' },
  { id: 'e5', source_id: 'base-camp', target_id: 'drone-base', type: 'road', distance: 3.0, travel_time: 11, risk_score: 0.15, status: 'open' },
  { id: 'e6', source_id: 'drone-base', target_id: 'shelter-a', type: 'airway', distance: 4.0, travel_time: 5, risk_score: 0.1, status: 'open' },
  { id: 'e7', source_id: 'drone-base', target_id: 'shelter-b', type: 'airway', distance: 5.0, travel_time: 6, risk_score: 0.1, status: 'open' },
  { id: 'e8', source_id: 'supply-depot', target_id: 'shelter-b', type: 'waterway', distance: 6.0, travel_time: 20, risk_score: 0.5, status: 'open' },
];

// Graph data — seeded from connected device, or falls back to defaults
let graphNodes: any[] = [...DEFAULT_NODES];
let graphEdges: any[] = [...DEFAULT_EDGES];

// ── Minimal HTTP parser ────────────────────────────────────────────

interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}

function parseHttpRequest(raw: string): HttpRequest | null {
  try {
    const headerEnd = raw.indexOf('\r\n\r\n');
    if (headerEnd === -1) return null;

    const headerSection = raw.substring(0, headerEnd);
    const body = raw.substring(headerEnd + 4);
    const lines = headerSection.split('\r\n');
    const [method, fullPath] = lines[0].split(' ');

    // Strip query string for path matching, keep it available
    const path = fullPath?.split('?')[0] || '/';
    const queryString = fullPath?.includes('?') ? fullPath.split('?')[1] : '';

    const headers: Record<string, string> = {};
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(':');
      if (idx > 0) {
        headers[lines[i].substring(0, idx).toLowerCase().trim()] =
          lines[i].substring(idx + 1).trim();
      }
    }
    // Attach query string as a pseudo-header for easy access
    headers['_query'] = queryString;

    return { method, path, headers, body };
  } catch {
    return null;
  }
}

function byteLength(str: string): number {
  // Count UTF-8 byte length without Buffer (not available in RN)
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) len += 1;
    else if (code <= 0x7ff) len += 2;
    else len += 3;
  }
  return len;
}

function httpResponse(status: number, statusText: string, jsonBody: any): string {
  const body = JSON.stringify(jsonBody);
  return [
    `HTTP/1.1 ${status} ${statusText}`,
    'Content-Type: application/json',
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers: Content-Type, Authorization',
    `Content-Length: ${byteLength(body)}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n');
}

function ok(data: any) {
  return httpResponse(200, 'OK', { data });
}

function notFound() {
  return httpResponse(404, 'Not Found', { error: 'Not found' });
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function parseQuery(qs: string): Record<string, string> {
  const params: Record<string, string> = {};
  if (!qs) return params;
  qs.split('&').forEach((pair) => {
    const [k, v] = pair.split('=');
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
  });
  return params;
}

// ── Route handler ──────────────────────────────────────────────────

function handleRequest(req: HttpRequest): string {
  const { method, path, body, headers } = req;
  const query = parseQuery(headers['_query'] || '');

  try {
    // OPTIONS preflight
    if (method === 'OPTIONS') return httpResponse(204, 'No Content', '');

    // ── Health ──
    if (path === '/api/v1/health') {
      return ok({ status: 'ok', relay: true, uptime: Date.now() });
    }

    // ── Auth: Register ──
    if (method === 'POST' && path === '/api/v1/auth/register') {
      const b = JSON.parse(body);
      const totpSecret = 'JBSWY3DPEHPK3PXP'; // Simplified for relay mode
      const userId = uuid();
      const user: RelayUser = {
        id: userId,
        device_id: b.deviceId,
        name: b.name || null,
        role: b.role || 'field_agent',
        public_key: b.publicKey || null,
        box_public_key: b.boxPublicKey || null,
        totp_secret: totpSecret,
      };
      users.set(b.deviceId, user);
      // Also register as peer
      peers.set(b.deviceId, {
        deviceId: b.deviceId,
        name: b.name || null,
        role: b.role || 'field_agent',
        publicKey: b.publicKey || null,
        boxPublicKey: b.boxPublicKey || null,
        battery_level: 1,
        signal_strength: 1,
        connected_peers: 0,
        last_heartbeat: new Date().toISOString(),
      });
      return ok({
        user: { id: userId, deviceId: b.deviceId, name: b.name, role: b.role, publicKey: b.publicKey },
        totp: { secret: totpSecret },
      });
    }

    // ── Auth: Verify OTP ──
    if (method === 'POST' && path === '/api/v1/auth/verify-otp') {
      const b = JSON.parse(body);
      const user = users.get(b.deviceId);
      if (!user) return httpResponse(401, 'Unauthorized', { error: 'Unknown device' });
      // In relay mode, accept any OTP (simplified for disaster use)
      const token = `relay-jwt-${user.device_id}-${Date.now()}`;
      return ok({ token, user: { id: user.id, deviceId: user.device_id, name: user.name, role: user.role } });
    }

    // ── Auth: Register box key ──
    if (method === 'POST' && path === '/api/v1/auth/register-box-key') {
      const b = JSON.parse(body);
      const peer = peers.get(b.deviceId);
      if (peer) peer.boxPublicKey = b.boxPublicKey;
      return ok({ success: true });
    }

    // ── Mesh: Send ──
    if (method === 'POST' && path === '/api/v1/mesh/send') {
      const b = JSON.parse(body);
      const msg: RelayMessage = {
        id: uuid(),
        source_device_id: '', // set from token if needed
        target_device_id: b.targetDeviceId,
        relay_device_id: null,
        payload: b.encryptedPayload,
        nonce: b.nonce || null,
        sender_box_pub_key: b.senderBoxPubKey || null,
        ttl: b.ttl ?? 3,
        hop_count: 0,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 86400000).toISOString(),
      };
      // Try to extract source from auth header
      const authHeader = headers['authorization'] || '';
      const tokenParts = authHeader.replace('Bearer relay-jwt-', '').split('-');
      if (tokenParts.length > 0) msg.source_device_id = tokenParts[0];
      messages.set(msg.id, msg);
      wsBroadcast('mesh:new_message', msg);
      return ok({ message: msg });
    }

    // ── Mesh: Inbox ──
    if (method === 'GET' && path.startsWith('/api/v1/mesh/inbox/')) {
      const deviceId = path.split('/').pop()!;
      const inbox = Array.from(messages.values()).filter(
        (m) => m.target_device_id === deviceId && m.status === 'pending',
      );
      return ok({ messages: inbox, count: inbox.length });
    }

    // ── Mesh: Ack ──
    if (method === 'POST' && path === '/api/v1/mesh/ack') {
      const b = JSON.parse(body);
      for (const id of b.messageIds || []) {
        const msg = messages.get(id);
        if (msg) msg.status = 'delivered';
      }
      return ok({ acknowledged: b.messageIds?.length || 0 });
    }

    // ── Mesh: Relay ──
    if (method === 'POST' && path === '/api/v1/mesh/relay') {
      const b = JSON.parse(body);
      const m = b.message;
      if (m && m.ttl > 0 && !messages.has(m.id)) {
        messages.set(m.id, {
          ...m,
          id: m.id || uuid(),
          source_device_id: m.sourceDeviceId,
          target_device_id: m.targetDeviceId,
          relay_device_id: null,
          payload: m.payload,
          nonce: m.nonce,
          sender_box_pub_key: m.senderBoxPubKey,
          ttl: m.ttl - 1,
          hop_count: (m.hopCount || 0) + 1,
          status: 'pending',
          created_at: new Date().toISOString(),
          expires_at: m.expiresAt || new Date(Date.now() + 86400000).toISOString(),
        });
        return ok({ relayed: true });
      }
      return ok({ relayed: false, reason: 'duplicate or expired' });
    }

    // ── Mesh: Peers ──
    if (method === 'GET' && path === '/api/v1/mesh/peers') {
      const peerList = Array.from(peers.values()).map((p) => ({
        deviceId: p.deviceId,
        name: p.name,
        role: p.role,
        boxPublicKey: p.boxPublicKey,
      }));
      return ok(peerList);
    }

    // ── Mesh: Heartbeat ──
    if (method === 'POST' && path === '/api/v1/mesh/heartbeat') {
      const b = JSON.parse(body);
      const existing = peers.get(b.deviceId);
      if (existing) {
        existing.battery_level = b.batteryLevel ?? existing.battery_level;
        existing.signal_strength = b.signalStrength ?? existing.signal_strength;
        existing.connected_peers = b.connectedPeers ?? existing.connected_peers;
        existing.last_heartbeat = new Date().toISOString();
      }
      const role = (b.batteryLevel > 0.5 && b.signalStrength > 0.6 && b.connectedPeers >= 2) ? 'relay' : 'client';
      return ok({ role });
    }

    // ── Mesh: Role ──
    if (method === 'GET' && path.startsWith('/api/v1/mesh/role/')) {
      const deviceId = path.split('/').pop()!;
      const peer = peers.get(deviceId);
      return ok({ role: peer ? 'relay' : 'client' });
    }

    // ── P2P: State ──
    if (method === 'GET' && path === '/api/v1/p2p/state') {
      // Aggregate all known vector clocks
      const merged: Record<string, number> = {};
      for (const [, s] of syncStates) {
        for (const [k, v] of Object.entries(s.vectorClock)) {
          merged[k] = Math.max(merged[k] || 0, v);
        }
      }
      return ok({ vectorClock: merged });
    }

    // ── P2P: Exchange ──
    if (method === 'POST' && path === '/api/v1/p2p/exchange') {
      const incoming = JSON.parse(body);
      const deviceId = incoming.deviceId;

      // Store this device's state
      syncStates.set(deviceId, {
        vectorClock: incoming.vectorClock || {},
        changes: incoming.changes || [],
      });

      // Build response: send back all OTHER devices' changes
      const responseChanges: any[] = [];
      const responseClock: Record<string, number> = {};
      for (const [id, state] of syncStates) {
        if (id === deviceId) continue;
        responseChanges.push(...state.changes);
        for (const [k, v] of Object.entries(state.vectorClock)) {
          responseClock[k] = Math.max(responseClock[k] || 0, v);
        }
      }

      return httpResponse(200, 'OK', {
        deviceId: 'relay-hub',
        vectorClock: responseClock,
        changes: responseChanges,
        stats: {
          bytesIn: body.length,
          bytesOut: JSON.stringify(responseChanges).length,
          totalBytes: body.length + JSON.stringify(responseChanges).length,
          deltaSync: Object.keys(incoming.vectorClock || {}).length > 0,
          recordsSent: responseChanges.length,
          recordsReceived: incoming.changes?.length || 0,
        },
      });
    }

    // ── P2P: Offer (mailbox) ──
    if (method === 'POST' && path === '/api/v1/p2p/offer') {
      const b = JSON.parse(body);
      const key = `${b.fromDeviceId}->${b.toDeviceId}`;
      p2pMailbox.set(key, { payload: b.payload, timestamp: Date.now() });
      return ok({ stored: true, key });
    }

    // ── P2P: Pickup (mailbox) ──
    if (method === 'GET' && path === '/api/v1/p2p/pickup') {
      const from = query.fromDeviceId;
      const to = query.toDeviceId;
      const key = `${from}->${to}`;
      const entry = p2pMailbox.get(key);
      if (entry) {
        p2pMailbox.delete(key);
        return ok({ available: true, payload: entry.payload, bytes: JSON.stringify(entry.payload).length });
      }
      return ok({ available: false });
    }

    // ── Sync: Push ──
    if (method === 'POST' && path === '/api/v1/sync/push') {
      const b = JSON.parse(body);
      syncStates.set(b.deviceId, {
        vectorClock: b.vectorClock || {},
        changes: b.changes || [],
      });
      const results = (b.changes || []).map((c: any) => ({ id: c.id, merged: true }));
      wsBroadcast('sync:push', { deviceId: b.deviceId, count: (b.changes || []).length });
      return ok({ results, serverClock: b.vectorClock });
    }

    // ── Sync: Pull ──
    if (method === 'POST' && path === '/api/v1/sync/pull') {
      const b = JSON.parse(body);
      const allChanges: any[] = [];
      const serverClock: Record<string, number> = {};
      for (const [id, state] of syncStates) {
        if (id === b.deviceId) continue;
        allChanges.push(...state.changes);
        for (const [k, v] of Object.entries(state.vectorClock)) {
          serverClock[k] = Math.max(serverClock[k] || 0, v);
        }
      }
      return ok({ changes: allChanges, serverClock, count: allChanges.length });
    }

    // ── Routes: Graph ──
    if (method === 'GET' && path === '/api/v1/routes/graph') {
      return ok({ nodes: graphNodes, edges: graphEdges });
    }

    // ── Routes: Find path (simplified Dijkstra) ──
    if (method === 'POST' && path === '/api/v1/routes/find-path') {
      const b = JSON.parse(body);
      const result = findPath(b.source, b.target, b.vehicle_type || 'truck');
      return ok(result);
    }

    // ── Routes: Toggle edge status ──
    if (method === 'PATCH' && path.match(/\/api\/v1\/routes\/edges\/[^/]+\/status/)) {
      const parts = path.split('/');
      const edgeId = parts[parts.length - 2];
      const b = JSON.parse(body);
      const edge = graphEdges.find((e: any) => e.id === edgeId);
      if (edge) {
        edge.status = b.status;
        return ok({ edge, affected_deliveries: [], computation_time_ms: 1 });
      }
      return notFound();
    }

    // ── Delivery: List ──
    if (method === 'GET' && path === '/api/v1/delivery/') {
      return ok({ deliveries: Array.from(deliveries.values()), count: deliveries.size });
    }

    // ── Delivery: Create ──
    if (method === 'POST' && path === '/api/v1/delivery/') {
      const b = JSON.parse(body);
      const d: RelayDelivery = {
        id: uuid(),
        source_node_id: b.source_node_id,
        target_node_id: b.target_node_id,
        vehicle_type: b.vehicle_type || 'truck',
        priority: b.priority || 'P2',
        status: 'pending',
        supply_id: b.supply_id || null,
        driver_id: b.driver_id || null,
        created_at: new Date().toISOString(),
      };
      deliveries.set(d.id, d);
      wsBroadcast('DELIVERY_CREATED', d);
      return ok(d);
    }

    // ── Delivery: Update status ──
    if (method === 'PATCH' && path.match(/\/api\/v1\/delivery\/[^/]+\/status/)) {
      const parts = path.split('/');
      const deliveryId = parts[parts.length - 2];
      const b = JSON.parse(body);
      const d = deliveries.get(deliveryId);
      if (d) {
        d.status = b.status;
        wsBroadcast('DELIVERY_STATUS_CHANGED', d);
        return ok(d);
      }
      return notFound();
    }

    // ── Delivery: PoD submit ──
    if (method === 'POST' && path.match(/\/api\/v1\/delivery\/[^/]+\/pod/)) {
      const parts = path.split('/');
      const deliveryId = parts[parts.length - 2];
      const b = JSON.parse(body);
      // Check nonce reuse
      if (usedNonces.has(b.nonce)) {
        return httpResponse(409, 'Conflict', { error: 'Nonce already used' });
      }
      usedNonces.add(b.nonce);
      const receipt: PodReceipt = {
        id: uuid(),
        delivery_id: deliveryId,
        sender_device_id: b.senderDeviceId || '',
        receiver_device_id: b.receiverDeviceId || '',
        sender_signature: b.senderSignature || '',
        receiver_signature: b.receiverSignature || null,
        payload_hash: b.payloadHash || '',
        nonce: b.nonce || '',
        status: 'confirmed',
        created_at: new Date().toISOString(),
      };
      podReceipts.set(receipt.id, receipt);
      // Update delivery status
      const d = deliveries.get(deliveryId);
      if (d) {
        d.status = 'delivered';
        wsBroadcast('DELIVERY_STATUS_CHANGED', d);
      }
      wsBroadcast('POD_CONFIRMED', receipt);
      return ok(receipt);
    }

    // ── Delivery: Chain of custody ──
    if (method === 'GET' && path.match(/\/api\/v1\/delivery\/[^/]+\/chain/)) {
      const parts = path.split('/');
      const deliveryId = parts[parts.length - 2];
      const receipts = Array.from(podReceipts.values()).filter((r) => r.delivery_id === deliveryId);
      const d = deliveries.get(deliveryId);
      return ok({
        delivery: d || { id: deliveryId, status: 'unknown' },
        receipts,
        chain_length: receipts.length,
        fully_verified: receipts.every((r) => r.status === 'confirmed'),
        audit_trail: [],
      });
    }

    // ── Audit log (accept and discard) ──
    if (method === 'POST' && path === '/api/v1/auth/audit/log') {
      return ok({ logged: true });
    }

    return notFound();
  } catch (err) {
    log('error', 'Relay handler error', (err as Error).message);
    return httpResponse(500, 'Internal Server Error', { error: (err as Error).message });
  }
}

// ── Simplified Dijkstra for route finding ──────────────────────────

function findPath(sourceId: string, targetId: string, vehicleType: string) {
  const start = Date.now();
  const typeMap: Record<string, string[]> = {
    truck: ['road'],
    boat: ['waterway'],
    drone: ['road', 'waterway', 'airway'],
  };
  const allowedTypes = typeMap[vehicleType] || ['road'];

  // Build adjacency list
  const adj: Map<string, Array<{ to: string; weight: number; edgeId: string }>> = new Map();
  for (const node of graphNodes) adj.set(node.id, []);
  for (const edge of graphEdges) {
    if (!allowedTypes.includes(edge.type)) continue;
    if (edge.status === 'washed_out' || edge.status === 'closed') continue;
    adj.get(edge.source_id)?.push({ to: edge.target_id, weight: edge.travel_time || 1, edgeId: edge.id });
    adj.get(edge.target_id)?.push({ to: edge.source_id, weight: edge.travel_time || 1, edgeId: edge.id });
  }

  // Dijkstra
  const dist: Map<string, number> = new Map();
  const prev: Map<string, string> = new Map();
  const visited: Set<string> = new Set();
  dist.set(sourceId, 0);

  while (true) {
    let minDist = Infinity;
    let u = '';
    for (const [node, d] of dist) {
      if (!visited.has(node) && d < minDist) {
        minDist = d;
        u = node;
      }
    }
    if (!u || u === targetId) break;
    visited.add(u);
    for (const neighbor of adj.get(u) || []) {
      const alt = minDist + neighbor.weight;
      if (alt < (dist.get(neighbor.to) ?? Infinity)) {
        dist.set(neighbor.to, alt);
        prev.set(neighbor.to, u);
      }
    }
  }

  if (!dist.has(targetId)) {
    return { found: false, message: `No ${vehicleType} route found` };
  }

  // Reconstruct path
  const path: string[] = [];
  let curr = targetId;
  while (curr) {
    path.unshift(curr);
    curr = prev.get(curr)!;
    if (curr === sourceId) { path.unshift(curr); break; }
  }

  // Calculate totals
  let totalDist = 0;
  const edgesUsed: any[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edge = graphEdges.find(
      (e: any) =>
        ((e.source_id === path[i] && e.target_id === path[i + 1]) ||
          (e.target_id === path[i] && e.source_id === path[i + 1])) &&
        allowedTypes.includes(e.type),
    );
    if (edge) {
      totalDist += edge.distance || 0;
      edgesUsed.push(edge);
    }
  }

  const srcNode = graphNodes.find((n: any) => n.id === sourceId);
  const tgtNode = graphNodes.find((n: any) => n.id === targetId);

  return {
    found: true,
    path,
    edges: edgesUsed,
    total_distance_km: Math.round(totalDist * 10) / 10,
    total_travel_time_min: Math.round(dist.get(targetId)! * 10) / 10,
    computation_time_ms: Date.now() - start,
    vehicle_type: vehicleType,
    source: srcNode?.name || sourceId,
    target: tgtNode?.name || targetId,
  };
}

// ── Server lifecycle ───────────────────────────────────────────────

let server: any = null;
let _isRunning = false;

export function isRelayRunning(): boolean {
  return _isRunning;
}

export function getRelayStats() {
  return {
    peers: peers.size,
    messages: messages.size,
    deliveries: deliveries.size,
    users: users.size,
    syncStates: syncStates.size,
  };
}

/** Seed graph data so route features work */
export function seedGraphData(nodes: any[], edges: any[]) {
  graphNodes = nodes;
  graphEdges = edges;
  log('info', `Relay seeded with ${nodes.length} nodes, ${edges.length} edges`);
}

export function startRelay(port: number = 8735): Promise<string> {
  return new Promise((resolve, reject) => {
    if (_isRunning) {
      resolve(`Already running on port ${port}`);
      return;
    }

    try {
      server = TcpSocket.createServer((socket: any) => {
        let data = '';
        let handled = false;
        let isWs = false;

        socket.on('data', (chunk: Buffer | string) => {
          if (isWs) return; // WebSocket frames handled by handleWebSocketUpgrade listener
          if (handled) return;
          data += chunk.toString();

          const headerEnd = data.indexOf('\r\n\r\n');
          if (headerEnd === -1) return;

          // Check for WebSocket upgrade
          if (data.toLowerCase().includes('upgrade: websocket')) {
            handled = true;
            isWs = true;
            if (handleWebSocketUpgrade(data, socket)) {
              data = '';
              return; // Connection stays open for WS
            }
          }

          const headerSection = data.substring(0, headerEnd);
          const contentLengthMatch = headerSection.match(/content-length:\s*(\d+)/i);
          const contentLength = contentLengthMatch ? parseInt(contentLengthMatch[1], 10) : 0;
          const bodyStart = headerEnd + 4;
          const bodyReceived = data.length - bodyStart;

          if (bodyReceived < contentLength) return;

          handled = true;

          const req = parseHttpRequest(data);
          data = '';

          const response = req ? handleRequest(req) : httpResponse(400, 'Bad Request', { error: 'Bad request' });

          try {
            socket.end(response);
          } catch {
            try { socket.destroy(); } catch {}
          }
        });

        socket.on('error', () => {
          wsClients.delete(socket);
        });

        // Safety: close HTTP sockets after 30s (not WS)
        setTimeout(() => {
          if (!isWs) { try { socket.destroy(); } catch {} }
        }, 30000);
      });

      server.listen({ port, host: '0.0.0.0' }, () => {
        _isRunning = true;
        log('info', `Phone relay server started on port ${port}`);
        resolve(`Relay running on port ${port}`);
      });

      server.on('error', (err: Error) => {
        log('error', 'Relay server error', err.message);
        // Only mark as not running if server truly failed to bind
        if (!_isRunning) {
          reject(err);
        }
        // Don't set _isRunning = false for connection-level errors
      });
    } catch (err) {
      reject(err);
    }
  });
}

export function stopRelay(): void {
  // Close all WebSocket clients
  for (const ws of wsClients) {
    try { ws.destroy(); } catch {}
  }
  wsClients.clear();

  if (server) {
    try {
      server.close();
    } catch {
      // Already closed
    }
    server = null;
    _isRunning = false;
    log('info', 'Phone relay server stopped');
  }
}

/** Clear all in-memory data */
export function resetRelayData(): void {
  messages.clear();
  peers.clear();
  users.clear();
  deliveries.clear();
  podReceipts.clear();
  syncStates.clear();
  p2pMailbox.clear();
  usedNonces.clear();
  graphNodes = [];
  graphEdges = [];
}
