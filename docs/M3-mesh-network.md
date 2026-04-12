# Module 3 — Ad-Hoc Mesh Network Protocol (9 Points)

Devices autonomously form a store-and-forward mesh network to relay encrypted supply data across physical dead zones. No Wi-Fi router or cellular tower required for intra-mesh communication. All payloads are end-to-end encrypted — relay nodes are cryptographically incapable of reading message contents.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                     DEVICE A (Sender)                                │
│                                                                      │
│  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
│  │  mesh-crypto.ts  │   │  useMeshStore.ts  │   │  database.ts    │  │
│  │                  │   │                   │   │                 │  │
│  │  nacl.box()      │   │  Zustand store    │   │  expo-sqlite    │  │
│  │  encrypt with    │   │  sendMessage()    │   │  mesh_messages  │  │
│  │  B's public key  │   │  flushOutbox()    │   │  mesh_peers     │  │
│  │                  │   │  30s auto-flush   │   │  (offline cache)│  │
│  └────────┬─────────┘   └────────┬──────────┘   └───────┬─────────┘  │
│           │                      │                       │            │
│           └──────────────────────┴───────────────────────┘            │
│                                  │                                    │
│        1. Write to local SQLite FIRST (offline-first)                │
│        2. Attempt server relay (best-effort)                         │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │
                    /api/v1/mesh/send
                    (may fail if offline — message stays in local outbox)
                                   │
┌──────────────────────────────────┼───────────────────────────────────┐
│                    SERVER (Express + SQLite)                          │
│                  (just another relay node, NOT a controller)          │
│                                                                      │
│  ┌───────────────────┐   ┌────────────────────┐   ┌──────────────┐ │
│  │  mesh-service.js   │   │  mesh.js (routes)  │   │  SQLite      │ │
│  │                    │   │                    │   │              │ │
│  │  createMessage()   │   │  POST /send        │   │  mesh_msgs   │ │
│  │  relayMessage()    │   │  GET /inbox/:id    │   │  mesh_node   │ │
│  │  markDelivered()   │   │  POST /relay       │   │  _state      │ │
│  │  evaluateRole()    │   │  POST /ack         │   │              │ │
│  │  TTL + dedup       │   │  POST /heartbeat   │   │  Encrypted   │ │
│  │                    │   │  GET /peers        │   │  payload     │ │
│  └────────────────────┘   └────────────────────┘   │  (opaque)    │ │
│                                                     └──────────────┘ │
│         Server stores encrypted blob. CANNOT decrypt it.             │
│         Zero-knowledge relay.                                        │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │
                    /api/v1/mesh/inbox/:deviceId
                    (Device B polls or gets WebSocket push)
                                   │
┌──────────────────────────────────┼───────────────────────────────────┐
│                     DEVICE B (Recipient)                             │
│                                                                      │
│  ┌─────────────────┐   ┌──────────────────┐                        │
│  │  mesh-crypto.ts  │   │  useMeshStore.ts  │                        │
│  │                  │   │                   │                        │
│  │  nacl.box.open() │   │  checkInbox()     │                        │
│  │  decrypt with    │   │  decryptMsg()     │                        │
│  │  B's secret key  │   │  (fully offline)  │                        │
│  └─────────────────┘   └──────────────────┘                         │
│                                                                      │
│  Only Device B can decrypt. Device B's secret key never leaves      │
│  the device (stored in SecureStore / iOS Keychain).                  │
└──────────────────────────────────────────────────────────────────────┘
```

**Key principle:** The server is just another relay node. Messages are always written to local SQLite first. If the server is unreachable, messages queue locally and auto-flush every 30 seconds when connectivity returns. Encryption and decryption happen entirely on-device.

---

## M3.1 — Store-and-Forward Message Relay — 4 Points

### What It Does

Device A sends a message destined for Device C via Device B (relay node). The message must survive Device B going offline mid-relay and resume when B comes back online. TTL prevents infinite loops. Deduplication prevents message duplication on retry.

### How Store-and-Forward Works

```
Message Lifecycle:

  Device A creates message:
    id:        UUID (globally unique)
    target:    Device C
    payload:   encrypted ciphertext (opaque to all relays)
    ttl:       3 (max hops before expiry)
    hop_count: 0
    status:    'pending'
    expires:   now + 24 hours

  1. A writes message to LOCAL SQLite (instant, works offline)
  2. A attempts POST /mesh/send to server (best-effort)
     → If online: server stores message, broadcasts WebSocket notification
     → If offline: message stays in local outbox, auto-flush in 30s

  3. Device B (relay) picks up message:
     → POST /mesh/relay { message }
     → Server checks: TTL > 0? → YES → decrement TTL, increment hop_count
     → Server checks: duplicate ID? → NO → store and forward
     → Message now has: ttl=2, hop_count=1, relay_device_id=B

  4. Device B goes offline mid-relay:
     → Message persists in B's local SQLite (status='pending')
     → When B comes back online, auto-flush forwards it

  5. Device C polls /mesh/inbox/device-c:
     → Receives encrypted message
     → Decrypts locally with nacl.box.open()
     → ACKs to server: POST /mesh/ack { messageIds: [...] }
     → Server marks messages as 'delivered'
