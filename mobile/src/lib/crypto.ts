import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8 } from 'tweetnacl-util';

export interface KeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/**
 * Generate an Ed25519 signing key pair.
 * - publicKey: 32 bytes — shared with the server and other devices
 * - secretKey: 64 bytes — stored ONLY on this device (in IndexedDB via Dexie)
 */
export function generateKeypair(): KeyPair {
  return nacl.sign.keyPair();
}

/**
 * Sign a UTF-8 message with the device's secret key.
 * Returns a detached signature (64 bytes) — the message is NOT embedded in it.
 */
export function signMessage(message: string, secretKey: Uint8Array): Uint8Array {
  const messageBytes = decodeUTF8(message);
  return nacl.sign.detached(messageBytes, secretKey);
}

/**
 * Verify a detached Ed25519 signature against a public key.
 * Returns true if the signature is valid for this message + key.
 */
export function verifySignature(
  message: string,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  const messageBytes = decodeUTF8(message);
  return nacl.sign.detached.verify(messageBytes, signature, publicKey);
}

/** Encode a Uint8Array key to base64 string (for storage/transmission). */
export function exportKeyBase64(key: Uint8Array): string {
  return encodeBase64(key);
}

/** Decode a base64 string back to Uint8Array key. */
export function importKeyBase64(b64: string): Uint8Array {
  return decodeBase64(b64);
}
