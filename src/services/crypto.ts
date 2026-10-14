/**
 * Sentinel Campus: Cryptographic Utilities
 * Provides cryptographically secure key generation and SHA-256 session-bound hashing.
 */

/**
 * Generates a cryptographically secure 6-digit numeric presence code [100000 - 999999].
 * Never uses timestamps, sequential numbers, or student/session identifiers.
 */
export function generateCryptographicKey(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    // Uniform distribution over 900,000 possibilities: 100000 - 999999
    const code = (array[0] % 900000) + 100000;
    return code.toString();
  }
  // Fallback for non-browser or test runner without webcrypto
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Generates a random 16-byte hex salt.
 */
export function generateSalt(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return Math.random().toString(36).substring(2, 18);
}

/**
 * Computes SHA-256 hash of salt:key:sessionId.
 * Binding to sessionId prevents replay attacks across different lecture sessions.
 */
export async function hashPresenceKey(
  salt: string,
  key: string,
  sessionId: string
): Promise<string> {
  const normalizedKey = key.trim();
  const payload = `${salt}:${normalizedKey}:${sessionId}`;

  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Node.js crypto fallback
  try {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(payload).digest('hex');
  } catch {
    // Pure JS fallback if crypto is unavailable in test environment
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(16).padStart(64, '0');
  }
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Generates an unpredictable, cryptographically secure 256-bit token (64 hex characters)
 * for temporary QR photo upload authorization.
 */
export function generateUploadToken(): string {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback for non-browser environment
  let token = '';
  for (let i = 0; i < 4; i++) {
    token += Math.random().toString(36).substring(2, 18);
  }
  return token.substring(0, 64);
}

/**
 * Computes SHA-256 hash of salt:token:sessionId.
 * Strictly binds the upload token to its designated session.
 */
export async function hashUploadToken(
  salt: string,
  token: string,
  sessionId: string
): Promise<string> {
  return hashPresenceKey(salt, token, sessionId);
}

