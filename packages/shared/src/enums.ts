import { z } from 'zod';

// These values mirror the enums in apps/api/prisma/schema.prisma.
// If you change one side, change the other in the same pull request.

export const DEVICE_STATUSES = ['PENDING', 'ACTIVE', 'REVOKED'] as const;
export const deviceStatusSchema = z.enum(DEVICE_STATUSES);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const MATCH_STATUSES = ['MATCHED', 'UNMATCHED', 'UNSUPPORTED', 'UNKNOWN'] as const;
export const matchStatusSchema = z.enum(MATCH_STATUSES);
export type MatchStatus = z.infer<typeof matchStatusSchema>;

export const UPDATE_STATUSES = ['UP_TO_DATE', 'UPDATE_AVAILABLE', 'UNKNOWN'] as const;
export const updateStatusSchema = z.enum(UPDATE_STATUSES);
export type UpdateStatus = z.infer<typeof updateStatusSchema>;

export const JOB_STATES = [
  'QUEUED',
  'RUNNING',
  'VERIFYING',
  'SUCCEEDED',
  'FAILED',
  'RESTART_REQUIRED',
  'CANCELLED',
  'INTERRUPTED',
  'VERIFICATION_FAILED',
] as const;
export const jobStateSchema = z.enum(JOB_STATES);
export type JobState = z.infer<typeof jobStateSchema>;

export const VERIFICATION_RESULTS = ['NOT_RUN', 'VERIFIED', 'FAILED'] as const;
export const verificationResultSchema = z.enum(VERIFICATION_RESULTS);
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN'] as const;
export const severitySchema = z.enum(SEVERITIES);
export type Severity = z.infer<typeof severitySchema>;

export const ACTOR_TYPES = ['USER', 'AGENT', 'SYSTEM'] as const;
export const actorTypeSchema = z.enum(ACTOR_TYPES);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const AUDIT_EVENT_TYPES = [
  'USER_REGISTERED',
  'USER_LOGIN',
  'USER_LOGOUT',
  'DEVICE_PAIRING_CODE_CREATED',
  'DEVICE_PAIRED',
  'DEVICE_REVOKED',
  'CREDENTIAL_ROTATED',
  'SCAN_REQUESTED',
  'SCAN_COMPLETED',
  'SCAN_FAILED',
  'UPDATE_PREVIEWED',
  'UPDATE_CONFIRMED',
  'UPDATE_STARTED',
  'UPDATE_COMPLETED',
  'UPDATE_FAILED',
  'UPDATE_VERIFIED',
  'UPDATE_VERIFICATION_FAILED',
  'SETTINGS_CHANGED',
  'EXPORT_CREATED',
  'UNAUTHORIZED_ATTEMPT',
] as const;
export const auditEventTypeSchema = z.enum(AUDIT_EVENT_TYPES);
export type AuditEventType = z.infer<typeof auditEventTypeSchema>;

// Derived from lastSeenAt and the poll interval. Not stored in the database.
export const CONNECTION_STATES = [
  'connected',
  'stale',
  'disconnected',
  'pending',
  'revoked',
] as const;
export const connectionStateSchema = z.enum(CONNECTION_STATES);
export type ConnectionState = z.infer<typeof connectionStateSchema>;

export const JOB_KINDS = ['scan', 'update'] as const;
export const jobKindSchema = z.enum(JOB_KINDS);
export type JobKind = z.infer<typeof jobKindSchema>;
