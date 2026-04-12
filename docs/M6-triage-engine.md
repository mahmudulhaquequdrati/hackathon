# Module 6 — Autonomous Triage & Priority Preemption Engine (10 Points)

When disaster disrupts delivery routes, the triage engine autonomously evaluates every active delivery against its SLA deadline, flags breaches and warnings, and preempts lower-priority cargo so critical supplies arrive on time. Every decision is logged with a human-readable rationale and broadcast in real-time.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SQLite Database                               │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐     │
│  │  deliveries   │    │  triage_     │    │  audit_log        │     │
│  │               │    │  decisions   │    │                   │     │
│  │  priority     │    │              │    │  hash-chained     │     │
│  │  route_data   │    │  decision_   │    │  tamper-proof     │     │
│  │  eta          │    │  type        │    │  TRIAGE_PREEMPTION│     │
│  │  status       │    │  slack_min   │    │  entries          │     │
│  │  created_at   │    │  dropped_    │    │                   │     │
│  │               │    │  cargo       │    │                   │     │
│  │               │    │  rationale   │    │                   │     │
│  └──────────────┘    └──────────────┘    └───────────────────┘     │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  triage-service.js (Engine)                           │
│                                                                      │
│  SLA_CONFIG            → P0=2h, P1=6h, P2=24h, P3=72h               │
│  computeSlaDeadline()  → created_at + SLA window                     │
│  computeEta()          → departure + travel time                     │
│  checkRouteSlowdown()  → (new-old)/old >= 30% → triggers triage     │
│  evaluateDeliveries()  → slack = deadline - ETA → breach/warn/ok     │
│  executePreemption()   → drop P2/P3 cargo at nearest waypoint       │
│  findNearestWaypoint() → waypoint/camp on the delivery route         │
│  buildRationale()      → human-readable decision explanation         │
│                                                                      │
│  CRDT: Priority taxonomy stored in LWW-Map for eventual consistency  │
│  Weight: slack_minutes = (sla_deadline - current_eta) / 60,000 ms    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  triage.js (API Endpoints)                            │
│                                                                      │
│  GET  /api/v1/triage/priorities  → priority taxonomy (CRDT-synced)   │
│  POST /api/v1/triage/evaluate    → run evaluation on all deliveries  │
│  POST /api/v1/triage/preempt     → execute preemption (cmd/dispatch) │
│  GET  /api/v1/triage/decisions   → past preemption decisions         │
│                                                                      │
│  WebSocket broadcasts:                                               │
│    TRIAGE_EVALUATED     → when evaluation completes                  │
│    PREEMPTION_EXECUTED  → when cargo is preempted                    │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  TriageScreen.tsx (Mobile UI)                         │
│                                                                      │
│  Stats bar: breach (red) | warning (orange) | ok (green)             │
│  Priority taxonomy: scrollable P0/P1/P2/P3 cards with SLA hours     │
│  Live countdown timer per delivery (hh:mm:ss to SLA deadline)        │
│  Slack progress bar (green → orange → red as slack shrinks)          │
│  Preempt button: only on P2/P3 cards, requires confirmation          │
│  Decision log: past preemptions with rationale + old/new ETA         │
│  WebSocket: live updates without polling                             │
└─────────────────────────────────────────────────────────────────────┘
```

---

## How It Works (Conceptual)

### The Core Idea: Slack Time

Everything revolves around one number — **slack minutes**:

```
slack = SLA_deadline - current_ETA
```

- **SLA_deadline** = when the delivery was created + the priority's delivery window
- **current_ETA** = when we predict the delivery will actually arrive

Positive slack = breathing room. Zero or negative = the delivery will be late (breach).

### The Priority Tiers (SLA Config)

| Tier | Label | SLA Window | Examples |
|------|-------|------------|----------|
| **P0** | Critical Medical | 2 hours (120 min) | antivenom, blood products |
| **P1** | High Priority | 6 hours (360 min) | water, emergency food |
| **P2** | Standard | 24 hours (1440 min) | general supplies |
| **P3** | Low Priority | 72 hours (4320 min) | non-essentials, equipment |

### How ETA is Estimated

**Pending deliveries** (haven't departed yet):
```
ETA = now + total_travel_time_minutes
```

**In-transit deliveries** (already moving):
```
elapsed = (now - created_at) in minutes
remaining = max(0, total_travel_time - elapsed)
ETA = now + remaining
```

### How Evaluation Works (Step by Step)

1. Fetch all active deliveries (`pending` or `in_transit`) with valid route data
2. For each delivery:
   - Compute **SLA deadline**: `created_at + SLA_CONFIG[priority].sla_minutes`
   - Estimate **current ETA** (formula depends on pending vs. in-transit)
   - Compute **slack**: `(deadline - ETA) / 60,000 ms`
   - Assign **status**:
     - `breach` → slack <= 0 (will miss or already missed deadline)
     - `warning` → slack < 30% of SLA window (running out of time)
     - `ok` → everything else
   - Update ETA in database
   - Flag **preemption eligible**: only `P2` and `P3`
3. Sort results: breaches first, then warnings, then by priority (P0 > P1 > P2 > P3)
4. Broadcast `TRIAGE_EVALUATED` via WebSocket
5. Return breach/warning/ok counts

### Warning Threshold: 30% of SLA Window

| Priority | SLA | Warning when slack < |
|----------|-----|---------------------|
| P0 | 120 min | **36 minutes** |
| P1 | 360 min | **108 minutes** |
| P2 | 1440 min | **432 minutes** |
| P3 | 4320 min | **1296 minutes** |

### How Preemption Works (Step by Step)

**Rule: P0 and P1 are NEVER preempted. Only P2/P3 cargo can be dropped.**

1. Fetch the delivery and parse its route data
2. Find the **nearest waypoint** on the delivery's route path (active waypoint or camp)
   - Walks through each node in the route path, returns the first waypoint/camp found
   - Fallback: first active waypoint in the database
3. Attempt to compute a **fresh route** (graph may have changed since original routing)
4. Calculate **new ETA** and **slack** based on updated route
5. Build a **rationale string**: human-readable explanation of why this preemption happened
6. Insert a `triage_decisions` record with: old/new ETA, slack, dropped cargo, waypoint, rationale
7. Mark the delivery as **`preempted`** in the deliveries table
8. Append to **audit log** (hash-chained, tamper-proof — reuses M1)
9. Broadcast `PREEMPTION_EXECUTED` via WebSocket

### Automatic vs. Manual Preemption

**Automatic trigger chain** (no human required):
```
Edge destroyed (washed_out/closed)
  → route-service reroutes affected deliveries
    → checkRouteSlowdown(): is new route 30%+ slower?
      → YES: evaluateDeliveries() runs on ALL active deliveries
        → Any P0/P1 in 'breach' status?
          → YES: executePreemption() runs automatically
