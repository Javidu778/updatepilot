import type { ErrorCode } from '@updatepilot/shared';

/** One place that maps every error code to its HTTP status. Matches docs/openapi.yaml. */
export const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DEVICE_REVOKED: 409,
  UNSUPPORTED_PACKAGE: 422,
  UPDATE_CHANGED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export type ErrorDetail = { path: string; message: string };

/**
 * Throw this from route handlers for expected failures. The error handler turns
 * it into the common error response. Never put secrets in the message.
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: ErrorDetail[],
    statusOverride?: number,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = statusOverride ?? STATUS_BY_CODE[code];
  }
}
