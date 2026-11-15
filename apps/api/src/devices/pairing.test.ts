import { describe, expect, it } from 'vitest';
import {
  PAIRING_CODE_TTL_MS,
  generateAgentToken,
  generatePairingCode,
  hashAgentToken,
  hashPairingCode,
  normalizePairingCode,
  pairingCodeExpiry,
} from './pairing';

const CODE_PATTERN = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

describe('generatePairingCode', () => {
  it('always matches the contract the shared schema enforces', () => {
    for (let i = 0; i < 200; i++) expect(generatePairingCode()).toMatch(CODE_PATTERN);
  });

  it('never uses the characters people confuse', () => {
    const codes = Array.from({ length: 400 }, () => generatePairingCode()).join('');
    expect(codes).not.toMatch(/[IO01]/);
  });

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generatePairingCode()));
    expect(codes.size).toBeGreaterThan(495);
  });
});

describe('normalizePairingCode', () => {
  it('accepts what a person actually types', () => {
    expect(normalizePairingCode('abcd1234')).toBe('ABCD-1234');
    expect(normalizePairingCode(' abcd 1234 ')).toBe('ABCD-1234');
    expect(normalizePairingCode('ABCD-1234')).toBe('ABCD-1234');
  });
});

describe('hashPairingCode', () => {
  it('is stable for the same code and secret', () => {
    expect(hashPairingCode('ABCD-1234', 'secret-one')).toBe(
      hashPairingCode('abcd1234', 'secret-one'),
    );
  });

  it('cannot be brute-forced from a database dump without the secret', () => {
    expect(hashPairingCode('ABCD-1234', 'secret-one')).not.toBe(
      hashPairingCode('ABCD-1234', 'secret-two'),
    );
  });

  it('never contains the code itself', () => {
    expect(hashPairingCode('ABCD-1234', 'secret-one')).not.toContain('ABCD');
  });
});

describe('agent tokens', () => {
  it('are long and unique', () => {
    const first = generateAgentToken();
    const second = generateAgentToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43); // 32 bytes base64url
  });

  it('are stored only as a hash', () => {
    const token = generateAgentToken();
    const hash = hashAgentToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(token);
  });
});

describe('pairingCodeExpiry', () => {
  it('is ten minutes after the moment the code was created', () => {
    const now = new Date('2026-11-15T10:00:00.000Z');
    expect(pairingCodeExpiry(now).toISOString()).toBe('2026-11-15T10:10:00.000Z');
    expect(PAIRING_CODE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
