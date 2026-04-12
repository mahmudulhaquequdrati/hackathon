import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api';

export function useOnlineStatus(intervalMs = 15_000) {
  const [isOnline, setIsOnline] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const check = async () => {
      try {
        await api.get('/health');
        if (mounted.current) setIsOnline(true);
      } catch {
        if (mounted.current) setIsOnline(false);
      }
    };
    check();
    const id = setInterval(check, intervalMs);
    return () => { mounted.current = false; clearInterval(id); };
  }, [intervalMs]);

  return isOnline;
}