```

### TTL (Time-to-Live) Mechanism

```
TTL prevents infinite message loops in the mesh:

  Start:  ttl=3, hop_count=0
  Hop 1:  ttl=2, hop_count=1  (A → B)
  Hop 2:  ttl=1, hop_count=2  (B → C)
  Hop 3:  ttl=0, hop_count=3  (C → D, if needed)

  At ttl=0: message is NOT forwarded further
  → relayMessage() returns { relayed: false, reason: 'ttl_expired' }

  Additionally, messages expire after 24 hours regardless of TTL:
  → expireStaleMessages() runs as side-effect on inbox/relay requests
  → UPDATE mesh_messages SET status = 'expired' WHERE expires_at < now
```

### Deduplication

```
Every message has a UUID assigned at creation time.
At every node (server and device), deduplication happens:

  Server (mesh-service.js):
    SELECT id FROM mesh_messages WHERE id = ?
    → If exists: return { relayed: false, reason: 'duplicate' }
    → If not: INSERT and forward

  Device (database.ts):
    INSERT OR IGNORE INTO mesh_messages (id, ...)
    → SQLite PRIMARY KEY constraint rejects duplicates silently

This prevents:
  - Infinite loops (A→B→A→B→...)
  - Duplicate delivery on retry after network failure
  - Replay attacks
```

### Offline-First Write Pattern

```
Every message action follows the same pattern:

  1. Write to local SQLite FIRST (always succeeds)
  2. Attempt server call (may fail if offline)
  3. On failure: message stays in local queue
  4. Auto-flush interval (30 seconds) retries all pending messages

  useMeshStore.sendMessage():
    → db.insertMeshMessage(msg)           ← always works
    → api.post('/mesh/send', msg)         ← try server
       → catch: silently swallow error    ← offline is fine
    → loadLocalMessages()                 ← update UI from SQLite

  Auto-flush (every 30s):
    → flushOutbox()    ← push pending sends
    → checkInbox()     ← pull new messages
    → relayMessages()  ← forward relayable (if relay role)
```

### Database Schema

```sql
-- Server (backend/src/db/schema.sql)
CREATE TABLE IF NOT EXISTS mesh_messages (
  id TEXT PRIMARY KEY,                    -- UUID, used for deduplication
  source_device_id TEXT NOT NULL,         -- original sender
  target_device_id TEXT NOT NULL,         -- intended recipient
  relay_device_id TEXT,                   -- last relay node (null if direct)
  payload TEXT NOT NULL,                  -- encrypted ciphertext (base64)
  nonce TEXT,                             -- nacl.box nonce (base64, 24 bytes)
  sender_box_pub_key TEXT,               -- sender's x25519 public key (base64)
  ttl INTEGER NOT NULL DEFAULT 3,         -- hops remaining
  hop_count INTEGER NOT NULL DEFAULT 0,   -- hops taken
  status TEXT NOT NULL DEFAULT 'pending', -- pending | relayed | delivered | expired
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT                          -- auto-expire after 24h
);

