import type {
  Application as ApplicationDto,
  AuditEventType,
  Device as DeviceDto,
  Job,
} from '@updatepilot/shared';
import type {
  Application as ApplicationRow,
  Device as DeviceRow,
  ReleaseMetadata as ReleaseRow,
  UpdateJob as UpdateJobRow,
} from '../../generated/prisma/client';
import { connectionState } from './connection';

/**
 * Turns database rows into the API response shapes from @updatepilot/shared.
 * Only fields that belong in a response are copied, so a new database column
 * is never exposed by accident.
 */

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toDevice(row: DeviceRow, now: Date = new Date()): DeviceDto {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    connection: connectionState(row, now),
    osVersion: row.osVersion,
    agentVersion: row.agentVersion,
    lastSeenAt: iso(row.lastSeenAt),
    isSample: row.isSample,
  };
}

export function toApplication(row: ApplicationRow): ApplicationDto {
  return {
    id: row.id,
    deviceId: row.deviceId,
    displayName: row.displayName,
    publisher: row.publisher,
    installedVersion: row.installedVersion,
    availableVersion: row.availableVersion,
    packageId: row.packageId,
    source: row.source,
    architecture: row.architecture,
    matchStatus: row.matchStatus,
    updateStatus: row.updateStatus,
    lastSeenAt: row.lastSeenAt.toISOString(),
    removedAt: iso(row.removedAt),
  };
}

export function toUpdateJob(row: UpdateJobRow): Job {
  return {
    id: row.id,
    kind: 'update',
    state: row.state,
    deviceId: row.deviceId,
    applicationId: row.applicationId,
    packageId: row.packageId,
    fromVersion: row.fromVersion,
    targetVersion: row.targetVersion,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    exitCode: row.exitCode,
    restartRequired: row.restartRequired,
    verification: row.verification,
    errorSummary: row.errorSummary,
  };
}

/**
 * Links come from outside sources (release feeds). Only https links are passed on, so a
 * `javascript:` or plain `http:` link can never reach the UI.
 */
export function safeHttpsUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function toRelease(row: ReleaseRow | null) {
  if (!row) return null;
  return {
    version: row.version,
    releaseDate: iso(row.releaseDate),
    changelogUrl: safeHttpsUrl(row.changelogUrl),
    officialUrl: safeHttpsUrl(row.officialUrl),
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}

/** Audit events that are about the person's own sign-in, not about their devices. Left out of the dashboard feed. */
export const HIDDEN_FROM_ACTIVITY: AuditEventType[] = [
  'USER_REGISTERED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'UNAUTHORIZED_ATTEMPT',
];

/**
 * Fixed text for each event type. No user-controlled text goes into the feed, so nothing
 * from the audit metadata can leak or inject markup. The Record type makes the compiler
 * complain if a new event type is added without a sentence here.
 */
export const ACTIVITY_SUMMARY: Record<AuditEventType, string> = {
  USER_REGISTERED: 'Account created',
  USER_LOGIN: 'Signed in',
  USER_LOGOUT: 'Signed out',
  DEVICE_PAIRING_CODE_CREATED: 'Pairing code created',
  DEVICE_PAIRED: 'Device paired',
  DEVICE_REVOKED: 'Device revoked',
  CREDENTIAL_ROTATED: 'Agent credential rotated',
  SCAN_REQUESTED: 'Scan requested',
  SCAN_COMPLETED: 'Scan completed',
  SCAN_FAILED: 'Scan failed',
  UPDATE_PREVIEWED: 'Update previewed',
  UPDATE_CONFIRMED: 'Update confirmed',
  UPDATE_STARTED: 'Update started',
  UPDATE_COMPLETED: 'Update completed',
  UPDATE_FAILED: 'Update failed',
  UPDATE_VERIFIED: 'Update verified',
  UPDATE_VERIFICATION_FAILED: 'Update verification failed',
  SETTINGS_CHANGED: 'Settings changed',
  EXPORT_CREATED: 'Report exported',
  UNAUTHORIZED_ATTEMPT: 'Unauthorized attempt',
};
