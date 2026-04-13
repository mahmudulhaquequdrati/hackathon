import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { textStyles } from '../theme/typography';
import { spacing } from '../theme/spacing';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  accentColor?: string;
}

export function ScreenHeader({ title, subtitle, onBack, right, accentColor }: ScreenHeaderProps) {
  return (
    <View style={s.container}>
      <View style={s.left}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={s.backBtn} activeOpacity={0.7}>
            <Text style={s.backIcon}>{'<'}</Text>
          </TouchableOpacity>
        )}
        <View style={s.titleWrap}>
          <Text style={[s.title, accentColor ? { color: accentColor } : null]}>{title}</Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        </View>
      </View>
      {right && <View style={s.right}>{right}</View>}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.bg.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  backIcon: {
    color: colors.text.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    ...textStyles.h3,
    color: colors.text.primary,
  },
  subtitle: {
    ...textStyles.caption,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  right: {
    marginLeft: spacing.md,
  },
});
