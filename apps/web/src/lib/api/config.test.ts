import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './config';

describe('resolveApiUrl', () => {
  it('uses an explicit host when one is set', () => {
    expect(resolveApiUrl('https://api.example.com', true)).toBe('https://api.example.com');
  });

  it('strips trailing slashes, because paths already start with one', () => {
    expect(resolveApiUrl('https://api.example.com/', true)).toBe('https://api.example.com');
    expect(resolveApiUrl('https://api.example.com///', true)).toBe('https://api.example.com');
    expect(resolveApiUrl('  https://api.example.com/  ', true)).toBe('https://api.example.com');
  });

  it('falls back to the same origin in production, which keeps the cookie first-party', () => {
    expect(resolveApiUrl(undefined, true)).toBe('');
    expect(resolveApiUrl('', true)).toBe('');
    expect(resolveApiUrl('   ', true)).toBe('');
  });

  it('falls back to the local API in development', () => {
    expect(resolveApiUrl(undefined, false)).toBe('http://localhost:4000');
    expect(resolveApiUrl('', false)).toBe('http://localhost:4000');
  });
});
