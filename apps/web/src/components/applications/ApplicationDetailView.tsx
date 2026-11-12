'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, ExternalLink, Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { applicationDetailSchema, type Job, type VerificationResult } from '@updatepilot/shared';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { JobStateBadge, MatchStatusBadge, UpdateStatusBadge } from '@/components/StatusBadge';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import {
  NOT_AVAILABLE,
  formatDate,
  formatRelativeTime,
  formatVersion,
  formatVersionChange,
} from '@/lib/format';

const VERIFICATION_TEXT: Record<VerificationResult, string> = {
  NOT_RUN: 'Not checked yet',
  VERIFIED: 'New version confirmed',
  FAILED: 'New version not confirmed',
};

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function UpdateHistory({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) {
    return <p className="muted">No update attempts have been recorded for this application yet.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="visually-hidden">Update attempts for this application</caption>
        <thead>
          <tr>
            <th scope="col">Requested</th>
            <th scope="col">Change</th>
            <th scope="col">Result</th>
            <th scope="col">Verification</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job.id}>
              <td>{formatRelativeTime(job.requestedAt)}</td>
              <td className="version">{formatVersionChange(job.fromVersion, job.targetVersion)}</td>
              <td>
                <JobStateBadge value={job.state} />
              </td>
              <td>{VERIFICATION_TEXT[job.verification]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One application from GET /api/v1/applications/:id: identity, versions, cached release
 * information and the update attempts recorded for it.
 *
 * A missing application, an invalid id and another user's application all answer 404 with the
 * same message, so this page cannot be used to probe for ids.
 */
export function ApplicationDetailView() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';
  const { api } = useAuth();

  const { resource, reload } = useApiResource(`application:${id}`, (signal) =>
    api.get(`/api/v1/applications/${encodeURIComponent(id)}`, {
      schema: applicationDetailSchema,
      signal,
    }),
  );

  const backLink = (
    <Link className="back-link" href="/applications">
      <ArrowLeft aria-hidden="true" size={16} />
      Back to applications
    </Link>
  );

  if (!id) {
    return (
      <>
        {backLink}
        <EmptyState
          title="No application selected"
          body="Open an application from the inventory."
        />
      </>
    );
  }

  if (resource.status === 'loading') {
    return (
      <>
        {backLink}
        <LoadingState label="Loading application…" />
      </>
    );
  }

  if (resource.status === 'error') {
    return (
      <>
        {backLink}
        <ErrorState
          error={resource.error}
          onRetry={reload}
          title="We could not load this application"
          subject="that application"
        />
      </>
    );
  }

  const application = resource.data;

  return (
    <>
      {backLink}

      <div className="page-header">
        <h1>{application.displayName}</h1>
        <p className="muted">
          {application.publisher ?? NOT_AVAILABLE} · {application.packageId ?? NOT_AVAILABLE}
        </p>
      </div>

      {application.isSample ? (
        <div className="banner banner-warning" role="status">
          <Info aria-hidden="true" size={16} />
          <p>
            <strong>Sample data.</strong> This application comes from seeded rows, not from a scan
            of this computer.
          </p>
        </div>
      ) : null}

      <div className="stack">
        <section className="card" aria-labelledby="detail-heading">
          <div className="section-heading">
            <h2 id="detail-heading">Details</h2>
            <span>
              <UpdateStatusBadge value={application.updateStatus} />{' '}
              <MatchStatusBadge value={application.matchStatus} />
            </span>
          </div>
          <dl className="detail-grid">
            <Field label="Installed version">{formatVersion(application.installedVersion)}</Field>
            <Field label="Available version">{formatVersion(application.availableVersion)}</Field>
            <Field label="Source">{application.source ?? NOT_AVAILABLE}</Field>
            <Field label="Architecture">{application.architecture ?? NOT_AVAILABLE}</Field>
            <Field label="Last seen">{formatRelativeTime(application.lastSeenAt)}</Field>
            <Field label="Removed">
              {application.removedAt ? formatDate(application.removedAt) : 'Still installed'}
            </Field>
          </dl>
        </section>

        <section className="card" aria-labelledby="release-heading">
          <h2 id="release-heading">Release information</h2>
          {application.release === null ? (
            <p className="muted">
              No release information is available for {formatVersion(application.availableVersion)}.
              Release data is filled by update checking in Week 4; until then this reads &ldquo;Not
              available&rdquo; rather than guessing.
            </p>
          ) : (
            <>
              <dl className="detail-grid">
                <Field label="Version">{formatVersion(application.release.version)}</Field>
                <Field label="Release date">{formatDate(application.release.releaseDate)}</Field>
                <Field label="Source">{application.release.source}</Field>
                <Field label="Checked">{formatDate(application.release.fetchedAt)}</Field>
              </dl>
              {application.release.changelogUrl || application.release.officialUrl ? (
                <p>
                  {application.release.changelogUrl ? (
                    <a
                      href={application.release.changelogUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Changelog <ExternalLink aria-hidden="true" size={12} />
                    </a>
                  ) : null}
                  {application.release.changelogUrl && application.release.officialUrl
                    ? ' · '
                    : null}
                  {application.release.officialUrl ? (
                    <a
                      href={application.release.officialUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      Official page <ExternalLink aria-hidden="true" size={12} />
                    </a>
                  ) : null}
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="history-heading">
          <h2 id="history-heading">Update history</h2>
          <UpdateHistory jobs={application.updateHistory} />
        </section>
      </div>
    </>
  );
}
