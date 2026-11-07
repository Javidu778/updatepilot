import { z } from 'zod';
import {
  actorTypeSchema,
  auditEventTypeSchema,
  connectionStateSchema,
  deviceStatusSchema,
  jobKindSchema,
  jobStateSchema,
  matchStatusSchema,
  severitySchema,
  updateStatusSchema,
  verificationResultSchema,
} from './enums';
import { agentJobSchema, displayVersionSchema, packageIdSchema } from './identifiers';

/**
 * Request and response contracts. docs/openapi.yaml documents the same shapes.
 * The API validates every request with these schemas; the web app and agent
 * use them to type and validate responses.
 */

// ---------------------------------------------------------------------------
// Common
// ---------------------------------------------------------------------------

export const isoDateTime = z.iso.datetime({ offset: true });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  });
}

export const sortOrderSchema = z.enum(['asc', 'desc']);

export const ERROR_CODES = [
  'VALIDATION_ERROR', // 400
  'UNAUTHENTICATED', // 401
  'FORBIDDEN', // 403 (CSRF failure, revoked device)
  'NOT_FOUND', // 404 (also used for resources owned by someone else)
  'INVALID_STATE', // 409 (job transition not allowed, active job exists)
  'IDEMPOTENCY_CONFLICT', // 409 (same key, different request)
  'DEVICE_REVOKED', // 409
  'UNSUPPORTED_PACKAGE', // 422
  'UPDATE_CHANGED', // 422 (target changed since preview, or preview expired)
  'RATE_LIMITED', // 429
  'INTERNAL_ERROR', // 500
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const errorResponseSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ---------------------------------------------------------------------------
// Auth (web users)
// ---------------------------------------------------------------------------

export const registerRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
});
export const loginRequestSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});
export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: isoDateTime,
});
export type User = z.infer<typeof userSchema>;

// Returned by register, login and GET /auth/me.
// The client sends csrfToken back in the X-CSRF-Token header on state-changing requests.
export const authResponseSchema = z.object({
  user: userSchema,
  csrfToken: z.string(),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

// ---------------------------------------------------------------------------
// Devices and pairing
// ---------------------------------------------------------------------------

export const deviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: deviceStatusSchema,
  connection: connectionStateSchema,
  osVersion: z.string().nullable(),
  agentVersion: z.string().nullable(),
  lastSeenAt: isoDateTime.nullable(),
  isSample: z.boolean(),
});
export type Device = z.infer<typeof deviceSchema>;

export const devicesResponseSchema = z.object({ data: z.array(deviceSchema) });

export const pairingCodeResponseSchema = z.object({
  code: z.string(), // shown once, never stored in plain text
  expiresAt: isoDateTime,
});

// Called by the agent. Not authenticated except by the one-time code.
export const pairRequestSchema = z.strictObject({
  pairingCode: z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/),
  deviceName: z.string().min(1).max(100),
  osVersion: z.string().max(100).optional(),
  agentVersion: z.string().max(32).optional(),
});
export const pairResponseSchema = z.object({
  deviceId: z.uuid(),
  agentToken: z.string(), // shown once; the server stores only a hash
  pollIntervalSeconds: z.number().int().min(1),
});

// ---------------------------------------------------------------------------
// Jobs (scan and update share one view)
// ---------------------------------------------------------------------------

export const jobSchema = z.object({
  id: z.uuid(),
  kind: jobKindSchema,
  state: jobStateSchema,
  deviceId: z.uuid(),
  applicationId: z.uuid().nullable(),
  packageId: z.string().nullable(),
  fromVersion: z.string().nullable(),
  targetVersion: z.string().nullable(),
  requestedAt: isoDateTime,
  startedAt: isoDateTime.nullable(),
  finishedAt: isoDateTime.nullable(),
  exitCode: z.number().int().nullable(),
  restartRequired: z.boolean(),
  verification: verificationResultSchema,
  errorSummary: z.string().nullable(),
});
export type Job = z.infer<typeof jobSchema>;

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const APPLICATION_SORT_FIELDS = [
  'displayName',
  'publisher',
  'installedVersion',
  'updateStatus',
  'lastSeenAt',
] as const;

