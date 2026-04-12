/**
 * M3: BLE Mesh Transport
 *
 * Bluetooth Low Energy transport for device-to-device mesh communication.
 * Works without any internet, WiFi, or cellular infrastructure.
 *
 * Uses:
 *   - react-native-ble-advertiser: advertise presence (peripheral mode)
 *   - react-native-ble-plx: scan, connect, read/write (central mode)
 *
 * On simulator: isAvailable() returns false, TransportManager uses HTTP.
 * On real device: BLE handles nearby peers, HTTP is fallback for remote.
 */

import { Platform } from 'react-native';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';
import { log } from './debug';
import type { MeshTransport } from './mesh-transport';
import type { MeshMessageRow } from './database';
import type { MeshPeer } from '../types';

/** Base64 string → UTF-8 string (React Native compatible, no Buffer needed) */
function b64ToUtf8(b64: string): string {
  const bytes = decodeBase64(b64);
  return new TextDecoder().decode(bytes);
}

/** Uint8Array → base64 string */
function bytesToB64(bytes: Uint8Array): string {
  return encodeBase64(bytes);
}

// ── BLE UUIDs ─────────────────────────────────────────────────────────

const MESH_SERVICE_UUID = '0000DD01-0000-1000-8000-00805F9B34FB';
const DEVICE_INFO_CHAR_UUID = '0000DD02-0000-1000-8000-00805F9B34FB';
const MSG_WRITE_CHAR_UUID = '0000DD03-0000-1000-8000-00805F9B34FB';

// ── Chunking Protocol ─────────────────────────────────────────────────

const DEFAULT_MTU = 20;
const CHUNK_HEADER_SIZE = 3; // [index, total, flags]

export function chunkMessage(json: string, mtu: number = DEFAULT_MTU): Uint8Array[] {
  const data = new TextEncoder().encode(json);
  const chunkDataSize = Math.max(mtu - CHUNK_HEADER_SIZE, 1);
  const totalChunks = Math.ceil(data.length / chunkDataSize);
  const chunks: Uint8Array[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkDataSize;
    const end = Math.min(start + chunkDataSize, data.length);
    const chunkData = data.slice(start, end);

    const flags = (i === 0 ? 0x01 : 0) | (i === totalChunks - 1 ? 0x02 : 0);
    const chunk = new Uint8Array(CHUNK_HEADER_SIZE + chunkData.length);
    chunk[0] = i;           // chunk index
    chunk[1] = totalChunks; // total chunks
    chunk[2] = flags;       // flags
    chunk.set(chunkData, CHUNK_HEADER_SIZE);

    chunks.push(chunk);
  }

  return chunks;
}

export function reassembleChunks(chunks: Uint8Array[]): string | null {
  if (chunks.length === 0) return null;

  const totalExpected = chunks[0][1];
  if (chunks.length !== totalExpected) return null; // incomplete

  // Sort by index
  const sorted = [...chunks].sort((a, b) => a[0] - b[0]);

  // Concatenate data portions
  const parts: Uint8Array[] = sorted.map(c => c.slice(CHUNK_HEADER_SIZE));
  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    combined.set(part, offset);
    offset += part.length;
  }

  return new TextDecoder().decode(combined);
}

// ── BLE Peer Discovery Entry ──────────────────────────────────────────

interface BlePeer {
  deviceId: string;
  boxPublicKey: string;
  name: string | null;
  role: string;
  peripheralId: string;
  rssi: number;
  lastSeen: number;
}

// ── BLE Transport Implementation ──────────────────────────────────────

export class BleTransport implements MeshTransport {
  onMessageReceived: ((msg: MeshMessageRow) => void) | null = null;

  private _deviceId = '';
  private _boxPublicKey = '';
  private _available = false;
  private _scanning = false;
  private discoveredPeers = new Map<string, BlePeer>();
  private inboxBuffer: MeshMessageRow[] = [];
  private bleManager: any = null;
  private bleAdvertiser: any = null;
  private pruneInterval: ReturnType<typeof setInterval> | null = null;

  isAvailable(): boolean {
    return this._available;
  }

  getType(): 'ble' {
    return 'ble';
  }

