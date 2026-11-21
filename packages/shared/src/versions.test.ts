import { describe, expect, it } from 'vitest';
import { compareVersions, isNewerVersion, isSameVersion, parseVersion } from './versions';

describe('parseVersion', () => {
  it('reads a plain version', () => {
    expect(parseVersion('2.56.1')).toEqual({
      numbers: [2, 56, 1],
      preRelease: null,
      bound: 'exact',
    });
  });

  it('ignores a trailing build in brackets, which WinGet reports for some packages', () => {
    expect(parseVersion('5.17.11 (34827)')).toEqual({
      numbers: [5, 17, 11],
      preRelease: null,
      bound: 'exact',
    });
    expect(parseVersion('7.2.5 (51704)')).toEqual({
      numbers: [7, 2, 5],
      preRelease: null,
      bound: 'exact',
    });
  });

  it('keeps a pre-release suffix', () => {
    expect(parseVersion('1.0.0-beta.2')).toEqual({
      numbers: [1, 0, 0],
      preRelease: 'beta.2',
      bound: 'exact',
    });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseVersion('  23.01  ')).toEqual({
      numbers: [23, 1],
      preRelease: null,
      bound: 'exact',
    });
  });

  it('refuses anything without a number', () => {
    expect(parseVersion('Unknown')).toBeNull();
    expect(parseVersion('')).toBeNull();
    expect(parseVersion(null)).toBeNull();
    expect(parseVersion(undefined)).toBeNull();
    expect(parseVersion('v')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('orders by number, not by text', () => {
    expect(compareVersions('2.9.0', '2.10.0')).toBeLessThan(0);
    expect(compareVersions('23.01', '24.08')).toBeLessThan(0);
    expect(compareVersions('1.21.13002.0', '1.21.13001.0')).toBeGreaterThan(0);
  });

  it('treats a missing segment as zero', () => {
    expect(compareVersions('2.44', '2.44.0')).toBe(0);
    expect(compareVersions('2025.1', '2025.1.1')).toBeLessThan(0);
  });

  it('ignores a bracketed build', () => {
    expect(compareVersions('5.17.11 (34827)', '5.17.11')).toBe(0);
    expect(compareVersions('7.2.5 (51704)', '5.17.11 (34827)')).toBeGreaterThan(0);
  });

  it('sorts a pre-release before its release', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
  });

  it('compares pre-release numbers numerically', () => {
    expect(compareVersions('1.0.0-beta.2', '1.0.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0-beta')).toBeLessThan(0);
  });

  it('returns null when either side cannot be read', () => {
    expect(compareVersions('Unknown', '2.0.0')).toBeNull();
    expect(compareVersions('2.0.0', 'Unknown')).toBeNull();
    expect(compareVersions(null, '2.0.0')).toBeNull();
  });
});

describe('bounded versions', () => {
  it('reads the bound WinGet reports when it cannot see the exact version', () => {
    // Real case: the Python Launcher reports "< 3.14.7".
    expect(parseVersion('< 3.14.7')).toEqual({
      numbers: [3, 14, 7],
      preRelease: null,
      bound: 'upper',
    });
    expect(parseVersion('>= 2.0')?.bound).toBe('lower');
  });

  it('proves an update when the exact version is above the bound', () => {
    expect(isNewerVersion('3.15.2', '< 3.14.7')).toBe(true);
    expect(isNewerVersion('3.14.7', '< 3.14.7')).toBe(true);
  });

  it('refuses to order a bound it cannot place', () => {
    // 3.13.0 may or may not be newer than "something below 3.14.7".
    expect(isNewerVersion('3.13.0', '< 3.14.7')).toBeNull();
    expect(compareVersions('< 3.14.7', '< 3.15')).toBeNull();
    expect(isNewerVersion('< 3.15', '3.14.7')).toBeNull();
  });

  it('proves an update when the bound is above the exact version', () => {
    expect(isNewerVersion('> 2.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('> 2.0', '2.1.0')).toBeNull();
  });
});

describe('isNewerVersion', () => {
  it('is true only for a strictly newer version', () => {
    expect(isNewerVersion('2.45.1', '2.44.0')).toBe(true);
    expect(isNewerVersion('2.44.0', '2.45.1')).toBe(false);
    expect(isNewerVersion('2.44.0', '2.44.0')).toBe(false);
    expect(isNewerVersion('2.44', '2.44.0')).toBe(false);
  });

  it('is null when it cannot tell, so no caller guesses', () => {
    expect(isNewerVersion('2.8.0', 'Unknown')).toBeNull();
    expect(isNewerVersion('Unknown', '2.8.0')).toBeNull();
  });
});

describe('isSameVersion', () => {
  it('treats differently written equal versions as equal', () => {
    expect(isSameVersion('2.44', '2.44.0')).toBe(true);
    expect(isSameVersion('5.17.11 (34827)', '5.17.11')).toBe(true);
  });

  it('is null when a side is unreadable', () => {
    expect(isSameVersion('Unknown', 'Unknown')).toBeNull();
  });
});