-- Mobile (mobile/src/lib/database.ts) — same schema
-- Plus: mesh_peers table for caching peer encryption keys offline
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/services/mesh-service.js` | `createMessage()`, `getInbox()`, `relayMessage()`, `markDelivered()`, `getRelayableMessages()`, `expireStaleMessages()` |
| `backend/src/routes/mesh.js` | `POST /send`, `GET /inbox/:deviceId`, `POST /relay`, `POST /ack` |
| `mobile/src/lib/useMeshStore.ts` | `sendMessage()`, `checkInbox()`, `flushOutbox()`, `relayMessages()`, `loadLocalMessages()` |
| `mobile/src/lib/database.ts` | `insertMeshMessage()`, `getPendingOutbox()`, `getPendingInbox()`, `getRelayableMessages()`, `updateMeshMessageStatus()`, `meshMessageExists()`, `expireOldMeshMessages()` |

### API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/v1/mesh/send` | JWT | Send an encrypted message to a target device |
| `GET /api/v1/mesh/inbox/:deviceId` | JWT | Get pending messages (own inbox only) |
| `POST /api/v1/mesh/relay` | JWT | Relay a message to next hop (TTL decremented) |
| `POST /api/v1/mesh/ack` | JWT | Acknowledge receipt of messages (bulk) |

---

## M3.2 — Dual-Role Node Architecture — 3 Points

### What It Does

Each device dynamically acts as either Client or Relay based on proximity, battery, and signal strength heuristics. Role switching is automatic (no manual intervention) and every switch is logged to the hash-chained audit trail (M1.4).

### Role Switching Heuristics

```
Every 15 seconds, the device evaluates its role:

  evaluateRole(batteryLevel, signalStrength, connectedPeers):
    IF battery > 50% AND signal > 60% AND peers >= 2:
      role = 'relay'    ← Strong enough to forward for others
    ELSE:
      role = 'client'   ← Conserve resources, send/receive only

  Examples:
    battery=85%, signal=90%, peers=3  →  RELAY
    battery=30%, signal=40%, peers=1  →  CLIENT
    battery=70%, signal=80%, peers=1  →  CLIENT (peers < 2)
    battery=60%, signal=70%, peers=2  →  RELAY

  Thresholds are tunable constants at the top of useMeshStore.ts.
```

### What Changes With Role

```
CLIENT mode:
  - sendMessage()  ← send encrypted messages
  - checkInbox()   ← receive messages for this device
  - flushOutbox()  ← push pending local messages

RELAY mode (all of CLIENT plus):
  - relayMessages()  ← forward messages destined for OTHER devices
  - Store messages locally for offline relay nodes
  - Report relay statistics to server

  The auto-flush interval (30s) handles relay automatically:
    if (nodeRole === 'relay') await relayMessages();
```

### Audit Trail Integration

```
Every role switch is logged via:
  auditService.appendLog(deviceId, 'MESH_ROLE_SWITCH', 'mesh_nodes', {
    deviceId,
    fromRole: 'client',
    toRole: 'relay',
    reason: 'battery=85%, signal=90%, peers=3 — meets relay threshold'
  })

This creates a hash-chained audit entry (M1.4) that is:
  - Tamper-evident (SHA-256 hash chain)
  - Queryable via GET /api/v1/auth/audit?resource=mesh_nodes
  - Includes the exact metrics that triggered the switch
```

### Server-Side Heartbeat

```
POST /api/v1/mesh/heartbeat
Body: { batteryLevel: 0.85, signalStrength: 0.9, connectedPeers: 3 }

Server:
  1. Gets current node state (or defaults to 'client')
  2. Evaluates role heuristics with same algorithm as device
  3. Updates mesh_node_state table
  4. If role changed:
     → Logs MESH_ROLE_SWITCH to audit trail
     → Broadcasts mesh:role_switch via WebSocket
  5. Returns: { role, previousRole, switched, batteryLevel, signalStrength, connectedPeers }
```

### Database Schema

