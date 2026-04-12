# Module 4 — Multi-Modal Vehicle Routing Engine (10 Points)

Real-time dynamic routing engine that optimizes delivery paths across a heterogeneous fleet (trucks, speedboats, drones) on a weighted directed graph. The graph updates live as field conditions change — when a road washes out, all affected routes recompute instantly.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SQLite Database                               │
│                                                                      │
│  ┌──────────────┐    ┌──────────────┐    ┌───────────────────┐     │
│  │  nodes (6)    │    │  edges (7)    │    │  deliveries       │     │
│  │               │    │               │    │                   │     │
│  │  sylhet-hub   │    │  e1: road     │    │  route_data JSON  │     │
│  │  sunamganj    │    │  e2: road     │    │  vehicle_type     │     │
│  │  companiganj  │    │  e3: waterway │    │  source/target    │     │
│  │  bishwanath   │    │  e4: road     │    │  status           │     │
│  │  golapganj    │    │  e5: road     │    │                   │     │
│  │  jaintapur    │    │  e6: airway   │    │                   │     │
│  │               │    │  e7: airway   │    │                   │     │
│  └──────────────┘    └──────────────┘    └───────────────────┘     │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  route-service.js (Engine)                            │
│                                                                      │
│  loadGraph()          → reads nodes + edges from SQLite              │
│  buildAdjacencyList() → filters by vehicle type + edge status        │
│  dijkstra()           → shortest path with weighted edges            │
│  findPath()           → full pipeline: validate → filter → route     │
│  updateEdgeStatus()   → mark edge failed → reroute active deliveries │
│                                                                      │
│  Weight formula: travel_time × (1 + risk_score)                      │
│  Vehicle filters: truck→road | boat→waterway | drone→airway          │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  routes.js (API Endpoints)                            │
│                                                                      │
│  GET  /api/v1/routes/graph           → full graph (nodes + edges)    │
│  POST /api/v1/routes/find-path       → compute shortest path         │
│  PATCH /api/v1/routes/edges/:id/status → mark edge failed/open       │
│                                                                      │
│  WebSocket broadcasts:                                               │
│    EDGE_STATUS_CHANGED  → when edge status changes                   │
│    ROUTE_RECALCULATED   → when a delivery gets rerouted              │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
┌─────────────────────────┴───────────────────────────────────────────┐
│                  RouteMapScreen.tsx (Mobile UI)                       │
│                                                                      │
│  WebView + Leaflet.js + OpenStreetMap tiles                          │
│  Nodes as colored circle markers (hub=blue, camp=green, etc.)        │
│  Edges as polylines (road=gray, waterway=cyan, airway=orange)        │
│  Failed edges = red dashed lines                                     │
│  Active route = yellow highlighted path                              │
│  Tap node → select destination → compute route                       │
│  Tap edge → toggle washed_out / open                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Files

| File | Purpose |
|------|---------|
| `backend/src/services/route-service.js` | Dijkstra engine, graph loader, reroute logic |
| `backend/src/routes/routes.js` | REST API endpoints for M4 |
| `mobile/src/screens/RouteMapScreen.tsx` | Leaflet map dashboard |
| `mobile/src/screens/DashboardScreen.tsx` | Added "Route Map" nav button |
| `mobile/App.tsx` | Added `routes` screen to navigation |
| `backend/src/db/schema.sql` | `nodes` + `edges` tables (pre-existing) |
| `backend/src/db/seed.js` | 6 nodes + 7 edges seed data (pre-existing) |

---

## Graph Data (Seed)

**Nodes (6):**

| ID | Name | Type | Lat/Lng |
|----|------|------|---------|
| sylhet-hub | Sylhet Hub | hub | 24.89, 91.87 |
| sunamganj | Sunamganj Camp | camp | 25.07, 91.40 |
| companiganj | Companiganj Post | waypoint | 25.05, 91.73 |
| bishwanath | Bishwanath Base | camp | 24.82, 91.72 |
| golapganj | Golapganj Post | waypoint | 24.73, 91.83 |
| jaintapur | Jaintapur Drone Base | drone_base | 25.13, 92.07 |

**Edges (7):**

