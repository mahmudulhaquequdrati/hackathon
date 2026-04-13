import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/useAuthStore';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';
import type { Role } from '../types';

const ROLES: { value: Role; label: string; desc: string; icon: string }[] = [
  { value: 'commander', label: 'Camp Commander', desc: 'Full access - manage all operations', icon: '\u2605' },
  { value: 'dispatcher', label: 'Dispatcher', desc: 'Manage supplies, deliveries & routes', icon: '\u2708' },
  { value: 'field_agent', label: 'Field Agent', desc: 'View supplies, manage deliveries', icon: '\u2691' },
  { value: 'drone_pilot', label: 'Drone Pilot', desc: 'Routes, deliveries & fleet ops', icon: '\u2B22' },
  { value: 'observer', label: 'Observer', desc: 'Read-only access to all data', icon: '\u25CE' },
];

export default function LoginScreen({ navigation }: any) {
  const {
    deviceId, isLoading, error, totpSecret, currentOtp,
    otpTimeRemaining, registerDevice, verifyOtp, refreshOtp,
  } = useAuthStore();

  const [step, setStep] = useState<'register' | 'generating' | 'otp'>(totpSecret ? 'otp' : 'register');
  const [selectedRole, setSelectedRole] = useState<Role>('field_agent');
  const [name, setName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);

  const waveAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    const wave = Animated.loop(
      Animated.sequence([
        Animated.timing(waveAnim, { toValue: 1, duration: 3000, useNativeDriver: true }),
        Animated.timing(waveAnim, { toValue: 0, duration: 3000, useNativeDriver: true }),
      ]),
    );
    wave.start();
    return () => wave.stop();
  }, [waveAnim]);

  useEffect(() => {
    if (totpSecret && step === 'register') setStep('otp');
  }, [totpSecret, step]);

  useEffect(() => {
    if (step !== 'otp' || !totpSecret) return;
    const interval = setInterval(() => refreshOtp(), 1000);
    return () => clearInterval(interval);
  }, [step, totpSecret, refreshOtp]);

  const handleRegister = async () => {
    setStep('generating');
    await registerDevice(selectedRole, name || undefined);
    if (useAuthStore.getState().totpSecret) {
      setTimeout(() => setStep('otp'), 1200);
    } else {
      setStep('register');
    }
  };

  const handleOtpInput = (text: string) => {
    const clean = text.replace(/[^0-9]/g, '').slice(0, 6);
    setOtpCode(clean);
    const digits = clean.split('');
    while (digits.length < 6) digits.push('');
    setOtpDigits(digits);
  };

  const handleAutoFill = () => {
    if (currentOtp) handleOtpInput(currentOtp);
  };

  const handleVerify = async () => {
    if (otpCode.length !== 6) return;
    await verifyOtp(otpCode);
    if (useAuthStore.getState().isAuthenticated) navigation.replace('Main');
  };

  const waveTranslate = waveAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  // Key generation animation step
  if (step === 'generating') {
    return (
      <SafeAreaView style={s.safe}>
        <Animated.View style={[s.generatingWrap, { opacity: fadeAnim }]}>
          <View style={s.logoLg}>
            <Animated.Text style={[s.logoIcon, { transform: [{ translateY: waveTranslate }] }]}>
              {'\u0394'}
            </Animated.Text>
          </View>
          <Text style={s.genTitle}>Generating Secure Keys</Text>
          <View style={s.genSteps}>
            <View style={s.genStep}>
              <Text style={s.genCheck}>{'\u2713'}</Text>
              <Text style={s.genStepText}>Ed25519 Key Pair (Signing)</Text>
            </View>
            <View style={s.genStep}>
              <Text style={s.genCheck}>{'\u2713'}</Text>
              <Text style={s.genStepText}>X25519 Key Pair (Encryption)</Text>
            </View>
            <View style={s.genStep}>
              <ActivityIndicator size="small" color={colors.accent.blue} style={{ marginRight: spacing.sm }} />
              <Text style={s.genStepText}>TOTP Secret (RFC 6238)</Text>
            </View>
          </View>
          <Text style={s.genHint}>Keys stored securely on device</Text>
        </Animated.View>
      </SafeAreaView>
    );
  }

  if (step === 'register') {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          {/* Logo & Brand */}
          <Animated.View style={[s.brandWrap, { opacity: fadeAnim }]}>
            <View style={s.logoLg}>
              <Animated.Text style={[s.logoIcon, { transform: [{ translateY: waveTranslate }] }]}>
                {'\u0394'}
              </Animated.Text>
            </View>
            <Text style={s.brandTitle}>Digital Delta</Text>
            <Text style={s.brandSub}>Disaster Relief Logistics Platform</Text>
            <View style={s.securityTag}>
              <Text style={s.securityIcon}>{'\u26BF'}</Text>
              <Text style={s.securityText}>Zero-Trust | Offline-First | E2E Encrypted</Text>
            </View>
          </Animated.View>

          {/* Registration Card */}
          <Card style={s.regCard}>
            <Text style={s.cardTitle}>Device Registration</Text>
            <Text style={s.cardSub}>Your device will be provisioned with cryptographic keys for secure communication</Text>

            {/* Device ID */}
            <Text style={s.fieldLabel}>Device ID</Text>
            <View style={s.deviceIdBox}>
              <Text style={s.deviceIdIcon}>{'\u2B22'}</Text>
              <Text style={s.deviceIdText} numberOfLines={1}>{deviceId}</Text>
            </View>

            {/* Name */}
            <Text style={s.fieldLabel}>Your Name</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Enter your name"
              placeholderTextColor={colors.text.muted}
            />

            {/* Role Selection */}
            <Text style={s.fieldLabel}>Select Role</Text>
            <View style={s.rolesGrid}>
              {ROLES.map(({ value, label, desc, icon }) => {
                const isSelected = selectedRole === value;
                return (
                  <TouchableOpacity
                    key={value}
                    style={[s.roleCard, isSelected && s.roleCardSelected]}
                    onPress={() => setSelectedRole(value)}
                    activeOpacity={0.7}
                  >
                    <View style={s.roleHeader}>
                      <View style={[s.roleIconWrap, isSelected && s.roleIconWrapActive]}>
                        <Text style={[s.roleIcon, isSelected && s.roleIconActive]}>{icon}</Text>
                      </View>
                      <View style={s.roleInfo}>
                        <Text style={[s.roleName, isSelected && s.roleNameActive]}>{label}</Text>
                        <Text style={s.roleDesc}>{desc}</Text>
                      </View>
                      {isSelected && (
                        <View style={s.roleCheckmark}>
                          <Text style={s.roleCheckText}>{'\u2713'}</Text>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {error ? <Text style={s.err}>{error}</Text> : null}

            <ActionButton
              title="Register & Generate Keys"
              onPress={handleRegister}
              loading={isLoading}
              fullWidth
              size="lg"
              style={{ marginTop: spacing.xl }}
            />

            <TouchableOpacity onPress={() => totpSecret ? setStep('otp') : Alert.alert('Not registered', 'Register first.')} style={s.linkWrap}>
              <Text style={s.link}>Already registered? Login with OTP</Text>
            </TouchableOpacity>
          </Card>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // OTP Verification Step
  const timerColor = otpTimeRemaining <= 5 ? colors.status.error : otpTimeRemaining <= 10 ? colors.status.warning : colors.status.success;
  const timerBg = otpTimeRemaining <= 5 ? colors.status.errorMuted : otpTimeRemaining <= 10 ? colors.status.warningMuted : colors.status.successMuted;

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Logo */}
        <Animated.View style={[s.brandWrap, { opacity: fadeAnim }]}>
          <View style={[s.logoLg, { backgroundColor: colors.status.successMuted }]}>
            <Text style={[s.logoIcon, { color: colors.status.success }]}>{'\u2713'}</Text>
          </View>
          <Text style={s.brandTitle}>Device Registered</Text>
          <Text style={s.brandSub}>Enter your time-based passcode to authenticate</Text>
        </Animated.View>

        <Card style={s.regCard}>
          {/* Current OTP Display */}
          {currentOtp ? (
            <View style={s.otpDisplay}>
              <View style={s.otpDisplayHeader}>
                <Text style={s.otpDisplayLabel}>YOUR CURRENT CODE</Text>
                <View style={[s.timerBadge, { backgroundColor: timerBg }]}>
                  <View style={[s.timerDot, { backgroundColor: timerColor }]} />
                  <Text style={[s.timerText, { color: timerColor }]}>{otpTimeRemaining}s</Text>
                </View>
              </View>
              <TouchableOpacity onPress={handleAutoFill} activeOpacity={0.7} style={s.otpCodeWrap}>
                {currentOtp.split('').map((digit, i) => (
                  <View key={i} style={s.otpDisplayDigit}>
                    <Text style={s.otpDisplayDigitText}>{digit}</Text>
                  </View>
                ))}
              </TouchableOpacity>
              <View style={s.progressBar}>
                <View style={[s.progressFill, { flex: 30 - otpTimeRemaining, backgroundColor: timerColor }]} />
                <View style={{ flex: otpTimeRemaining }} />
              </View>
              <Text style={s.otpHint}>Tap code to auto-fill below</Text>
            </View>
          ) : null}

          {/* OTP Input - Segmented Boxes */}
          <Text style={s.fieldLabel}>Enter 6-Digit Code</Text>
          <View style={s.otpInputWrap}>
            {otpDigits.map((d, i) => (
              <View key={i} style={[s.otpInputBox, d ? s.otpInputBoxFilled : null]}>
                <Text style={[s.otpInputText, d ? s.otpInputTextFilled : null]}>{d || '\u2022'}</Text>
              </View>
            ))}
          </View>
          <TextInput
            style={s.hiddenInput}
            value={otpCode}
            onChangeText={handleOtpInput}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          {error ? <Text style={s.err}>{error}</Text> : null}

          <ActionButton
            title="Verify & Login"
            onPress={handleVerify}
            loading={isLoading}
            disabled={otpCode.length !== 6}
            fullWidth
            size="lg"
            variant={otpCode.length === 6 ? 'success' : 'primary'}
            style={{ marginTop: spacing.xl }}
          />

          <TouchableOpacity onPress={() => setStep('register')} style={s.linkWrap}>
            <Text style={s.link}>Register a new device</Text>
          </TouchableOpacity>

          {/* Security Info */}
          <View style={s.securityInfo}>
            <Text style={s.securityInfoTitle}>Security Details</Text>
            <View style={s.securityRow}>
              <Text style={s.securityDot}>{'\u2713'}</Text>
              <Text style={s.securityRowText}>Ed25519 keypair generated on device</Text>
            </View>
            <View style={s.securityRow}>
              <Text style={s.securityDot}>{'\u2713'}</Text>
              <Text style={s.securityRowText}>TOTP per RFC 6238 (30s window)</Text>
            </View>
            <View style={s.securityRow}>
              <Text style={s.securityDot}>{'\u2713'}</Text>
              <Text style={s.securityRowText}>Keys stored in secure enclave</Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing['2xl'], paddingTop: spacing['3xl'] },

  // Brand
  brandWrap: { alignItems: 'center', marginBottom: spacing['2xl'] },
  logoLg: {
    width: 72, height: 72, borderRadius: 20,
    backgroundColor: colors.accent.blueMuted,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  logoIcon: { fontSize: 36, fontWeight: '800', color: colors.accent.blue },
  brandTitle: { ...textStyles.h2, color: colors.text.primary },
  brandSub: { ...textStyles.bodySmall, color: colors.text.muted, marginTop: spacing.xs, textAlign: 'center' },
  securityTag: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.elevated, borderRadius: radius.full,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    marginTop: spacing.md, gap: spacing.xs,
  },
  securityIcon: { fontSize: 12, color: colors.accent.blue },
  securityText: { fontSize: fontSize.xs, color: colors.text.tertiary },

  // Card
  regCard: { padding: spacing['2xl'] },
  cardTitle: { ...textStyles.h3, color: colors.text.primary, marginBottom: spacing.xs },
  cardSub: { ...textStyles.bodySmall, color: colors.text.muted, marginBottom: spacing.lg },

  // Fields
  fieldLabel: {
    fontSize: fontSize.sm, fontWeight: fontWeight.semibold,
    color: colors.text.secondary, marginBottom: spacing.sm,
    marginTop: spacing.lg, letterSpacing: 0.3,
  },
  input: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    color: colors.text.primary, fontSize: fontSize.base,
  },

  // Device ID
  deviceIdBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  deviceIdIcon: { fontSize: 14, color: colors.accent.blue },
  deviceIdText: { color: colors.text.tertiary, fontSize: fontSize.sm, flex: 1 },

  // Roles
  rolesGrid: { gap: spacing.sm },
  roleCard: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, padding: spacing.md,
  },
  roleCardSelected: {
    backgroundColor: colors.accent.blueMuted, borderColor: colors.accent.blue,
  },
  roleHeader: { flexDirection: 'row', alignItems: 'center' },
  roleIconWrap: {
    width: 36, height: 36, borderRadius: radius.sm,
    backgroundColor: colors.bg.elevated,
    alignItems: 'center', justifyContent: 'center',
  },
  roleIconWrapActive: { backgroundColor: colors.accent.blue },
  roleIcon: { fontSize: 16, color: colors.text.tertiary },
  roleIconActive: { color: '#fff' },
  roleInfo: { flex: 1, marginLeft: spacing.md },
  roleName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.text.primary },
  roleNameActive: { color: colors.accent.blueLight },
  roleDesc: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: 2 },
  roleCheckmark: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.accent.blue,
    alignItems: 'center', justifyContent: 'center',
  },
  roleCheckText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Error
  err: { color: colors.status.error, fontSize: fontSize.md, marginVertical: spacing.md, textAlign: 'center' },

  // Links
  linkWrap: { paddingVertical: spacing.sm, marginTop: spacing.sm },
  link: { color: colors.text.muted, fontSize: fontSize.md, textAlign: 'center' },

  // OTP Display
  otpDisplay: {
    backgroundColor: colors.bg.card, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.lg,
  },
  otpDisplayHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: spacing.md,
  },
  otpDisplayLabel: { fontSize: fontSize.xs, color: colors.text.muted, letterSpacing: 1.5 },
  timerBadge: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.sm, paddingVertical: 3,
    borderRadius: radius.full, gap: spacing.xs,
  },
  timerDot: { width: 6, height: 6, borderRadius: 3 },
  timerText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  otpCodeWrap: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  otpDisplayDigit: {
    width: 40, height: 48, borderRadius: radius.sm,
    backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  otpDisplayDigitText: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text.primary },
  progressBar: {
    height: 3, backgroundColor: colors.bg.elevated,
    borderRadius: 2, marginTop: spacing.md, flexDirection: 'row',
  },
  progressFill: { height: 3, borderRadius: 2 },
  otpHint: { fontSize: fontSize.xs, color: colors.text.muted, textAlign: 'center', marginTop: spacing.sm },

  // OTP Input
  otpInputWrap: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center' },
  otpInputBox: {
    width: 44, height: 52, borderRadius: radius.md,
    backgroundColor: colors.bg.card, borderWidth: 1.5, borderColor: colors.border.default,
    alignItems: 'center', justifyContent: 'center',
  },
  otpInputBoxFilled: { borderColor: colors.accent.blue, backgroundColor: colors.accent.blueMuted },
  otpInputText: { fontSize: fontSize.xl, color: colors.text.muted },
  otpInputTextFilled: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.text.primary },
  hiddenInput: { position: 'absolute', opacity: 0, height: 0 },

  // Generating step
  generatingWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    padding: spacing['2xl'],
  },
  genTitle: { ...textStyles.h3, color: colors.text.primary, marginTop: spacing.xl, marginBottom: spacing['2xl'] },
  genSteps: { gap: spacing.lg, width: '100%', maxWidth: 300 },
  genStep: { flexDirection: 'row', alignItems: 'center' },
  genCheck: { color: colors.status.success, fontSize: 18, fontWeight: '700', marginRight: spacing.md, width: 24 },
  genStepText: { ...textStyles.body, color: colors.text.secondary },
  genHint: { ...textStyles.caption, color: colors.text.muted, marginTop: spacing['2xl'] },

  // Security Info
  securityInfo: {
    marginTop: spacing.xl, paddingTop: spacing.lg,
    borderTopWidth: 1, borderTopColor: colors.border.default,
  },
  securityInfoTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.tertiary, marginBottom: spacing.md },
  securityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  securityDot: { color: colors.status.success, fontSize: 12, marginRight: spacing.sm },
  securityRowText: { fontSize: fontSize.sm, color: colors.text.muted },
});
