'use client';

import type { ConnectionState } from '@updatepilot/shared';
import { useDevices } from '@/lib/devices/devices-context';

const LABELS: Record<ConnectionState, { text: string; tone: string }> = {
  connected: { text: 'Connected', tone: 'success' },
  stale: { text: 'Stale', tone: 'warning' },
  disconnected: { text: 'Disconnected', tone: 'danger' },
  pending: { text: 'Not paired', tone: 'neutral' },
  revoked: { text: 'Revoked', tone: 'danger' },
};

/**
 * Always visible in the top bar. Shows the text as well as the colour, never colour alone.
 * The state comes from GET /api/v1/devices through the shared devices context, so the top bar
 * and the Overview page can never disagree.
 */
export function AgentIndicator() {
  const { connection, status } = useDevices();

  const badge = () => {
    if (status === 'loading') return <span className="badge badge-neutral">Agent: Checking…</span>;
    if (status === 'error') return <span className="badge badge-neutral">Agent: Unknown</span>;
    const { text, tone } = LABELS[connection];
    return <span className={`badge badge-${tone}`}>Agent: {text}</span>;
  };

  return <p className="agent-indicator">{badge()}</p>;
}
