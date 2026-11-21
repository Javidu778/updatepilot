import { describe, expect, it } from 'vitest';
import { isStale, RELEASE_CACHE_MAX_AGE_MS } from './refresh';
import { knownPackageIds, repoForPackageId } from './registry';

describe('repoForPackageId', () => {
  it('finds a known package regardless of case', () => {
    expect(repoForPackageId('7zip.7zip')).toEqual({ owner: 'ip7z', repo: '7zip' });
    expect(repoForPackageId('7ZIP.7Zip')).toEqual({ owner: 'ip7z', repo: '7zip' });
    expect(repoForPackageId('Notepad++.Notepad++')).toEqual({
      owner: 'notepad-plus-plus',
      repo: 'notepad-plus-plus',
    });
  });

  it('has no source for anything it does not know', () => {
    expect(repoForPackageId('Some.UnknownPackage')).toBeNull();
    expect(repoForPackageId(null)).toBeNull();
    expect(repoForPackageId('')).toBeNull();
  });

  it('lists what it can fetch, so the docs and the UI can agree', () => {
    expect(knownPackageIds()).toContain('7zip.7zip');
    expect(knownPackageIds()).toEqual([...knownPackageIds()].sort());
  });
});

describe('isStale', () => {
  const now = new Date('2026-11-22T00:00:00.000Z');

  it('treats a missing timestamp as stale', () => {
    expect(isStale(null, now)).toBe(true);
  });

  it('keeps a fresh entry and refreshes an old one', () => {
    const fresh = new Date(now.getTime() - 60 * 60 * 1000);
    const old = new Date(now.getTime() - RELEASE_CACHE_MAX_AGE_MS - 1000);
    expect(isStale(fresh, now)).toBe(false);
    expect(isStale(old, now)).toBe(true);
  });
});