```sql
CREATE TABLE IF NOT EXISTS mesh_node_state (
  device_id TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'client',   -- 'client' or 'relay'
  battery_level REAL,                    -- 0.0 to 1.0
  signal_strength REAL,                  -- 0.0 to 1.0
  connected_peers INTEGER DEFAULT 0,
  last_heartbeat TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/services/mesh-service.js` | `evaluateRole()`, `updateNodeState()`, `getNodeState()`, `logRoleSwitch()` |
| `backend/src/routes/mesh.js` | `POST /heartbeat`, `GET /role/:deviceId` |
| `mobile/src/lib/useMeshStore.ts` | `updateRoleHeuristics()`, roleHistory state, 15s evaluation interval |
| `mobile/src/screens/MeshScreen.tsx` | Node Status card (role badge, battery, signal, peers), Role History card |

### API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/v1/mesh/heartbeat` | JWT | Report battery/signal/peers, get role evaluation |
| `GET /api/v1/mesh/role/:deviceId` | JWT | Get current mesh role for a device |

---

## M3.3 — End-to-End Message Encryption — 2 Points

### What It Does

All inter-node payloads are encrypted using the recipient's public key. Relay nodes are cryptographically incapable of reading message contents. This is demonstrable via packet inspection — the payload stored on the server and all relay nodes is opaque ciphertext.

### Why Not Ed25519?

```
M1.2 uses Ed25519 for SIGNING (authentication, non-repudiation).
Ed25519 is NOT designed for encryption.

M3.3 uses x25519 (Curve25519) for ENCRYPTION (confidentiality).
Same curve family, different purpose.

We generate a SEPARATE x25519 box keypair for each device:
  Ed25519  → nacl.sign    → "I wrote this message" (signature)
  x25519   → nacl.box     → "Only you can read this" (encryption)

This follows the same pattern as Signal Protocol (separate identity
and encryption keys) and avoids the need for ed2curve conversion.
```

### How nacl.box Encryption Works

```
nacl.box uses: Curve25519 (key exchange) + XSalsa20 (stream cipher) + Poly1305 (MAC)

Encryption (Device A → Device B):
  1. A generates random 24-byte nonce
  2. A computes shared secret: Curve25519(A.secretKey, B.publicKey)
  3. A encrypts: XSalsa20-Poly1305(plaintext, nonce, sharedSecret)
  4. Result: ciphertext (base64) + nonce (base64) + A's box public key

  encryptMessage(plaintext, recipientBoxPubKey, senderBoxSecretKey):
    nonce = nacl.randomBytes(24)
    ciphertext = nacl.box(message, nonce, recipientPubKey, senderSecretKey)
    return { ciphertext: base64(ciphertext), nonce: base64(nonce) }

Decryption (Device B):
  1. B computes same shared secret: Curve25519(B.secretKey, A.publicKey)
  2. B decrypts: XSalsa20-Poly1305.open(ciphertext, nonce, sharedSecret)
  3. Result: original plaintext

  decryptMessage(ciphertextB64, nonceB64, senderBoxPubKey, recipientBoxSecretKey):
    decrypted = nacl.box.open(ciphertext, nonce, senderPubKey, recipientSecretKey)
    return decrypted ? encodeUTF8(decrypted) : null

Relay node (Device C) CANNOT decrypt:
  C has its OWN secret key, not B's secret key
  nacl.box.open(ciphertext, nonce, A.publicKey, C.secretKey) → null
  The shared secret is DIFFERENT because C.secretKey != B.secretKey
```

### Key Registration

```
During device registration (POST /api/v1/auth/register):

  1. Device generates Ed25519 keypair (M1.2):    nacl.sign.keyPair()
  2. Device generates x25519 box keypair (M3.3):  nacl.box.keyPair()
  3. Both public keys sent to server:
     { deviceId, publicKey: ed25519Pub, boxPublicKey: x25519Pub }
  4. Server stores both in users table:
     users.public_key     = Ed25519 (for signature verification)
     users.box_public_key = x25519  (for mesh encryption lookup)
  5. Secret keys stored ONLY on device (SecureStore / Keychain)

For existing devices upgrading to M3:
  POST /api/v1/auth/register-box-key { boxPublicKey }
```

### Peer Discovery & Key Cache

