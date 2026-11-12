import { describe, expect, it } from 'vitest';
import {
  NOT_AVAILABLE,
  countOf,
  formatRelativeTime,
  formatVersion,
  formatVersionChange,
  plural,
} from './format';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  it('reads "just now" under a minute', () => {
    expect(formatRelativeTime(ago(30_000), NOW)).toBe('just now');
  });

  it('counts minutes, hours and days', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1 minute ago');
    expect(formatRelativeTime(ago(3 * MINUTE), NOW)).toBe('3 minutes ago');
    expect(formatRelativeTime(ago(2 * HOUR), NOW)).toBe('2 hours ago');
    expect(formatRelativeTime(ago(5 * DAY), NOW)).toBe('5 days ago');
  });

  it('never goes negative when the clock is ahead', () => {
    expect(formatRelativeTime(new Date(NOW + MINUTE).toISOString(), NOW)).toBe('just now');
  });

  it('says "Not available" rather than guessing', () => {
    expect(formatRelativeTime(null, NOW)).toBe(NOT_AVAILABLE);
    expect(formatRelativeTime(undefined, NOW)).toBe(NOT_AVAILABLE);
    expect(formatRelativeTime('not-a-date', NOW)).toBe(NOT_AVAILABLE);
  });
});

describe('versions', () => {
  it('shows a version as given', () => {
    expect(formatVersion('1.2.3')).toBe('1.2.3');
  });

  it('replaces a missing or blank version', () => {
    expect(formatVersion(null)).toBe(NOT_AVAILABLE);
    expect(formatVersion(undefined)).toBe(NOT_AVAILABLE);
    expect(formatVersion('   ')).toBe(NOT_AVAILABLE);
  });

  it('writes a change only when both sides exist', () => {
    expect(formatVersionChange('1.2.3', '1.3.0')).toBe('1.2.3 → 1.3.0');
    expect(formatVersionChange(null, '1.3.0')).toBe(NOT_AVAILABLE);
    expect(formatVersionChange('1.2.3', null)).toBe(NOT_AVAILABLE);
  });
});

describe('counts', () => {
  it('matches the number to the noun', () => {
    expect(plural(1, 'application')).toBe('application');
    expect(plural(2, 'application')).toBe('applications');
    expect(countOf(1, 'application')).toBe('1 application');
    expect(countOf(18, 'application')).toBe('18 applications');
  });
});
