'use client';

import { useEffect, useState } from 'react';
import {
  applicationDetailSchema,
  jobSchema,
  updatePreviewSchema,
  updatesResponseSchema,
  type Job,
  type UpdateCandidate,
  type UpdatePreview,
} from '@updatepilot/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { JobStateBadge, UpdateStatusBadge } from '@/components/StatusBadge';
import { ApiError } from '@/lib/api/errors';
import { describeFailure } from '@/lib/api/describe-failure';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import { countOf, formatDate, formatRelativeTime } from '@/lib/format';

/** States a job can reach and never leave. */
const FINAL_STATES = new Set([
  'SUCCEEDED',
  'FAILED',
  'VERIFICATION_FAILED',
  'RESTART_REQUIRED',
  'INTERRUPTED',
  'CANCELLED',
]);

type DialogPhase = 'previewing' | 'ready' | 'confirmed' | 'done' | 'error';

/**
 * The Update Center: what can be updated, one confirmation per package, then the outcome.
 *
 * Everything on this screen comes from the API. The confirmation dialog shows exactly the package
 * and target version the server will act on, and the execute call sends the preview token - so what
 * the user saw is what runs. Progress is read back from the application's own update history rather
 * than invented locally.
 */
export function UpdateCenter() {
  const { api } = useAuth();
  const { resource, reload } = useApiResource('updates:list', (signal) =>
    api.get('/api/v1/updates?pageSize=100', { schema: updatesResponseSchema, signal }),
  );
  const [selected, setSelected] = useState<UpdateCandidate | null>(null);

  if (resource.status === 'loading') return <LoadingState label="Looking for available updates…" />;
  if (resource.status === 'error') {
    return (
      <ErrorState
        error={resource.error}
        onRetry={reload}
        title="We could not load the updates"
        subject="the update list"
      />
    );
  }

  const { data, total } = resource.data;

  if (data.length === 0) {
    return (
      <EmptyState
        title="Nothing to update"
        body="Every matched application is on its newest known version. Run a scan to check again."
        action={{ label: 'Refresh', onClick: reload }}
      />
    );
  }

  return (
    <>
      <p className="muted update-count" role="status">
        {countOf(total, 'update')} available. Each one is confirmed separately.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">Applications with an update available</caption>
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Installed</th>
              <th scope="col">Available</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="visually-hidden">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((candidate) => (
              <tr key={candidate.applicationId}>
                <td>
                  <span className="row-link">{candidate.displayName}</span>
                  <span className="cell-secondary mono">{candidate.packageId}</span>
                </td>
                <td className="version">{candidate.installedVersion}</td>
                <td className="version">{candidate.availableVersion}</td>
                <td>
                  {candidate.activeJobId ? (
                    <JobStateBadge value="RUNNING" />
                  ) : (
                    <UpdateStatusBadge value="UPDATE_AVAILABLE" />
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={candidate.activeJobId !== null}
                    onClick={() => setSelected(candidate)}
                  >
                    {candidate.activeJobId ? 'In progress' : 'Review update'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected ? (
        <ConfirmUpdateDialog
          candidate={selected}
          onClose={() => {
            setSelected(null);
            reload();
          }}
        />
      ) : null}
    </>
  );
}

function ConfirmUpdateDialog({
  candidate,
  onClose,
}: {
  candidate: UpdateCandidate;
  onClose: () => void;
}) {
  const { api } = useAuth();
  const [phase, setPhase] = useState<DialogPhase>('previewing');
  const [preview, setPreview] = useState<UpdatePreview | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Load the preview as soon as the dialog opens: it is the server's statement of what will run.
  useEffect(() => {
    let cancelled = false;
    api
      .post(`/api/v1/updates/${candidate.applicationId}/preview`, {
        schema: updatePreviewSchema,
      })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(describeFailure(error, 'this update'));
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, [api, candidate.applicationId]);

  // While a job is in flight, read its state from the application's update history.
  useEffect(() => {
    if (phase !== 'confirmed') return;
    let cancelled = false;
    const timer = setInterval(() => {
      api
        .get(`/api/v1/applications/${candidate.applicationId}`, { schema: applicationDetailSchema })
        .then((detail) => {
          if (cancelled) return;
          const latest = detail.updateHistory[0];
          if (!latest) return;
          setJob(latest);
          if (FINAL_STATES.has(latest.state)) setPhase('done');
        })
        .catch(() => {
          // A failed poll is not a failed update; the next tick tries again.
        });
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, api, candidate.applicationId]);

  // Esc closes, like any dialog. Disabled once the update is queued: cancelling a running installer
  // from a keyboard shortcut would be a lie.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && phase !== 'confirmed') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const confirm = async () => {
    if (!preview) return;
    try {
      const queued = await api.post(`/api/v1/updates/${candidate.applicationId}/execute`, {
        body: { previewToken: preview.previewToken },
        schema: jobSchema,
      });
      setJob(queued);
      setPhase('confirmed');
    } catch (error) {
      if (error instanceof ApiError && error.code === 'UPDATE_CHANGED') {
        setMessage('The update changed while this dialog was open. Close it and review again.');
      } else if (error instanceof ApiError && error.code === 'INVALID_STATE') {
        setMessage(error.message);
      } else {
        setMessage(describeFailure(error, 'this update'));
      }
      setPhase('error');
    }
  };

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) =>
        event.target === event.currentTarget && phase !== 'confirmed' && onClose()
      }
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-update-title"
      >
        <h2 id="confirm-update-title">Confirm update</h2>

        <dl className="detail-grid">
          <div>
            <dt>Application</dt>
            <dd>{candidate.displayName}</dd>
          </div>
          <div>
            <dt>Package</dt>
            <dd className="mono">{candidate.packageId}</dd>
          </div>
          <div>
            <dt>Installed version</dt>
            <dd className="mono">{candidate.installedVersion}</dd>
          </div>
          <div>
            <dt>Update to</dt>
            <dd className="mono update-target">
              {preview?.targetVersion ?? candidate.availableVersion}
            </dd>
          </div>
        </dl>

        {phase === 'previewing' ? (
          <p className="muted">Checking what this update will do…</p>
        ) : null}

        {preview ? (
          <ul className="dialog-notes">
            {preview.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
            <li>This confirmation is valid until {formatDate(preview.expiresAt)}.</li>
          </ul>
        ) : null}

        {job ? (
          <p className="dialog-progress" role="status">
            <JobStateBadge value={job.state} />{' '}
            {job.state === 'QUEUED'
              ? 'The agent picks this up on its next poll.'
              : job.state === 'SUCCEEDED'
                ? `Verified: the installed version is now ${job.targetVersion}.`
                : job.state === 'RESTART_REQUIRED'
                  ? 'Installed. Restart the computer, then run a scan to verify the version.'
                  : job.errorSummary
                    ? job.errorSummary
                    : 'The update is running. This page updates itself.'}
          </p>
        ) : null}

        {message ? (
          <p className="form-error" role="alert">
            {message}
          </p>
        ) : null}

        <div className="dialog-actions">
          {phase === 'ready' ? (
            <>
              <button type="button" className="btn btn-primary" onClick={confirm}>
                Confirm update
              </button>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Cancel
              </button>
            </>
          ) : null}

          {phase === 'previewing' ? (
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
          ) : null}

          {phase === 'error' ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          ) : null}

          {phase === 'confirmed' ? (
            <p className="muted">Leave this window open to see the result.</p>
          ) : null}

          {phase === 'done' ? (
            <button type="button" className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          ) : null}
        </div>

        {phase === 'done' && job ? (
          <p className="muted">Finished {formatRelativeTime(job.finishedAt ?? job.requestedAt)}.</p>
        ) : null}
      </div>
    </div>
  );
}