```

**Manual trigger** (human required):
- Commander or dispatcher presses "Trigger Preemption" button on a P2/P3 delivery card
- Confirmation dialog: "This will preempt the current delivery to prioritize urgent supply. Continue?"
- Calls `POST /api/v1/triage/preempt` with `{ delivery_id }`

### The Slowdown Check

```
slowdown_pct = ((new_travel_time - old_travel_time) / old_travel_time) x 100
```

If >= 30%, triage evaluation is triggered. Example:
- Old route: 50 min. New route: 70 min.
- Slowdown: (70 - 50) / 50 x 100 = **40%** → triggers triage

### CRDT Integration

The priority taxonomy (P0-P3 labels, SLA hours, examples) is stored in a **CRDT LWW-Map** (Last-Write-Wins Map). This ensures the taxonomy stays consistent even when network nodes are disconnected and sync later. Each field is stored as `P0_label`, `P0_sla_hours`, etc.

---

## Files

| File | Action | Purpose |
|------|--------|---------|
| `backend/src/services/triage-service.js` | CREATED | Core engine: evaluate, preempt, SLA config, CRDT taxonomy, rationale |
| `backend/src/routes/triage.js` | CREATED | REST API endpoints for M6 |
| `mobile/src/screens/TriageScreen.tsx` | CREATED | Live triage dashboard with countdown timers, progress bars, preempt button |
| `mobile/src/lib/useTriageStore.ts` | CREATED | Zustand store for triage state, API calls, WebSocket sync |
| `mobile/src/types/index.ts` | MODIFIED | Added `SlaConfig`, `TriageEvaluation`, `PreemptionDecision` types |
| `mobile/App.tsx` | MODIFIED | Added `triage` screen to navigation |
| `mobile/src/screens/DashboardScreen.tsx` | MODIFIED | Added "Triage Engine" nav button |
| `backend/src/db/schema.sql` | MODIFIED | Added `triage_decisions` table |

---

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/v1/triage/priorities` | Any authenticated | Priority taxonomy with CRDT state |
| POST | `/api/v1/triage/evaluate` | `triage` write permission | Evaluate all active deliveries against SLA |
| POST | `/api/v1/triage/preempt` | Commander or Dispatcher role | Execute preemption on a specific delivery |
| GET | `/api/v1/triage/decisions` | Any authenticated | List past preemption decisions (limit param) |

