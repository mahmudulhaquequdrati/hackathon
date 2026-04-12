import * as OTPAuth from 'otpauth';

/**
 * Generate the current 6-digit TOTP code from a base32 secret.
 * Works entirely offline — uses device clock, no server needed.
 */
export function generateOtp(secretBase32: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'DigitalDelta',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.generate();
}

/**
 * Verify a TOTP code locally (offline verification).
 * Window=1 allows ±30s tolerance for clock drift.
 * Returns true if valid.
 */
export function verifyOtp(secretBase32: string, token: string): boolean {
  const totp = new OTPAuth.TOTP({
    issuer: 'DigitalDelta',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  const delta = totp.validate({ token, window: 1 });
  return delta !== null;
}

/**
 * Seconds remaining before the current OTP expires.
 * The TOTP rotates every 30 seconds aligned to Unix epoch.
 */
export function getTimeRemaining(): number {
  return 30 - (Math.floor(Date.now() / 1000) % 30);
}
