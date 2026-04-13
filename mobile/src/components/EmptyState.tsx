import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { textStyles } from '../theme/typography';
import { spacing } from '../theme/spacing';

interface EmptyStateProps {
  title: string;
  message?: string;
  icon?: React.ReactNode;
}

export function EmptyState({ title, message, icon }: EmptyStateProps) {
  return (
    <View style={s.container}>
      {icon && <View style={s.iconWrap}>{icon}</View>}
      <Text style={s.title}>{title}</Text>
      {message && <Text style={s.message}>{message}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['3xl'],
    paddingHorizontal: spacing.xl,
  },
  iconWrap: {
    marginBottom: spacing.lg,
    opacity: 0.5,
  },
  title: {
    ...textStyles.h4,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  message: {
    ...textStyles.bodySmall,
    color: colors.text.muted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
