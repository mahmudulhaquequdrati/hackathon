import React, { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import LoginScreen from './src/screens/LoginScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import P2PSyncScreen from './src/screens/P2PSyncScreen';
import MeshScreen from './src/screens/MeshScreen';
import QRPairScreen from './src/screens/QRPairScreen';
import RouteMapScreen from './src/screens/RouteMapScreen';
import DeliveryScreen from './src/screens/DeliveryScreen';
import TriageScreen from './src/screens/TriageScreen';
import { useAuthStore } from './src/lib/useAuthStore';
import { log } from './src/lib/debug';

type Screen = 'login' | 'dashboard' | 'p2p' | 'mesh' | 'qr-pair' | 'routes' | 'delivery' | 'triage';

export default function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('login');
  const initialize = useAuthStore((s) => s.initialize);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    log('info', 'App starting, initializing...');
    initialize()
      .then(() => {
        log('info', 'Init complete', `auth=${useAuthStore.getState().isAuthenticated}`);
        setReady(true);
      })
      .catch((err) => {
        log('error', 'Init failed', err.message);
        setReady(true);
      });
  }, [initialize]);

  useEffect(() => {
    if (ready) setScreen(isAuthenticated ? 'dashboard' : 'login');
  }, [ready, isAuthenticated]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: '#030712', justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color="#3b82f6" />
      </View>
    );
  }

  const nav = {
    replace: (s: string) => {
      if (s === 'Main' || s === 'dashboard') setScreen('dashboard');
      else if (s === 'Login' || s === 'login') setScreen('login');
      else if (s === 'p2p') setScreen('p2p');
      else if (s === 'mesh') setScreen('mesh')
      else if (s === 'qr-pair') setScreen('qr-pair')
      else if (s === 'routes') setScreen('routes')
      else if (s === 'delivery') setScreen('delivery');
      else if (s === 'triage') setScreen('triage');
    },
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {screen === 'login' && <LoginScreen navigation={nav} />}
      {screen === 'dashboard' && <DashboardScreen navigation={nav} />}
      {screen === 'p2p' && <P2PSyncScreen onBack={() => setScreen('dashboard')} />}
      {screen === 'mesh' && <MeshScreen onBack={() => setScreen('dashboard')} onNavigate={(s: string) => setScreen(s as Screen)} />}
      {screen === 'qr-pair' && <QRPairScreen onBack={() => setScreen('dashboard')} />}
      {screen === 'routes' && <RouteMapScreen onBack={() => setScreen('dashboard')} />}
      {screen === 'delivery' && <DeliveryScreen onBack={() => setScreen('dashboard')} />}
      {screen === 'triage' && <TriageScreen onBack={() => setScreen('dashboard')} />}
    </SafeAreaProvider>
  );
}
