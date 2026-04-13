import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing } from '../theme/spacing';

type TabKey = 'dashboard' | 'routes' | 'delivery' | 'mesh' | 'triage';

interface Tab {
  key: TabKey;
  label: string;
  icon: string;
}

const tabs: Tab[] = [
  { key: 'dashboard', label: 'Home', icon: '\u2302' },
  { key: 'routes', label: 'Map', icon: '\u25CB' },
  { key: 'delivery', label: 'Deliver', icon: '\u25A1' },
  { key: 'mesh', label: 'Network', icon: '\u25C7' },
  { key: 'triage', label: 'Triage', icon: '\u26A0' },
];

interface BottomTabBarProps {
  activeScreen: string;
  onNavigate: (screen: string) => void;
}

export function BottomTabBar({ activeScreen, onNavigate }: BottomTabBarProps) {
  return (
    <View style={s.container}>
      {tabs.map((tab) => {
        const isActive = activeScreen === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            style={s.tab}
            onPress={() => onNavigate(tab.key)}
            activeOpacity={0.7}
          >
            <View style={[s.iconWrap, isActive && s.iconWrapActive]}>
              <Text style={[s.icon, isActive && s.iconActive]}>{tab.icon}</Text>
            </View>
            <Text style={[s.label, isActive && s.labelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.tab.bg,
    borderTopWidth: 1,
    borderTopColor: colors.tab.border,
    paddingBottom: 20, // safe area bottom padding
    paddingTop: spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  iconWrap: {
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginBottom: 2,
  },
  iconWrapActive: {
    backgroundColor: colors.accent.blueMuted,
  },
  icon: {
    fontSize: 18,
    color: colors.tab.inactive,
  },
  iconActive: {
    color: colors.tab.active,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.tab.inactive,
  },
  labelActive: {
    color: colors.tab.active,
    fontWeight: fontWeight.semibold,
  },
});
