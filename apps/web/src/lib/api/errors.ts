import type { ErrorCode } from '@updatepilot/shared';

export type FieldDetail = { path: string; message: string };

/** The API answered, but with an error. Built from the common error format in docs/openapi.yaml. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'UNKNOWN',
    message: string,
    public readonly details: FieldDetail[] = [],
    public readonly requestId?: string,
    /** Seconds to wait, when the server said so (rate limits). */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The API could not be reached at all (offline, API not running, blocked by CORS). */
export class NetworkError extends Error {
  constructor() {
    super('The server could not be reached');
    this.name = 'NetworkError';
  }
}

/** The API answered successfully, but not in the shape the shared contract promises. */
export class ResponseShapeError extends Error {
  constructor() {
    super('The server sent a response the app does not understand');
    this.name = 'ResponseShapeError';
  }
}

/** First server message for each field, for example { email: 'This email cannot be used' }. */
export function fieldMessages(error: ApiError): Record<string, string> {
  const messages: Record<string, string> = {};
  for (const detail of error.details) {
    if (!(detail.path in messages)) messages[detail.path] = detail.message;
  }
  return messages;
}