```
GET /api/v1/mesh/peers
Returns all devices with box public keys:
  [
    { deviceId: "dev-agent-01", name: "Field Agent Hasan", role: "field_agent", boxPublicKey: "x25519..." },
    { deviceId: "dev-pilot-01", name: "Drone Pilot Mim", role: "drone_pilot", boxPublicKey: "x25519..." },
  ]

Device caches peers locally in mesh_peers SQLite table:
  → Works fully offline
  → Can encrypt for any cached peer without server access
  → Refreshed on each fetchAndCachePeers() call
```

### Zero-Knowledge Proof

```
To demonstrate that relay nodes CANNOT read message contents:

  1. Device A sends encrypted message to Device B
  2. Inspect mesh_messages table on the server:
     payload = "1WwV2OrMiHYaucCZRsJu5W2SA/kuIW8FDYv..."  ← opaque base64
  3. The server (relay) has:
     - A's box public key (sender_box_pub_key column)
     - The ciphertext (payload column)
     - The nonce (nonce column)
  4. The server does NOT have:
     - B's box SECRET key (only on B's device)
  5. Without B's secret key, nacl.box.open() returns null
  6. Therefore: relay nodes are cryptographically incapable of reading contents

  Verified in test:
    > const pairC = nacl.box.keyPair();  // relay's keys
    > nacl.box.open(ciphertext, nonce, pairA.publicKey, pairC.secretKey)
    null  ← CANNOT decrypt
```

### Files

| File | Purpose |
|------|---------|
| `mobile/src/lib/mesh-crypto.ts` | `generateBoxKeypair()`, `encryptMessage()`, `decryptMessage()`, `exportKeyBase64()`, `importKeyBase64()` |
| `mobile/src/lib/storage.ts` | `storeBoxKeypair()`, `loadBoxKeypair()` — SecureStore persistence |
| `mobile/src/lib/useAuthStore.ts` | Box keypair generation during `registerDevice()` |
| `backend/src/routes/auth.js` | `POST /register` (accepts `boxPublicKey`), `POST /register-box-key` |
| `backend/src/services/mesh-service.js` | `getBoxPublicKey()`, `getPeers()` |
| `backend/src/routes/mesh.js` | `GET /peers` |

### Library

`tweetnacl` — TweetNaCl.js, implements nacl.box (Curve25519-XSalsa20-Poly1305). Zero dependencies, audited, 6KB.

---

## Complete File Map

| File | Action | Module |
|------|--------|--------|
| `backend/src/services/mesh-service.js` | New | M3.1, M3.2, M3.3 |
| `backend/src/routes/mesh.js` | Replaced 501 stubs | M3.1, M3.2, M3.3 |
| `backend/src/routes/auth.js` | Modified | M3.3 |
| `backend/src/db/schema.sql` | Modified | M3.1, M3.2, M3.3 |
| `backend/src/db/seed.js` | Modified | Schema compat |
| `backend/src/db/reset.js` | Modified | Schema compat |
| `mobile/src/lib/mesh-crypto.ts` | New | M3.3 |
| `mobile/src/lib/useMeshStore.ts` | New | M3.1, M3.2 |
| `mobile/src/lib/database.ts` | Modified | M3.1 |
| `mobile/src/lib/storage.ts` | Modified | M3.3 |
| `mobile/src/lib/useAuthStore.ts` | Modified | M3.3 |
| `mobile/src/types/index.ts` | Modified | All |
| `mobile/src/screens/MeshScreen.tsx` | New | All |
| `mobile/App.tsx` | Modified | Nav |
| `mobile/src/screens/DashboardScreen.tsx` | Modified | Nav |

---

## Complete API Reference

| Endpoint | Method | Auth | Module | Description |
|----------|--------|------|--------|-------------|
| `/api/v1/mesh/send` | POST | JWT | M3.1 | Send encrypted message through mesh |
| `/api/v1/mesh/inbox/:deviceId` | GET | JWT | M3.1 | Get pending messages (own inbox only) |
| `/api/v1/mesh/relay` | POST | JWT | M3.1 | Relay message to next hop |
| `/api/v1/mesh/ack` | POST | JWT | M3.1 | Acknowledge receipt (bulk) |
| `/api/v1/mesh/peers` | GET | JWT | M3.3 | Get all peers with box public keys |
| `/api/v1/mesh/heartbeat` | POST | JWT | M3.2 | Report metrics, get role evaluation |
| `/api/v1/mesh/role/:deviceId` | GET | JWT | M3.2 | Get current mesh role |
| `/api/v1/auth/register` | POST | Public | M3.3 | Now accepts `boxPublicKey` field |
| `/api/v1/auth/register-box-key` | POST | JWT | M3.3 | Register box key for existing devices |

