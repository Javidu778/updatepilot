import { describe, expect, it } from 'vitest';
import { AGENT_POLL_INTERVAL_SECONDS, connectionState } from './connection';

const now = new Date('2026-11-09T12:00:00.000Z');
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

describe('connectionState', () => {
  it('reports revoked and pending whatever the last-seen time says', () => {
    expect(connectionState({ status: 'REVOKED', lastSeenAt: now }, now)).toBe('revoked');
    expect(connectionState({ status: 'PENDING', lastSeenAt: now }, now)).toBe('pending');
  });

  it('is disconnected when an active device was never seen', () => {
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: null }, now)).toBe('disconnected');
  });

  it('is connected within three poll intervals', () => {
    const limit = 3 * AGENT_POLL_INTERVAL_SECONDS;
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(0) }, now)).toBe('connected');
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(limit) }, now)).toBe(
      'connected',
    );
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(limit + 1) }, now)).toBe(
      'stale',
    );
  });

  it('is stale for up to ten minutes, then disconnected', () => {
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(600) }, now)).toBe('stale');
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(601) }, now)).toBe(
      'disconnected',
    );
  });

  it('treats a last-seen time slightly in the future (clock difference) as connected', () => {
    expect(connectionState({ status: 'ACTIVE', lastSeenAt: secondsAgo(-5) }, now)).toBe(
      'connected',
    );
  });
});
