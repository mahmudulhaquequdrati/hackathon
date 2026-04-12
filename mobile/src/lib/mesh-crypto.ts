/**
 * M3.3: End-to-End Mesh Message Encryption
 *
 * Uses nacl.box (Curve25519-XSalsa20-Poly1305) for asymmetric encryption.
 * Separate from crypto.ts which handles Ed25519 signing.
 * Relay nodes cannot decrypt — only the intended recipient can.
 */

import naclDefault from 'tweetnacl';
import { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } from 'tweetnacl-util';

// tweetnacl type defs don't expose box/randomBytes on the default export,
// but they exist at runtime. Cast for access.
const nacl = naclDefault as any;

export interface BoxKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface EncryptedPayload {
  ciphertext: string; // base64
  nonce: string;      // base64
}

/**
 * Generate an x25519 box keypair for mesh encryption.
 * This is separate from the Ed25519 signing keypair (M1.2).
 */
export function generateBoxKeypair(): BoxKeyPair {
  return nacl.box.keyPair();
}

/**
 * Encrypt a plaintext message for a specific recipient.
 * Only the recipient (with their box secret key) can decrypt.
 */
export function encryptMessage(
  plaintext: string,
  recipientBoxPubKey: Uint8Array,
  senderBoxSecretKey: Uint8Array,
): EncryptedPayload {
  const nonce = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
  const messageBytes = decodeUTF8(plaintext);
  const encrypted = nacl.box(messageBytes, nonce, recipientBoxPubKey, senderBoxSecretKey);
  if (!encrypted) throw new Error('Encryption failed');
  return {
    ciphertext: encodeBase64(encrypted),
    nonce: encodeBase64(nonce),
  };
}

/**
 * Decrypt a message intended for this device.
 * Returns null if decryption fails (wrong key, tampered, etc.).
 */
export function decryptMessage(
  ciphertextB64: string,
  nonceB64: string,
  senderBoxPubKey: Uint8Array,
  recipientBoxSecretKey: Uint8Array,
): string | null {
  try {
    const ciphertext = decodeBase64(ciphertextB64);
    const nonce = decodeBase64(nonceB64);
    const decrypted = nacl.box.open(ciphertext, nonce, senderBoxPubKey, recipientBoxSecretKey);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch {
    return null;
  }
}

/** Encode a Uint8Array key to base64 string. */
export function exportKeyBase64(key: Uint8Array): string {
  return encodeBase64(key);
}

/** Decode a base64 string back to Uint8Array key. */
export function importKeyBase64(b64: string): Uint8Array {
  return decodeBase64(b64);
}