---

## Database Tables

**`triage_decisions`** (new):
```sql
CREATE TABLE IF NOT EXISTS triage_decisions (
  id TEXT PRIMARY KEY,
  delivery_id TEXT REFERENCES deliveries(id),
  decision_type TEXT NOT NULL,     -- 'preempt' | 'escalate' | 'hold'
  priority TEXT NOT NULL,           -- P0, P1, P2, P3
  old_eta TEXT,
  new_eta TEXT,
  sla_deadline TEXT,
  slack_minutes REAL,
  dropped_cargo TEXT,               -- JSON array of supply IDs
  waypoint_id TEXT REFERENCES nodes(id),
  rationale TEXT,                   -- Human-readable explanation
  decided_by TEXT DEFAULT 'system', -- 'system' or user role
  created_at TEXT DEFAULT (datetime('now'))
);
```

**`deliveries`** (modified — M6-relevant columns):
```sql
-- priority TEXT NOT NULL DEFAULT 'P2'   → P0, P1, P2, P3
-- eta TEXT                              → updated by evaluateDeliveries()
-- status TEXT                           → can become 'preempted'
-- route_data TEXT                       → JSON with travel time used for ETA calc
```

---

## Sub-Task Mapping

### M6.1 — SLA Priority Taxonomy in CRDT (2 pts)

- 4-tier priority system: P0 (2h), P1 (6h), P2 (24h), P3 (72h)
- Stored in CRDT LWW-Map via `shared/crdt/src` — `createMap()` + `materialize()`
- `GET /triage/priorities` returns structured tiers + raw CRDT state
- Taxonomy is initialized on first access via `initPriorityTaxonomy()`

### M6.2 — Evaluate Deliveries Against SLA (3 pts)

- `POST /triage/evaluate` runs `evaluateDeliveries(broadcast)`
- For each active delivery: computes deadline, estimates ETA, calculates slack
- Status thresholds: `breach` (slack <= 0), `warning` (slack < 30% of SLA), `ok`
- Sorts results: breaches first, then by priority tier
- Updates delivery ETA in database
- Broadcasts `TRIAGE_EVALUATED` via WebSocket with breach/warning/ok counts
- Response includes `computation_time_ms` for performance tracking

### M6.3 — Priority Preemption (3 pts)

- `POST /triage/preempt` runs `executePreemption(deliveryId, broadcast)`
- Only P2/P3 deliveries can be preempted (P0/P1 are sacred)
- Finds nearest waypoint on route for cargo drop
- Logs decision with: old/new ETA, slack, dropped cargo, waypoint, rationale
- Updates delivery status to `preempted`
- Appends to hash-chained audit log (reuses M1)
- Broadcasts `PREEMPTION_EXECUTED` via WebSocket

### M6.4 — Automatic Preemption on Route Failure (2 pts)

