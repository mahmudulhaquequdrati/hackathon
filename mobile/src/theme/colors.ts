export const colors = {
  // Backgrounds
  bg: {
    primary: '#030712',
    card: '#111827',
    elevated: '#1f2937',
    input: '#1f2937',
    overlay: 'rgba(0,0,0,0.6)',
  },

  // Borders
  border: {
    default: '#374151',
    light: '#4b5563',
    focus: '#3b82f6',
  },

  // Text
  text: {
    primary: '#f9fafb',
    secondary: '#d1d5db',
    tertiary: '#9ca3af',
    muted: '#6b7280',
    inverse: '#030712',
  },

  // Actions
  accent: {
    blue: '#3b82f6',
    blueDark: '#2563eb',
    blueLight: '#60a5fa',
    blueMuted: 'rgba(59,130,246,0.15)',
  },

  // Status
  status: {
    success: '#22c55e',
    successMuted: 'rgba(34,197,94,0.15)',
    warning: '#f59e0b',
    warningMuted: 'rgba(245,158,11,0.15)',
    error: '#ef4444',
    errorMuted: 'rgba(239,68,68,0.15)',
    info: '#06b6d4',
    infoMuted: 'rgba(6,182,212,0.15)',
  },

  // Priority
  priority: {
    p0: '#ef4444',
    p0bg: 'rgba(239,68,68,0.15)',
    p1: '#f59e0b',
    p1bg: 'rgba(245,158,11,0.15)',
    p2: '#3b82f6',
    p2bg: 'rgba(59,130,246,0.15)',
    p3: '#6b7280',
    p3bg: 'rgba(107,114,128,0.15)',
  },

  // Module accents
  module: {
    auth: '#8b5cf6',
    sync: '#06b6d4',
    mesh: '#22c55e',
    routes: '#f59e0b',
    delivery: '#ec4899',
    triage: '#ef4444',
    predict: '#a855f7',
  },

  // Edge / node types (map)
  map: {
    road: '#9ca3af',
    waterway: '#06b6d4',
    airway: '#f59e0b',
    hub: '#3b82f6',
    camp: '#22c55e',
    waypoint: '#9ca3af',
    droneBase: '#f59e0b',
    failure: '#ef4444',
    route: '#facc15',
  },

  // Tab bar
  tab: {
    active: '#3b82f6',
    inactive: '#6b7280',
    bg: '#111827',
    border: '#1f2937',
  },
} as const;

export type Colors = typeof colors;
