import { describe, expect, it } from 'vitest';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { csrfTokenFor, generateSessionToken, hashSessionToken, safeEqual } from './tokens';

describe('passwords', () => {
  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
  });

  it('never stores the password in the hash', async () => {
    const hash = await hashPassword('SuperSecret-Passw0rd!');
    expect(hash).not.toContain('SuperSecret');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('uses a different salt each time', async () => {
    expect(await hashPassword('same-password-123')).not.toBe(await hashPassword('same-password-123'));
  });

  it('counts every character of long passwords (bcrypt alone stops at 72 bytes)', async () => {
    const base = 'a'.repeat(80);
    const hash = await hashPassword(`${base}X`);
    expect(await verifyPassword(`${base}X`, hash)).toBe(true);
    expect(await verifyPassword(`${base}Y`, hash)).toBe(false);
  });

  it('handles unicode passwords', async () => {
    const hash = await hashPassword('pässwörd-密码-🔑-123');
    expect(await verifyPassword('pässwörd-密码-🔑-123', hash)).toBe(true);
  });

  it('dummy verification always returns false', async () => {
    expect(await verifyAgainstDummy('anything')).toBe(false);
  });
});

describe('session tokens', () => {
  it('generates long, unique, URL-safe tokens', () => {
    const a = generateSessionToken();
    const b = generateSessionToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('hashes deterministically and never returns the token', () => {
    const token = generateSessionToken();
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toContain(token);
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('csrf tokens', () => {
  const secret = 'x'.repeat(40);

  it('is stable for one session and different between sessions', () => {
    const one = hashSessionToken('session-one');
    const two = hashSessionToken('session-two');
    expect(csrfTokenFor(one, secret)).toBe(csrfTokenFor(one, secret));
    expect(csrfTokenFor(one, secret)).not.toBe(csrfTokenFor(two, secret));
  });

  it('depends on the server secret', () => {
    const hash = hashSessionToken('session-one');
    expect(csrfTokenFor(hash, secret)).not.toBe(csrfTokenFor(hash, 'y'.repeat(40)));
  });

  it('safeEqual compares correctly, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'a')).toBe(false);
  });
});
