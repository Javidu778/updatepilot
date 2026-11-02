import type { ConnectionState } from '@updatepilot/shared';

const LABELS: Record<ConnectionState, { text: string; tone: string }> = {
  connected: { text: 'Connected', tone: 'success' },
  stale: { text: 'Stale', tone: 'warning' },
  disconnected: { text: 'Disconnected', tone: 'danger' },
  pending: { text: 'Not paired', tone: 'neutral' },
  revoked: { text: 'Revoked', tone: 'danger' },
};

/**
 * Always visible in the top bar. Shows the text as well as the colour, never colour alone.
 * Shell only: the real state comes from GET /api/v1/devices once the agent exists (Week 3).
 */
export function AgentIndicator({ state = 'pending' }: { state?: ConnectionState }) {
  const { text, tone } = LABELS[state];
  return (
    <p className="agent-indicator">
      <span className={`badge badge-${tone}`}>Agent: {text}</span>
    </p>
  );
}