const booleanQuery = z.enum(['true', 'false']).transform((v) => v === 'true');

export const applicationsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  updateStatus: updateStatusSchema.optional(),
  matchStatus: matchStatusSchema.optional(),
  source: z.string().max(64).optional(),
  deviceId: z.uuid().optional(),
  includeRemoved: booleanQuery.default(false),
  // Whitelisted so the client can never choose an arbitrary column.
  sort: z.enum(APPLICATION_SORT_FIELDS).default('displayName'),
  order: sortOrderSchema.default('asc'),
});
export type ApplicationsQuery = z.infer<typeof applicationsQuerySchema>;

export const applicationSchema = z.object({
  id: z.uuid(),
  deviceId: z.uuid(),
  displayName: z.string(),
  publisher: z.string().nullable(),
  installedVersion: z.string(),
  availableVersion: z.string().nullable(),
  packageId: z.string().nullable(),
  source: z.string().nullable(),
  architecture: z.string().nullable(),
  matchStatus: matchStatusSchema,
  updateStatus: updateStatusSchema,
  lastSeenAt: isoDateTime,
  removedAt: isoDateTime.nullable(),
});
export type Application = z.infer<typeof applicationSchema>;
export const applicationsResponseSchema = paginatedSchema(applicationSchema);

export const releaseInfoSchema = z.object({
  version: z.string(),
  releaseDate: isoDateTime.nullable(),
  // Only https URLs are accepted from external sources.
  changelogUrl: z.url({ protocol: /^https$/ }).nullable(),
  officialUrl: z.url({ protocol: /^https$/ }).nullable(),
  source: z.string(),
  fetchedAt: isoDateTime,
});

export const applicationDetailSchema = applicationSchema.extend({
  isSample: z.boolean(),
  release: releaseInfoSchema.nullable(),
  updateHistory: z.array(jobSchema),
});

// ---------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------

// POST /devices/{id}/scans has no body. The Idempotency-Key header is optional but recommended.
export const idempotencyKeySchema = z.uuid();

// ---------------------------------------------------------------------------
// Updates. In /updates/{id}/..., {id} is the APPLICATION id.
// ---------------------------------------------------------------------------

export const updateCandidateSchema = z.object({
  applicationId: z.uuid(),
  deviceId: z.uuid(),
  displayName: z.string(),
  publisher: z.string().nullable(),
  packageId: z.string(),
  source: z.string(),
  installedVersion: z.string(),
  availableVersion: z.string(),
  notes: z.array(z.string()),
  activeJobId: z.uuid().nullable(),
});
export const updatesQuerySchema = paginationQuerySchema.extend({
  deviceId: z.uuid().optional(),
});
export const updatesResponseSchema = paginatedSchema(updateCandidateSchema);

export const updatePreviewSchema = z.object({
  applicationId: z.uuid(),
  deviceId: z.uuid(),
  displayName: z.string(),
  publisher: z.string().nullable(),
  packageId: z.string(),
  source: z.string(),
  architecture: z.string().nullable(),
  fromVersion: z.string(),
  targetVersion: z.string(),
  mayRequireElevation: z.boolean(),
  mayRequireRestart: z.boolean(),
  notes: z.array(z.string()),
  // Signed, short-lived, single-use. Binds user, application, package and target version.
  previewToken: z.string(),
  expiresAt: isoDateTime,
});
export type UpdatePreview = z.infer<typeof updatePreviewSchema>;

export const executeUpdateRequestSchema = z.strictObject({
  previewToken: z.string().min(20).max(2048),
});

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export const activityItemSchema = z.object({
  id: z.uuid(),
  timestamp: isoDateTime,
  eventType: auditEventTypeSchema,
  summary: z.string(),
});

