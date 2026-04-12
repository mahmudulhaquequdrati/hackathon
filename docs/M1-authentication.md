# Module 1 — Secure Authentication & Identity Management (9 Points)

Offline-first authentication system with zero-trust identity. No third-party OAuth. Every device is cryptographically self-sovereign.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        DEVICE (Browser)                          │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────────┐    │
│  │  Ed25519     │  │  TOTP        │  │  IndexedDB (Dexie)  │    │
│  │  Keypair     │  │  Generator   │  │                     │    │
│  │  (crypto.ts) │  │  (totp.ts)   │  │  keypairs table     │    │
│  │              │  │              │  │  totpSecrets table   │    │
│  │  sign()      │  │  generate()  │  │                     │    │
│  │  verify()    │  │  verify()    │  │  Persists across    │    │
│  │              │  │  countdown() │  │  browser sessions    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬──────────┘    │
│         │                 │                      │               │
│         └────────┬────────┘                      │               │
│                  │                               │               │
│         ┌────────▼────────┐              ┌───────▼──────────┐   │
│         │  useAuthStore   │◄────────────►│  Zustand State   │   │
│         │  (Zustand)      │              │  user, token,    │   │
│         │                 │              │  publicKey,      │   │
│         │  registerDevice │              │  totpSecret,     │   │
│         │  verifyOtp      │              │  isAuthenticated │   │
│         │  hasPermission  │              └──────────────────┘   │
│         └────────┬────────┘                                      │
│                  │                                               │
└──────────────────┼───────────────────────────────────────────────┘
                   │  /api/v1/auth/*
                   │  (online) or local verify (offline)
┌──────────────────┼───────────────────────────────────────────────┐
│                  ▼           SERVER (Express)                    │
│                                                                  │
│  ┌──────────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  extractUser     │──►│  requireRole │──►│  Route Handler │  │
│  │  (JWT decode)    │   │  requirePerm │   │                │  │
│  │  Global middle.  │   │  Per-route   │   │  auth-service  │  │
│  └──────────────────┘   └──────────────┘   └───────┬────────┘  │
│                                                     │           │
│                              ┌───────────────────────┘          │
│                              ▼                                   │
│  ┌──────────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │  audit middle.   │──►│  audit-svc   │──►│  SQLite        │  │
│  │  Auto-logs all   │   │  Hash chain  │   │  users table   │  │
│  │  POST/PUT/PATCH  │   │  SHA-256     │   │  audit_log     │  │
│  └──────────────────┘   └──────────────┘   └────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## M1.1 — Mobile OTP Generation (TOTP/HOTP) — 3 Points

### What It Does

Generates 6-digit one-time passwords that rotate every 30 seconds, entirely offline. Implements RFC 6238 (TOTP).

### How TOTP Works

```
Both device and server share a secret (base32 string, e.g. "HKORX5OK3E2SNV5...")
This secret is generated once during registration and never changes.

Every 30 seconds, a new code is computed:

  counter = floor(unix_timestamp / 30)

  code = HMAC-SHA1(secret, counter)  →  take last 6 digits  →  "847291"

Because both sides know the secret and the current time,
they independently compute the same 6-digit code.
No network required.

Timeline:
  ──────|────────|────────|────────|────────
     30s      30s      30s      30s
  847291   153628   430701   992145   381067
```

### Secret Lifecycle

```
1. POST /api/v1/auth/register
   Server generates random 20-byte secret → base32 encode
   Server stores in users.totp_secret
   Server returns secret to device (ONE-TIME transfer)

2. Device stores secret in IndexedDB (Dexie totpSecrets table)
   Secret persists across browser sessions

3. From now on:
   - Device generates codes locally (no server needed)
   - Server verifies codes independently
   - Window tolerance: ±1 period (accepts current, previous, next code)
```

### JWT After Verification

```
POST /api/v1/auth/verify-otp { deviceId, token: "847291" }

Server:
  1. Load TOTP secret from users table
  2. Compute expected code for current time window
  3. Compare → if match:
     Issue JWT = { userId, deviceId, role, name, exp: 24h }
  4. Return { token: "eyJ...", user: { id, role, ... } }

Browser:
  1. Store JWT in localStorage
  2. Attach to all future API calls: Authorization: Bearer <jwt>
```

### Offline Fallback

```
When server is unreachable:
  1. Browser tries POST /verify-otp → network error
  2. Catches error → falls back to LOCAL verification
  3. Loads TOTP secret from IndexedDB
  4. Computes HMAC-SHA1(secret, floor(time/30)) locally
  5. Compares with entered code
  6. If match → sets isAuthenticated = true (no JWT, but app works)
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/services/auth-service.js` | `generateTotpSecret()`, `verifyTotp()`, `generateCurrentTotp()`, `issueToken()`, `verifyToken()` |
| `backend/src/routes/auth.js` | `POST /register` (auto-generates TOTP), `POST /verify-otp` (returns JWT), `GET /otp/:deviceId` (demo) |
| `frontend/src/lib/totp.ts` | `generateOtp(secret)`, `verifyOtp(secret, token)`, `getTimeRemaining()` |
| `frontend/src/lib/useAuthStore.ts` | `verifyOtp()` (online + offline fallback), `refreshOtp()`, `loadTotpSecret()` |
| `frontend/src/screens/LoginScreen.tsx` | Two-step UI: Register → OTP entry with 30s countdown |

### API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `POST /api/v1/auth/register` | Public | Register device + auto-generate TOTP secret |
| `POST /api/v1/auth/verify-otp` | Public | Verify OTP code, return JWT |
| `GET /api/v1/auth/otp/:deviceId` | Public | Get current code (demo/testing only) |

### Library

`otpauth` — RFC 6238/4226 implementation, works in Node.js and browser, zero native deps.

---

## M1.2 — Asymmetric Key Pair Provisioning (Ed25519) — 3 Points

### What It Does

Every device gets a unique Ed25519 cryptographic identity. The private key never leaves the device. The public key is shared with the server and other devices for signature verification.

### How Ed25519 Works

```
Key Generation (tweetnacl.sign.keyPair()):
  publicKey:  32 bytes  → share freely with anyone
  secretKey:  64 bytes  → NEVER leaves this device

Signing:
  message = "Deliver 50 units of antivenom to Sunamganj"
  signature = Ed25519.sign(message, secretKey)
  → 64 bytes, unique to this message + this key

Verification (anyone with publicKey):
  Ed25519.verify(message, signature, publicKey)
  → true  (authentic, untampered)
  → false (tampered message OR wrong key)
```

### Storage Model

```
┌─ Browser (IndexedDB / Dexie) ───────────────────────┐
│  keypairs table:                                     │
│  ┌─────────────────────────────────────────────────┐ │
│  │ deviceId:   "a1b2c3d4-..."                      │ │
│  │ publicKey:  "V7vnPdVM6maXzN..." (base64)        │ │
│  │ secretKey:  "Vxfjr4KtpVmeZh..." (base64)        │ │
│  │ createdAt:  "2026-04-12T10:00:00.000Z"          │ │
│  └─────────────────────────────────────────────────┘ │
│  The secretKey NEVER goes over the network.          │
└──────────────────────────────────────────────────────┘

┌─ Server (SQLite users table) ───────────────────────┐
│  users.public_key = base64 encoded Ed25519 pubkey    │
│  No secret key stored on server.                     │
│  Server can VERIFY signatures, not CREATE them.      │
└──────────────────────────────────────────────────────┘
```

### Registration Flow

```
Browser:
  1. generateKeypair() → { publicKey, secretKey }
  2. Store both in IndexedDB (Dexie keypairs table)
  3. POST /register { deviceId, publicKey, role }
     ↑ Only publicKey sent. secretKey stays local.

Server:
  1. Store publicKey in users.public_key
  2. Generate TOTP secret (M1.1)
  3. Return user + TOTP secret
```

### Why Ed25519 Over RSA-2048

| | Ed25519 | RSA-2048 |
|---|---------|----------|
| Key size | 32 bytes | 256 bytes |
| Signature size | 64 bytes | 256 bytes |
| Speed | Very fast | Slower |
| Library | tweetnacl (pure JS) | node:crypto (native) |
| Browser support | Same library | Different API |

The spec allows either. Ed25519 is 8x smaller keys, same library in browser + Node, no native modules needed for offline PWA.

### Who Uses These Keys Later

| Module | How keys are used |
|--------|-------------------|
| M3.3 Mesh Encryption | Encrypt messages using recipient's public key |
| M5.1 Proof of Delivery | Driver signs QR code with secret key, recipient verifies with public key |
| M1.4 Audit Trail | Entries can be signed for non-repudiation |

### Files

| File | Purpose |
|------|---------|
| `backend/src/services/auth-service.js` | `generateKeypair()`, `registerDevice()`, `verifySignature()`, `signMessage()` |
| `backend/src/routes/auth.js` | `GET /keypair` (demo), `POST /register`, `POST /verify-signature` |
| `frontend/src/lib/crypto.ts` | `generateKeypair()`, `signMessage()`, `verifySignature()`, `exportKeyBase64()`, `importKeyBase64()` |
| `frontend/src/lib/db/dexie-schema.ts` | `keypairs` table, `totpSecrets` table |
| `frontend/src/lib/useAuthStore.ts` | `generateAndStoreKeypair()`, `loadKeypair()`, `registerDevice()` |
| `frontend/src/types/tweetnacl.d.ts` | TypeScript declarations for tweetnacl |

### API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/v1/auth/keypair` | Public | Generate fresh keypair (demo) |
| `POST /api/v1/auth/register` | Public | Register device with publicKey |
| `POST /api/v1/auth/verify-signature` | Public | Verify signature against stored publicKey |

### Library

`tweetnacl` + `tweetnacl-util` — audited Ed25519 implementation, pure JavaScript, no native bindings, works offline in any browser.

---

## M1.3 — Role-Based Access Control (RBAC) — 2 Points

### What It Does

Enforces who can do what across all API endpoints. Five roles with distinct read/write/execute permissions, checked at the middleware level before any route handler runs.

### The Five Roles

| Role | Description | Real-world equivalent |
|------|-------------|----------------------|
| `commander` | Full unrestricted access | Camp leader, incident commander |
| `dispatcher` | Read all, write logistics, execute routes | Logistics coordinator |
| `field_agent` | Read/write deliveries, read supplies | Ground worker, volunteer |
| `drone_pilot` | Read routes/deliveries, execute fleet | Remote drone operator |
| `observer` | Read-only everything | UN monitor, journalist, auditor |

### Permission Matrix

```
                 READ                      WRITE                       EXECUTE
 ──────────── ──────────────────────── ─────────────────────────── ───────────
 commander    *  (everything)          *  (everything)             *  (everything)
 dispatcher   *  (everything)          supplies, deliveries,       routes
                                       triage
 field_agent  supplies, deliveries,    deliveries, pod_receipts    (none)
              nodes
 drone_pilot  routes, deliveries,      deliveries                  fleet
              nodes
 observer     *  (everything)          (none)                      (none)
```

### Three Middleware Functions

```javascript
// 1. extractUser — runs globally on EVERY request (index.js)
//    Decodes JWT → sets req.user = { userId, deviceId, role, name }
//    If no token or invalid → req.user = null (doesn't block)
app.use(extractUser);

// 2. requireAuth — blocks if not logged in
router.get('/me', requireAuth, handler);
// → 401 { error: "Authentication required" }

// 3. requireRole — blocks if wrong role
router.post('/preempt', requireRole('commander', 'dispatcher'), handler);
// → 403 { error: "Insufficient permissions", required: [...], current: "observer" }

// 4. requirePermission — checks against the matrix
router.post('/', requirePermission('deliveries', 'write'), handler);
// → 403 { error: "Insufficient permissions", required: { resource, action }, current: "observer" }
```

### Request Flow

```
Request: POST /api/v1/triage/preempt
         Authorization: Bearer eyJ...

  ┌──────────────────────────────────────────┐
  │ extractUser (global)                     │
  │ Decode JWT → req.user = {               │
  │   userId: "abc-123",                    │
  │   deviceId: "dev-001",                  │
  │   role: "observer",                     │
  │   name: "UN Observer"                   │
  │ }                                        │
  └──────────────┬───────────────────────────┘
                 │
  ┌──────────────▼───────────────────────────┐
  │ auditMiddleware (global)                 │
  │ Prepares to log if response succeeds     │
  └──────────────┬───────────────────────────┘
                 │
  ┌──────────────▼───────────────────────────┐
  │ requireRole('commander', 'dispatcher')   │
  │                                          │
  │ req.user.role = "observer"               │
  │ "observer" NOT in ['commander',          │
  │                     'dispatcher']        │
  │                                          │
  │ → 403 {                                  │
  │     error: "Insufficient permissions",   │
  │     required: ["commander","dispatcher"],│
  │     current: "observer"                  │
  │   }                                      │
  └──────────────────────────────────────────┘
  Handler NEVER executes.
```

### Route Guards Applied

```
PUBLIC (no guard):
  POST /auth/register
  POST /auth/verify-otp
  GET  /auth/keypair
  GET  /auth/otp/:deviceId

requireAuth (any logged-in user):
  GET  /auth/me
  GET  /sync/state         GET  /sync/pull
  GET  /routes/graph
  ALL  /mesh/*
  GET  /delivery/
  GET  /triage/priorities
  GET  /predictions/risk-map    GET  /predictions/edge-risk/:id
  GET  /fleet/vehicles          GET  /fleet/reachability

requireRole (specific roles):
  GET  /auth/audit                → commander, dispatcher
  GET  /auth/audit/verify         → commander
  POST /sync/push                 → commander, dispatcher, field_agent
  PATCH /routes/edges/:id/status  → commander, dispatcher, field_agent
  POST /triage/preempt            → commander, dispatcher
  POST /predictions/ingest        → commander, dispatcher
  POST /fleet/rendezvous          → commander, drone_pilot

requirePermission (matrix lookup):
  POST /routes/find-path          → routes:execute
  POST /delivery/                 → deliveries:write
  PATCH /delivery/:id/status      → deliveries:write
  POST /delivery/:id/pod          → pod_receipts:write
  POST /triage/evaluate           → triage:write
  POST /fleet/dispatch            → fleet:execute
```

### Frontend Side

The same permission matrix is mirrored in `useAuthStore.hasPermission(resource, action)` so the UI can show/hide features without a server call:

```typescript
// In any component:
const { hasPermission } = useAuthStore();

if (hasPermission('fleet', 'execute')) {
  // Show "Dispatch Drone" button
}
```

`ProtectedRoute` component wraps pages that require authentication:

```tsx
<Route path="/dashboard" element={
  <ProtectedRoute>           {/* redirects to /login if not auth */}
    <DashboardScreen />
  </ProtectedRoute>
} />
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/middleware/rbac.js` | `PERMISSIONS` matrix, `extractUser`, `requireAuth`, `requireRole`, `requirePermission` |
| `backend/src/index.js` | `app.use(extractUser)` — global before all routes |
| `backend/src/routes/*.js` | Each route file applies appropriate guards |
| `frontend/src/lib/useAuthStore.ts` | `hasPermission(resource, action)` — client-side mirror |
| `frontend/src/components/auth/ProtectedRoute.tsx` | Auth guard + role check for React routes |
| `frontend/src/App.tsx` | Dashboard wrapped in `<ProtectedRoute>` |

---

## M1.4 — Audit Trail & Immutable Login Logs — 1 Point

### What It Does

Every mutation (POST, PUT, PATCH, DELETE) is automatically appended to a tamper-evident log using SHA-256 hash chaining. Each entry's hash includes the previous entry's hash, so modifying any entry breaks the entire chain from that point forward.

### How Hash Chaining Works

```
Entry #0 (GENESIS)                Entry #1                         Entry #2
┌─────────────────────┐          ┌─────────────────────┐          ┌─────────────────────┐
│ prev_hash: 000...0  │          │ prev_hash: 25d0cc.. │          │ prev_hash: 43c8b3.. │
│ timestamp: 10:00:00 │          │ timestamp: 10:00:05 │          │ timestamp: 10:00:08 │
│ user_id:   null     │          │ user_id:   null     │          │ user_id:   abc-123  │
│ action:    GENESIS  │          │ action:    POST     │          │ action:    POST     │
│ resource:  system   │          │ resource:  /register│          │ resource:  /verify  │
│ payload:   {seeded} │          │ payload:   {dev,pk} │          │ payload:   {dev,otp}│
│                     │          │                     │          │                     │
│ hash: SHA256(       │          │ hash: SHA256(       │          │ hash: SHA256(       │
│   000...0 +         │────chain───→ 25d0cc... +      │────chain───→ 43c8b3... +      │
│   10:00:00 +        │    link  │   10:00:05 +       │    link  │   10:00:08 +       │
│   null +            │          │   null +            │          │   abc-123 +        │
│   GENESIS +         │          │   POST +            │          │   POST +            │
│   system +          │          │   /register +       │          │   /verify +         │
│   {seeded}          │          │   {dev,pk}          │          │   {dev,otp}         │
│ ) = 25d0cc...       │          │ ) = 43c8b3...       │          │ ) = 746b2f...       │
└─────────────────────┘          └─────────────────────┘          └─────────────────────┘
```

### Tamper Detection

```
If someone changes Entry #1's payload from {dev,pk} to {hacked:true}:

  Recomputed hash = SHA256(25d0cc... + 10:00:05 + null + POST + /register + {hacked:true})
                  = 7c441a...

  Stored hash    = 43c8b3...

  7c441a... ≠ 43c8b3...  →  TAMPERED!

verifyChain() returns:
{
  valid: false,
  brokenAt: 1,
  reason: "hash mismatch — entry was tampered",
  expectedHash: "7c441a...",
  actualHash: "43c8b3..."
}
```

### Auto-Logging Middleware

```
Every request passes through auditMiddleware (global in index.js):

  1. Is this a mutation? (POST/PUT/PATCH/DELETE)
     No → skip (GET requests not logged)

  2. Intercept res.json()

  3. After response is sent, check status code:
     status >= 400 → skip (failed requests not logged)
     status < 400  → log it:
       appendLog(req.user.userId, req.method, req.url, req.body)

  4. appendLog():
     a. Get last entry's hash (or "000...0" for first entry)
     b. Compute: hash = SHA256(prevHash + timestamp + userId + action + resource + payload)
     c. INSERT into audit_log with hash and prev_hash
```

### Chain Verification

```
verifyChain() walks every entry in chronological order:

  for each entry (i = 0, 1, 2, ...):
    1. Check entry.prev_hash == expected_prev_hash
       (expected is previous entry's hash, or "000...0" for first)
    2. Recompute hash from entry fields
    3. Check recomputed == entry.hash
    4. If either fails → return { valid: false, brokenAt: i, reason: ... }
    5. Set expected_prev_hash = entry.hash for next iteration

  All entries pass → return { valid: true, totalEntries: N }
```

### Files

| File | Purpose |
|------|---------|
| `backend/src/services/audit-service.js` | `appendLog()` (hash-chained insert), `verifyChain()` (integrity check), `getLogs()` (filtered query) |
| `backend/src/middleware/audit.js` | `auditMiddleware` — auto-logs POST/PUT/PATCH/DELETE |
| `backend/src/index.js` | `app.use(auditMiddleware)` — global after extractUser |
| `backend/src/routes/auth.js` | `GET /audit` (commander+dispatcher), `GET /audit/verify` (commander) |
| `backend/src/db/seed.js` | Seeds genesis entry via `auditService.appendLog()` |

### API Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/v1/auth/audit` | Commander, Dispatcher | Paginated audit log. Query params: `userId`, `resource`, `limit`, `offset` |
| `GET /api/v1/auth/audit/verify` | Commander only | Verify chain integrity → `{ valid: true/false, brokenAt, reason }` |

### Demo Script (Corruption Detection)

```bash
# 1. Do some operations (register, login, etc.)
# 2. Verify chain is valid:
curl http://localhost:3001/api/v1/auth/audit/verify \
  -H "Authorization: Bearer $JWT"
# → { "data": { "valid": true, "totalEntries": 4 } }

# 3. Corrupt an entry directly in SQLite:
sqlite3 backend/data/digital_delta.sqlite \
  "UPDATE audit_log SET payload = '{\"hacked\":true}' WHERE rowid = 2"

# 4. Verify again — corruption detected:
curl http://localhost:3001/api/v1/auth/audit/verify \
  -H "Authorization: Bearer $JWT"
# → { "data": { "valid": false, "brokenAt": 1, "reason": "hash mismatch..." } }
```

---

## Complete File Map

```
backend/
├── src/
│   ├── services/
│   │   ├── auth-service.js      ← All M1.1 + M1.2 logic
│   │   └── audit-service.js     ← M1.4 hash chain
│   ├── middleware/
│   │   ├── rbac.js              ← M1.3 permission matrix + guards
│   │   └── audit.js             ← M1.4 auto-logging middleware
│   ├── routes/
│   │   ├── auth.js              ← M1 API endpoints
│   │   ├── sync.js              ← RBAC applied
│   │   ├── routes.js            ← RBAC applied
│   │   ├── mesh.js              ← RBAC applied
│   │   ├── delivery.js          ← RBAC applied
│   │   ├── triage.js            ← RBAC applied
│   │   ├── predictions.js       ← RBAC applied
│   │   └── fleet.js             ← RBAC applied
│   └── index.js                 ← Global middleware: extractUser → auditMiddleware → routes

frontend/
├── src/
│   ├── lib/
│   │   ├── crypto.ts            ← M1.2 Ed25519 sign/verify
│   │   ├── totp.ts              ← M1.1 OTP generate/verify/countdown
│   │   ├── useAuthStore.ts      ← M1.1-M1.3 state management
│   │   ├── api.ts               ← HTTP client with JWT headers
│   │   └── db/
│   │       └── dexie-schema.ts  ← keypairs + totpSecrets tables
│   ├── components/
│   │   └── auth/
│   │       └── ProtectedRoute.tsx  ← M1.3 route guard
│   ├── screens/
│   │   └── LoginScreen.tsx      ← M1.1 + M1.2 registration + OTP UI
│   └── types/
│       └── tweetnacl.d.ts       ← Type declarations
```

## Dependencies

| Package | Used by | Purpose |
|---------|---------|---------|
| `tweetnacl` | M1.2 (backend + frontend) | Ed25519 key generation, signing, verification |
| `tweetnacl-util` | M1.2 (backend + frontend) | Base64/UTF-8 encoding helpers |
| `otpauth` | M1.1 (backend + frontend) | RFC 6238 TOTP generation and verification |
| `jsonwebtoken` | M1.1 (backend only) | JWT signing and verification (HS256) |
| `uuid` | M1 (backend) | Generate unique IDs for users and audit entries |
| `dexie` | M1 (frontend) | IndexedDB wrapper for keypairs and TOTP secrets |

## Scoring

| Task | Points | Status |
|------|--------|--------|
| M1.1 Mobile OTP Generation | 3 | Complete |
| M1.2 Asymmetric Key Pair Provisioning | 3 | Complete |
| M1.3 Role-Based Access Control | 2 | Complete |
| M1.4 Audit Trail & Immutable Login Logs | 1 | Complete |
| **Total** | **9/9** | **Complete** |
