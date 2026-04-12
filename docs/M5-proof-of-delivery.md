# Module 5 — Zero-Trust Proof-of-Delivery System (7 Points)

Every physical handoff between a driver and a recipient camp is cryptographically verified — without any network connectivity. The handoff protocol is non-repudiable: both parties sign, nonces prevent replay, and the full chain of custody is reconstructable from the ledger.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                   DRIVER DEVICE (Sender)                             │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐      │
│  │  pod.ts       │   │  crypto.ts    │   │  database.ts      │      │
│  │               │   │               │   │                   │      │
│  │  generatePod  │   │  Ed25519 sign │   │  used_nonces      │      │
│  │  Payload()    │──►│  with secret  │   │  pod_receipts     │      │
│  │               │   │  key (local)  │   │  (offline store)  │      │
│  └──────┬────────┘   └──────────────┘   └───────────────────┘      │
│         │                                                            │
│         ▼                                                            │
│  ┌──────────────┐                                                   │
│  │  QR Code      │ ◄── contains: delivery_id, sender_pubkey,       │
│  │  (on screen)  │     payload_hash, nonce, timestamp, signature    │
│  └──────┬────────┘                                                   │
└─────────┼───────────────────────────────────────────────────────────┘
          │  phone-to-phone scan (no network needed)
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 RECIPIENT DEVICE (Receiver)                           │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌───────────────────┐      │
│  │  expo-camera  │   │  pod.ts       │   │  database.ts      │      │
│  │               │   │               │   │                   │      │
│  │  scan QR ─────┼──►│  verifyPod    │   │  markNonceUsed()  │      │
│  │               │   │  Payload()    │──►│  storePodReceipt()│      │
│  │               │   │  countersign  │   │                   │      │
│  │               │   │  Pod()        │   │                   │      │
│  └──────────────┘   └──────────────┘   └───────────────────┘      │
│                                                                      │
│  Verification steps:                                                 │
│    1. Check timestamp not expired (< 5 min)                         │
│    2. Check nonce not reused (local SQLite)                         │
│    3. Verify sender Ed25519 signature                               │
│    4. Countersign with receiver's secret key                        │
│    5. Store receipt locally                                          │
│    6. Sync to server when online                                    │
└─────────────────────────────────────────────────────────────────────┘
          │
          ▼  (when connectivity returns)
┌─────────────────────────────────────────────────────────────────────┐
│                    SERVER (Express + SQLite)                          │
│                                                                      │
│  ┌────────────────────┐   ┌──────────────────┐   ┌──────────────┐ │
│  │  delivery-service   │   │  delivery.js      │   │  SQLite      │ │
│  │                     │   │  (routes)         │   │              │ │
│  │  createDelivery()   │   │  POST /           │   │  deliveries  │ │
│  │  createPodChallenge │   │  PATCH /:id/status│   │  pod_receipts│ │
│  │  verifyAndConfirm   │   │  POST /:id/pod    │   │  used_nonces │ │
│  │  getDeliveryChain() │   │  GET /:id/chain   │   │  audit_log   │ │
│  └────────────────────┘   └──────────────────┘   └──────────────┘ │
│                                                                      │
│  On confirm:                                                         │
│    → Verify sender signature (Ed25519)                              │
│    → Check nonce not reused (used_nonces table)                     │
│    → Check timestamp not expired                                    │
│    → Store receipt in pod_receipts                                  │
│    → Update delivery status → 'delivered'                           │
│    → Append to hash-chained audit log (M1.4)                       │
│    → WebSocket broadcast POD_CONFIRMED                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Files

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/services/delivery-service.js` | CREATED | Delivery CRUD, PoD challenge generation, verify+countersign, nonce tracking, chain of custody |
| `backend/src/routes/delivery.js` | MODIFIED | Replaced 501 stubs with 5 real endpoints |
| `backend/src/db/schema.sql` | MODIFIED | Added `used_nonces` table for replay protection |
| `mobile/src/lib/pod.ts` | CREATED | Offline QR payload generation, signature verification, nonce checking, receipt storage |
| `mobile/src/lib/database.ts` | MODIFIED | Added `used_nonces` + `pod_receipts` tables to local SQLite |
| `mobile/src/screens/DeliveryScreen.tsx` | CREATED | Delivery list, QR generate/scan, chain of custody view |
| `mobile/App.tsx` | MODIFIED | Added `delivery` screen to navigation |
| `mobile/src/screens/DashboardScreen.tsx` | MODIFIED | Added "Deliveries & PoD" nav button |

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/v1/delivery/` | Any authenticated | List deliveries (filter by `status`, `driver_id`) |
| POST | `/api/v1/delivery/` | `deliveries` write | Create delivery (auto-routes via M4) |
| PATCH | `/api/v1/delivery/:id/status` | `deliveries` write | Update status: pending → in_transit → delivered/failed |
| POST | `/api/v1/delivery/:id/pod` | `pod_receipts` write | `action=generate`: create unsigned PoD challenge; `action=confirm`: verify + store receipt |
| GET | `/api/v1/delivery/:id/chain` | Any authenticated | Full chain of custody (receipts + audit trail) |