  async initialize(deviceId: string, boxPublicKey: string): Promise<void> {
    this._deviceId = deviceId;
    this._boxPublicKey = boxPublicKey;

    // Check if running on a real device
    try {
      const Constants = require('expo-constants').default;
      const isDevice = Constants.isDevice;

      if (!isDevice) {
        log('info', 'BLE: Running on simulator — BLE unavailable');
        this._available = false;
        return;
      }
    } catch {
      // expo-constants not available, try platform check
      if (__DEV__ && Platform.OS === 'web') {
        this._available = false;
        return;
      }
    }

    try {
      // Import BLE libraries (only available in dev builds with native modules)
      const BleManagerModule = require('react-native-ble-plx');
      this.bleManager = new BleManagerModule.BleManager();

      // Check BLE adapter state
      const state = await this.bleManager.state();
      if (state !== 'PoweredOn') {
        log('info', `BLE: Adapter state is ${state}, waiting...`);
        // Wait for power on
        await new Promise<void>((resolve) => {
          const sub = this.bleManager.onStateChange((newState: string) => {
            if (newState === 'PoweredOn') {
              sub.remove();
              resolve();
            }
          }, true);
          // Timeout after 5s
          setTimeout(() => { sub.remove(); resolve(); }, 5000);
        });
      }

      // Start advertising
      await this.startAdvertising();

      // Start scanning
      await this.startScanning();

      // Prune stale peers every 30s
      this.pruneInterval = setInterval(() => this.pruneStale(), 30_000);

      this._available = true;
      log('info', `BLE: Transport initialized, advertising as ${deviceId.substring(0, 12)}...`);
    } catch (err) {
      log('info', `BLE: Not available — ${(err as Error).message}`);
      this._available = false;
    }
  }

  async shutdown(): Promise<void> {
    this._available = false;
    if (this.pruneInterval) clearInterval(this.pruneInterval);

    try {
      if (this.bleManager) {
        this.bleManager.stopDeviceScan();
        this.bleManager.destroy();
      }
      if (this.bleAdvertiser) {
        this.bleAdvertiser.stopBroadcast();
      }
    } catch { /* cleanup best-effort */ }

    log('info', 'BLE: Transport shut down');
  }

  // ── Advertising (Peripheral mode) ─────────────────────────────────

