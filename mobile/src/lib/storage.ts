import * as SecureStore from 'expo-secure-store';

const KEYS = {
  DEVICE_ID: 'digital_delta_device_id',
  PUBLIC_KEY: 'digital_delta_public_key',
  SECRET_KEY: 'digital_delta_secret_key',
  TOTP_SECRET: 'digital_delta_totp_secret',
  JWT_TOKEN: 'digital_delta_jwt_token',
  USER_DATA: 'digital_delta_user_data',
} as const;

/** Get or generate a unique device ID */
export async function getDeviceId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEYS.DEVICE_ID);
  if (!id) {
    id = generateUUID();
    await SecureStore.setItemAsync(KEYS.DEVICE_ID, id);
  }
  return id;
}

/** Store Ed25519 keypair in SecureStore (uses iOS Keychain / Android Keystore) */
export async function storeKeypair(publicKey: string, secretKey: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.PUBLIC_KEY, publicKey);
  await SecureStore.setItemAsync(KEYS.SECRET_KEY, secretKey);
}

/** Load keypair from SecureStore */
export async function loadKeypair(): Promise<{ publicKey: string; secretKey: string } | null> {
  const publicKey = await SecureStore.getItemAsync(KEYS.PUBLIC_KEY);
  const secretKey = await SecureStore.getItemAsync(KEYS.SECRET_KEY);
  if (publicKey && secretKey) return { publicKey, secretKey };
  return null;
}

/** Store TOTP secret in SecureStore */
export async function storeTotpSecret(secret: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.TOTP_SECRET, secret);
}

/** Load TOTP secret from SecureStore */
export async function loadTotpSecret(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.TOTP_SECRET);
}

/** Store JWT token */
export async function storeToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(KEYS.JWT_TOKEN, token);
}

/** Load JWT token */
export async function loadToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.JWT_TOKEN);
}

/** Store user data as JSON */
export async function storeUserData(user: object): Promise<void> {
  await SecureStore.setItemAsync(KEYS.USER_DATA, JSON.stringify(user));
}

/** Load user data from JSON */
export async function loadUserData<T>(): Promise<T | null> {
  const data = await SecureStore.getItemAsync(KEYS.USER_DATA);
  if (data) return JSON.parse(data) as T;
  return null;
}

/** Clear all stored data (logout) */
export async function clearAll(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.JWT_TOKEN);
  await SecureStore.deleteItemAsync(KEYS.USER_DATA);
  // Keep device ID, keypair, and TOTP secret — they persist across sessions
}

/** Simple UUID v4 generator (no external dep needed) */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
