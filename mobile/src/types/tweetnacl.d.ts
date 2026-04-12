declare module 'tweetnacl' {
  export interface SignKeyPair {
    publicKey: Uint8Array;
    secretKey: Uint8Array;
  }

  interface SignDetached {
    (msg: Uint8Array, secretKey: Uint8Array): Uint8Array;
    verify(msg: Uint8Array, sig: Uint8Array, publicKey: Uint8Array): boolean;
  }

  export const sign: {
    keyPair(): SignKeyPair;
    detached: SignDetached;
  };
}

declare module 'tweetnacl-util' {
  export function encodeBase64(data: Uint8Array): string;
  export function decodeBase64(data: string): Uint8Array;
  export function encodeUTF8(data: Uint8Array): string;
  export function decodeUTF8(data: string): Uint8Array;
}
