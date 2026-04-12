// Enums
export type Role = 'commander' | 'dispatcher' | 'field_agent' | 'drone_pilot' | 'observer';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type NodeType = 'hub' | 'camp' | 'waypoint' | 'drone_base';
export type NodeStatus = 'active' | 'damaged' | 'offline';
export type EdgeType = 'road' | 'waterway' | 'airway';
export type EdgeStatus = 'open' | 'degraded' | 'closed' | 'washed_out';
export type VehicleType = 'truck' | 'boat' | 'drone';
export type DeliveryStatus = 'pending' | 'in_transit' | 'delivered' | 'failed';
export type SupplyCategory = 'medical' | 'food' | 'water' | 'equipment' | 'shelter';
export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'conflict';

// Core entities
export interface ReliefNode {
  id: string;
  name: string;
  type: NodeType;
  lat: number;
  lng: number;
  status: NodeStatus;
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  distance: number;
  travelTime: number;
  capacity: number;
  riskScore: number;
  status: EdgeStatus;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  deviceId: string;
  name: string | null;
  publicKey: string | null;
  role: Role;
  totpSecret?: string;
  createdAt: string;
  lastLogin: string | null;
}

export interface Supply {
  id: string;
  name: string;
  category: SupplyCategory;
  quantity: number;
  unit: string;
  priority: Priority;
  nodeId: string;
  crdtState?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Delivery {
  id: string;
  supplyId: string;
  sourceNodeId: string;
  targetNodeId: string;
  vehicleType: VehicleType;
  status: DeliveryStatus;
  priority: Priority;
  routeData?: string;
  driverId: string | null;
  eta: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEntry {
  id: string;
  userId: string | null;
  action: string;
  resource: string;
  payload: string | null;
  hash: string;
  prevHash: string;
  createdAt: string;
}

export interface SyncState {
  id: string;
  nodeId: string;
  vectorClock: string;
  lastSync: string;
  syncType: 'full' | 'delta';
}

export interface PodReceipt {
  id: string;
  deliveryId: string;
  senderDeviceId: string;
  receiverDeviceId: string;
  senderSignature: string;
  receiverSignature: string | null;
  payloadHash: string;
  nonce: string;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: string;
}

export interface MeshMessage {
  id: string;
  sourceDeviceId: string;
  targetDeviceId: string;
  relayDeviceId: string | null;
  payload: string;
  ttl: number;
  hopCount: number;
  status: 'pending' | 'relayed' | 'delivered' | 'expired';
  createdAt: string;
  expiresAt: string | null;
}

// Vector clock type
export type VectorClock = Record<string, number>;

// API response wrapper
export interface ApiResponse<T> {
  data: T;
  error?: string;
  timestamp: string;
}

// Conflict types for CRDT resolution
export interface CrdtConflict {
  id: string;
  resourceType: 'supply' | 'delivery' | 'node';
  resourceId: string;
  localValue: unknown;
  remoteValue: unknown;
  localClock: VectorClock;
  remoteClock: VectorClock;
  detectedAt: string;
}

// Triage entry for priority queue
export interface TriageEntry {
  id: string;
  deliveryId: string;
  priority: Priority;
  description: string;
  nodeId: string;
  nodeName: string;
  slaDeadline: string;
  createdAt: string;
  status: 'pending' | 'in_progress' | 'resolved';
}
