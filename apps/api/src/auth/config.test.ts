import { afterEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe('getAuthConfig', () => {
  it('rejects the placeholder session secret in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.WEB_ORIGIN = 'http://localhost:3000';
    process.env.SESSION_SECRET = `replace-${'x'.repeat(32)}`;

    const { getAuthConfig } = await import('./config');

    expect(() => getAuthConfig()).toThrow(
      /SESSION_SECRET is still the \.env\.example placeholder; set a real random value/,
    );
  });
});
