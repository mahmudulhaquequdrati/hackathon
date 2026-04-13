/**
 * M3: Ad-Hoc Mesh Network — Zustand Store
 *
 * Offline-first mesh messaging with store-and-forward relay,
 * E2E encryption, and dual-role node management.
 *
 * Pattern: write to local SQLite FIRST, then attempt server sync.
 * Auto-flush every 30s picks up queued messages.
 */

import { create } from 'zustand';
import { api } from './api';
import * as db from './database';
import * as storage from './storage';
import { transportManager } from './mesh-transport';
import { bleTransport } from './ble-mesh';
import {
  generateBoxKeypair,
  encryptMessage,
  decryptMessage,
  exportKeyBase64,
  importKeyBase64,
} from './mesh-crypto';
import { log } from './debug';
import type { MeshMessage, MeshNodeRole, MeshPeer } from '../types';

// UUID generator (same as storage.ts)
function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

interface RoleSwitch {
  from: MeshNodeRole;
  to: MeshNodeRole;
  reason: string;
  timestamp: string;
}

interface MeshState {
  // State
  inbox: MeshMessage[];
  outbox: MeshMessage[];
  allMessages: MeshMessage[];
  peers: MeshPeer[];
  nodeRole: MeshNodeRole;
  batteryLevel: number;
  signalStrength: number;
  connectedPeers: number;
  isFlushingQueue: boolean;
  lastFlushAt: string | null;
  roleHistory: RoleSwitch[];
  relayedCount: number;
  initialized: boolean;

  // Box keypair
  boxPublicKey: string | null;
  boxSecretKey: string | null;

  // Actions
  initialize: (deviceId: string) => Promise<void>;
  sendMessage: (targetDeviceId: string, plaintext: string, recipientBoxPubKey: string) => Promise<void>;
  checkInbox: () => Promise<void>;
  flushOutbox: () => Promise<void>;
  relayMessages: () => Promise<void>;
  decryptMsg: (msg: MeshMessage) => string | null;
  updateRoleHeuristics: (battery: number, signal: number, peerCount: number) => void;
  fetchAndCachePeers: () => Promise<void>;
  loadLocalMessages: () => Promise<void>;
  resetState: () => void;
}

let _deviceId = '';
let _flushInterval: ReturnType<typeof setInterval> | null = null;

