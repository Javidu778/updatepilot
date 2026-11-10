// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each([
    ['/applications', '/applications'],
    ['/applications?page=2&q=git', '/applications?page=2&q=git'],
    ['/applications/3f2b8c1e#details', '/applications/3f2b8c1e#details'],
    ['/updates', '/updates'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'], // encoded slashes stay a path on this site
  ])('keeps the same-site path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ['//evil.example/phish'],
    ['///evil.example'],
    ['/\\evil.example'],
    ['/\\/evil.example'],
    ['https://evil.example'],
    ['http://evil.example/login'],
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['evil.example'],
    ['applications'],
    ['/..//evil.example'],
    ['/.//evil.example'],
    ['/\tevil.example'],
    ['/path\nwith-newline'],
    ['/a\u0000b'],
  ])('falls back for the unsafe value %j', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });

  it('falls back for empty and missing values', () => {
    expect(safeNextPath(null)).toBe('/');
    expect(safeNextPath(undefined)).toBe('/');
    expect(safeNextPath('')).toBe('/');
  });

  it('refuses the sign-in pages themselves, to avoid a redirect loop', () => {
    expect(safeNextPath('/login')).toBe('/');
    expect(safeNextPath('/login?next=/applications')).toBe('/');
    expect(safeNextPath('/register')).toBe('/');
    expect(safeNextPath('/register/')).toBe('/');
    expect(safeNextPath('/login/extra')).toBe('/');
  });

  it('does not refuse paths that only start with the same letters', () => {
    expect(safeNextPath('/loginhelp')).toBe('/loginhelp');
  });

  it('refuses very long values', () => {
    expect(safeNextPath(`/${'a'.repeat(3000)}`)).toBe('/');
  });

  it('uses the fallback it is given', () => {
    expect(safeNextPath('https://evil.example', '/applications')).toBe('/applications');
    expect(safeNextPath(null, '')).toBe('');
  });
});