- Triggered by `updateEdgeStatus()` in route-service.js (M4)
- When rerouted delivery is 30%+ slower → `evaluateDeliveries()` runs
- Any P0/P1 deliveries in `breach` → `executePreemption()` fires automatically
- Full chain: edge fails → reroute → slowdown check → evaluate → auto-preempt
- No human intervention required — system decides autonomously

---

## Real-Time Flow

```
                    Server                          Mobile
                      │                               │
 Edge washed out ────►│                               │
                      │  reroute affected deliveries  │
                      │  slowdown >= 30%?             │
                      │  YES → evaluateDeliveries()   │
                      │                               │
                      │──── WS: TRIAGE_EVALUATED ────►│  update stats bar
                      │                               │  update countdown timers
                      │                               │  show breach/warning badges
                      │                               │
                      │  auto-preempt P0/P1 breaches  │
                      │                               │
                      │──── WS: PREEMPTION_EXECUTED ─►│  add to decision log
                      │                               │  show rationale + waypoint
                      │                               │
              Manual: │◄── POST /triage/preempt ──────│  user taps "Trigger
                      │    { delivery_id }             │  Preemption" on P2/P3
                      │                               │
                      │──── WS: PREEMPTION_EXECUTED ─►│  refresh decision log
```

---

## UI Components

### Stats Bar
Three colored cards at the top:
- **Red**: breach count (SLA exceeded)
- **Orange**: warning count (running low)
- **Green**: ok count (on track)

### Priority Taxonomy
Horizontally scrollable cards showing P0-P3 with color coding:
- P0 = red, P1 = orange, P2 = yellow, P3 = green
- Each shows tier, label, SLA hours, and cargo examples

### Evaluation Cards (per delivery)
- Priority badge (P0/P1/P2/P3) + status badge (BREACH/WARNING/OK)
- **Live countdown timer** (hh:mm:ss) ticking every second to SLA deadline
- Supply name and route (source → target)
- Vehicle type and slack minutes
- **Slack progress bar**: green (>20% remaining), orange (<20%), red (breached)
- **"Trigger Preemption" button**: only visible for P2/P3 deliveries

### Decision Log
- Cards showing past preemption decisions
- Priority badge, decision type, timestamp
- Supply name + full rationale text
- Dropped cargo IDs
- Old ETA → New ETA comparison

---

## How to Test

### Prerequisites

```bash
# 1. Seed database
cd backend && node src/db/seed.js

# 2. Start server
node src/index.js

# 3. Get a JWT token (same process as M4/M5 — register, TOTP, verify-otp)
# Save as TOKEN
```

### Test 1 — Get Priority Taxonomy (M6.1)

```bash
curl -s http://localhost:3001/api/v1/triage/priorities \
  -H "Authorization: Bearer TOKEN"
```

**Expected:** JSON with `priorities` array (4 tiers: P0-P3 with labels, sla_hours, examples) and `crdt_state` containing LWW-Map entries.

### Test 2 — Create Test Deliveries (Setup)

```bash
# Create a P0 drone delivery (2h SLA)
curl -s -X POST http://localhost:3001/api/v1/delivery/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"sunamganj","vehicle_type":"drone","priority":"P0"}'

# Create a P2 truck delivery (24h SLA)
curl -s -X POST http://localhost:3001/api/v1/delivery/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"bishwanath","vehicle_type":"truck","priority":"P2"}'
```

Save the delivery IDs as `P0_DID` and `P2_DID`.

### Test 3 — Evaluate All Deliveries (M6.2)