| ID | Source → Target | Type | Travel Time | Risk |
|----|-----------------|------|-------------|------|
| e1 | sylhet-hub → bishwanath | road | 35 min | 0.10 |
| e2 | sylhet-hub → companiganj | road | 50 min | 0.20 |
| e3 | companiganj → sunamganj | waterway | 90 min | 0.40 |
| e4 | bishwanath → golapganj | road | 28 min | 0.15 |
| e5 | golapganj → sylhet-hub | road | 22 min | 0.10 |
| e6 | sylhet-hub → jaintapur | airway | 15 min | 0.05 |
| e7 | jaintapur → sunamganj | airway | 40 min | 0.10 |

---

## Sub-Task Mapping

### M4.1 — Graph Representation & Multi-Modal Edge Types (3 pts)

- Graph stored in SQLite `nodes` + `edges` tables
- 3 edge types: `road`, `waterway`, `airway`
- Edge weights encode: `travel_time`, `capacity`, `risk_score`
- `loadGraph()` returns full graph; `buildAdjacencyList()` builds in-memory adjacency list

### M4.2 — Dynamic Route Re-Computation on Node Failure (4 pts)

- `PATCH /api/v1/routes/edges/:id/status` marks an edge as `washed_out` or `closed`
- `updateEdgeStatus()` automatically finds all active deliveries using that edge and re-computes their routes
- Response includes `computation_time_ms` (must be < 2000ms)
- WebSocket broadcasts `EDGE_STATUS_CHANGED` and `ROUTE_RECALCULATED`

### M4.3 — Vehicle-Type Constraint Handling (2 pts)

- Dijkstra filters edges by vehicle: `truck` → road only, `boat` → waterway only, `drone` → airway only
- Drones have a payload limit of 15kg (checked before routing)
- If no valid path exists for the vehicle type, returns `found: false` with message

### M4.4 — Visual Route Dashboard (1 pt)

- Leaflet.js map in a WebView (OpenStreetMap tiles, works offline if cached)
- Nodes colored by type, edges colored by transport type
- Failed edges shown as red dashed lines
- Active routes highlighted in yellow
- Real-time updates via WebSocket

---

## How to Test

### Prerequisites

```bash
# 1. Seed the database
cd backend && node src/db/seed.js

# 2. Start the server
node src/index.js
# → Backend running on port 3001

# 3. Get a JWT token (need keypair + TOTP):
# Get keypair
curl -s http://localhost:3001/api/v1/auth/keypair
# → copy publicKey

# Register (replace PUBLIC_KEY)
curl -s -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-01","publicKey":"PUBLIC_KEY","role":"commander","name":"Tester"}'
# → copy totp.secret

# Generate OTP (replace TOTP_SECRET)
python3 -c "
import hmac,hashlib,struct,time,base64
s=base64.b32decode('TOTP_SECRET')
c=int(time.time())//30
h=hmac.new(s,struct.pack('>Q',c),hashlib.sha1).digest()
o=h[-1]&0xF
print(f'{(struct.unpack(\">I\",h[o:o+4])[0]&0x7FFFFFFF)%1000000:06d}')
"

# Verify OTP to get JWT (replace DEVICE_ID and OTP)
curl -s -X POST http://localhost:3001/api/v1/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"test-01","token":"OTP"}'
# → copy data.token as TOKEN
```

### Test 1 — Get Full Graph (M4.1)

```bash
curl -s http://localhost:3001/api/v1/routes/graph \
  -H "Authorization: Bearer TOKEN"
```

**Expected:** JSON with 6 nodes and 7 edges, each edge has `type`, `travel_time`, `risk_score`, `status`.

### Test 2 — Truck Route: sylhet-hub → golapganj (M4.1 + M4.3)

```bash
curl -s -X POST http://localhost:3001/api/v1/routes/find-path \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"sylhet-hub","target":"golapganj","vehicle_type":"truck"}'
```

**Expected:** `found: true`, path = `[sylhet-hub, golapganj]` via road edge e5 (direct, 15km, 22min). Uses road edges only.

### Test 3 — Boat Route: sylhet-hub → sunamganj (M4.3)

```bash
curl -s -X POST http://localhost:3001/api/v1/routes/find-path \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"sylhet-hub","target":"sunamganj","vehicle_type":"boat"}'
```

**Expected:** `found: false` — no waterway path from sylhet-hub (waterway only exists companiganj→sunamganj, but no waterway reaches companiganj). Proves vehicle constraint filtering works.

### Test 4 — Drone Route: sylhet-hub → sunamganj (M4.3)

```bash
curl -s -X POST http://localhost:3001/api/v1/routes/find-path \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"sylhet-hub","target":"sunamganj","vehicle_type":"drone"}'
```

