import type { ConnectionState, DeviceStatus } from '@updatepilot/shared';

/** How often an agent asks the API for work. Week 3 makes this configurable. */
export const AGENT_POLL_INTERVAL_SECONDS = 10;

const CONNECTED_WITHIN_MS = 3 * AGENT_POLL_INTERVAL_SECONDS * 1000; // 30 seconds
const STALE_WITHIN_MS = 10 * 60 * 1000; // 10 minutes

/**
 * The connection state shown in the UI. It is worked out from the device status and the
 * last time the agent contacted the API. It is never stored, so it cannot go out of date.
 *
 *   revoked        the user revoked the agent
 *   pending        paired but never activated
 *   connected      seen within 3 poll intervals
 *   stale          seen within 10 minutes (shown as a warning)
 *   disconnected   not seen for longer, or never seen
 */
export function connectionState(
  device: { status: DeviceStatus; lastSeenAt: Date | null },
  now: Date = new Date(),
): ConnectionState {
  if (device.status === 'REVOKED') return 'revoked';
  if (device.status === 'PENDING') return 'pending';
  if (!device.lastSeenAt) return 'disconnected';

  const age = now.getTime() - device.lastSeenAt.getTime();
  if (age <= CONNECTED_WITHIN_MS) return 'connected'; // also covers small clock differences
  if (age <= STALE_WITHIN_MS) return 'stale';
  return 'disconnected';
}