```bash
curl -s -X POST http://localhost:3001/api/v1/triage/evaluate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

**Expected:**
```json
{
  "data": {
    "evaluations": [
      {
        "delivery_id": "...",
        "priority": "P0",
        "status": "ok",
        "slack_minutes": 64.17,
        "sla_deadline": "2026-04-13T14:00:00.000Z",
        "current_eta": "2026-04-13T12:55:00.000Z",
        "preemption_eligible": false
      },
      {
        "delivery_id": "...",
        "priority": "P2",
        "status": "ok",
        "slack_minutes": 1404.5,
        "preemption_eligible": true
      }
    ],
    "breach_count": 0,
    "warning_count": 0,
    "ok_count": 2,
    "evaluated_at": "2026-04-13T12:00:00.000Z"
  }
}
```

### Test 4 — Manual Preemption of P2 Delivery (M6.3)

```bash
curl -s -X POST http://localhost:3001/api/v1/triage/preempt \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_id":"P2_DID"}'
```

**Expected:**
```json
{
  "data": {
    "id": "uuid",
    "delivery_id": "P2_DID",
    "decision_type": "preempt",
    "priority": "P2",
    "old_eta": "...",
    "new_eta": "...",
    "sla_deadline": "...",
    "slack_minutes": 1404,
    "dropped_cargo": ["supply-id"],
    "waypoint": { "id": "bishwanath", "name": "Bishwanath Base", "lat": 24.8167, "lng": 91.7167 },
    "rationale": "PREEMPTION EXECUTED: P2 cargo \"Canned Goods\" on delivery P2_DID. P2/P3 cargo deposited at waypoint...",
    "decided_by": "system"
  }
}
```

### Test 5 — Verify Decision Log (M6.3)

```bash
curl -s http://localhost:3001/api/v1/triage/decisions \
  -H "Authorization: Bearer TOKEN"
```

**Expected:** Array with the preemption decision from Test 4, including rationale, waypoint, dropped_cargo.

### Test 6 — Automatic Preemption via Route Failure (M6.4)

```bash
# Step 1: Create a P0 delivery on a road route
curl -s -X POST http://localhost:3001/api/v1/delivery/ \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"golapganj","vehicle_type":"truck","priority":"P0"}'

# Step 2: Mark the direct road (e5) as washed out — forces reroute via e1+e4
curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e5/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"washed_out"}'
```

**Expected:** The edge status change triggers:
1. Reroute: `sylhet-hub → golapganj` via `e5` (22min) becomes `sylhet-hub → bishwanath → golapganj` via `e1+e4` (63min) — a **186% slowdown**
2. Since slowdown >= 30%, `evaluateDeliveries()` runs automatically
3. If the P0 delivery is in breach, `executePreemption()` fires on any P2/P3 deliveries
4. Check `/triage/decisions` to see the auto-generated decision

```bash
# Verify auto-decision was logged
curl -s http://localhost:3001/api/v1/triage/decisions \
  -H "Authorization: Bearer TOKEN"

# Reopen the edge
curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e5/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"open"}'
```

### Test 7 — Preemption Blocked on P0/P1

```bash
# Try to preempt a P0 delivery (should succeed at API level but P0 is marked as
# preemption_eligible: false in evaluations — the UI hides the button)
# This tests that the evaluation correctly flags eligibility
curl -s -X POST http://localhost:3001/api/v1/triage/evaluate \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

**Expected:** All P0/P1 evaluations have `preemption_eligible: false`. All P2/P3 have `preemption_eligible: true`.

### Test 8 — Role Restriction

```bash
# Login as field_agent (not commander or dispatcher)
# Try to preempt — should be rejected
curl -s -X POST http://localhost:3001/api/v1/triage/preempt \
  -H "Authorization: Bearer FIELD_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"delivery_id":"P2_DID"}'
```

**Expected:** `403 Forbidden` — only commanders and dispatchers can preempt.

### Test 9 — Mobile UI

1. Start backend: `cd backend && node src/index.js`
2. Start mobile: `cd mobile && npx expo start`
3. Login → Dashboard → tap **"Triage Engine"**
4. See priority taxonomy cards (P0/P1/P2/P3 with SLA hours)
5. Tap **"Evaluate"** → see active deliveries with countdown timers and slack bars
6. Stats bar shows breach/warning/ok counts
7. On a P2/P3 card → tap **"Trigger Preemption"** → confirm dialog → decision appears in log
8. Open Route Map → toggle an edge to washed_out → return to Triage → pull to refresh → see updated evaluations
9. Decision log shows rationale with old/new ETA and waypoint location

---

## Quick Test Script

Save as `test-m6.sh` and run after starting the server:

```bash
#!/bin/bash
# Usage: ./test-m6.sh TOKEN
TOKEN=$1
AUTH="Authorization: Bearer $TOKEN"
TRIAGE="http://localhost:3001/api/v1/triage"
DELIVERY="http://localhost:3001/api/v1/delivery"
ROUTES="http://localhost:3001/api/v1/routes"

echo "=== M6.1: Priority Taxonomy ==="
curl -s "$TRIAGE/priorities" -H "$AUTH" \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];[print(f\"  {p['tier']}: {p['label']} ({p['sla_hours']}h)\") for p in d['priorities']]"

echo ""
echo "=== Setup: Create P0 + P2 deliveries ==="
P0_DID=$(curl -s -X POST "$DELIVERY/" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"sunamganj","vehicle_type":"drone","priority":"P0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "  P0 delivery: ${P0_DID:0:8}..."

P2_DID=$(curl -s -X POST "$DELIVERY/" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"bishwanath","vehicle_type":"truck","priority":"P2"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "  P2 delivery: ${P2_DID:0:8}..."

echo ""
echo "=== M6.2: Evaluate Deliveries ==="
curl -s -X POST "$TRIAGE/evaluate" -H "$AUTH" -H "Content-Type: application/json" -d '{}' \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Breach: {d[\"breach_count\"]}  Warning: {d[\"warning_count\"]}  OK: {d[\"ok_count\"]}')
for e in d['evaluations']:
    print(f'  {e[\"priority\"]} | {e[\"status\"]:7} | slack: {e[\"slack_minutes\"]:8.1f}m | preempt: {e[\"preemption_eligible\"]} | {e.get(\"supply_name\",\"?\")[:30]}')
"

echo ""
echo "=== M6.3: Preempt P2 Delivery ==="
curl -s -X POST "$TRIAGE/preempt" -H "$AUTH" -H "Content-Type: application/json" \
  -d "{\"delivery_id\":\"$P2_DID\"}" \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Decision: {d[\"id\"][:8]}...')
print(f'  Waypoint: {d[\"waypoint\"][\"name\"]}')
print(f'  Slack: {d[\"slack_minutes\"]}m')
print(f'  Rationale: {d[\"rationale\"][:80]}...')
"

echo ""
echo "=== M6.3: Decision Log ==="
curl -s "$TRIAGE/decisions" -H "$AUTH" \
  | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']['decisions']
print(f'  Total decisions: {len(ds)}')
for d in ds[:3]:
    print(f'  {d[\"priority\"]} {d[\"decision_type\"]} | slack: {d[\"slack_minutes\"]}m | {d[\"rationale\"][:60]}...')
"

echo ""
echo "=== M6.4: Auto-Preemption via Edge Failure ==="
echo "  Creating P0 truck delivery on e5 route..."
AUTO_DID=$(curl -s -X POST "$DELIVERY/" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"source_node_id":"sylhet-hub","target_node_id":"golapganj","vehicle_type":"truck","priority":"P0"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "  Delivery: ${AUTO_DID:0:8}..."

echo "  Washing out e5 (triggers reroute + triage)..."
curl -s -X PATCH "$ROUTES/edges/e5/status" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"washed_out"}' \
  | python3 -c "
import sys,json
d=json.load(sys.stdin)['data']
print(f'  Edge: {d[\"old_status\"]} → {d[\"new_status\"]} ({d[\"computation_time_ms\"]}ms)')
print(f'  Affected deliveries: {len(d[\"affected_deliveries\"])}')
for a in d['affected_deliveries']:
    print(f'    {a[\"delivery_id\"][:8]}... → {a[\"status\"]}')
"

echo "  Checking auto-generated decisions..."
curl -s "$TRIAGE/decisions" -H "$AUTH" \
  | python3 -c "
import sys,json
ds=json.load(sys.stdin)['data']['decisions']
print(f'  Total decisions now: {len(ds)}')
"

echo ""
echo "  Reopening e5..."
curl -s -X PATCH "$ROUTES/edges/e5/status" -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"status":"open"}' > /dev/null && echo "  Done"
```