---

## How to Test

### Prerequisites

```bash
# 1. Reset and seed the database
cd backend
node src/db/reset.js
node src/db/seed.js

# 2. Start the backend server
node src/index.js
# → Server running on port 3001
```

### Test M3.1 — Store-and-Forward Message Relay

```bash
# Register two test devices
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-a","publicKey":"cHViQQ==","boxPublicKey":"Ym94QQ==","role":"field_agent","name":"Device A"}'

curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-b","publicKey":"cHViQg==","boxPublicKey":"Ym94Qg==","role":"field_agent","name":"Device B"}'

# Get JWTs (use OTP from server for testing)
OTP_A=$(curl -s http://localhost:3001/api/v1/auth/otp/test-a | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['code'])")
JWT_A=$(curl -s -X POST http://localhost:3001/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"test-a\",\"token\":\"$OTP_A\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

OTP_B=$(curl -s http://localhost:3001/api/v1/auth/otp/test-b | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['code'])")
JWT_B=$(curl -s -X POST http://localhost:3001/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d "{\"deviceId\":\"test-b\",\"token\":\"$OTP_B\"}" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# TEST 1: Send message A → B
curl -X POST http://localhost:3001/api/v1/mesh/send \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"targetDeviceId":"test-b","encryptedPayload":"ZW5jcnlwdGVk","nonce":"bm9uY2U=","senderBoxPubKey":"Ym94QQ==","ttl":3}'
# Expected: { "data": { "id": "...", "status": "pending", "ttl": 3, "hopCount": 0 } }

# TEST 2: Check B's inbox
curl http://localhost:3001/api/v1/mesh/inbox/test-b \
  -H "Authorization: Bearer $JWT_B"
# Expected: { "data": { "messages": [...], "count": 1 } }

# TEST 3: ACK the message
MSG_ID=$(curl -s http://localhost:3001/api/v1/mesh/inbox/test-b \
  -H "Authorization: Bearer $JWT_B" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['messages'][0]['id'])")
curl -X POST http://localhost:3001/api/v1/mesh/ack \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_B" \
  -d "{\"messageIds\":[\"$MSG_ID\"]}"
# Expected: { "data": { "acknowledged": 1 } }

# TEST 4: Relay with TTL decrement
curl -X POST http://localhost:3001/api/v1/mesh/relay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"message":{"id":"relay-001","sourceDeviceId":"test-b","targetDeviceId":"test-c","payload":"dGVzdA==","ttl":2,"hopCount":0}}'
# Expected: { "data": { "relayed": true, "ttlRemaining": 1, "hopCount": 1 } }

# TEST 5: Deduplication (same message ID)
curl -X POST http://localhost:3001/api/v1/mesh/relay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"message":{"id":"relay-001","sourceDeviceId":"test-b","targetDeviceId":"test-c","payload":"dGVzdA==","ttl":2,"hopCount":0}}'
# Expected: { "data": { "relayed": false, "reason": "duplicate" } }

# TEST 6: TTL expired
curl -X POST http://localhost:3001/api/v1/mesh/relay \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"message":{"id":"ttl-zero","sourceDeviceId":"x","targetDeviceId":"y","payload":"dGVzdA==","ttl":0,"hopCount":5}}'
# Expected: { "data": { "relayed": false, "reason": "ttl_expired" } }
```

### Test M3.2 — Dual-Role Node Architecture

