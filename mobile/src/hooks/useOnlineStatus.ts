import { useState, useEffect } from 'react';
import { api } from '../lib/api';

/**
 * Shared online status — only ONE health check loop runs globally,
 * no matter how many components call useOnlineStatus().
 */

let _isOnline = false;
let _listeners: Set<(v: boolean) => void> = new Set();
let _intervalId: ReturnType<typeof setInterval> | null = null;

async function check() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    await api.request('/health', { signal: controller.signal });
    clearTimeout(timeout);
    if (!_isOnline) {
      _isOnline = true;
      _listeners.forEach(fn => fn(true));
    }
  } catch {
    if (_isOnline) {
      _isOnline = false;
      _listeners.forEach(fn => fn(false));
    }
  }
}

function startPolling() {
  if (_intervalId) return;
  check();
  _intervalId = setInterval(check, 10_000); // check every 10s
}

function stopPolling() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(_isOnline);

  useEffect(() => {
    _listeners.add(setIsOnline);
    startPolling();
    // Sync current value in case it changed before mount
    setIsOnline(_isOnline);

    return () => {
      _listeners.delete(setIsOnline);
      if (_listeners.size === 0) stopPolling();
    };
  }, []);

  return isOnline;
}