export const useMeshStore = create<MeshState>((set, get) => ({
  inbox: [],
  outbox: [],
  allMessages: [],
  peers: [],
  nodeRole: 'client',
  batteryLevel: 1.0,
  signalStrength: 0.5,
  connectedPeers: 0,
  isFlushingQueue: false,
  lastFlushAt: null,
  roleHistory: [],
  relayedCount: 0,
  initialized: false,
  boxPublicKey: null,
  boxSecretKey: null,

  /**
   * Initialize mesh store: load keys, messages, peers, start auto-flush.
   */
  initialize: async (deviceId: string) => {
    _deviceId = deviceId;
    log('info', 'Mesh store initializing...', deviceId);

    // Load box keypair
    let boxKeys = await storage.loadBoxKeypair();
    if (!boxKeys) {
      log('crypto', 'No box keypair found, generating...');
      const pair = generateBoxKeypair();
      const pub = exportKeyBase64(pair.publicKey);
      const sec = exportKeyBase64(pair.secretKey);
      await storage.storeBoxKeypair(pub, sec);
      boxKeys = { publicKey: pub, secretKey: sec };

      // Register with server (best-effort)
      try {
        await api.post('/auth/register-box-key', { boxPublicKey: pub });
        log('info', 'Box public key registered with server');
      } catch {
        log('info', 'Box key registration deferred (offline)');
      }
    }

    set({
      boxPublicKey: boxKeys.publicKey,
      boxSecretKey: boxKeys.secretKey,
      initialized: true,
    });

    // Initialize transport manager (BLE + HTTP)
    try {
      transportManager.registerBleTransport(bleTransport);
    } catch { /* BLE not available in this build */ }
    await transportManager.initialize(deviceId, boxKeys.publicKey);

    // Register BLE push callback for incoming messages
    transportManager.onMessageReceived = async (msg) => {
      const exists = await db.meshMessageExists(msg.id);
      if (!exists) {
        await db.insertMeshMessage(msg);
        await get().loadLocalMessages();
        log('info', `BLE: Received message ${msg.id.substring(0, 8)}...`);
      }
    };

    // Load local state
    const savedRole = await db.getMeshNodeState('role');
    if (savedRole) set({ nodeRole: savedRole as MeshNodeRole });

    const savedHistory = await db.getMeshNodeState('roleHistory');
    if (savedHistory) {
      try { set({ roleHistory: JSON.parse(savedHistory) }); } catch { /* ignore */ }
    }

    // Load messages from local DB
    await get().loadLocalMessages();

    // Fetch and cache peers (best-effort)
    get().fetchAndCachePeers().catch(() => {});

    // Start auto-flush interval (30s)
    if (_flushInterval) clearInterval(_flushInterval);
    _flushInterval = setInterval(async () => {
      const state = get();
      if (!state.initialized) return;
      await state.flushOutbox();
      await state.checkInbox();
      if (state.nodeRole === 'relay') {
        await state.relayMessages();
      }
    }, 30_000);

    log('info', 'Mesh store initialized', `role=${savedRole || 'client'}, box=${boxKeys.publicKey.substring(0, 12)}...`);
  },

  /**
   * Load all messages from local SQLite.
   */
  loadLocalMessages: async () => {
    try {
      await db.expireOldMeshMessages();
      const all = await db.getAllMeshMessages(_deviceId);
      const inbox = all.filter(m => m.target_device_id === _deviceId);
      const outbox = all.filter(m => m.source_device_id === _deviceId);

      set({
        allMessages: all.map(rowToMessage),
        inbox: inbox.map(rowToMessage),
        outbox: outbox.map(rowToMessage),
      });
    } catch (err) {
      log('error', 'Failed to load mesh messages', (err as Error).message);
    }
  },

  /**
   * Send an encrypted message. Writes to local SQLite first (offline-first).
   */
  sendMessage: async (targetDeviceId: string, plaintext: string, recipientBoxPubKey: string) => {
    const { boxPublicKey, boxSecretKey } = get();
    if (!boxSecretKey || !boxPublicKey) {
      throw new Error('Box keypair not initialized');
    }

    // Encrypt with recipient's public key
    const { ciphertext, nonce } = encryptMessage(
      plaintext,
      importKeyBase64(recipientBoxPubKey),
      importKeyBase64(boxSecretKey),
    );

    const id = uuid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

    const row: db.MeshMessageRow = {
      id,
      source_device_id: _deviceId,
      target_device_id: targetDeviceId,
      relay_device_id: null,
      payload: ciphertext,
      nonce,
      sender_box_pub_key: boxPublicKey,
      ttl: 3,
      hop_count: 0,
      status: 'pending',
      created_at: now.toISOString(),
      expires_at: expiresAt,
    };

    // Write to local SQLite FIRST (offline-first)
    await db.insertMeshMessage(row);
    log('info', 'Mesh message queued locally', `id=${id.substring(0, 8)}..., target=${targetDeviceId.substring(0, 12)}...`);

    // Attempt transport send: BLE (nearby) → HTTP (server) → queue (offline)
    const sent = await transportManager.sendMessage(row);
    if (sent) {
      await db.updateMeshMessageStatus(id, 'relayed');
      row.status = 'relayed';
      log('info', `Mesh message sent via ${transportManager.activeType}`, id.substring(0, 8));
    } else {
      log('info', 'Message queued for later flush (offline)', id.substring(0, 8));
    }

    // Refresh local state
    await get().loadLocalMessages();
  },

  /**
   * Check inbox: try server, then load from local DB.
   */
  checkInbox: async () => {
    // Pull from all transports (BLE + HTTP), deduplicated
    const transportMessages = await transportManager.checkInbox(_deviceId);

    if (transportMessages.length > 0) {
      let newCount = 0;
      for (const msg of transportMessages) {
        const exists = await db.meshMessageExists(msg.id);
        if (!exists) {
          await db.insertMeshMessage(msg);
          newCount++;
        }
      }
      if (newCount > 0) {
        log('info', `Received ${newCount} mesh messages via ${transportManager.activeType}`);
      }
    }

    await get().loadLocalMessages();
  },

  /**
   * Flush pending outbox messages to server.
   */
  flushOutbox: async () => {
    const pending = await db.getPendingOutbox(_deviceId);
    if (pending.length === 0) return;

    set({ isFlushingQueue: true });
    log('info', `Flushing ${pending.length} mesh messages...`);

    let flushed = 0;
    for (const msg of pending) {
      const sent = await transportManager.sendMessage(msg);
      if (sent) {
        await db.updateMeshMessageStatus(msg.id, 'relayed');
        flushed++;
      } else {
        break; // Stop on first failure (likely offline / out of range)
      }
    }

    if (flushed > 0) {
      log('info', `Flushed ${flushed}/${pending.length} mesh messages`);
    }

    set({ isFlushingQueue: false, lastFlushAt: new Date().toISOString() });
    await get().loadLocalMessages();
  },

  /**
   * Relay messages when acting as relay node.
   */
  relayMessages: async () => {
    const relayable = await db.getRelayableMessages(_deviceId);
    if (relayable.length === 0) return;

    let relayed = 0;
    for (const msg of relayable) {
      const success = await transportManager.relayMessage(msg, _deviceId);
      if (success) {
        await db.updateMeshMessageStatus(msg.id, 'relayed');
        relayed++;
      } else {
        break;
      }
    }

    if (relayed > 0) {
      set(s => ({ relayedCount: s.relayedCount + relayed }));
      log('info', `Relayed ${relayed} mesh messages`);
    }
  },

  /**
   * Decrypt a message intended for this device (fully offline).
   */
  decryptMsg: (msg: MeshMessage): string | null => {
    const { boxSecretKey } = get();
    if (!boxSecretKey || !msg.nonce || !msg.senderBoxPubKey) return null;

    return decryptMessage(
      msg.payload,
      msg.nonce,
      importKeyBase64(msg.senderBoxPubKey),
      importKeyBase64(boxSecretKey),
    );
  },

  /**
   * M3.2: Update role heuristics and auto-switch client/relay.
   */
  updateRoleHeuristics: (battery: number, signal: number, peerCount: number) => {
    const currentRole = get().nodeRole;

    // Heuristic: relay if battery > 50%, signal > 0.6, peers >= 2
    let newRole: MeshNodeRole = 'client';
    if (battery > 0.5 && signal > 0.6 && peerCount >= 2) {
      newRole = 'relay';
    }

    set({ batteryLevel: battery, signalStrength: signal, connectedPeers: peerCount });

    if (currentRole !== newRole) {
      const reason = newRole === 'relay'
        ? `battery=${(battery * 100).toFixed(0)}%, signal=${(signal * 100).toFixed(0)}%, peers=${peerCount} — meets relay threshold`
        : `battery=${(battery * 100).toFixed(0)}%, signal=${(signal * 100).toFixed(0)}%, peers=${peerCount} — below relay threshold`;

      const switchEntry: RoleSwitch = {
        from: currentRole,
        to: newRole,
        reason,
        timestamp: new Date().toISOString(),
      };

      const history = [switchEntry, ...get().roleHistory].slice(0, 10);
      set({ nodeRole: newRole, roleHistory: history });

      // Persist role locally
      db.saveMeshNodeState('role', newRole);
      db.saveMeshNodeState('roleHistory', JSON.stringify(history));

      // Report to server (best-effort)
      api.post('/mesh/heartbeat', {
        batteryLevel: battery,
        signalStrength: signal,
        connectedPeers: peerCount,
      }).catch(() => {});

      log('info', `Role switch: ${currentRole} → ${newRole}`, reason);
    }
  },

  /**
   * Fetch peers from server and cache locally for offline use.
   */
  resetState: () => {
    set({
      inbox: [],
      outbox: [],
      allMessages: [],
      peers: [],
    });
  },

  fetchAndCachePeers: async () => {
    // Get peers from all transports (BLE nearby + HTTP server), deduplicated
    const peers = await transportManager.getPeers();

    if (peers.length > 0) {
      // Cache each peer locally for offline use
      for (const peer of peers) {
        if (peer.boxPublicKey && peer.deviceId !== _deviceId) {
          await db.cachePeer(peer.deviceId, peer.boxPublicKey, peer.name, peer.role);
        }
      }
      set({ peers: peers.filter(p => p.deviceId !== _deviceId) });
      log('info', `Discovered ${peers.length} mesh peers (${transportManager.activeType})`);
    } else {
      // Fully offline — load from local cache
      const cached = await db.getCachedPeers();
      set({
        peers: cached.map(p => ({
          deviceId: p.device_id,
          name: p.name,
          boxPublicKey: p.box_public_key,
          role: (p.role || 'field_agent') as any,
        })),
      });
      log('info', `Loaded ${cached.length} peers from cache (offline)`);
    }
  },
}));

/** Convert a database row to a MeshMessage. */
function rowToMessage(row: db.MeshMessageRow): MeshMessage {
  return {
    id: row.id,
    sourceDeviceId: row.source_device_id,
    targetDeviceId: row.target_device_id,
    relayDeviceId: row.relay_device_id,
    payload: row.payload,
    nonce: row.nonce || '',
    senderBoxPubKey: row.sender_box_pub_key || '',
    ttl: row.ttl,
    hopCount: row.hop_count,
    status: row.status as MeshMessage['status'],
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
