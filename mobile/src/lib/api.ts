import { log } from './debug';

// Use your computer's local IP — localhost means the phone itself
const API_BASE = process.env.EXPO_PUBLIC_API_URL;

class ApiClient {
  private token: string | null = null;
  private baseUrl: string = API_BASE;

  setToken(token: string | null) {
    this.token = token;
  }

  setBaseUrl(url: string) {
    this.baseUrl = url;
    log('info', 'API base URL changed', url);
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

    try {
      const res = await fetch(url, { ...options, headers });

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
      const msg = (err as Error).message;
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
