'use client';

import { securityFindingsResponseSchema, type SecurityFinding } from '@updatepilot/shared';
import { Info } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState } from '@/components/DataStates';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';
import { countOf, formatDate, formatRelativeTime } from '@/lib/format';

const SEVERITY_TONE: Record<string, { tone: string; label: string }> = {
  CRITICAL: { tone: 'danger', label: 'Critical' },
  HIGH: { tone: 'danger', label: 'High' },
  MEDIUM: { tone: 'warning', label: 'Medium' },
  LOW: { tone: 'info', label: 'Low' },
  UNKNOWN: { tone: 'neutral', label: 'Unknown' },
};

function SeverityBadge({ severity }: { severity: SecurityFinding['severity'] }) {
  const { tone, label } = SEVERITY_TONE[severity] ?? SEVERITY_TONE.UNKNOWN;
  return <span className={`badge badge-${tone}`}>{label}</span>;
}

/**
 * Security insights.
 *
 * The page is deliberately careful about what absence means. It shows where the data came from,
 * when it was last checked, and the limitation that an empty list is not proof of safety.
 *
 * There is no live advisory feed yet: the OSV integration is later work, so today the rows are
 * seeded sample data and the page says so in the banner rather than in a footnote.
 */
export function SecurityInsights() {
  const { api } = useAuth();
  const { resource, reload } = useApiResource('security:findings', (signal) =>
    api.get('/api/v1/security/findings', { schema: securityFindingsResponseSchema, signal }),
  );

  if (resource.status === 'loading') {
    return <LoadingState label="Checking known advisories…" />;
  }

  if (resource.status === 'error') {
    return (
      <ErrorState
        error={resource.error}
        onRetry={reload}
        title="We could not load security insights"
        subject="the advisory list"
      />
    );
  }

  const { data, total, meta } = resource.data;

  return (
    <>
      {meta.isSample ? (
        <div className="banner banner-warning" role="status">
          <Info aria-hidden="true" size={16} />
          <p>
            <strong>Sample data.</strong> These rows exist to design this page. Live advisory
            checking arrives with the OSV integration, so nothing here tells you anything about the
            software on your computer.
          </p>
        </div>
      ) : null}

      <p className="muted">
        Source: {meta.source}. Last checked {formatRelativeTime(meta.checkedAt)}.
        {meta.checkedAt ? ` (${formatDate(meta.checkedAt)})` : ''}
      </p>

      {data.length === 0 ? (
        <EmptyState title="No known advisories for your applications" body={meta.limitations} />
      ) : (
        <>
          <p className="muted update-count" role="status">
            {countOf(total, 'finding')} for packages you have installed.
          </p>

          <div className="table-wrap">
            <table className="data-table">
              <caption className="visually-hidden">Known advisories for installed packages</caption>
              <thead>
                <tr>
                  <th scope="col">Package</th>
                  <th scope="col">Advisory</th>
                  <th scope="col">Severity</th>
                  <th scope="col">Affected</th>
                  <th scope="col">Fixed in</th>
                  <th scope="col">Checked</th>
                </tr>
              </thead>
              <tbody>
                {data.map((finding) => (
                  <tr key={finding.id}>
                    <td>
                      <span className="mono">{finding.packageId}</span>
                      {finding.summary ? (
                        <span className="cell-secondary">{finding.summary}</span>
                      ) : null}
                    </td>
                    <td className="mono">{finding.advisoryId}</td>
                    <td>
                      <SeverityBadge severity={finding.severity} />
                    </td>
                    <td className="version">{finding.affectedRange}</td>
                    <td className="version">{finding.fixedVersion ?? 'Not available'}</td>
                    <td>
                      {formatRelativeTime(finding.lastVerifiedAt)}
                      <span className="cell-secondary">{finding.source}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {data.some((finding) => finding.sourceUrl) ? (
            <p className="muted">
              Advisories with a published page:{' '}
              {data
                .filter((finding) => finding.sourceUrl)
                .map((finding, index) => (
                  <span key={finding.id}>
                    {index > 0 ? ', ' : ''}
                    <a href={finding.sourceUrl!} target="_blank" rel="noreferrer noopener">
                      {finding.advisoryId}
                    </a>
                  </span>
                ))}
              .
            </p>
          ) : null}
        </>
      )}

      <p className="muted">{meta.limitations}</p>
    </>
  );
}
