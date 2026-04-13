import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface StatusBadgeProps {
  label: string;
  color: string;
  bgColor?: string;
  size?: 'sm' | 'md';
  dot?: boolean;
}

export function StatusBadge({ label, color, bgColor, size = 'sm', dot }: StatusBadgeProps) {
  const bg = bgColor || `${color}20`;

  return (
    <View style={[s.badge, { backgroundColor: bg }, size === 'md' && s.badgeMd]}>
      {dot && <View style={[s.dot, { backgroundColor: color }]} />}
      <Text style={[s.text, { color }, size === 'md' && s.textMd]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  badgeMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  text: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  textMd: {
    fontSize: fontSize.sm,
  },
});
