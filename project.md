# HackFusion 2026 - Complete Module List (1-8)

## Module 1 - Secure Authentication & Identity Management [9 Points]

Contestants must implement a mobile-first authentication system that functions without active internet access and complies with zero-trust identity principles. The login flow must not depend on third-party OAuth providers.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M1.1 Mobile OTP Generation (TOTP/HOTP) | 3 | Generate time-based or HMAC-based OTPs locally using RFC 6238/4226. OTP must be valid offline. Demo must show expiry and re-generation. |
| M1.2 Asymmetric Key Pair Provisioning | 3 | Upon first login, generate per-device RSA-2048 or Ed25519 key pair. Public key stored in shared ledger. Private key stored in device secure enclave or Keystore. |
| M1.3 Role-Based Access Control (RBAC) | 2 | Roles: Field Volunteer, Supply Manager, Drone Operator, Camp Commander, Sync Admin. Each role has defined read/write/execute permissions enforced at the data layer. |
| M1.4 Audit Trail & Immutable Login Logs | 1 | Every auth event (login, OTP failure, key rotation) is appended to a tamper-evident local log using hash chaining. Demonstrated by injecting a log corruption and detecting it. |

---

## Module 2 - Offline-First Distributed Database & CRDT Sync [10 Points]

The system must operate as a fully distributed ledger across disconnected devices. When connectivity is restored (Bluetooth, Wi-Fi Direct, or cellular), all local databases must converge to an identical state with mathematical consistency guarantees - no central arbiter required.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M2.1 CRDT-Based Data Model | 4 | Implement at minimum one of: G-Counter, OR-Set, LWW-Register, or RGA for supply inventory entries. Demonstrate that concurrent conflicting updates on two disconnected devices merge correctly upon reconnect. |
| M2.2 Vector Clock / Causal Ordering | 3 | Every mutation carries a vector clock. Causal history must be preserved. Demonstrate: A writes, B reads A's write, B writes. Sync order must reflect causality. |
| M2.3 Conflict Visualization & Resolution | 2 | When a genuine conflict is detected (same field updated concurrently), surface it in the UI with both values and a resolution mechanism. Log the resolution decision. |
| M2.4 Sync Protocol over Bluetooth / Wi-Fi Direct | 1 | Actual device-to-device sync (not simulated). Delta-sync only: transmit changed records since last vector clock. Bandwidth overhead must be sub-10 KB per sync cycle under normal operation. |

---

## Module 3 - Ad-Hoc Mesh Network Protocol [9 Points]

Devices must autonomously form a store-and-forward mesh network to relay encrypted supply data across physical dead zones. No Wi-Fi router or cellular tower should be required for intra-mesh communication.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M3.1 Store-and-Forward Message Relay | 4 | Device A sends a message destined for Device C via Device B (relay). Message must survive Device B going offline mid-relay and resume when B comes back online. TTL and deduplication required. |
| M3.2 Dual-Role Node Architecture | 3 | Each device dynamically acts as Client or Relay based on proximity, battery, and signal strength heuristics. Role switching must be automatic and logged. |
| M3.3 End-to-End Message Encryption | 2 | All inter-node payloads encrypted using the recipient's public key (established in M1.2). Relay nodes must be cryptographically incapable of reading message contents. Demonstrate with packet inspection. |

---

## Module 4 - Multi-Modal Vehicle Routing Problem (VRP) Engine [10 Points]

Implement a real-time, dynamic routing engine that optimizes delivery paths across a heterogeneous fleet (trucks, speedboats, drones) on a weighted graph representing roads, waterways, and airways. The graph must update live as field conditions change.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M4.1 Graph Representation & Multi-Modal Edge Types | 3 | Model the logistics network as a weighted directed graph with at minimum 3 edge types: Road, Waterway, Airway. Edge weights encode travel time, capacity, and risk score. |
| M4.2 Dynamic Route Re-Computation on Node Failure | 4 | When a field agent marks a road as 'Washed Out' or a river as 'Impassable,' the system recalculates all affected active routes within 2 seconds (measured). Use Dijkstra, A*, or equivalent with demonstrably correct shortest paths. |
| M4.3 Vehicle-Type Constraint Handling | 2 | Routes are vehicle-specific: trucks only use road edges; speedboats only use waterway edges; drones only use airway edges with payload weight limits. Cross-mode transfers trigger a handoff event. |
| M4.4 Visual Route Dashboard | 1 | Live map visualization (Leaflet.js + OSM tiles cached offline) showing all active routes, vehicle positions, and edge failure overlays updating in real time during the demo. |

