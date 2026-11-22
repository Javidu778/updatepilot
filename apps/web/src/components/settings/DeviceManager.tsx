'use client';

import { useState } from 'react';
import {
  deviceSchema,
  devicesResponseSchema,
  pairingCodeResponseSchema,
  type Device,
} from '@updatepilot/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { ConnectionBadge } from '@/components/StatusBadge';
import { describeFailure } from '@/lib/api/describe-failure';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import { formatDate, formatRelativeTime } from '@/lib/format';

type PairingCode = { code: string; expiresAt: string };

/**
 * Settings & agent: pair a computer, see the paired ones, revoke one.
 *
 * The pairing code is shown once and expires in ten minutes. Revoking is immediate and names exactly
 * what stops working, because it is the one action here that cannot be undone from this page.
 */
export function DeviceManager() {
  const { api } = useAuth();
  const { resource, reload } = useApiResource('devices:settings', (signal) =>
    api.get('/api/v1/devices', { schema: devicesResponseSchema, signal }),
  );

  const [pairing, setPairing] = useState<PairingCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const requestCode = async () => {
    setBusy(true);
    setMessage(null);
    try {
      setPairing(
        await api.post('/api/v1/devices/pairing-codes', { schema: pairingCodeResponseSchema }),
      );
    } catch (error) {
      setMessage(describeFailure(error, 'a pairing code'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (device: Device) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.post(`/api/v1/devices/${device.id}/revoke`, { schema: deviceSchema });
      setConfirming(null);
      reload();
    } catch (error) {
      setMessage(describeFailure(error, 'that device'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className="card" aria-labelledby="pair-heading">
        <h2 id="pair-heading">Pair a new computer</h2>
        <p className="muted">
          Ask for a code, run the pairing command on that PC, then start the agent there. The code
          is single use and expires after ten minutes.
        </p>

        <div className="scan-control">
          <button type="button" className="btn btn-primary" onClick={requestCode} disabled={busy}>
            {pairing ? 'Get another code' : 'Create pairing code'}
          </button>
        </div>

        {pairing ? (
          <div className="pair-panel">
            <p className="pair-code" aria-live="polite">
              {pairing.code}
            </p>
            <p className="muted">Valid until {formatDate(pairing.expiresAt)}.</p>
            <p className="muted">On that computer, in the repository folder:</p>
            <ol className="pair-steps">
              <li>
                <code>npm run pair -w apps/agent -- --code {pairing.code}</code>
              </li>
              <li>
                <code>npm start -w apps/agent</code>
              </li>
            </ol>
            <p className="muted">
              The device turns <strong>Active</strong> on the agent&apos;s first poll, within about
              ten seconds.
            </p>
          </div>
        ) : null}

        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="devices-heading">
        <h2 id="devices-heading">Paired computers</h2>

        {resource.status === 'loading' ? (
          <LoadingState label="Loading your devices…" rows={3} />
        ) : null}

        {resource.status === 'error' ? (
          <ErrorState
            error={resource.error}
            onRetry={reload}
            title="We could not load your devices"
            subject="your devices"
          />
        ) : null}

        {resource.status === 'ready' && resource.data.data.length === 0 ? (
          <EmptyState
            title="No computer paired yet"
            body="Create a pairing code above and run the agent on the computer you want to manage."
          />
        ) : null}

        {resource.status === 'ready' && resource.data.data.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Computers paired with this account</caption>
              <thead>
                <tr>
                  <th scope="col">Computer</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last seen</th>
                  <th scope="col">Agent</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {resource.data.data.map((device) => (
                  <tr key={device.id}>
                    <td>
                      <span className="row-link">{device.name}</span>
                      {device.isSample ? (
                        <span className="cell-secondary">Sample data</span>
                      ) : device.osVersion ? (
                        <span className="cell-secondary">{device.osVersion}</span>
                      ) : null}
                    </td>
                    <td>
                      <ConnectionBadge value={device.connection} />
                    </td>
                    <td>{formatRelativeTime(device.lastSeenAt)}</td>
                    <td className="version">{device.agentVersion ?? 'Not available'}</td>
                    <td>
                      {device.status === 'REVOKED' ? (
                        <span className="muted">Revoked</span>
                      ) : confirming === device.id ? (
                        <span className="confirm-inline">
                          <span>Stop trusting this PC?</span>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => revoke(device)}
                            disabled={busy}
                          >
                            Yes, revoke
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => setConfirming(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => setConfirming(device.id)}
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <p className="muted">
          Revoking stops the agent on that computer within one poll. It cannot run scans or updates
          again until you pair it with a new code.
        </p>
      </section>
    </>
  );
}
