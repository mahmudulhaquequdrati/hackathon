import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Network from 'expo-network';
import { useAuthStore } from '../lib/useAuthStore';
import { useMeshStore } from '../lib/useMeshStore';
import { api } from '../lib/api';
import {
  startRelay,
  stopRelay,
  isRelayRunning,
  getRelayStats,
  seedGraphData,
} from '../lib/phone-relay';
import {
  buildQRPayload,
  parseQRPayload,
  pairWithScannedDevice,
  type QRPairingPayload,
} from '../lib/qr-pairing';

const RELAY_PORT = 8735;

export default function QRPairScreen({ onBack }: { onBack: () => void }) {
  const { deviceId, user } = useAuthStore();
  const { boxPublicKey, initialized, initialize, fetchAndCachePeers } = useMeshStore();

  // Auto-initialize mesh so QR code has the box public key
  useEffect(() => {
    if (deviceId && !initialized) {
      initialize(deviceId);
    }
  }, [deviceId, initialized]);

  const [ipAddress, setIpAddress] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState(api.getBaseUrl());
  const [manualUrl, setManualUrl] = useState('');

  // Hub mode state
  const [hubRunning, setHubRunning] = useState(isRelayRunning());
  const [hubStats, setHubStats] = useState(getRelayStats());

  // Scanner state
  const [showScanner, setShowScanner] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [scannedPeer, setScannedPeer] = useState<QRPairingPayload | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // Fetch local IP
  const refreshIP = useCallback(async () => {
    try {
      const ip = await Network.getIpAddressAsync();
      setIpAddress(ip);
    } catch {
      setIpAddress(null);
    }
  }, []);

  useEffect(() => {
    refreshIP();
  }, [refreshIP]);

  // Poll hub stats
  useEffect(() => {
    if (!hubRunning) return;
    const interval = setInterval(() => {
      setHubStats(getRelayStats());
    }, 3000);
    return () => clearInterval(interval);
  }, [hubRunning]);

  // Hub mode controls
  const toggleHub = async () => {
    if (hubRunning) {
      stopRelay();
      setHubRunning(false);
      Alert.alert('Hub Stopped', 'This phone is no longer acting as a server.');
    } else {
      try {
        // Seed graph data from local cache before starting
        try {
          const graphRes = await api.get<{ data: { nodes: any[]; edges: any[] } }>('/routes/graph');
          if (graphRes.data) seedGraphData(graphRes.data.nodes, graphRes.data.edges);
        } catch {
          // No existing server — start with empty graph (devices will sync later)
        }
        await startRelay(RELAY_PORT);
        setHubRunning(true);
        // Hub phone connects to itself via localhost (external IP may not loop back)
        const selfUrl = `http://127.0.0.1:${RELAY_PORT}/api/v1`;
        const externalUrl = `http://${ipAddress}:${RELAY_PORT}/api/v1`;
        await api.saveBaseUrl(selfUrl);
        setServerUrl(selfUrl);
        Alert.alert(
          'Hub Started!',
          `This phone is now the server.\n\nOther phones should connect to:\n${externalUrl}\n\nOr scan your QR code.`,
        );
      } catch (err) {
        Alert.alert('Error', `Failed to start hub: ${(err as Error).message}`);
      }
    }
  };

  // QR payload — when hub is running, include relay URL so scanners auto-connect
  const hubUrl = hubRunning && ipAddress ? `http://${ipAddress}:${RELAY_PORT}/api/v1` : serverUrl;
  const qrData = deviceId
    ? buildQRPayload(
        deviceId,
        boxPublicKey || 'pending',
        user?.name || null,
        ipAddress,
        hubUrl,
      )
    : null;

  // Handle barcode scan
  const onBarcodeScanned = useCallback(
    ({ data }: { data: string }) => {
      if (scanned) return;
      setScanned(true);

      const payload = parseQRPayload(data);
      if (!payload) {
        Alert.alert('Invalid QR', 'This is not a Digital Delta pairing code.');
        setScanned(false);
        return;
      }
      if (payload.deviceId === deviceId) {
        Alert.alert('Self Scan', "You scanned your own device's QR code.");
        setScanned(false);
        return;
      }
      setScannedPeer(payload);
      setShowScanner(false);
    },
    [scanned, deviceId],
  );

  // Confirm pairing
  const confirmPair = async (switchServer: boolean) => {
    if (!scannedPeer) return;
    try {
      await pairWithScannedDevice(scannedPeer, switchServer);
      if (switchServer && scannedPeer.serverUrl) {
        setServerUrl(scannedPeer.serverUrl);
      }
      await fetchAndCachePeers();
      Alert.alert('Paired!', `Paired with ${scannedPeer.name || scannedPeer.deviceId.substring(0, 12)}`);
      setScannedPeer(null);
      setScanned(false);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
      setScanned(false);
    }
  };

  // Manual URL connect
  const connectManualUrl = async () => {
    const url = manualUrl.trim();
    if (!url) {
      Alert.alert('Error', 'Enter a backend URL');
      return;
    }
    try {
      await api.saveBaseUrl(url);
      setServerUrl(url);
      setManualUrl('');
      Alert.alert('Connected', `Backend set to ${url}`);
    } catch (err) {
      Alert.alert('Error', (err as Error).message);
    }
  };

  const resetUrl = async () => {
    await api.resetBaseUrl();
    setServerUrl(api.getBaseUrl());
    Alert.alert('Reset', 'Backend URL reset to default');
  };

  const isLocalNetwork = /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(serverUrl);

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <TouchableOpacity onPress={onBack}>
          <Text style={s.backBtn}>Back to Dashboard</Text>
        </TouchableOpacity>

        <Text style={s.title}>QR Pair & LAN Setup</Text>
        <Text style={s.subtitle}>Connect devices without Bluetooth</Text>

        {/* ── Hub Mode ──────────────────────────────────────── */}
        <View style={[s.card, hubRunning && { borderColor: '#22c55e' }]}>
          <Text style={s.cardH}>HUB MODE (NO SERVER NEEDED)</Text>
          <Text style={s.desc}>
            {hubRunning
              ? 'This phone is the server. Other phones connect to your IP.'
              : 'Turn this phone into a server. No laptop, no internet — just WiFi or hotspot.'}
          </Text>

          <TouchableOpacity
            style={[s.hubBtn, hubRunning && s.hubBtnStop]}
            onPress={toggleHub}
          >
            <Text style={s.hubBtnText}>
              {hubRunning ? 'Stop Hub' : 'Start Hub Mode'}
            </Text>
          </TouchableOpacity>

          {hubRunning && ipAddress && (
            <View style={{ marginTop: 10 }}>
              <Row label="Status" value="RUNNING" color="#22c55e" />
              <Row label="Server URL" value={`http://${ipAddress}:${RELAY_PORT}/api/v1`} color="#22c55e" />
              <Row label="Peers" value={String(hubStats.peers)} />
              <Row label="Messages" value={String(hubStats.messages)} />
              <Row label="Deliveries" value={String(hubStats.deliveries)} />
              <Row label="Sync states" value={String(hubStats.syncStates)} />
              <Text style={[s.desc, { marginTop: 8 }]}>
                Tell other phones to enter this URL:{'\n'}
                http://{ipAddress}:{RELAY_PORT}/api/v1
              </Text>
            </View>
          )}

          {!hubRunning && (
            <View style={s.steps}>
              <Text style={s.step}>1. Enable WiFi hotspot on this phone (or connect all to same WiFi)</Text>
              <Text style={s.step}>2. Tap "Start Hub Mode" above</Text>
              <Text style={s.step}>3. Other phones: scan your QR or enter your IP</Text>
              <Text style={s.step}>4. All features work — messaging, sync, deliveries, routes</Text>
            </View>
          )}
        </View>

        {/* ── My Device QR ──────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardH}>MY DEVICE QR</Text>
          <Text style={s.desc}>
            Show this QR code to another device to pair. It contains your device
            ID, encryption key, and current network info.
          </Text>

          {qrData ? (
            <View style={s.qrContainer}>
              <QRCode
                value={qrData}
                size={200}
                backgroundColor="#111827"
                color="#e5e7eb"
              />
            </View>
          ) : (
            <Text style={s.emptyText}>
              Initialize mesh first (go to Mesh screen)
            </Text>
          )}

          <Row label="Device ID" value={deviceId ? `${deviceId.substring(0, 16)}...` : 'N/A'} />
          <Row label="IP Address" value={ipAddress || 'Not available'} color={ipAddress ? '#22c55e' : '#6b7280'} />
          <Row label="Box Key" value={boxPublicKey ? `${boxPublicKey.substring(0, 16)}...` : 'Not set'} color="#60a5fa" />
          <Row label="Backend" value={serverUrl} color={isLocalNetwork ? '#22c55e' : '#f59e0b'} />

          <TouchableOpacity style={s.smallBtn} onPress={refreshIP}>
            <Text style={s.smallBtnText}>Refresh IP</Text>
          </TouchableOpacity>
        </View>

        {/* ── Scan Peer ─────────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardH}>SCAN PEER DEVICE</Text>
          <Text style={s.desc}>
            Scan another device's QR code to pair with them and exchange
            encryption keys.
          </Text>

          <TouchableOpacity
            style={s.scanBtn}
            onPress={() => {
              if (!permission?.granted) {
                requestPermission();
                return;
              }
              setScanned(false);
              setShowScanner(true);
            }}
          >
            <Text style={s.scanBtnText}>Open Camera to Scan</Text>
          </TouchableOpacity>

          {/* Scanned peer confirmation */}
          {scannedPeer && (
            <View style={s.peerCard}>
              <Text style={s.peerCardTitle}>Peer Found</Text>
              <Row label="Name" value={scannedPeer.name || 'Unknown'} />
              <Row label="Device" value={`${scannedPeer.deviceId.substring(0, 16)}...`} />
              <Row label="IP" value={scannedPeer.ipAddress || 'N/A'} />
              {scannedPeer.serverUrl && (
                <Row label="Server" value={scannedPeer.serverUrl} color="#22c55e" />
              )}

              <TouchableOpacity
                style={s.confirmBtn}
                onPress={() => confirmPair(false)}
              >
                <Text style={s.confirmBtnText}>Pair Device Only</Text>
              </TouchableOpacity>

              {scannedPeer.serverUrl && (
                <TouchableOpacity
                  style={[s.confirmBtn, s.confirmBtnAlt]}
                  onPress={() => confirmPair(true)}
                >
                  <Text style={s.confirmBtnText}>
                    Pair & Switch to Their Backend
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                onPress={() => {
                  setScannedPeer(null);
                  setScanned(false);
                }}
              >
                <Text style={s.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* ── Network Setup ─────────────────────────────────── */}
        <View style={s.card}>
          <Text style={s.cardH}>NETWORK SETUP</Text>
          <Text style={s.desc}>
            Connect all devices to the same WiFi or hotspot. Set the backend
            server IP below, or scan a QR code that includes it.
          </Text>

          <View style={s.steps}>
            <Text style={s.step}>1. Run backend on a laptop: npm start (port 3001)</Text>
            <Text style={s.step}>2. Connect all devices to the same WiFi or hotspot</Text>
            <Text style={s.step}>3. Enter the backend IP below or scan a QR code</Text>
          </View>

          <Text style={s.labelSmall}>Backend URL</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.input}
              placeholder="http://192.168.1.5:3001/api/v1"
              placeholderTextColor="#6b7280"
              value={manualUrl}
              onChangeText={setManualUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <TouchableOpacity style={s.connectBtn} onPress={connectManualUrl}>
              <Text style={s.connectBtnText}>Set</Text>
            </TouchableOpacity>
          </View>

          <Row label="Current" value={serverUrl} color={isLocalNetwork ? '#22c55e' : '#f59e0b'} />
          <Row label="Mode" value={isLocalNetwork ? 'Local LAN' : 'Remote'} color={isLocalNetwork ? '#22c55e' : '#f59e0b'} />

          <TouchableOpacity style={s.smallBtn} onPress={resetUrl}>
            <Text style={s.smallBtnText}>Reset to Default</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* ── Camera Modal ────────────────────────────────────── */}
      <Modal visible={showScanner} animationType="slide">
        <SafeAreaView style={s.scannerContainer}>
          <Text style={s.scannerTitle}>Scan Peer QR Code</Text>
          <CameraView
            style={s.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={scanned ? undefined : onBarcodeScanned}
          />
          <TouchableOpacity
            style={s.closeScannerBtn}
            onPress={() => {
              setShowScanner(false);
              setScanned(false);
            }}
          >
            <Text style={s.closeScannerText}>Close Scanner</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={s.stateRow}>
      <Text style={s.stateLabel}>{label}</Text>
      <Text style={[s.stateValue, color ? { color } : undefined]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 20, paddingTop: 16, paddingBottom: 40 },
  backBtn: { color: '#60a5fa', fontSize: 14, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 13, color: '#9ca3af', marginTop: 2, marginBottom: 20 },

  card: { backgroundColor: '#111827', borderWidth: 1, borderColor: '#374151', borderRadius: 14, padding: 16, marginBottom: 16 },
  cardH: { fontSize: 11, fontWeight: 'bold', color: '#9ca3af', letterSpacing: 1, marginBottom: 8 },
  desc: { fontSize: 13, color: '#6b7280', marginBottom: 12, lineHeight: 18 },

  qrContainer: { alignItems: 'center', paddingVertical: 20, backgroundColor: '#111827', borderRadius: 12 },

  stateRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  stateLabel: { fontSize: 13, color: '#6b7280' },
  stateValue: { fontSize: 13, color: '#d1d5db', flex: 1, textAlign: 'right' },

  smallBtn: { marginTop: 10, borderWidth: 1, borderColor: '#374151', borderRadius: 8, padding: 8, alignItems: 'center' },
  smallBtnText: { color: '#60a5fa', fontSize: 12, fontWeight: '600' },

  hubBtn: { backgroundColor: '#065f46', borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 8 },
  hubBtnStop: { backgroundColor: '#7f1d1d' },
  hubBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  scanBtn: { backgroundColor: '#7c3aed', borderRadius: 10, padding: 12, alignItems: 'center', marginBottom: 12 },
  scanBtnText: { color: '#e9d5ff', fontSize: 14, fontWeight: '600' },

  peerCard: { backgroundColor: '#1f2937', borderRadius: 10, padding: 14, marginTop: 8, borderWidth: 1, borderColor: '#374151' },
  peerCardTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 8 },

  confirmBtn: { backgroundColor: '#22c55e', borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 10 },
  confirmBtnAlt: { backgroundColor: '#2563eb' },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cancelText: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 10 },

  steps: { marginBottom: 12 },
  step: { color: '#9ca3af', fontSize: 13, lineHeight: 22 },

  labelSmall: { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  inputRow: { flexDirection: 'row', marginBottom: 10, gap: 8 },
  input: { flex: 1, backgroundColor: '#1f2937', borderWidth: 1, borderColor: '#374151', borderRadius: 10, padding: 10, color: '#fff', fontSize: 14 },
  connectBtn: { backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' },
  connectBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  emptyText: { color: '#6b7280', fontSize: 13, fontStyle: 'italic', textAlign: 'center', paddingVertical: 20 },

  // Scanner modal
  scannerContainer: { flex: 1, backgroundColor: '#030712' },
  scannerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center', paddingVertical: 16 },
  camera: { flex: 1 },
  closeScannerBtn: { backgroundColor: '#374151', padding: 16, alignItems: 'center' },
  closeScannerText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