---

## Sub-Task Mapping

### M5.1 — Signed QR Code Challenge-Response Handshake (3 pts)

**What it does:**
1. Driver taps "Generate QR" → `pod.ts:generatePodPayload()` builds `{ delivery_id, sender_pubkey, payload_hash, nonce, timestamp }` and signs it with Ed25519 secret key
2. QR code displayed on screen via `react-native-qrcode-svg`
3. Recipient scans with `expo-camera` → `pod.ts:verifyPodPayload()` checks sender signature against `sender_pubkey`
4. Recipient countersigns with `pod.ts:countersignPod()` using their own secret key
5. Both signatures stored in `pod_receipts` → mutual verification, no server needed

**Reuses from M1:** Ed25519 key pair (generated at registration), `crypto.ts` sign/verify functions

### M5.2 — Tamper-Evidence & Replay Protection (2 pts)

**Three rejection cases:**

| Check | Error Code | Trigger |
|-------|-----------|---------|
| Nonce already used | `NONCE_REUSED` | Same QR scanned twice |
| Timestamp > 5 min old | `EXPIRED` | Stale QR code |
| Signature doesn't match payload | `SIGNATURE_INVALID` | Tampered QR data |

- Nonces tracked in `used_nonces` table (both server-side SQLite and mobile local SQLite)
- Each nonce is a UUID, single-use, checked before any other validation

### M5.3 — Delivery Receipt Chain (2 pts)

- Each confirmed PoD receipt stored in `pod_receipts` with both signatures
- Every PoD event appended to `audit_log` via `audit-service.appendLog()` (hash-chained from M1.4)
- `GET /delivery/:id/chain` returns: delivery details, all receipts, full audit trail
- Chain of custody reconstructable from ledger history alone

---

## Database Tables

**`used_nonces`** (new):
```sql
CREATE TABLE IF NOT EXISTS used_nonces (
  nonce TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  delivery_id TEXT REFERENCES deliveries(id),
  used_at TEXT DEFAULT (datetime('now'))
);
```

**`pod_receipts`** (pre-existing, now populated):
```sql
-- Already existed in schema.sql
-- Columns: id, delivery_id, sender_device_id, receiver_device_id,
--          sender_signature, receiver_signature, payload_hash, nonce, status
```

**`deliveries`** (pre-existing, now with real data):
```sql
-- Route auto-computed on creation via M4 findPath()
-- Status transitions: pending → in_transit → delivered/failed
```

---

## How to Test

### Prerequisites

```bash
# 1. Seed database + apply schema
cd backend && node src/db/seed.js

# 2. Start server
node src/index.js

# 3. Get a JWT token (same process as M4 — register, TOTP, verify-otp)
# See M4 docs for the full flow. Save the TOKEN and SECKEY.
```

