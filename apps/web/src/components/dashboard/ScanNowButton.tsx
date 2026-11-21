'use client';

import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ApiError } from '@/lib/api/errors';
import { describeFailure } from '@/lib/api/describe-failure';
import { useAuth } from '@/lib/auth/session';

type Props = {
  /** The paired device to scan, or null when no agent has paired yet. */
  deviceId: string | null;
  /** Called after a scan is queued, so the page can refresh once results arrive. */
  onRequested?: () => void;
};

type State =
  | { status: 'idle' }
  | { status: 'requesting' }
  | { status: 'queued' }
  | { status: 'error'; message: string };

/**
 * Queues a scan for the paired device.
 *
 * This is the only place the browser asks the agent to do something, and it does not talk to the
 * agent at all: it creates a job, and the agent claims it on its next poll. The result therefore
 * arrives asynchronously, so the button reports "requested" and never claims the scan finished.
 */
export function ScanNowButton({ deviceId, onRequested }: Props) {
  const { api } = useAuth();
  const [state, setState] = useState<State>({ status: 'idle' });

  const start = async () => {
    if (!deviceId) return;
    setState({ status: 'requesting' });
    try {
      await api.post(`/api/v1/devices/${deviceId}/scans`);
      setState({ status: 'queued' });
      onRequested?.();
    } catch (error) {
      // Already scanning is not a failure: it means someone (or a previous click) got there first.
      if (error instanceof ApiError && error.code === 'INVALID_STATE') {
        setState({
          status: 'error',
          message: 'A scan is already queued or running. Results appear when the agent finishes.',
        });
        return;
      }
      setState({ status: 'error', message: describeFailure(error, 'the scan') });
    }
  };

  const busy = state.status === 'requesting';
  const queued = state.status === 'queued';

  return (
    <div className="scan-control">
      <button
        type="button"
        className="btn btn-primary"
        onClick={start}
        disabled={!deviceId || busy}
        aria-describedby="scan-hint"
      >
        <RefreshCw aria-hidden="true" size={16} />
        {busy ? 'Requesting…' : queued ? 'Scan requested' : 'Scan now'}
      </button>

      <p id="scan-hint" className="muted scan-hint" role="status">
        {!deviceId
          ? 'Pair an agent before a scan can run.'
          : queued
            ? 'The agent picks this up within about 10 seconds. Reload to see the results.'
            : state.status === 'error'
              ? state.message
              : 'Reads the software installed on the paired computer.'}
      </p>
    </div>
  );
}
