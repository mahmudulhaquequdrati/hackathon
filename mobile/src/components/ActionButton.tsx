import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface ActionButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export function ActionButton({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled,
  loading,
  icon,
  style,
  textStyle,
  fullWidth,
}: ActionButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        s.base,
        sizeStyles[size],
        variantStyles[variant],
        fullWidth && s.fullWidth,
        isDisabled && s.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={variant === 'ghost' || variant === 'outline' ? colors.accent.blue : '#fff'} />
      ) : (
        <>
          {icon}
          <Text
            style={[
              s.text,
              sizeTextStyles[size],
              variantTextStyles[variant],
              icon ? { marginLeft: spacing.sm } : null,
              textStyle,
            ]}
          >
            {title}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  text: {
    fontWeight: fontWeight.semibold,
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.5,
  },
});

const sizeStyles: Record<string, ViewStyle> = {
  sm: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  md: { paddingVertical: spacing.md, paddingHorizontal: spacing.lg },
  lg: { paddingVertical: spacing.lg, paddingHorizontal: spacing.xl },
};

const sizeTextStyles: Record<string, TextStyle> = {
  sm: { fontSize: fontSize.sm },
  md: { fontSize: fontSize.base },
  lg: { fontSize: fontSize.lg },
};

const variantStyles: Record<string, ViewStyle> = {
  primary: { backgroundColor: colors.accent.blue },
  secondary: { backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default },
  destructive: { backgroundColor: colors.status.error },
  ghost: { backgroundColor: 'transparent' },
  success: { backgroundColor: colors.status.success },
  outline: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.accent.blue },
};

const variantTextStyles: Record<string, TextStyle> = {
  primary: { color: '#fff' },
  secondary: { color: colors.text.secondary },
  destructive: { color: '#fff' },
  ghost: { color: colors.accent.blue },
  success: { color: '#fff' },
  outline: { color: colors.accent.blue },
};
