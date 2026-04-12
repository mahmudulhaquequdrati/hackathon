import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';

/**
 * Checks whether the configured backend (local or remote) is reachable.
 * Works with both internet-based servers and local LAN backends.
 * Checks every 5 seconds with a 3-second timeout for fast detection.
 */
export function useOnlineStatus(intervalMs = 5_000) {
  const [isOnline, setIsOnline] = useState(false);
  const mounted = useRef(true);

  const check = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout
      await api.request('/health', { signal: controller.signal });
      clearTimeout(timeout);
      if (mounted.current) setIsOnline(true);
    } catch {
      if (mounted.current) setIsOnline(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    check();
    const id = setInterval(check, intervalMs);
    return () => { mounted.current = false; clearInterval(id); };
  }, [intervalMs, check]);

  return isOnline;
}
