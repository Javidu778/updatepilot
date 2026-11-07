import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Pure crypto helpers for sessions. No database or config access, so they are easy to unit test. */

/** 256 bits of randomness, URL-safe. This value exists only in the browser cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** The database stores only this hash, so a database leak does not leak usable sessions. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * CSRF token bound to one session: HMAC(secret, sessionTokenHash).
 * Nothing extra is stored. The client receives it from login/register/me and
 * sends it back in the X-CSRF-Token header on state-changing requests.
 */
export function csrfTokenFor(sessionTokenHash: string, secret: string): string {
  return createHmac('sha256', secret).update(sessionTokenHash).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