```bash
# TEST 7: High metrics → relay role
curl -X POST http://localhost:3001/api/v1/mesh/heartbeat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"batteryLevel":0.85,"signalStrength":0.9,"connectedPeers":3}'
# Expected: { "data": { "role": "relay", "switched": true } }

# TEST 8: Low metrics → client role
curl -X POST http://localhost:3001/api/v1/mesh/heartbeat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"batteryLevel":0.3,"signalStrength":0.4,"connectedPeers":1}'
# Expected: { "data": { "role": "client", "switched": true } }

# TEST 9: Verify role switches in audit log
curl http://localhost:3001/api/v1/auth/audit?resource=mesh_nodes \
  -H "Authorization: Bearer $JWT_A"
# Expected: audit entries with action "MESH_ROLE_SWITCH"

# TEST 10: Get current role
curl http://localhost:3001/api/v1/mesh/role/test-a \
  -H "Authorization: Bearer $JWT_A"
# Expected: { "data": { "role": "client", "batteryLevel": 0.3, ... } }
```

### Test M3.3 — End-to-End Message Encryption

```bash
# TEST 11: Verify encryption end-to-end (run in Node.js)
node -e "
const nacl = require('tweetnacl');
const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = require('tweetnacl-util');

// Simulate Device A and Device B
const pairA = nacl.box.keyPair();
const pairB = nacl.box.keyPair();

// A encrypts for B
const plaintext = 'Emergency: 500 water bottles needed at Sunamganj Camp';
const nonce = nacl.randomBytes(24);
const ciphertext = nacl.box(decodeUTF8(plaintext), nonce, pairB.publicKey, pairA.secretKey);

console.log('Plaintext:', plaintext);
console.log('Ciphertext:', encodeBase64(ciphertext));
console.log('');

// B decrypts — should work
const decrypted = nacl.box.open(ciphertext, nonce, pairA.publicKey, pairB.secretKey);
console.log('B decrypts:', decrypted ? encodeUTF8(decrypted) : 'FAILED');

// C (relay node) tries to decrypt — should fail
const pairC = nacl.box.keyPair();
const wrongDecrypt = nacl.box.open(ciphertext, nonce, pairA.publicKey, pairC.secretKey);
console.log('C (relay) decrypts:', wrongDecrypt);
console.log('');
console.log(wrongDecrypt === null ? 'PASS: Zero-knowledge relay verified' : 'FAIL');
"
# Expected:
# B decrypts: Emergency: 500 water bottles needed at Sunamganj Camp
# C (relay) decrypts: null
# PASS: Zero-knowledge relay verified

# TEST 12: Verify peers endpoint returns box keys
curl http://localhost:3001/api/v1/mesh/peers \
  -H "Authorization: Bearer $JWT_A"
# Expected: array of peers with boxPublicKey field

# TEST 13: Register box key for existing device
curl -X POST http://localhost:3001/api/v1/auth/register-box-key \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_A" \
  -d '{"boxPublicKey":"bmV3Ym94a2V5"}'
# Expected: { "data": { "registered": true } }
```

### Test Offline Behavior (Mobile App)

```
1. Start the backend server and mobile app
2. Navigate to Dashboard → "Mesh Network" button
3. Select a peer and send a message
   → Should show "Message encrypted and queued"
   → Outbox should show message with "pending" status
4. Kill the backend server
5. Send another message
   → Should still succeed (queued locally)
   → Outbox shows 2 pending messages
6. Restart the backend server
7. Wait 30 seconds (auto-flush interval)
   → Pending messages should flush to server
   → Status should change to "relayed"
8. Check inbox on recipient device
   → Messages should appear
   → Tap to decrypt → plaintext visible
```

---

## BLE Transport Layer — True Offline Mesh (No Internet Required)

### Why BLE?

In a real flood zone there is no internet, no WiFi routers, no cell towers. The only thing that works is **Bluetooth** between the phones themselves. The transport abstraction layer decouples the mesh protocol from the communication mechanism:

```
useMeshStore.ts  ──>  TransportManager
                          │
                    ┌─────┴─────┐
                    │           │
              BleTransport  HttpTransport
              (real device)  (simulator / fallback)
```

### Transport Abstraction

**File**: `mobile/src/lib/mesh-transport.ts`

