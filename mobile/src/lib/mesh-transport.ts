/**
 * M3: Mesh Transport Abstraction Layer
 *
 * Decouples mesh protocol logic from transport mechanism.
 * Two implementations:
 *   - HttpTransport: uses REST API (works on simulators)
 *   - BleTransport: uses Bluetooth LE (works on real devices, no internet needed)
 *
 * TransportManager auto-selects: BLE if available, HTTP as fallback.
 */

import { api } from './api';
import { log } from './debug';
import type { MeshMessageRow } from './database';
import type { MeshPeer } from '../types';

// ── Transport Interface ───────────────────────────────────────────────

export interface MeshTransport {
  initialize(deviceId: string, boxPublicKey: string): Promise<void>;
  shutdown(): Promise<void>;
  sendMessage(msg: MeshMessageRow): Promise<boolean>;
  checkInbox(deviceId: string): Promise<MeshMessageRow[]>;
  getPeers(): Promise<MeshPeer[]>;
  relayMessage(msg: MeshMessageRow, relayDeviceId: string): Promise<boolean>;
  isAvailable(): boolean;
  getType(): 'ble' | 'http';
  onMessageReceived: ((msg: MeshMessageRow) => void) | null;
}

// ── HTTP Transport (server relay, works on simulators) ────────────────

export class HttpTransport implements MeshTransport {
  onMessageReceived: ((msg: MeshMessageRow) => void) | null = null;

  async initialize(): Promise<void> {
    log('info', 'HttpTransport initialized (server relay mode)');
  }

  async shutdown(): Promise<void> {}

  isAvailable(): boolean {
    return true; // always available as fallback
  }

  getType(): 'http' {
    return 'http';
  }

  async sendMessage(msg: MeshMessageRow): Promise<boolean> {
    try {
      await api.post('/mesh/send', {
        targetDeviceId: msg.target_device_id,
        encryptedPayload: msg.payload,
        nonce: msg.nonce,
        senderBoxPubKey: msg.sender_box_pub_key,
        ttl: msg.ttl,
      });
      return true;
    } catch {
      return false;
    }
  }

  async checkInbox(deviceId: string): Promise<MeshMessageRow[]> {
    try {
      const response = await api.get<{ data: { messages: any[]; count: number } }>(
        `/mesh/inbox/${deviceId}`,
      );
      const messages = response.data.messages;

      // ACK received messages (best-effort)
      if (messages.length > 0) {
        const ids = messages.map((m: any) => m.id);
        try {
          await api.post('/mesh/ack', { messageIds: ids });
        } catch { /* best-effort */ }
      }

      return messages.map((m: any) => ({
        id: m.id,
        source_device_id: m.source_device_id,
        target_device_id: m.target_device_id,
        relay_device_id: m.relay_device_id,
        payload: m.payload,
        nonce: m.nonce,
        sender_box_pub_key: m.sender_box_pub_key,
        ttl: m.ttl,
        hop_count: m.hop_count,
        status: 'delivered' as const,
        created_at: m.created_at,
        expires_at: m.expires_at,
      }));
    } catch {
      return []; // offline
    }
  }

  async getPeers(): Promise<MeshPeer[]> {
    try {
      const response = await api.get<{ data: MeshPeer[] }>('/mesh/peers');
      return response.data;
    } catch {
      return [];
    }
  }

  async relayMessage(msg: MeshMessageRow, _relayDeviceId: string): Promise<boolean> {
    try {
      const response = await api.post<{ data: { relayed: boolean } }>('/mesh/relay', {
        message: {
          id: msg.id,
          sourceDeviceId: msg.source_device_id,
          targetDeviceId: msg.target_device_id,
          payload: msg.payload,
          nonce: msg.nonce,
          senderBoxPubKey: msg.sender_box_pub_key,
          ttl: msg.ttl,
          hopCount: msg.hop_count,
          expiresAt: msg.expires_at,
        },
      });
      return response.data.relayed;
    } catch {
      return false;
    }
  }
}

// ── Transport Manager ─────────────────────────────────────────────────

export class TransportManager {
  private transports: MeshTransport[] = [];
  private _bleTransport: MeshTransport | null = null;
  private _httpTransport: HttpTransport;

  constructor() {
    this._httpTransport = new HttpTransport();
    this.transports = [this._httpTransport];
  }

  /** Register the BLE transport (called from ble-mesh.ts when available) */
  registerBleTransport(ble: MeshTransport): void {
    this._bleTransport = ble;
    // BLE is priority — put it first
    this.transports = [ble, this._httpTransport];
    log('info', 'BLE transport registered');
  }

  async initialize(deviceId: string, boxPublicKey: string): Promise<void> {
    for (const t of this.transports) {
      await t.initialize(deviceId, boxPublicKey);
    }
  }

  async shutdown(): Promise<void> {
    for (const t of this.transports) {
      await t.shutdown();
    }
  }

  /** Get the active (highest-priority available) transport */
  getActiveTransport(): MeshTransport {
    for (const t of this.transports) {
      if (t.isAvailable()) return t;
    }
    return this._httpTransport; // always fallback
  }

  /** Send via BLE if peer is nearby, else HTTP */
  async sendMessage(msg: MeshMessageRow): Promise<boolean> {
    // Try BLE first if available
    if (this._bleTransport?.isAvailable()) {
      const sent = await this._bleTransport.sendMessage(msg);
      if (sent) return true;
    }
    // Fallback to HTTP
    return this._httpTransport.sendMessage(msg);
  }

  /** Check inbox from all available transports */
  async checkInbox(deviceId: string): Promise<MeshMessageRow[]> {
    const results: MeshMessageRow[] = [];

    // BLE inbox (push-based, buffered)
    if (this._bleTransport?.isAvailable()) {
      const bleMessages = await this._bleTransport.checkInbox(deviceId);
      results.push(...bleMessages);
    }

    // HTTP inbox
    const httpMessages = await this._httpTransport.checkInbox(deviceId);
    results.push(...httpMessages);

    // Deduplicate by message ID
    const seen = new Set<string>();
    return results.filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  /** Get peers from all transports (union) */
  async getPeers(): Promise<MeshPeer[]> {
    const allPeers: MeshPeer[] = [];

    if (this._bleTransport?.isAvailable()) {
      const blePeers = await this._bleTransport.getPeers();
      allPeers.push(...blePeers);
    }

    const httpPeers = await this._httpTransport.getPeers();
    allPeers.push(...httpPeers);

    // Deduplicate by deviceId
    const seen = new Set<string>();
    return allPeers.filter(p => {
      if (seen.has(p.deviceId)) return false;
      seen.add(p.deviceId);
      return true;
    });
  }

  /** Relay via BLE first, then HTTP */
  async relayMessage(msg: MeshMessageRow, relayDeviceId: string): Promise<boolean> {
    if (this._bleTransport?.isAvailable()) {
      const relayed = await this._bleTransport.relayMessage(msg, relayDeviceId);
      if (relayed) return true;
    }
    return this._httpTransport.relayMessage(msg, relayDeviceId);
  }

  /** Set message received callback on all transports */
  set onMessageReceived(cb: ((msg: MeshMessageRow) => void) | null) {
    for (const t of this.transports) {
      t.onMessageReceived = cb;
    }
  }

  /** Check if BLE is active */
  get isBleActive(): boolean {
    return this._bleTransport?.isAvailable() ?? false;
  }

  get activeType(): 'ble' | 'http' {
    return this.getActiveTransport().getType();
  }
}

/** Singleton transport manager */
export const transportManager = new TransportManager();
