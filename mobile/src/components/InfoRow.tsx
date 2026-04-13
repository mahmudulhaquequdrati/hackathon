import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing } from '../theme/spacing';

interface InfoRowProps {
  label: string;
  value: string | number;
  valueColor?: string;
  icon?: React.ReactNode;
  compact?: boolean;
}

export function InfoRow({ label, value, valueColor, icon, compact }: InfoRowProps) {
  return (
    <View style={[s.row, compact && s.compact]}>
      <View style={s.labelWrap}>
        {icon}
        <Text style={[s.label, icon ? { marginLeft: spacing.sm } : null]}>{label}</Text>
      </View>
      <Text style={[s.value, valueColor ? { color: valueColor } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border.default,
  },
  compact: {
    paddingVertical: spacing.xs,
  },
  labelWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  label: {
    fontSize: fontSize.md,
    color: colors.text.tertiary,
  },
  value: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    color: colors.text.primary,
    maxWidth: '50%',
    textAlign: 'right',
  },
});
