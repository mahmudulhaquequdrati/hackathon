import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface StatCardProps {
  value: number | string;
  label: string;
  color?: string;
  onPress?: () => void;
  icon?: React.ReactNode;
}

export function StatCard({ value, label, color = colors.accent.blue, onPress, icon }: StatCardProps) {
  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      style={[s.card, { borderColor: `${color}30` }]}
      {...(onPress ? { onPress, activeOpacity: 0.7 } : {})}
    >
      {icon && <View style={s.iconWrap}>{icon}</View>}
      <Text style={[s.value, { color }]}>{value}</Text>
      <Text style={s.label} numberOfLines={1}>{label}</Text>
    </Wrapper>
  );
}

const s = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  iconWrap: {
    marginBottom: spacing.xs,
  },
  value: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
  },
  label: {
    fontSize: fontSize.xs,
    color: colors.text.muted,
    marginTop: spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: fontWeight.medium,
  },
});
