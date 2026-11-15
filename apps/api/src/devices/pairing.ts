import { createHash, createHmac, randomBytes, randomInt } from 'node:crypto';

/**
 * Pairing codes and agent tokens.
 *
 * No database and no config access here, so every rule below is unit-tested without Postgres.
 *
 * The two secrets are deliberately different kinds of thing:
 *  - a pairing code is short and typed by a person, so it is hashed with a server-side pepper
 *    (HMAC keyed with SESSION_SECRET) and expires in minutes;
 *  - an agent token is long and random, so a plain SHA-256 hash already makes a database dump
 *    useless.
 */

// No I, O, 0 or 1: the characters people mistype when reading a code aloud or retyping it.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GROUP_LENGTH = 4;

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** The server tells the agent how often to poll. Changing it here changes every agent. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 10;

/** "ABCD-1234" from a 31-character alphabet: about 40 bits of randomness. */
export function generatePairingCode(): string {
  let code = '';
  for (let position = 0; position < GROUP_LENGTH * 2; position++) {
    if (position === GROUP_LENGTH) code += '-';
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** "abcd 1234" and "ABCD-1234" are the same code. Anything unusable is returned uppercased. */
export function normalizePairingCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length === 8
    ? `${cleaned.slice(0, GROUP_LENGTH)}-${cleaned.slice(GROUP_LENGTH)}`
    : input.trim().toUpperCase();
}

export function hashPairingCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(normalizePairingCode(code)).digest('hex');
}

/** 256 bits, URL-safe. Returned to the agent once and never stored. */
export function generateAgentToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function pairingCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + PAIRING_CODE_TTL_MS);
}
