import { isNewerVersion, type MatchStatus, type UpdateStatus } from '@updatepilot/shared';

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
 * The update status comes from comparing the two versions properly (see `versions.ts` in the shared
 * package), not from testing them for inequality: a lower "available" version would otherwise be
 * offered as an upgrade. When either version cannot be read, the status is UNKNOWN and the UI says
 * so, rather than claiming an update exists.
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

  if (!input.availableVersion) return { matchStatus, updateStatus: 'UP_TO_DATE' };

  const newer = isNewerVersion(input.availableVersion, input.installedVersion);
  const updateStatus: UpdateStatus =
    newer === null ? 'UNKNOWN' : newer ? 'UPDATE_AVAILABLE' : 'UP_TO_DATE';

  return { matchStatus, updateStatus };
}
