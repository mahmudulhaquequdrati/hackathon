# Digital Delta

**Offline-First Disaster Relief Logistics Platform**

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-0.81-61DAFB?logo=react&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-54-000020?logo=expo&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-yellow)

> HackFusion 2026 Submission -- A production-grade platform for managing supply deliveries across disconnected, flood-prone regions using CRDTs, mesh networking, ML-based predictions, and zero-trust cryptography.

---

## Overview

Digital Delta enables humanitarian logistics teams to coordinate supply deliveries when infrastructure is destroyed. The system works **fully offline** -- devices sync via Bluetooth mesh, resolve conflicts with CRDTs, and re-route deliveries in real time as roads flood or bridges collapse.

**Key differentiators:**

- **No internet required** -- BLE mesh networking for device-to-device communication
- **Mathematically consistent** -- CRDT-based distributed database with vector clock ordering
- **Zero-trust security** -- Ed25519 keypairs, TOTP authentication, cryptographic proof-of-delivery
- **ML-powered predictions** -- Logistic regression classifier trained on Bangladesh rainfall data (98.3% accuracy)
- **Autonomous triage** -- Priority preemption engine that reroutes critical supplies when SLAs breach

---

## Architecture

```
+---------------------+       WebSocket / REST        +---------------------+
|                     | <---------------------------> |                     |
|    Mobile App       |                               |    Backend API      |
|  (React Native +   |       BLE Mesh (P2P)          |  (Express + SQLite) |
|   Expo + SQLite)    | <---------------------------> |    Port 3001        |
|                     |                               |                     |
+---------------------+                               +---------------------+
         |                                                      |
         |  imports                                             |  reads
         v                                                      v
+---------------------+                               +---------------------+
|   Shared CRDT Lib   |                               |   Chaos Server      |
|  (LWW-Register,     |                               |  (Flask, Port 5000) |
|   LWW-Map,          |                               |  Simulates floods,  |
|   Vector Clock)     |                               |  edge failures      |
+---------------------+                               +---------------------+
```

---

## Modules

| Module | Name | Points | Description |
|--------|------|--------|-------------|
| **M1** | Secure Authentication | 9 | Ed25519 keypairs, offline TOTP, RBAC (5 roles), hash-chained audit trail |
| **M2** | CRDT Sync | 10 | LWW-Register/Map, vector clocks, conflict visualization, BLE delta-sync |
| **M3** | Mesh Network | 9 | Store-and-forward relay, dual-role nodes, E2E encryption (x25519) |
| **M4** | Vehicle Routing | 10 | Weighted directed graph, Dijkstra pathfinding, multi-modal constraints |
| **M5** | Proof-of-Delivery | 7 | QR challenge-response, Ed25519 signatures, nonce replay protection |
| **M6** | Triage Engine | 7 | SLA breach prediction, autonomous preemption, priority taxonomy (P0-P3) |
| **M7** | Predictive Route Decay | 9 | Rainfall-trained logistic regression, proactive rerouting on flood risk |
| **M8** | Drone Handoff | 9 | Reachability analysis, rendezvous points, battery-aware mesh throttling |

---

## Tech Stack

### Backend
- **Express** 4.21 -- REST API + middleware
- **better-sqlite3** 11.7 -- Embedded database (WAL mode)
- **ws** 8.18 -- WebSocket server for real-time broadcasts
- **jsonwebtoken** -- JWT auth
- **otpauth** -- RFC 6238 TOTP generation
- **tweetnacl** -- Ed25519 signing + x25519 encryption

### Mobile
- **React Native** 0.81 + **React** 19.1
- **Expo** 54 -- Build toolchain
- **expo-sqlite** -- On-device database
- **expo-secure-store** -- Credential storage
- **react-native-ble-plx** -- Bluetooth Low Energy
- **zustand** 5.0 -- State management
- **TypeScript** 5.9

### Shared
- **CRDT library** -- Pure JS, zero dependencies (LWW-Register, LWW-Map, Vector Clock)

