import type { ErrorRequestHandler } from 'express';
import { z } from 'zod';
import type { ErrorResponse } from '@updatepilot/shared';
import { AppError, type ErrorDetail } from '../lib/errors';

type BodyParserError = Error & { type?: string; status?: number };

/**
 * The only place that writes error responses, so every error has the same shape
 * and unexpected errors never leak internals (stack traces, SQL, file paths).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const requestId = String(req.id ?? 'unknown');
  let status = 500;
  let body: ErrorResponse['error'] = {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Try again, and contact the team if it keeps happening.',
    requestId,
  };

  if (err instanceof AppError) {
    status = err.status;
    body = {
      code: err.code,
      message: err.message,
      requestId,
      ...(err.details ? { details: err.details } : {}),
    };
  } else if (err instanceof z.ZodError) {
    const details: ErrorDetail[] = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    status = 400;
    body = { code: 'VALIDATION_ERROR', message: 'The request is not valid', requestId, details };
  } else if ((err as BodyParserError)?.type === 'entity.parse.failed') {
    status = 400;
    body = { code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON', requestId };
  } else if ((err as BodyParserError)?.type === 'entity.too.large') {
    status = 413;
    body = { code: 'VALIDATION_ERROR', message: 'The request body is too large', requestId };
  }

  if (status >= 500) {
    // Full detail goes to the server log only.
    req.log.error({ err }, 'Unhandled error');
  } else {
    req.log.info({ code: body.code, status }, 'Request rejected');
  }

  res.status(status).json({ error: body } satisfies ErrorResponse);
};