export const dashboardSchema = z.object({
  isSample: z.boolean(),
  counts: z.object({
    applications: z.number().int(),
    updatesAvailable: z.number().int(),
    unmatched: z.number().int(),
    unsupported: z.number().int(),
  }),
  lastScanAt: isoDateTime.nullable(),
  agent: z.object({
    connection: connectionStateSchema,
    deviceId: z.uuid().nullable(),
    lastSeenAt: isoDateTime.nullable(),
  }),
  recentActivity: z.array(activityItemSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export const historyQuerySchema = paginationQuerySchema.extend({
  type: z.enum(['scan', 'update', 'audit']).default('update'),
  from: isoDateTime.optional(),
  to: isoDateTime.optional(),
  outcome: jobStateSchema.optional(),
  deviceId: z.uuid().optional(),
});

export const historyItemSchema = z.object({
  id: z.uuid(),
  type: z.enum(['scan', 'update', 'audit']),
  timestamp: isoDateTime,
  deviceId: z.uuid().nullable(),
  outcome: jobStateSchema.nullable(),
  actorType: actorTypeSchema.nullable(),
  summary: z.string(),
  // Safe diagnostic metadata only. Never secrets, tokens or file contents.
  details: z.record(z.string(), z.unknown()),
});
export const historyResponseSchema = paginatedSchema(historyItemSchema);

// ---------------------------------------------------------------------------
// Security findings
// ---------------------------------------------------------------------------

export const securityFindingsQuerySchema = paginationQuerySchema.extend({
  packageId: packageIdSchema.optional(),
  severity: severitySchema.optional(),
  deviceId: z.uuid().optional(),
});

export const securityFindingSchema = z.object({
  id: z.uuid(),
  packageId: z.string(),
  advisoryId: z.string(),
  severity: severitySchema,
  summary: z.string().nullable(),
  affectedRange: z.string(),
  fixedVersion: z.string().nullable(),
  source: z.string(),
  sourceUrl: z.url({ protocol: /^https$/ }).nullable(),
  lastVerifiedAt: isoDateTime,
});

export const securityFindingsResponseSchema = paginatedSchema(securityFindingSchema).extend({
  meta: z.object({
    checkedAt: isoDateTime.nullable(),
    source: z.string(),
    limitations: z.string(),
    isSample: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Agent channel (authenticated with the agent token)
// ---------------------------------------------------------------------------

export const agentNextJobResponseSchema = z.object({
  job: agentJobSchema.nullable(),
  pollIntervalSeconds: z.number().int().min(1),
  serverTime: isoDateTime,
});

export const agentProgressRequestSchema = z.strictObject({
  state: z.enum(['RUNNING', 'VERIFYING']),
});

export const scannedApplicationSchema = z.strictObject({
  displayName: z.string().min(1).max(256),
  publisher: z.string().max(256).nullable(),
  installedVersion: displayVersionSchema,
  availableVersion: displayVersionSchema.nullable(),
  packageId: packageIdSchema.nullable(),
  source: z.string().max(64).nullable(),
  architecture: z.string().max(32).nullable(),
});
export type ScannedApplication = z.infer<typeof scannedApplicationSchema>;

export const scanResultsRequestSchema = z.strictObject({
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  applications: z.array(scannedApplicationSchema).max(5000),
});

export const updateResultRequestSchema = z.strictObject({
  startedAt: isoDateTime,
  finishedAt: isoDateTime,
  exitCode: z.number().int(),
  restartRequired: z.boolean(),
  installedVersionAfter: displayVersionSchema.nullable(),
  // Untrusted text from the agent: the UI must escape it, and it is length-limited.
  errorSummary: z.string().max(1000).nullable(),
});
export type UpdateResultRequest = z.infer<typeof updateResultRequestSchema>;
