import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, ScrollView, Alert, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../lib/useAuthStore';
import type { Role } from '../types';

const ROLES: { value: Role; label: string }[] = [
  { value: 'commander', label: 'Commander' },
  { value: 'dispatcher', label: 'Dispatcher' },
  { value: 'field_agent', label: 'Field Agent' },
  { value: 'drone_pilot', label: 'Drone Pilot' },
  { value: 'observer', label: 'Observer' },
];

export default function LoginScreen({ navigation }: any) {
  const {
    deviceId, isLoading, error, totpSecret, currentOtp,
    otpTimeRemaining, registerDevice, verifyOtp, refreshOtp,
  } = useAuthStore();

  const [step, setStep] = useState<'register' | 'otp'>(totpSecret ? 'otp' : 'register');
  const [selectedRole, setSelectedRole] = useState<Role>('field_agent');
  const [name, setName] = useState('');
  const [otpCode, setOtpCode] = useState('');

  useEffect(() => {
    if (totpSecret && step === 'register') setStep('otp');
  }, [totpSecret, step]);

  useEffect(() => {
    if (step !== 'otp' || !totpSecret) return;
    const interval = setInterval(() => refreshOtp(), 1000);
    return () => clearInterval(interval);
  }, [step, totpSecret, refreshOtp]);

  const handleRegister = async () => {
    await registerDevice(selectedRole, name || undefined);
    if (useAuthStore.getState().totpSecret) setStep('otp');
  };

  const handleVerify = async () => {
    if (otpCode.length !== 6) return;
    await verifyOtp(otpCode);
    if (useAuthStore.getState().isAuthenticated) navigation.replace('Main');
  };

  if (step === 'register') {
    return (
      <SafeAreaView style={s.safe}>
        <ScrollView contentContainerStyle={s.content}>
          <View style={s.center}>
            <View style={s.logo}><Text style={s.logoT}>DD</Text></View>
            <Text style={s.title}>Digital Delta</Text>
            <Text style={s.sub}>Disaster Relief Logistics</Text>
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Register Device</Text>

            <Text style={s.label}>Device ID</Text>
            <View style={s.readonly}><Text style={s.mono} numberOfLines={1}>{deviceId}</Text></View>

            <Text style={s.label}>Name (optional)</Text>
            <TextInput style={s.input} value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor="#6b7280" />

            <Text style={s.label}>Role</Text>
            <View style={s.roleWrap}>
              {ROLES.map(({ value, label }) => (
                <TouchableOpacity
                  key={value}
                  style={[s.roleBtn, selectedRole === value && s.roleSel]}
                  onPress={() => setSelectedRole(value)}
                >
                  <Text style={[s.roleTxt, selectedRole === value && s.roleSelTxt]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {error ? <Text style={s.err}>{error}</Text> : null}

            <TouchableOpacity style={s.primary} onPress={handleRegister} disabled={isLoading}>
              {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>Register & Generate Keys</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => totpSecret ? setStep('otp') : Alert.alert('Not registered', 'Register first.')}>
              <Text style={s.link}>Already registered? Login with OTP</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // OTP step
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.center}>
          <View style={[s.logo, { backgroundColor: 'rgba(34,197,94,0.2)' }]}><Text style={[s.logoT, { color: '#22c55e' }]}>OK</Text></View>
          <Text style={s.title}>Digital Delta</Text>
          <Text style={s.sub}>Enter Passcode</Text>
        </View>

        <View style={s.card}>
          {currentOtp ? (
            <View style={s.otpBox}>
              <View style={s.otpHead}>
                <Text style={s.otpLbl}>YOUR CODE</Text>
                <View style={[s.timer, otpTimeRemaining <= 5 ? s.tRed : otpTimeRemaining <= 10 ? s.tYel : s.tGrn]}>
                  <Text style={s.timerTxt}>{otpTimeRemaining}s</Text>
                </View>
              </View>
              <TouchableOpacity onPress={() => setOtpCode(currentOtp)}>
                <Text style={s.otpBig}>{currentOtp}</Text>
              </TouchableOpacity>
              <View style={s.bar}>
                <View style={[s.barFill, { flex: 30 - otpTimeRemaining }]} />
                <View style={{ flex: otpTimeRemaining }} />
              </View>
              <Text style={s.hint}>Tap code to auto-fill</Text>
            </View>
          ) : null}

          <Text style={s.label}>Enter 6-digit code</Text>
          <TextInput
            style={[s.input, { fontSize: 24, textAlign: 'center', letterSpacing: 10 }]}
            value={otpCode}
            onChangeText={(t) => setOtpCode(t.replace(/[^0-9]/g, '').slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            placeholder="000000"
            placeholderTextColor="#6b7280"
          />

          {error ? <Text style={s.err}>{error}</Text> : null}

          <TouchableOpacity style={[s.primary, otpCode.length !== 6 && { opacity: 0.4 }]} onPress={handleVerify} disabled={isLoading || otpCode.length !== 6}>
            {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryTxt}>Verify & Login</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setStep('register')}>
            <Text style={s.link}>Register a new device</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 24, paddingTop: 50, justifyContent: 'center' },
  center: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 48, height: 48, borderRadius: 12, backgroundColor: 'rgba(37,99,235,0.2)', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  logoT: { fontSize: 18, fontWeight: 'bold', color: '#3b82f6' },
  title: { fontSize: 26, fontWeight: 'bold', color: '#fff' },
  sub: { fontSize: 13, color: '#6b7280', marginTop: 4 },

  card: { backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 16, padding: 24 },
  cardTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 16 },

  label: { fontSize: 13, fontWeight: '600', color: '#d1d5db', marginBottom: 6, marginTop: 12 },
  input: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: '#fff', fontSize: 15 },
  readonly: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  mono: { color: '#9ca3af', fontSize: 12 },
  hint: { fontSize: 11, color: '#6b7280', marginTop: 6 },

  roleWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  roleBtn: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8, marginBottom: 8 },
  roleSel: { backgroundColor: 'rgba(59,130,246,0.15)', borderColor: '#3b82f6' },
  roleTxt: { color: '#9ca3af', fontSize: 13 },
  roleSelTxt: { color: '#60a5fa' },

  err: { color: '#f87171', fontSize: 13, marginVertical: 10, textAlign: 'center' },
  primary: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 16, marginBottom: 12 },
  primaryTxt: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  link: { color: '#9ca3af', fontSize: 13, textAlign: 'center', paddingVertical: 6 },

  otpBox: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 12, padding: 16, marginBottom: 16 },
  otpHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  otpLbl: { fontSize: 11, color: '#9ca3af', letterSpacing: 1 },
  timer: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12, borderWidth: 1 },
  tGrn: { backgroundColor: 'rgba(34,197,94,0.15)', borderColor: '#166534' },
  tYel: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#92400e' },
  tRed: { backgroundColor: 'rgba(220,38,38,0.15)', borderColor: '#991b1b' },
  timerTxt: { color: '#fff', fontSize: 12, fontWeight: '600' },
  otpBig: { fontSize: 36, fontWeight: 'bold', color: '#fff', letterSpacing: 8 },
  bar: { height: 4, backgroundColor: '#374151', borderRadius: 2, marginTop: 10, flexDirection: 'row' },
  barFill: { height: 4, backgroundColor: '#3b82f6', borderRadius: 2 },
});
