import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';
import { getDatabase } from './database';

// We use a simple JS SHA-256 since crypto.subtle isn't available in React Native
// tweetnacl.hash is SHA-512, so we use it and truncate for a unique hash
function sha256Hex(input: string): string {
  const hash = nacl.hash(decodeUTF8(input));
  // Convert first 32 bytes to hex (equivalent strength to SHA-256)
  return Array.from(hash.slice(0, 32)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface PodPayload {
  delivery_id: string;
  sender_pubkey: string;
  sender_device_id: string;
  payload_hash: string;
  nonce: string;
  timestamp: string;
}

export interface PodChallenge {
  pod_payload: PodPayload;
  canonical_string: string;
  signature: string;
}

export interface PodReceipt {
  id: string;
  delivery_id: string;
  sender_device_id: string;
  receiver_device_id: string;
  sender_signature: string;
  receiver_signature: string;
  payload_hash: string;
  nonce: string;
  status: string;
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const POD_EXPIRY_MINUTES = 5;

/**
 * M5.1: Generate a signed PoD payload (driver side)
 * Creates the QR data that the recipient will scan.
 */
export function generatePodPayload(
  deliveryId: string,
  senderDeviceId: string,
  senderPublicKey: Uint8Array,
  senderSecretKey: Uint8Array,
  supplyDetails?: string,
): PodChallenge {
  const payloadHash = sha256Hex(supplyDetails || deliveryId);
  const nonce = uuid();
  const timestamp = new Date().toISOString();

  const podPayload: PodPayload = {
    delivery_id: deliveryId,
    sender_pubkey: encodeBase64(senderPublicKey),
    sender_device_id: senderDeviceId,
    payload_hash: payloadHash,
    nonce,
    timestamp,
  };

  const canonicalString = JSON.stringify(podPayload);
  const messageBytes = decodeUTF8(canonicalString);
  const signatureBytes = nacl.sign.detached(messageBytes, senderSecretKey);

  return {
    pod_payload: podPayload,
    canonical_string: canonicalString,
    signature: encodeBase64(signatureBytes),
  };
}

/**
 * M5.1 + M5.2: Verify a PoD payload (recipient side)
 * Checks signature, nonce reuse, and expiry.
 */
export async function verifyPodPayload(
  challenge: PodChallenge,
): Promise<{ valid: true } | { valid: false; code: string; message: string }> {
  const { pod_payload, canonical_string, signature } = challenge;

  // M5.2: Check timestamp expiry
  const podTime = new Date(pod_payload.timestamp).getTime();
  const now = Date.now();
  if (now - podTime > POD_EXPIRY_MINUTES * 60 * 1000) {
    return { valid: false, code: 'EXPIRED', message: `PoD expired — older than ${POD_EXPIRY_MINUTES} minutes` };
  }

  // M5.2: Check nonce not reused
  const used = await isNonceUsed(pod_payload.nonce);
  if (used) {
    return { valid: false, code: 'NONCE_REUSED', message: 'Nonce already used — replay detected' };
  }

  // M5.1: Verify sender signature
  try {
    const messageBytes = decodeUTF8(canonical_string);
    const signatureBytes = decodeBase64(signature);
    const publicKeyBytes = decodeBase64(pod_payload.sender_pubkey);
    const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    if (!valid) {
      return { valid: false, code: 'SIGNATURE_INVALID', message: 'Sender signature invalid — tampered payload' };
    }
  } catch {
    return { valid: false, code: 'SIGNATURE_INVALID', message: 'Failed to verify signature' };
  }

  return { valid: true };
}

/**
 * M5.1: Countersign a verified PoD payload (recipient side)
 * Returns the receiver's signature.
 */
export function countersignPod(
  canonicalString: string,
  receiverSecretKey: Uint8Array,
): string {
  const messageBytes = decodeUTF8(canonicalString);
  const signatureBytes = nacl.sign.detached(messageBytes, receiverSecretKey);
  return encodeBase64(signatureBytes);
}

/**
 * M5.2: Check if a nonce has been used locally
 */
export async function isNonceUsed(nonce: string): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ nonce: string }>('SELECT nonce FROM used_nonces WHERE nonce = ?', [nonce]);
  return !!row;
}

/**
 * M5.2: Mark a nonce as used locally
 */
export async function markNonceUsed(nonce: string, deliveryId: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('INSERT OR IGNORE INTO used_nonces (nonce, delivery_id) VALUES (?, ?)', [nonce, deliveryId]);
}

/**
 * Store a confirmed PoD receipt locally for offline sync (M5.3)
 */
export async function storePodReceipt(receipt: PodReceipt): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR REPLACE INTO pod_receipts (id, delivery_id, sender_device_id, receiver_device_id, sender_signature, receiver_signature, payload_hash, nonce, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [receipt.id, receipt.delivery_id, receipt.sender_device_id, receipt.receiver_device_id,
     receipt.sender_signature, receipt.receiver_signature, receipt.payload_hash, receipt.nonce, receipt.status],
  );
}

/**
 * Get all locally stored PoD receipts
 */
export async function getLocalReceipts(): Promise<PodReceipt[]> {
  const db = await getDatabase();
  return db.getAllAsync<PodReceipt>('SELECT * FROM pod_receipts ORDER BY created_at DESC');
}