### Infrastructure
- **SQLite** -- Both backend and mobile storage
- **Flask** (Python) -- Chaos simulation server

---

## Project Structure

```
digital-delta/
├── backend/
│   ├── src/
│   │   ├── index.js                 # Express server, WebSocket, middleware
│   │   ├── middleware/
│   │   │   ├── rbac.js              # Role-based access control
│   │   │   └── audit.js             # Hash-chained audit logging
│   │   ├── routes/
│   │   │   ├── auth.js              # M1: Keypair, TOTP, signatures
│   │   │   ├── sync.js              # M2: Vector clock push/pull
│   │   │   ├── mesh.js              # M3: Store-and-forward relay
│   │   │   ├── routes.js            # M4: Graph, pathfinding
│   │   │   ├── delivery.js          # M5: CRUD + PoD handshake
│   │   │   ├── triage.js            # M6: SLA evaluation, preemption
│   │   │   ├── predictions.js       # M7: ML risk predictions
│   │   │   └── fleet.js             # M8: Drone handoff
│   │   ├── services/                # Business logic for each module
│   │   └── db/
│   │       ├── schema.sql           # 14 tables
│   │       ├── seed.js              # Sample data (Sylhet region)
│   │       └── reset.js             # Drop all tables
│   ├── package.json
│   └── .env
│
├── mobile/
│   ├── App.tsx                      # Root component, navigation
│   ├── src/
│   │   ├── screens/                 # 9 screens (Login, Dashboard, Delivery, etc.)
│   │   ├── lib/                     # Core logic (auth, mesh, crypto, sync, triage)
│   │   ├── components/              # Reusable UI (Card, Badge, StatCard, etc.)
│   │   ├── theme/                   # Colors, spacing, typography
│   │   └── types/                   # TypeScript definitions
│   ├── app.json
│   └── package.json
│
├── shared/
│   └── crdt/
│       └── src/                     # LWW-Register, LWW-Map, Vector Clock
│
├── docs/                            # Detailed module specifications (M1-M6)
├── chaos.py                         # Flask chaos server
├── rainfall_training.csv            # ML training data (200 rows)
├── project.md                       # HackFusion spec (8 modules, 69 points)
└── package.json                     # Root monorepo scripts
```

---

## Getting Started

### Prerequisites

- **Node.js** >= 18
- **pnpm** (recommended) or npm
- **Python** 3.x (for chaos server)
- **Expo CLI** (`npm install -g expo-cli`)
- **iOS Simulator** or **Android Emulator** (or physical device)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd digital-delta

# Install backend dependencies
cd backend
npm install

# Install mobile dependencies
cd ../mobile
pnpm install

# (Optional) Install chaos server dependencies
pip install flask flask-cors
```

### Running the Backend

```bash
cd backend

# Set up the database (reset + seed)
node src/db/reset.js
node src/db/seed.js

# Start the development server
npm run dev
# Server runs on http://localhost:3001
# WebSocket on ws://localhost:3001
# Health check: GET /api/v1/health
```

### Running the Mobile App

```bash
cd mobile
pnpm start
# Scan the QR code with Expo Go on your device
# Or press 'i' for iOS simulator / 'a' for Android emulator
```

### Running the Chaos Server

```bash
python chaos.py
# Flask server on http://localhost:5000
# GET  /api/network/status  -- current flood status
# POST /api/network/reset   -- clear all flooded edges
```

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | API server port |
| `CHAOS_SERVER_URL` | `http://localhost:5000` | Chaos simulation server |
| `JWT_SECRET` | *(required)* | Secret for signing JWT tokens |
| `DB_PATH` | `./data/digital_delta.sqlite` | SQLite database file path |

### Mobile

Configure the backend URL in your mobile environment to point to your local network IP (e.g., `http://192.168.x.x:3001`).

---

## API Reference

All endpoints are prefixed with `/api/v1`.

### Authentication (`/auth`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/keypair` | Generate a test Ed25519 keypair |
| `POST` | `/register` | Register device (public key + TOTP secret) |
| `POST` | `/verify-otp` | Validate TOTP, receive JWT |
| `POST` | `/verify-signature` | Verify Ed25519 signature |

