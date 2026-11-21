import type { MatchStatus, UpdateStatus } from '@updatepilot/shared';

/**
 * How an installed application is identified across scans.
 *
 * A matched package is identified by its package ID. An unmatched application has no ID, so it is
 * identified by name + publisher + architecture, normalised.
 *
 * WARNING: changing this rule orphans every existing row, because the keys stop matching.
 * Day 5's matching module builds on this function rather than replacing it.
 */

function slug(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function appKeyFor(input: {
  packageId: string | null;
  displayName: string;
  publisher: string | null;
  architecture: string | null;
}): string {
  if (input.packageId) return `pkg:${input.packageId.toLowerCase()}`;
  return `app:${slug(input.displayName)}|${slug(input.publisher)}|${slug(input.architecture)}`;
}

/**
 * The statuses the UI colours and filters by.
 *
 * Day 4 compares versions only for equality. Day 5 replaces that with real version ordering and
 * release metadata, which is why this function exists on its own.
 */
export function deriveStatuses(input: {
  packageId: string | null;
  source: string | null;
  installedVersion: string;
  availableVersion: string | null;
}): { matchStatus: MatchStatus; updateStatus: UpdateStatus } {
  const matchStatus: MatchStatus = !input.packageId
    ? 'UNMATCHED'
    : input.source !== null && input.source !== 'winget'
      ? 'UNSUPPORTED'
      : 'MATCHED';

  if (matchStatus !== 'MATCHED') return { matchStatus, updateStatus: 'UNKNOWN' };

  const updateStatus: UpdateStatus =
    input.availableVersion && input.availableVersion !== input.installedVersion
      ? 'UPDATE_AVAILABLE'
      : 'UP_TO_DATE';

  return { matchStatus, updateStatus };
}
