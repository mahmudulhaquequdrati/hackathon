// MUST be first line — polyfills crypto.getRandomValues for tweetnacl
// This package works in Expo Go (no native module needed)
import 'react-native-get-random-values';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
