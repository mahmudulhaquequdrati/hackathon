import { create } from 'zustand';
import type { Role } from '../types';
import { api } from './api';
import * as storage from './storage';
import { generateKeypair, exportKeyBase64 } from './crypto';
import { generateOtp, verifyOtp as verifyOtpLocal, getTimeRemaining } from './totp';
import { log } from './debug';

interface AuthState {
  user: { id: string; deviceId: string; name: string | null; role: Role; publicKey: string | null } | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  deviceId: string;

  // M1.2: Keypair
  publicKey: string | null;
  secretKey: string | null;

  // M1.1: TOTP
  totpSecret: string | null;
  currentOtp: string | null;
  otpTimeRemaining: number;

  // Actions
  initialize: () => Promise<void>;
  registerDevice: (role?: Role, name?: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  refreshOtp: () => void;
  logout: () => Promise<void>;
  hasPermission: (resource: string, action: string) => boolean;
}

const PERMISSIONS: Record<string, { read: string[] | '*'; write: string[] | '*'; execute: string[] | '*' }> = {
  commander:    { read: '*', write: '*', execute: '*' },
  dispatcher:   { read: '*', write: ['supplies', 'deliveries', 'triage'], execute: ['routes'] },
  field_agent:  { read: ['supplies', 'deliveries', 'nodes'], write: ['deliveries', 'pod_receipts'], execute: [] },
  drone_pilot:  { read: ['routes', 'deliveries', 'nodes'], write: ['deliveries'], execute: ['fleet'] },
  observer:     { read: '*', write: [], execute: [] },
};

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  deviceId: '',
  publicKey: null,
  secretKey: null,
  totpSecret: null,
  currentOtp: null,
  otpTimeRemaining: 0,

  /** Load persisted state from SecureStore on app startup */
  initialize: async () => {
    const deviceId = await storage.getDeviceId();
    const keypair = await storage.loadKeypair();
    const totpSecret = await storage.loadTotpSecret();
    const token = await storage.loadToken();
    const user = await storage.loadUserData<AuthState['user']>();

    let currentOtp: string | null = null;
    if (totpSecret) {
      currentOtp = generateOtp(totpSecret);
    }

    if (token) {
      api.setToken(token);
    }

    set({
      deviceId,
      publicKey: keypair?.publicKey || null,
      secretKey: keypair?.secretKey || null,
      totpSecret,
      currentOtp,
      otpTimeRemaining: totpSecret ? getTimeRemaining() : 0,
      token,
      user,
      isAuthenticated: !!token || !!totpSecret, // Can auth offline if has TOTP secret
    });
  },

  /** Register device: generate keypair + send pubkey to server + get TOTP secret */
  registerDevice: async (role?: Role, name?: string) => {
    set({ isLoading: true, error: null });
    try {
      const { deviceId } = get();
      log('crypto', 'Generating Ed25519 keypair...');

      // Generate keypair
      const pair = generateKeypair();
      const pubB64 = exportKeyBase64(pair.publicKey);
      const secB64 = exportKeyBase64(pair.secretKey);
      log('crypto', 'Keypair generated', `pub=${pubB64.substring(0, 16)}...`);

      // Store keypair in SecureStore
      await storage.storeKeypair(pubB64, secB64);

      // Register with server
      const response = await api.post<{
        data: {
          user: AuthState['user'];
          totp: { secret: string };
        };
      }>('/auth/register', {
        deviceId,
        publicKey: pubB64,
        role: role || 'field_agent',
        name,
      });

      const { user, totp } = response.data;

      // Store TOTP secret
      await storage.storeTotpSecret(totp.secret);
      if (user) await storage.storeUserData(user);

      const currentOtp = generateOtp(totp.secret);

      set({
        publicKey: pubB64,
        secretKey: secB64,
        user,
        totpSecret: totp.secret,
        currentOtp,
        otpTimeRemaining: getTimeRemaining(),
        isLoading: false,
      });
      log('info', 'Registration complete', `role=${user?.role}`);
    } catch (err) {
      log('error', 'Registration failed', (err as Error).message);
      set({ isLoading: false, error: (err as Error).message });
    }
  },

  /** Verify OTP: tries server first, falls back to offline local verification */
  verifyOtp: async (otp: string) => {
    set({ isLoading: true, error: null });
    const { deviceId, totpSecret } = get();

    try {
      // Try online verification
      const response = await api.post<{
        data: {
          token: string;
          user: AuthState['user'];
        };
      }>('/auth/verify-otp', { deviceId, token: otp });

      const { token, user } = response.data;
      await storage.storeToken(token);
      if (user) await storage.storeUserData(user);
      api.setToken(token);

      set({ token, user, isAuthenticated: true, isLoading: false });
    } catch {
      // Offline fallback
      if (totpSecret && verifyOtpLocal(totpSecret, otp)) {
        set({ isAuthenticated: true, isLoading: false });
      } else {
        set({ isLoading: false, error: 'Invalid or expired OTP' });
      }
    }
  },

  /** Refresh OTP display (called every second) */
  refreshOtp: () => {
    const { totpSecret } = get();
    if (!totpSecret) return;
    set({
      currentOtp: generateOtp(totpSecret),
      otpTimeRemaining: getTimeRemaining(),
    });
  },

  /** Logout — clear token + user, keep keys and TOTP secret */
  logout: async () => {
    await storage.clearAll();
    api.setToken(null);
    set({ token: null, user: null, isAuthenticated: false });
  },

  /** Client-side RBAC permission check */
  hasPermission: (resource: string, action: string): boolean => {
    const { user } = get();
    if (!user) return false;
    const perms = PERMISSIONS[user.role];
    if (!perms) return false;
    const allowed = perms[action as keyof typeof perms];
    if (allowed === '*') return true;
    if (Array.isArray(allowed)) return allowed.includes(resource);
    return false;
  },
}));
