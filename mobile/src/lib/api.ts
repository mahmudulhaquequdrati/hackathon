import * as SecureStore from 'expo-secure-store';
import { log } from './debug';

// Use your computer's local IP — localhost means the phone itself
const API_BASE = process.env.EXPO_PUBLIC_API_URL;
const STORED_URL_KEY = 'digital_delta_api_url';

class ApiClient {
  private token: string | null = null;
  private baseUrl: string = API_BASE;

  setToken(token: string | null) {
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
    log('info', 'API base URL changed', url);
  }

  /** Persist a custom backend URL (e.g. local LAN server) */
  async saveBaseUrl(url: string): Promise<void> {
    this.setBaseUrl(url);
    await SecureStore.setItemAsync(STORED_URL_KEY, url);
  }

  /** On startup: always use the default server first.
   *  The saved URL is only a fallback the user can switch to manually. */
  async loadSavedBaseUrl(): Promise<void> {
    // Always start with the default (.env) server
    this.baseUrl = API_BASE;
    log('info', 'Using default API URL', API_BASE);
  }

  /** Get the saved hub/fallback URL (if any) without activating it */
  async getSavedFallbackUrl(): Promise<string | null> {
    return SecureStore.getItemAsync(STORED_URL_KEY);
  }

  /** Reset to the default env-based URL */
  async resetBaseUrl(): Promise<void> {
    this.baseUrl = API_BASE;
    await SecureStore.deleteItemAsync(STORED_URL_KEY);
    log('info', 'API URL reset to default', API_BASE);
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    const url = `${this.baseUrl}${path}`;
    log('api', `${method} ${path}`, options.body ? String(options.body).substring(0, 200) : undefined);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Add timeout so requests don't hang forever when server is unreachable
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout
    const signal = options.signal
      ? options.signal // use caller's signal if provided
      : controller.signal;

    try {
      const res = await fetch(url, { ...options, headers, signal });
      clearTimeout(timeout);

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: res.statusText }));
        const msg = error.error || `HTTP ${res.status}`;
        log('error', `${method} ${path} → ${res.status}`, msg);
        throw new Error(msg);
      }

      const data = await res.json();
      log('api', `${method} ${path} → ${res.status} OK`);
      return data;
    } catch (err) {
      clearTimeout(timeout);
      const msg = (err as Error).message;
      if ((err as Error).name === 'AbortError') {
        log('error', `${method} ${path} TIMEOUT`, '10s');
        throw new Error('Request timed out — server unreachable');
      }
      if (msg.startsWith('HTTP') || msg.includes('Invalid') || msg.includes('Not implemented')) {
        throw err; // Already logged above
      }
      log('error', `${method} ${path} FAILED`, msg);
      throw err;
    }
  }

  get<T>(path: string) { return this.request<T>(path); }
  post<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'POST', body: JSON.stringify(body) }); }
  patch<T>(path: string, body: unknown) { return this.request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); }
}

export const api = new ApiClient();