### Test 1 — Create a Delivery (auto-routes via M4)

```bash
curl -s -X POST http://localhost:3001/api/v1/delivery/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "source_node_id": "sylhet-hub",
    "target_node_id": "sunamganj",
    "vehicle_type": "drone",
    "priority": "P0"
  }'
```

**Expected:** Delivery created with `status: "pending"`, `route_data` contains computed drone path `sylhet-hub → jaintapur → sunamganj`. Save the `id` as DELIVERY_ID.

### Test 2 — List Deliveries

```bash
curl -s http://localhost:3001/api/v1/delivery/ \
  -H "Authorization: Bearer TOKEN"
```

**Expected:** Array of deliveries with count.

### Test 3 — Update Status to in_transit

```bash
curl -s -X PATCH http://localhost:3001/api/v1/delivery/DELIVERY_ID/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status": "in_transit"}'
```

**Expected:** `status: "in_transit"`. Logged to audit trail.

### Test 4 — Generate PoD Challenge (M5.1)

```bash
curl -s -X POST http://localhost:3001/api/v1/delivery/DELIVERY_ID/pod \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"action": "generate", "sender_device_id": "YOUR_DEVICE_ID"}'
```

**Expected:** Returns `pod_payload` with `delivery_id`, `sender_pubkey`, `payload_hash`, `nonce`, `timestamp`, and `canonical_string`. The `note` says "Sign canonical_string with your Ed25519 secret key on-device."

### Test 5 — Sign the Challenge (simulate device-side signing)

```bash
# Use Node.js to sign (since secret key never leaves the device)
node -e "
const nacl = require('tweetnacl');
const {decodeBase64, encodeBase64} = require('tweetnacl-util');
const secretKey = decodeBase64('YOUR_SECRET_KEY_BASE64');
const canonical = 'CANONICAL_STRING_FROM_TEST_4';
const msg = new TextEncoder().encode(canonical);
const sig = nacl.sign.detached(msg, secretKey);
console.log(encodeBase64(sig));
"
```

Save the output as SENDER_SIG.

### Test 6 — Confirm PoD Receipt (M5.1 + M5.2)

```bash
curl -s -X POST http://localhost:3001/api/v1/delivery/DELIVERY_ID/pod \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "confirm",
    "pod_payload": {PASTE_POD_PAYLOAD_JSON},
    "sender_signature": "SENDER_SIG",
    "receiver_device_id": "RECEIVER_DEVICE_ID"
  }'
```

**Expected:** 
```json
{
  "data": {
    "receipt_id": "...",
    "delivery_id": "...",
    "status": "confirmed",
    "sender_device_id": "...",
    "receiver_device_id": "...",
    "payload_hash": "...",
    "nonce": "..."
  }
}
```

Delivery status auto-updates to `delivered`.

### Test 7 — Replay Attack (M5.2)

```bash
# Run the EXACT same confirm request as Test 6 again
curl -s -X POST http://localhost:3001/api/v1/delivery/DELIVERY_ID/pod \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{SAME_BODY_AS_TEST_6}'
```

**Expected:**
```json
{
  "error": "Nonce already used — replay detected",
  "code": "NONCE_REUSED"
}
```

### Test 8 — Tampered Signature (M5.2)

```bash
# Same request but change one character in sender_signature
curl -s -X POST http://localhost:3001/api/v1/delivery/DELIVERY_ID/pod \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "confirm",
    "pod_payload": {PAYLOAD_WITH_NEW_NONCE},
    "sender_signature": "AAAA_TAMPERED_SIGNATURE",
    "receiver_device_id": "RECEIVER_DEVICE_ID"
  }'
```

**Expected:**
```json
{
  "error": "Sender signature invalid — tampered payload",
  "code": "SIGNATURE_INVALID"
}
```

### Test 9 — Chain of Custody (M5.3)

```bash
curl -s http://localhost:3001/api/v1/delivery/DELIVERY_ID/chain \
  -H "Authorization: Bearer TOKEN"
```

