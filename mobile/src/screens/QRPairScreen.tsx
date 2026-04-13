import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, TextInput,
  StyleSheet, Alert, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Network from 'expo-network';
import { useAuthStore } from '../lib/useAuthStore';
import { useMeshStore } from '../lib/useMeshStore';
import { api } from '../lib/api';
import { startRelay, stopRelay, isRelayRunning, getRelayStats, seedGraphData } from '../lib/phone-relay';
import { buildQRPayload, parseQRPayload, pairWithScannedDevice, type QRPairingPayload } from '../lib/qr-pairing';
import { ScreenHeader } from '../components/ScreenHeader';
import { Card } from '../components/Card';
import { ActionButton } from '../components/ActionButton';
import { InfoRow } from '../components/InfoRow';
import { StatusBadge } from '../components/StatusBadge';
import { colors } from '../theme/colors';
import { textStyles, fontSize, fontWeight } from '../theme/typography';
import { spacing, radius } from '../theme/spacing';

const RELAY_PORT = 8735;

export default function QRPairScreen({ onBack }: { onBack: () => void }) {
  const { deviceId, user } = useAuthStore();
  const { boxPublicKey, initialized, initialize, fetchAndCachePeers } = useMeshStore();

  useEffect(() => {
    if (deviceId && !initialized) initialize(deviceId);
  }, [deviceId, initialized]);

  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(api.getBaseUrl());
  const [manualUrl, setManualUrl] = useState('');
  const [hubRunning, setHubRunning] = useState(isRelayRunning());
  const [hubStats, setHubStats] = useState(getRelayStats());
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scannedPeer, setScannedPeer] = useState<QRPairingPayload | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const refreshIP = useCallback(async () => {
    try { const ip = await Network.getIpAddressAsync(); setIpAddress(ip); }
    catch { setIpAddress(null); }
  }, []);

  useEffect(() => { refreshIP(); }, [refreshIP]);

  useEffect(() => {
    if (!hubRunning) return;
    const interval = setInterval(() => setHubStats(getRelayStats()), 3000);
    return () => clearInterval(interval);
  }, [hubRunning]);

  const toggleHub = async () => {
    if (hubRunning) {
      stopRelay(); setHubRunning(false);
      Alert.alert('Hub Stopped', 'This phone is no longer acting as a server.');
    } else {
      try {
        try {
          const graphRes = await api.get<{ data: { nodes: any[]; edges: any[] } }>('/routes/graph');
          if (graphRes.data) seedGraphData(graphRes.data.nodes, graphRes.data.edges);
        } catch {}
        await startRelay(RELAY_PORT);
        setHubRunning(true);
        const selfUrl = `http://127.0.0.1:${RELAY_PORT}/api/v1`;
        const externalUrl = `http://${ipAddress}:${RELAY_PORT}/api/v1`;
        await api.saveBaseUrl(selfUrl);
        setServerUrl(selfUrl);
        Alert.alert('Hub Started!', `Server running.\n\nOther phones connect to:\n${externalUrl}`);
      } catch (err) { Alert.alert('Error', `Failed: ${(err as Error).message}`); }
    }
  };

  const hubUrl = hubRunning && ipAddress ? `http://${ipAddress}:${RELAY_PORT}/api/v1` : serverUrl;
  const qrData = deviceId ? buildQRPayload(deviceId, boxPublicKey || 'pending', user?.name || null, ipAddress, hubUrl) : null;

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);
    const payload = parseQRPayload(data);
    if (!payload) { Alert.alert('Invalid QR', 'Not a Digital Delta pairing code.'); setScanned(false); return; }
    if (payload.deviceId === deviceId) { Alert.alert('Self Scan', "You scanned your own QR."); setScanned(false); return; }
    setScannedPeer(payload); setShowScanner(false);
  }, [scanned, deviceId]);

  const confirmPair = async (switchServer: boolean) => {
    if (!scannedPeer) return;
    try {
      await pairWithScannedDevice(scannedPeer, switchServer);
      if (switchServer && scannedPeer.serverUrl) setServerUrl(scannedPeer.serverUrl);
      await fetchAndCachePeers();
      Alert.alert('Paired!', `Paired with ${scannedPeer.name || scannedPeer.deviceId.substring(0, 12)}`);
      setScannedPeer(null); setScanned(false);
    } catch (err) { Alert.alert('Error', (err as Error).message); setScanned(false); }
  };

  const connectManualUrl = async () => {
    const url = manualUrl.trim();
    if (!url) { Alert.alert('Error', 'Enter a backend URL'); return; }
    try { await api.saveBaseUrl(url); setServerUrl(url); setManualUrl(''); Alert.alert('Connected', `Backend set to ${url}`); }
    catch (err) { Alert.alert('Error', (err as Error).message); }
  };

  const resetUrl = async () => {
    await api.resetBaseUrl(); setServerUrl(api.getBaseUrl());
    Alert.alert('Reset', 'Backend URL reset to default');
  };

  const isLocalNetwork = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(serverUrl);

  return (
    <SafeAreaView style={s.safe}>
      <ScreenHeader title="QR Pair & Setup" subtitle="Connect devices" onBack={onBack} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* QR Code Hero */}
          <Card style={s.qrHero}>
            {qrData ? (
              <View style={s.qrCenter}>
                <View style={s.qrFrame}>
                  <QRCode value={qrData} size={180} backgroundColor={colors.bg.card} color="#e5e7eb" />
                </View>
                <Text style={s.qrLabel}>Show this to pair with another device</Text>
                <View style={s.qrMeta}>
                  <InfoRow label="Device" value={deviceId ? `${deviceId.substring(0, 16)}...` : 'N/A'} compact />
                  <InfoRow label="IP" value={ipAddress || 'Not available'} valueColor={ipAddress ? colors.status.success : colors.text.muted} compact />
                  <InfoRow label="Key" value={boxPublicKey ? `${boxPublicKey.substring(0, 16)}...` : 'Pending'} valueColor={colors.accent.blueLight} compact />
                </View>
                <ActionButton title="Refresh IP" onPress={refreshIP} variant="ghost" size="sm" />
              </View>
            ) : (
              <Text style={s.emptyText}>Initialize mesh first to generate QR</Text>
            )}
          </Card>

          {/* Scan Peer */}
          <Card>
            <Text style={s.sectionLabel}>SCAN PEER DEVICE</Text>
            <Text style={s.hint}>Scan another device's QR code to exchange encryption keys and pair.</Text>
            <ActionButton
              title="Open Scanner"
              onPress={() => {
                if (!permission?.granted) { requestPermission(); return; }
                setScanned(false); setShowScanner(true);
              }}
              variant="primary"
              fullWidth
            />

            {scannedPeer && (
              <Card style={s.peerResult} variant="accent" accentColor={colors.status.success}>
                <Text style={s.peerFoundTitle}>Peer Found</Text>
                <InfoRow label="Name" value={scannedPeer.name || 'Unknown'} compact />
                <InfoRow label="Device" value={`${scannedPeer.deviceId.substring(0, 16)}...`} compact />
                <InfoRow label="IP" value={scannedPeer.ipAddress || 'N/A'} compact />
                {scannedPeer.serverUrl && <InfoRow label="Server" value={scannedPeer.serverUrl} valueColor={colors.status.success} compact />}

                <View style={s.pairActions}>
                  <ActionButton title="Pair Only" onPress={() => confirmPair(false)} variant="success" style={{ flex: 1 }} />
                  {scannedPeer.serverUrl && (
                    <ActionButton title="Pair & Switch Server" onPress={() => confirmPair(true)} variant="primary" style={{ flex: 1 }} />
                  )}
                </View>
                <TouchableOpacity onPress={() => { setScannedPeer(null); setScanned(false); }}>
                  <Text style={s.cancelLink}>Cancel</Text>
                </TouchableOpacity>
              </Card>
            )}
          </Card>

          {/* Hub Mode */}
          <Card style={hubRunning ? s.hubRunning : undefined}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionLabel}>HUB MODE</Text>
              {hubRunning && <StatusBadge label="RUNNING" color={colors.status.success} dot />}
            </View>
            <Text style={s.hint}>
              {hubRunning
                ? 'This phone is the server. Other devices connect to your IP.'
                : 'Turn this phone into a local server. No laptop or internet needed.'}
            </Text>

            <ActionButton
              title={hubRunning ? 'Stop Hub' : 'Start Hub Mode'}
              onPress={toggleHub}
              variant={hubRunning ? 'destructive' : 'success'}
              fullWidth
              size="lg"
            />

            {hubRunning && ipAddress && (
              <View style={s.hubInfo}>
                <InfoRow label="Server URL" value={`http://${ipAddress}:${RELAY_PORT}/api/v1`} valueColor={colors.status.success} compact />
                <InfoRow label="Peers" value={String(hubStats.peers)} compact />
                <InfoRow label="Messages" value={String(hubStats.messages)} compact />
                <InfoRow label="Deliveries" value={String(hubStats.deliveries)} compact />
                <InfoRow label="Sync states" value={String(hubStats.syncStates)} compact />
              </View>
            )}

            {!hubRunning && (
              <View style={s.steps}>
                <Text style={s.step}>1. Enable WiFi hotspot or connect all to same WiFi</Text>
                <Text style={s.step}>2. Tap "Start Hub Mode" above</Text>
                <Text style={s.step}>3. Other phones scan your QR or enter your IP</Text>
              </View>
            )}
          </Card>

          {/* Network Setup */}
          <Card>
            <Text style={s.sectionLabel}>NETWORK SETUP</Text>
            <View style={s.currentNetwork}>
              <InfoRow label="Current URL" value={serverUrl} valueColor={isLocalNetwork ? colors.status.success : colors.status.warning} compact />
              <InfoRow label="Mode" value={isLocalNetwork ? 'Local LAN' : 'Remote'} valueColor={isLocalNetwork ? colors.status.success : colors.status.warning} compact />
            </View>

            <Text style={s.fieldLabel}>Backend URL</Text>
            <View style={s.inputRow}>
              <TextInput
                style={s.input}
                placeholder="http://192.168.1.5:3001/api/v1"
                placeholderTextColor={colors.text.muted}
                value={manualUrl}
                onChangeText={setManualUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <ActionButton title="Set" onPress={connectManualUrl} variant="primary" size="sm" />
            </View>
            <ActionButton title="Reset to Default" onPress={resetUrl} variant="ghost" size="sm" />
          </Card>

          <View style={{ height: spacing['3xl'] }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Camera Modal */}
      <Modal visible={showScanner} animationType="slide">
        <SafeAreaView style={s.scannerWrap}>
          <View style={s.scannerHeader}>
            <Text style={s.scannerTitle}>Scan Peer QR Code</Text>
            <Text style={s.scannerHint}>Point camera at another device's QR code</Text>
          </View>
          <View style={s.cameraWrap}>
            <CameraView
              style={s.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
            />
            <View style={s.viewfinder}>
              <View style={[s.corner, s.cornerTL]} />
              <View style={[s.corner, s.cornerTR]} />
              <View style={[s.corner, s.cornerBL]} />
              <View style={[s.corner, s.cornerBR]} />
            </View>
          </View>
          <ActionButton
            title="Close Scanner"
            onPress={() => { setShowScanner(false); setScanned(false); }}
            variant="secondary"
            fullWidth
            size="lg"
            style={{ margin: spacing.lg }}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  content: { padding: spacing.lg, gap: spacing.lg },

  // QR Hero
  qrHero: { alignItems: 'center' },
  qrCenter: { alignItems: 'center', width: '100%' },
  qrFrame: {
    padding: spacing.lg, borderRadius: radius.lg,
    backgroundColor: colors.bg.card, borderWidth: 2, borderColor: colors.border.default,
    marginBottom: spacing.lg,
  },
  qrLabel: { fontSize: fontSize.sm, color: colors.text.muted, marginBottom: spacing.lg },
  qrMeta: { width: '100%', marginBottom: spacing.sm },

  // Section labels
  sectionLabel: { ...textStyles.label, color: colors.text.muted, marginBottom: spacing.sm },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  hint: { fontSize: fontSize.sm, color: colors.text.muted, marginBottom: spacing.md, lineHeight: 18 },
  emptyText: { color: colors.text.muted, fontSize: fontSize.md, textAlign: 'center', paddingVertical: spacing.xl },

  // Peer result
  peerResult: { marginTop: spacing.lg },
  peerFoundTitle: { ...textStyles.h4, color: colors.text.primary, marginBottom: spacing.sm },
  pairActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  cancelLink: { color: colors.text.muted, fontSize: fontSize.md, textAlign: 'center', marginTop: spacing.md },

  // Hub
  hubRunning: { borderColor: colors.status.success },
  hubInfo: { marginTop: spacing.md },
  steps: { marginTop: spacing.md, gap: spacing.xs },
  step: { fontSize: fontSize.sm, color: colors.text.tertiary, lineHeight: 22 },

  // Network
  currentNetwork: { marginBottom: spacing.md },
  fieldLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text.secondary, marginBottom: spacing.sm },
  inputRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  input: {
    flex: 1, backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.default,
    borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text.primary, fontSize: fontSize.base,
  },

  // Scanner
  scannerWrap: { flex: 1, backgroundColor: colors.bg.primary },
  scannerHeader: { alignItems: 'center', paddingVertical: spacing.lg },
  scannerTitle: { ...textStyles.h3, color: colors.text.primary },
  scannerHint: { fontSize: fontSize.sm, color: colors.text.muted, marginTop: spacing.xs },
  cameraWrap: { flex: 1, position: 'relative' },
  camera: { flex: 1 },
  viewfinder: {
    position: 'absolute', top: '25%', left: '15%',
    width: '70%', height: '50%',
  },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: colors.accent.blue },
  cornerTL: { top: 0, left: 0, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 4 },
});
