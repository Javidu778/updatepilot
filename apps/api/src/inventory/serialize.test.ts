import { describe, expect, it } from 'vitest';
import { AUDIT_EVENT_TYPES } from '@updatepilot/shared';
import { ACTIVITY_SUMMARY, HIDDEN_FROM_ACTIVITY, safeHttpsUrl } from './serialize';

describe('safeHttpsUrl', () => {
  it('keeps https links', () => {
    expect(safeHttpsUrl('https://www.7-zip.org/history.txt')).toBe(
      'https://www.7-zip.org/history.txt',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/changelog',
    'ftp://example.com/file',
    '//example.com/changelog',
    'not a url',
    '',
  ])('drops %j', (value) => {
    expect(safeHttpsUrl(value)).toBeNull();
  });

  it('returns null for null', () => {
    expect(safeHttpsUrl(null)).toBeNull();
  });
});

describe('activity feed', () => {
  it('has a fixed sentence for every audit event type', () => {
    for (const type of AUDIT_EVENT_TYPES) {
      expect(ACTIVITY_SUMMARY[type]).toEqual(expect.any(String));
    }
  });

  it('hides sign-in noise but keeps device and update events', () => {
    expect(HIDDEN_FROM_ACTIVITY).toEqual(
      expect.arrayContaining([
        'USER_LOGIN',
        'USER_LOGOUT',
        'USER_REGISTERED',
        'UNAUTHORIZED_ATTEMPT',
      ]),
    );
    expect(HIDDEN_FROM_ACTIVITY).not.toContain('SCAN_COMPLETED');
    expect(HIDDEN_FROM_ACTIVITY).not.toContain('UPDATE_FAILED');
  });
});
