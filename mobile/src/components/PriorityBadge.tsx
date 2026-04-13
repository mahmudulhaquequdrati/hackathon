import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface PriorityBadgeProps {
  priority: string;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const priorityConfig: Record<string, { color: string; bg: string; label: string }> = {
  P0: { color: colors.priority.p0, bg: colors.priority.p0bg, label: 'Critical' },
  P1: { color: colors.priority.p1, bg: colors.priority.p1bg, label: 'High' },
  P2: { color: colors.priority.p2, bg: colors.priority.p2bg, label: 'Standard' },
  P3: { color: colors.priority.p3, bg: colors.priority.p3bg, label: 'Low' },
};

export function PriorityBadge({ priority, showLabel, size = 'sm' }: PriorityBadgeProps) {
  const p = priority.toUpperCase();
  const config = priorityConfig[p] || priorityConfig.P3;

  return (
    <View style={[s.badge, { backgroundColor: config.bg }, size === 'lg' && s.badgeLg]}>
      <Text style={[s.code, { color: config.color }, size === 'lg' && s.codeLg]}>{p}</Text>
      {showLabel && <Text style={[s.label, { color: config.color }]}>{config.label}</Text>}
    </View>
  );
}

export function getPriorityColor(priority: string): string {
  const p = priority.toUpperCase();
  return (priorityConfig[p] || priorityConfig.P3).color;
}

export function getPriorityBg(priority: string): string {
  const p = priority.toUpperCase();
  return (priorityConfig[p] || priorityConfig.P3).bg;
}

const s = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
    gap: spacing.xs,
  },
  badgeLg: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  code: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.5,
  },
  codeLg: {
    fontSize: fontSize.base,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
});
