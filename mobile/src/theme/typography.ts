import { TextStyle } from 'react-native';

export const fontSize = {
  xs: 10,
  sm: 12,
  md: 13,
  base: 14,
  lg: 16,
  xl: 18,
  '2xl': 22,
  '3xl': 28,
  '4xl': 34,
} as const;

export const fontWeight = {
  normal: '400' as TextStyle['fontWeight'],
  medium: '500' as TextStyle['fontWeight'],
  semibold: '600' as TextStyle['fontWeight'],
  bold: '700' as TextStyle['fontWeight'],
  extrabold: '800' as TextStyle['fontWeight'],
};

export const lineHeight = {
  tight: 1.2,
  normal: 1.4,
  relaxed: 1.6,
};

export const textStyles = {
  h1: { fontSize: fontSize['3xl'], fontWeight: fontWeight.bold } as TextStyle,
  h2: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold } as TextStyle,
  h3: { fontSize: fontSize.xl, fontWeight: fontWeight.semibold } as TextStyle,
  h4: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold } as TextStyle,
  body: { fontSize: fontSize.base, fontWeight: fontWeight.normal } as TextStyle,
  bodySmall: { fontSize: fontSize.md, fontWeight: fontWeight.normal } as TextStyle,
  caption: { fontSize: fontSize.sm, fontWeight: fontWeight.normal } as TextStyle,
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: 0.5, textTransform: 'uppercase' } as TextStyle,
  tiny: { fontSize: fontSize.xs, fontWeight: fontWeight.normal } as TextStyle,
} as const;