---

## Module 5 - Zero-Trust Proof-of-Delivery (PoD) System [7 Points]

To prevent supply diversion and theft, every physical handoff between a driver and a recipient camp must be cryptographically verified - without any network connectivity. The handoff protocol must be non-repudiable.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M5.1 Signed QR Code Challenge-Response Handshake | 3 | Driver generates a QR code containing: delivery_id, sender_pubkey, payload_hash, nonce, timestamp - all signed with driver's private key. Recipient scans and countersigns. Mutual verification without a server. |
| M5.2 Tamper-Evidence & Replay Protection | 2 | Nonces are single-use and tracked locally. A replayed or tampered QR code must be rejected with a specific error code. Demonstrate by replaying a previously used QR code. |
| M5.3 Delivery Receipt Chain | 2 | Each PoD receipt is appended to the CRDT ledger (Module 2) and propagated to all syncing nodes. The chain of custody for any package must be reconstructable from ledger history alone. |

---

## Module 6 - Autonomous Triage & Priority Preemption Engine [7 Points]

Not all cargo has equal urgency. The system must autonomously evaluate delivery priorities in real time and make preemptive rescheduling decisions when route conditions deteriorate - without requiring a human dispatcher.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M6.1 Cargo Priority Taxonomy & SLA Windows | 2 | Define at least 4 priority tiers with delivery SLA windows: P0 (Critical Medical, e.g. antivenom - 2 hrs), P1 (High - 6 hrs), P2 (Standard - 24 hrs), P3 (Low - 72 hrs). Stored in CRDT. |
| M6.2 Real-Time SLA Breach Prediction | 3 | When a route slows by 30% or more (due to M4 updates or M7 predictions), the engine predicts if the current ETA will breach SLA for each cargo item and triggers a preemption evaluation. |
| M6.3 Autonomous Drop-and-Reroute Decision | 2 | System autonomously instructs the driver to deposit P2/P3 cargo at a designated safe waypoint and reroute with P0/P1 cargo only. Decision and rationale logged to the audit trail. Simulated in the dashboard. |

---

## Module 7 - Predictive Route Decay (ML-Based) [9 Points]

Rather than reacting to road failures, the system must proactively predict which routes are at risk of becoming impassable based on simulated environmental sensor data - and reroute vehicles before they encounter the failure.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M7.1 Rainfall Ingestion & Feature Engineering | 2 | Ingest simulated rainfall rate data (CSV or mock sensor API at 1 Hz or higher). Extract features per graph edge: cumulative rainfall, rate-of-change, elevation, soil saturation proxy. |
| M7.2 Impassability Classification Model | 3 | Train a binary classifier (logistic regression, decision tree, or gradient boosting) on the simulated dataset to predict edge impassability within the next 2 hours. Report precision, recall, and F1. Model must run on-device. |
| M7.3 Proactive Rerouting Integration | 3 | Predictions from M7.2 are fed into the routing engine (M4). Edges predicted as high-risk (probability above 0.7) have their weights penalized. Affected drivers receive advance rerouting recommendations. |
| M7.4 Prediction Confidence Display | 1 | Route map overlays edge color-coded by predicted risk. Hovering an edge shows the probability score, contributing features, and prediction timestamp. |

---

## Module 8 - Hybrid Fleet Orchestration & Drone Handoff Logic [9 Points]

Design and implement the multi-agent coordination logic for seamless payload transfer between ground vehicles and autonomous drones for last-mile delivery to otherwise unreachable locations.

| Task | Points | Evaluation Criteria |
|------|--------|---------------------|
| M8.1 Reachability Analysis | 2 | Determine which delivery destinations are unreachable by boat or truck given current graph state. Classify them as 'Drone-Required Zones' and flag in the dashboard. |
| M8.2 Optimal Rendezvous Point Computation | 3 | Given boat position, drone base, and destination, compute the geographic coordinate that minimizes total travel time for both agents to meet - subject to drone range and payload weight constraints. Must be demonstrably correct on at least 3 test scenarios. |
| M8.3 Handoff Coordination Protocol | 2 | Simulate the handoff event: boat arrives at rendezvous, generates a PoD receipt (Module 5), drone acknowledges with counter-signature, and payload ownership transfers in the CRDT ledger. |
| M8.4 Battery-Aware Mesh Throttling | 2 | Background mesh broadcast frequency is dynamically adjusted based on battery level (below 30%: reduce frequency by 60%), accelerometer state (stationary: reduce by 80%), and proximity to known nodes. Demonstrate measurable battery savings in a 10-minute simulated run. |