```typescript
interface MeshTransport {
  initialize(deviceId, boxPublicKey): Promise<void>
  sendMessage(msg): Promise<boolean>
  checkInbox(deviceId): Promise<MeshMessageRow[]>
  getPeers(): Promise<MeshPeer[]>
  relayMessage(msg, relayDeviceId): Promise<boolean>
  isAvailable(): boolean
  getType(): 'ble' | 'http'
}
```

**TransportManager** holds `[BleTransport, HttpTransport]`:
- `sendMessage()`: try BLE first for nearby peers, fall back to HTTP
- `checkInbox()`: merge results from both transports, deduplicate by message ID
- `getPeers()`: union BLE-discovered + HTTP-fetched peers
- On simulator: BLE `isAvailable()` = false, HTTP used seamlessly

### BLE Transport

**File**: `mobile/src/lib/ble-mesh.ts`

**Libraries**:
- `react-native-ble-plx` — Central mode: scan for peers, connect, read/write characteristics
- `react-native-ble-advertiser` — Peripheral mode: advertise presence so others can find us

**Custom BLE Service UUIDs**:
```
MESH_SERVICE_UUID:  0000DD01-0000-1000-8000-00805F9B34FB
DEVICE_INFO_CHAR:   0000DD02-...  (READ — deviceId + boxPublicKey)
MSG_WRITE_CHAR:     0000DD03-...  (WRITE — receive mesh messages)
```

**How it works**:
1. Each device **advertises** the mesh service UUID (via `react-native-ble-advertiser`)
2. Each device **scans** for nearby mesh peers (via `react-native-ble-plx`)
3. On discovery: connect, read device info, cache peer + RSSI + boxPublicKey
4. To send: connect to target peer, chunk message, write to characteristic
5. Prune peers not seen in 60 seconds

**Chunking Protocol** (for messages > BLE MTU):
```
Packet: [1 byte index][1 byte total][1 byte flags][N bytes data]
Default: 17 data bytes per chunk (MTU=20)
Negotiated: up to 509 data bytes per chunk (MTU=512)
```

### Dev Build Requirements

BLE requires native modules — Expo Go cannot be used. Build with EAS:

```bash
# For simulator testing (HTTP only, BLE gracefully unavailable):
eas build --profile development --platform ios

# For real device testing (BLE active):
eas build --profile development-device --platform ios
```

**Config**: `mobile/eas.json` defines both build profiles.

### BLE Files

| File | Purpose |
|------|---------|
| `mobile/src/lib/mesh-transport.ts` | Transport interface, HttpTransport, TransportManager |
| `mobile/src/lib/ble-mesh.ts` | BleTransport: advertising, scanning, chunking, peer discovery |
| `mobile/src/lib/useMeshStore.ts` | Refactored to use `transportManager` instead of direct `api` calls |
| `mobile/app.json` | BLE config plugins, iOS/Android permissions |
| `mobile/eas.json` | EAS dev build config |

### Testing BLE

```
1. Build dev client for two physical phones:
   eas build --profile development-device

2. Install on both phones

3. Open Mesh Network screen on both devices

4. TRANSPORT card should show "BLE" with "Direct Bluetooth" label

5. Peers should auto-discover each other (no manual IP entry!)

6. Send an encrypted message from Phone A to Phone B

7. Turn OFF the backend server — messages still deliver via BLE

8. Walk Phone B out of BLE range (~30m) — message queues locally

9. Walk back in range — message auto-delivers via BLE flush

10. The demo: "No internet. No server. No WiFi. Just Bluetooth."
```

---

## Offline-First Guarantees Summary

| Guarantee | How |
|-----------|-----|
| Send always works | Writes to local SQLite before server call |
| Decrypt is fully offline | nacl.box.open uses only local secret key |
| Peer keys cached locally | mesh_peers SQLite table survives offline |
| Role heuristics are local | No server call needed for client/relay switch |
| Auto-flush on reconnect | 30s interval retries pending messages |
| Relay persists offline | Relay nodes keep messages in local DB, forward when back |
| Dedup is local | INSERT OR IGNORE by message ID, no server needed |
| BLE works without infrastructure | Direct Bluetooth between phones, no WiFi/internet/server needed |
| Transport fallback | BLE first for nearby peers, HTTP when server available, local queue always |