### Sync (`/sync`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/state` | Current vector clock state |
| `POST` | `/push` | Push local CRDT changes |
| `POST` | `/pull` | Pull remote CRDT changes |

### Routes (`/routes`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/graph` | Full network graph (nodes + edges) |
| `POST` | `/find-path` | Dijkstra shortest path (vehicle-constrained) |
| `PATCH` | `/edges/:id/status` | Update edge status (triggers reroute) |

### Deliveries (`/delivery`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/create` | Create a new delivery |
| `GET` | `/` | List all deliveries |
| `PATCH` | `/:id/status` | Update delivery status |
| `POST` | `/pod-challenge` | Initiate PoD handshake |
| `POST` | `/pod-confirm` | Verify + countersign PoD |

### Triage (`/triage`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/priorities` | SLA taxonomy (P0-P3) |
| `POST` | `/evaluate` | Evaluate all active deliveries |
| `POST` | `/preempt` | Execute preemption decision |
| `GET` | `/decisions` | Past triage decisions |

### Mesh (`/mesh`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/send` | Queue message for relay |
| `GET` | `/inbox` | Pending messages for device |
| `POST` | `/relay` | Relay message to next hop |
| `POST` | `/node-state` | Update device mesh state |

### Predictions (`/predictions`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/predict-edge` | ML flood risk score for an edge |

---

## Database Schema

14 SQLite tables across backend and mobile:

| Table | Purpose |
|-------|---------|
| `users` | Device identity, Ed25519 public keys, roles, TOTP secrets |
| `nodes` | Relief camps, hubs, waypoints, drone bases (lat/lng, capacity) |
| `edges` | Roads, waterways, airways (distance, travel time, risk score) |
| `supplies` | Inventory with CRDT state (category, quantity, priority P0-P3) |
| `deliveries` | Shipments with route data, vehicle type, ETA, status |
| `audit_log` | Hash-chained immutable log (tamper detection) |
| `sync_state` | Vector clock metadata per node |
| `pod_receipts` | Proof-of-delivery signatures (sender + receiver) |
| `mesh_messages` | Store-and-forward queue (encrypted payload, TTL, hop count) |
| `used_nonces` | Replay protection for PoD handshakes |
| `mesh_node_state` | Dual-role tracking (client/relay, battery, signal) |
| `triage_decisions` | Preemption log with rationale |

---

## Key Data Flows

### Authentication
1. Device generates Ed25519 keypair locally
2. Registers public key with server (`/auth/register`)
3. Server returns TOTP secret
4. Device generates TOTP offline, submits to `/auth/verify-otp`
5. Server issues JWT for subsequent requests

### CRDT Sync
1. Mobile updates supply locally, increments vector clock
2. On connectivity, pushes delta to `/sync/push`
3. Server merges via LWW (highest timestamp wins)
4. Broadcasts update via WebSocket to other clients

### Mesh Relay
1. Device A encrypts message with Device C's x25519 public key
2. Sends to Device B (relay) over BLE
3. Device B stores and forwards -- cannot decrypt payload
4. TTL decremented per hop; expires after 24h

### Proof-of-Delivery
1. Driver generates signed QR code (delivery ID, payload hash, nonce)
2. Recipient scans, countersigns with their private key
3. Both signatures verified server-side; nonce checked for replay
4. PoD receipt written to CRDT ledger + audit trail

---

## Documentation

Detailed module specifications are available in the [`docs/`](docs/) directory:

- [M1 - Authentication](docs/M1-authentication.md)
- [M2 - CRDT Sync](docs/M2-crdt-sync.md)
- [M3 - Mesh Network](docs/M3-mesh-network.md)
- [M4 - Vehicle Routing](docs/M4-vehicle-routing.md)
- [M5 - Proof of Delivery](docs/M5-proof-of-delivery.md)
- [M6 - Triage Engine](docs/M6-triage-engine.md)

---

we took help from claude

---

*Built for HackFusion 2026*
