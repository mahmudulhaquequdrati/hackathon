// In-memory debug log — captures API calls, errors, and events
// Viewable from the Debug tab in the app

export interface DebugEntry {
  id: number;
  time: string;
  type: 'api' | 'error' | 'info' | 'crypto';
  message: string;
  detail?: string;
}

let _id = 0;
const _logs: DebugEntry[] = [];
const _listeners: Set<() => void> = new Set();

function now(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export function log(type: DebugEntry['type'], message: string, detail?: string) {
  const entry: DebugEntry = { id: ++_id, time: now(), type, message, detail };
  _logs.unshift(entry); // newest first
  if (_logs.length > 100) _logs.pop();
  _listeners.forEach((fn) => fn());
  // Also console.log for Metro
  console.log(`[DEBUG][${type}] ${message}${detail ? ': ' + detail : ''}`);
}

export function getLogs(): DebugEntry[] {
  return _logs;
}

export function clearLogs() {
  _logs.length = 0;
  _listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}
