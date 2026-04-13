import React from 'react';
import { View, ViewStyle, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

interface CardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'elevated' | 'outlined' | 'accent';
  accentColor?: string;
  noPadding?: boolean;
}

export function Card({ children, style, variant = 'default', accentColor, noPadding }: CardProps) {
  return (
    <View
      style={[
        s.base,
        !noPadding && s.padding,
        variant === 'elevated' && s.elevated,
        variant === 'outlined' && s.outlined,
        variant === 'accent' && accentColor
          ? { borderLeftWidth: 3, borderLeftColor: accentColor }
          : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  base: {
    backgroundColor: colors.bg.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  padding: {
    padding: spacing.lg,
  },
  elevated: {
    backgroundColor: colors.bg.elevated,
    borderColor: colors.border.light,
  },
  outlined: {
    backgroundColor: 'transparent',
    borderColor: colors.border.light,
  },
});
