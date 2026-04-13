import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

interface ChipOption {
  key: string;
  label: string;
  color?: string;
}

interface ChipSelectorProps {
  options: ChipOption[];
  selected: string;
  onSelect: (key: string) => void;
  accentColor?: string;
  size?: 'sm' | 'md';
}

export function ChipSelector({ options, selected, onSelect, accentColor = colors.accent.blue, size = 'md' }: ChipSelectorProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scroll}>
      {options.map((opt) => {
        const isActive = opt.key === selected;
        const chipColor = opt.color || accentColor;

        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => onSelect(opt.key)}
            activeOpacity={0.7}
            style={[
              s.chip,
              size === 'sm' && s.chipSm,
              isActive
                ? { backgroundColor: chipColor, borderColor: chipColor }
                : { backgroundColor: colors.bg.elevated, borderColor: colors.border.default },
            ]}
          >
            <Text
              style={[
                s.chipText,
                size === 'sm' && s.chipTextSm,
                { color: isActive ? '#fff' : colors.text.tertiary },
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  chipSm: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  chipText: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
  },
  chipTextSm: {
    fontSize: fontSize.sm,
  },
});