**Expected:**
```
Delivery status: delivered
Receipts: 1
Fully verified: true/false
Audit trail: N entries
  - DELIVERY_CREATED
  - DELIVERY_STATUS_CHANGED (pending → in_transit)
  - POD_CHALLENGE_CREATED
  - POD_CONFIRMED
  - DELIVERY_STATUS_CHANGED (in_transit → delivered)
```

### Test 10 — Mobile UI

1. Start backend: `cd backend && node src/index.js`
2. Start mobile: `cd mobile && npx expo start`
3. Login → Dashboard → tap **"Deliveries & PoD"**
4. Tap **"+ New Delivery"** → delivery appears with PENDING badge
5. Tap **"Start Transit"** → badge changes to IN_TRANSIT
6. Tap **"Generate QR"** → QR code modal appears with nonce
7. On second device: tap **"Scan QR"** → camera opens → scan the QR
8. See **"Confirmed"** alert → delivery status becomes DELIVERED
9. Scan same QR again → see **"NONCE_REUSED: Replay detected"** error
10. Tap **"Chain"** → see receipt with sender/receiver signatures + audit trail

---

## Quick Test Script

Save as `test-m5.sh` and run after starting the server:

```bash
#!/bin/bash
# Usage: ./test-m5.sh TOKEN SECRET_KEY DEVICE_ID
TOKEN=$1; SECKEY=$2; DEVID=$3
AUTH="Authorization: Bearer $TOKEN"
URL="http://localhost:3001/api/v1/delivery"

echo "--- Create delivery ---"
DID=$(curl -s -X POST "$URL/" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"source_node_id\":\"sylhet-hub\",\"target_node_id\":\"sunamganj\",\"vehicle_type\":\"drone\",\"priority\":\"P0\"}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "Delivery: $DID"

echo "--- Start transit ---"
curl -s -X PATCH "$URL/$DID/status" -H "$AUTH" -H "Content-Type: application/json" -d '{"status":"in_transit"}' > /dev/null && echo "in_transit"

echo "--- Generate PoD ---"
POD=$(curl -s -X POST "$URL/$DID/pod" -H "$AUTH" -H "Content-Type: application/json" -d "{\"action\":\"generate\",\"sender_device_id\":\"$DEVID\"}")
CANONICAL=$(echo "$POD" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['canonical_string'])")
NONCE=$(echo "$POD" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['pod_payload']['nonce'])")
echo "Nonce: ${NONCE:0:8}..."

echo "--- Sign ---"
SIG=$(node -e "
const nacl=require('tweetnacl');const{decodeBase64,encodeBase64}=require('tweetnacl-util');
const sk=decodeBase64('$SECKEY');const msg=new TextEncoder().encode('$CANONICAL');
console.log(encodeBase64(nacl.sign.detached(msg,sk)));
")

echo "--- Confirm PoD ---"
PAYLOAD=$(echo "$POD" | python3 -c "import sys,json; import json as j; print(j.dumps(json.load(sys.stdin)['data']['pod_payload']))")
curl -s -X POST "$URL/$DID/pod" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"action\":\"confirm\",\"pod_payload\":$PAYLOAD,\"sender_signature\":\"$SIG\",\"receiver_device_id\":\"$DEVID\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Status: {d.get('data',{}).get('status','FAILED')}\")"

echo "--- Replay (should fail) ---"
curl -s -X POST "$URL/$DID/pod" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"action\":\"confirm\",\"pod_payload\":$PAYLOAD,\"sender_signature\":\"$SIG\",\"receiver_device_id\":\"$DEVID\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"Error: {d.get('error','none')} Code: {d.get('code','none')}\")"

echo "--- Chain ---"
curl -s "$URL/$DID/chain" -H "$AUTH" | python3 -c "
import sys,json; d=json.load(sys.stdin)['data']
print(f\"Status: {d['delivery']['status']}, Receipts: {d['chain_length']}, Audit: {len(d['audit_trail'])} entries\")
"
```