**Expected:** `found: true`, path = `[sylhet-hub, jaintapur, sunamganj]` via airway edges e6+e7 (102km, 55min). Uses airway edges only.

### Test 5 — Mark Road Washed Out (M4.2)

```bash
# Mark e5 (sylhet↔golapganj direct road) as washed out
curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e5/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"washed_out"}'
```

**Expected:** `old_status: "open"`, `new_status: "washed_out"`, `computation_time_ms < 2000`.

### Test 6 — Truck Reroutes Around Failure (M4.2)

```bash
# Same truck route, but e5 is now washed out
curl -s -X POST http://localhost:3001/api/v1/routes/find-path \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"sylhet-hub","target":"golapganj","vehicle_type":"truck"}'
```

**Expected:** `found: true`, path = `[sylhet-hub, bishwanath, golapganj]` via e1+e4 (40.5km, 63min). Avoids washed-out e5.

### Test 7 — Cascading Failure: No Route (M4.2)

```bash
# Also mark e1 (sylhet→bishwanath) as washed out
curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e1/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"washed_out"}'

# Now try truck route again
curl -s -X POST http://localhost:3001/api/v1/routes/find-path \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"sylhet-hub","target":"golapganj","vehicle_type":"truck"}'
```

**Expected:** `found: false` — both road paths to golapganj are washed out. Only a drone could reach it (but golapganj has no airway edges, so drone also fails).

### Test 8 — Reopen Edge (M4.2)

```bash
curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e5/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"open"}'

curl -s -X PATCH http://localhost:3001/api/v1/routes/edges/e1/status \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"open"}'
```

**Expected:** Edges back to `open`, routes work again.

### Test 9 — Mobile Map UI (M4.4)

1. Start backend: `cd backend && node src/index.js`
2. Start mobile: `cd mobile && npx expo start`
3. Login → Dashboard → tap **"Route Map"**
4. See Leaflet map with 6 nodes and 7 color-coded edges
5. Tap a node → select destination → see yellow route highlighted
6. Tap an edge → toggle "Mark Washed Out" → edge turns red/dashed
7. Request same route again → it reroutes around the failure

---

## Quick Test Script

Save this and run after starting the server:

```bash
#!/bin/bash
# Usage: ./test-m4.sh TOKEN
TOKEN=$1
AUTH="Authorization: Bearer $TOKEN"
URL="http://localhost:3001/api/v1/routes"

echo "--- Graph ---"
curl -s "$URL/graph" -H "$AUTH" | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"{len(d['nodes'])} nodes, {len(d['edges'])} edges\")"

echo "--- Truck: sylhet→golapganj ---"
curl -s -X POST "$URL/find-path" -H "$AUTH" -H "Content-Type: application/json" -d '{"source":"sylhet-hub","target":"golapganj","vehicle_type":"truck"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"found={d['found']} path={d.get('path','-')} time={d.get('total_travel_time_min','-')}min\")"

echo "--- Drone: sylhet→sunamganj ---"
curl -s -X POST "$URL/find-path" -H "$AUTH" -H "Content-Type: application/json" -d '{"source":"sylhet-hub","target":"sunamganj","vehicle_type":"drone"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"found={d['found']} path={d.get('path','-')} time={d.get('total_travel_time_min','-')}min\")"

echo "--- Boat: sylhet→sunamganj (should fail) ---"
curl -s -X POST "$URL/find-path" -H "$AUTH" -H "Content-Type: application/json" -d '{"source":"sylhet-hub","target":"sunamganj","vehicle_type":"boat"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"found={d['found']} msg={d.get('message','-')}\")"

echo "--- Wash out e5 ---"
curl -s -X PATCH "$URL/edges/e5/status" -H "$AUTH" -H "Content-Type: application/json" -d '{"status":"washed_out"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"{d['edge_id']}: {d['old_status']}→{d['new_status']} ({d['computation_time_ms']}ms)\")"

echo "--- Truck reroute: sylhet→golapganj ---"
curl -s -X POST "$URL/find-path" -H "$AUTH" -H "Content-Type: application/json" -d '{"source":"sylhet-hub","target":"golapganj","vehicle_type":"truck"}' | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print(f\"found={d['found']} path={d.get('path','-')} time={d.get('total_travel_time_min','-')}min\")"

echo "--- Reopen e5 ---"
curl -s -X PATCH "$URL/edges/e5/status" -H "$AUTH" -H "Content-Type: application/json" -d '{"status":"open"}' > /dev/null && echo "done"
```
