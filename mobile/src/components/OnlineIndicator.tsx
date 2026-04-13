import React, { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import { colors } from '../theme/colors';
import { fontSize, fontWeight } from '../theme/typography';
import { spacing } from '../theme/spacing';

interface OnlineIndicatorProps {
  isOnline: boolean;
  compact?: boolean;
}

export function OnlineIndicator({ isOnline, compact }: OnlineIndicatorProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isOnline, pulseAnim]);

  const dotColor = isOnline ? colors.status.success : colors.status.error;

  return (
    <View style={s.wrap}>
      <View style={s.dotWrap}>
        {isOnline && (
          <Animated.View
            style={[
              s.pulse,
              { backgroundColor: `${dotColor}40`, transform: [{ scale: pulseAnim }] },
            ]}
          />
        )}
        <View style={[s.dot, { backgroundColor: dotColor }]} />
      </View>
      {!compact && (
        <Text style={[s.label, { color: dotColor }]}>
          {isOnline ? 'Online' : 'Offline'}
        </Text>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dotWrap: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