  private async startAdvertising(): Promise<void> {
    try {
      this.bleAdvertiser = require('react-native-ble-advertiser').default;

      // Request permissions on Android
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        await PermissionsAndroid.requestMultiple([
          'android.permission.BLUETOOTH_SCAN',
          'android.permission.BLUETOOTH_ADVERTISE',
          'android.permission.BLUETOOTH_CONNECT',
          'android.permission.ACCESS_FINE_LOCATION',
        ]);
      }

      // Encode deviceId hash into manufacturer data (first 8 bytes)
      const idBytes = new TextEncoder().encode(this._deviceId);
      const manufacturerData = Array.from(idBytes.slice(0, 8));

      await this.bleAdvertiser.broadcast(
        MESH_SERVICE_UUID,
        manufacturerData,
        {
          advertiseMode: 1, // ADVERTISE_MODE_BALANCED
          txPowerLevel: 2,  // ADVERTISE_TX_POWER_MEDIUM
          connectable: true,
          includeDeviceName: false,
        },
      );

      log('info', 'BLE: Advertising started');
    } catch (err) {
      log('error', 'BLE: Failed to start advertising', (err as Error).message);
    }
  }

  // ── Scanning (Central mode) ───────────────────────────────────────

  private async startScanning(): Promise<void> {
    if (!this.bleManager || this._scanning) return;
    this._scanning = true;

    try {
      this.bleManager.startDeviceScan(
        [MESH_SERVICE_UUID],
        { allowDuplicates: true },
        (error: any, device: any) => {
          if (error) {
            log('error', 'BLE: Scan error', error.message);
            return;
          }
          if (device) {
            this.onDeviceDiscovered(device);
          }
        },
      );
      log('info', 'BLE: Scanning for mesh peers...');
    } catch (err) {
      log('error', 'BLE: Failed to start scanning', (err as Error).message);
      this._scanning = false;
    }
  }

  private async onDeviceDiscovered(device: any): Promise<void> {
    const peripheralId = device.id;

    // Skip if we already know this peer recently
    const existing = Array.from(this.discoveredPeers.values())
      .find(p => p.peripheralId === peripheralId);
    if (existing && Date.now() - existing.lastSeen < 10_000) return; // refresh every 10s

    try {
      // Connect to read device info
      const connected = await this.bleManager.connectToDevice(peripheralId, { timeout: 5000 });
      await connected.discoverAllServicesAndCharacteristics();

      // Read device info characteristic
      const infoChar = await connected.readCharacteristicForService(
        MESH_SERVICE_UUID,
        DEVICE_INFO_CHAR_UUID,
      );

      if (infoChar?.value) {
        const decoded = b64ToUtf8(infoChar.value);
        const info = JSON.parse(decoded);

        this.discoveredPeers.set(info.deviceId, {
          deviceId: info.deviceId,
          boxPublicKey: info.boxPublicKey,
          name: info.name || null,
          role: info.role || 'field_agent',
          peripheralId,
          rssi: device.rssi || -100,
          lastSeen: Date.now(),
        });

        log('info', `BLE: Discovered peer ${info.deviceId.substring(0, 12)}... RSSI=${device.rssi}`);
      }

      await connected.cancelConnection();
    } catch {
      // Connection failed — peer may have moved away, ignore
    }
  }

  private pruneStale(): void {
    const now = Date.now();
    for (const [id, peer] of this.discoveredPeers) {
      if (now - peer.lastSeen > 60_000) { // 60s timeout
        this.discoveredPeers.delete(id);
      }
    }
  }

  // ── Transport Interface Methods ───────────────────────────────────

  async sendMessage(msg: MeshMessageRow): Promise<boolean> {
    const peer = this.discoveredPeers.get(msg.target_device_id);
    if (!peer) return false; // peer not in BLE range

    try {
      const json = JSON.stringify({
        id: msg.id,
        source_device_id: msg.source_device_id,
        target_device_id: msg.target_device_id,
        relay_device_id: msg.relay_device_id,
        payload: msg.payload,
        nonce: msg.nonce,
        sender_box_pub_key: msg.sender_box_pub_key,
        ttl: msg.ttl,
        hop_count: msg.hop_count,
        status: msg.status,
        created_at: msg.created_at,
        expires_at: msg.expires_at,
      });

      // Connect and negotiate MTU
      const device = await this.bleManager.connectToDevice(peer.peripheralId, { timeout: 5000 });
      await device.discoverAllServicesAndCharacteristics();

      let mtu = DEFAULT_MTU;
      try {
        const negotiated = await device.requestMTU(185);
        mtu = negotiated.mtu || DEFAULT_MTU;
      } catch { /* use default */ }

      // Chunk and send
      const chunks = chunkMessage(json, mtu);
      for (const chunk of chunks) {
        const b64 = bytesToB64(chunk);
        await device.writeCharacteristicWithResponseForService(
          MESH_SERVICE_UUID,
          MSG_WRITE_CHAR_UUID,
          b64,
        );
      }

      await device.cancelConnection();
      log('info', `BLE: Sent message to ${peer.deviceId.substring(0, 12)}... (${chunks.length} chunks)`);
      return true;
    } catch (err) {
      log('error', `BLE: Send failed to ${peer.deviceId.substring(0, 12)}...`, (err as Error).message);
      return false;
    }
  }

  async checkInbox(): Promise<MeshMessageRow[]> {
    // BLE is push-based — return buffered messages and clear
    const messages = [...this.inboxBuffer];
    this.inboxBuffer = [];
    return messages;
  }

  async getPeers(): Promise<MeshPeer[]> {
    return Array.from(this.discoveredPeers.values()).map(p => ({
      deviceId: p.deviceId,
      name: p.name,
      boxPublicKey: p.boxPublicKey,
      role: p.role as any,
    }));
  }

  async relayMessage(msg: MeshMessageRow): Promise<boolean> {
    // Flood relay: try to send to all known BLE peers (except source)
    let relayed = false;
    for (const peer of this.discoveredPeers.values()) {
      if (peer.deviceId === msg.source_device_id) continue;
      if (peer.deviceId === msg.relay_device_id) continue;
      try {
        const sent = await this.sendMessage({ ...msg, target_device_id: peer.deviceId });
        if (sent) relayed = true;
      } catch { /* continue to next peer */ }
    }
    return relayed;
  }

  // ── Public Getters ────────────────────────────────────────────────

  get nearbyPeerCount(): number {
    return this.discoveredPeers.size;
  }

  get nearbyPeers(): BlePeer[] {
    return Array.from(this.discoveredPeers.values());
  }

  get isScanning(): boolean {
    return this._scanning;
  }
}

// ── BLE Transport Singleton ───────────────────────────────────────────

export const bleTransport = new BleTransport();
