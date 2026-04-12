/**
 * QR Code Pairing — exchange device info for mesh networking over LAN.
 *
 * Devices display a QR code containing their deviceId, box public key,
 * local IP, and optional backend server URL. Scanning another device's
 * QR code pairs them and optionally switches the API to a local backend.
 */

import { cachePeer } from './database';
import { api } from './api';
import { log } from './debug';

export interface QRPairingPayload {
  v: 1; // version tag so we can detect our own QR codes
  deviceId: string;
  boxPublicKey: string;
  name: string | null;
  ipAddress: string | null;
  serverUrl: string | null; // e.g. "http://192.168.1.5:3001/api/v1"
  timestamp: number;
}

/** Build a JSON string to encode into a QR code */
export function buildQRPayload(
  deviceId: string,
  boxPublicKey: string,
  name: string | null,
  ipAddress: string | null,
  serverUrl: string | null,
): string {
  const payload: QRPairingPayload = {
    v: 1,
    deviceId,
    boxPublicKey,
    name,
    ipAddress,
    serverUrl,
    timestamp: Date.now(),
  };
  return JSON.stringify(payload);
}

/** Parse and validate a scanned QR code string. Returns null if invalid. */
export function parseQRPayload(data: string): QRPairingPayload | null {
  try {
    const obj = JSON.parse(data);
    if (obj.v !== 1 || !obj.deviceId || !obj.boxPublicKey) return null;
    return obj as QRPairingPayload;
  } catch {
    return null;
  }
}

/** Save a scanned peer to the local database and optionally switch backend URL. */
export async function pairWithScannedDevice(
  payload: QRPairingPayload,
  switchServer: boolean = false,
): Promise<void> {
  // Save peer with network info
  await cachePeer(
    payload.deviceId,
    payload.boxPublicKey,
    payload.name,
    null, // role unknown until heartbeat
    payload.ipAddress,
    null, // port embedded in serverUrl
  );

  // Optionally switch API to the scanned device's local backend
  if (switchServer && payload.serverUrl) {
    await api.saveBaseUrl(payload.serverUrl);
    log('info', 'Switched API to LAN backend via QR', payload.serverUrl);
  }

  log('info', 'Paired with device via QR', payload.deviceId);
}
