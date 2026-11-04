import type { RequestHandler, Response } from 'express';
import type { z } from 'zod';

type Schemas = {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
};

/**
 * Validates request parts with Zod. On failure the ZodError reaches the error
 * handler (HTTP 400, VALIDATION_ERROR). On success the parsed values are stored
 * in res.locals.validated; read them with getValidated().
 *
 * Express 5 makes req.query read-only, so parsed values are not written back.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    try {
      const validated: { body?: unknown; query?: unknown; params?: unknown } = {};
      if (schemas.params) validated.params = schemas.params.parse(req.params);
      if (schemas.query) validated.query = schemas.query.parse(req.query);
      if (schemas.body) validated.body = schemas.body.parse(req.body);
      res.locals.validated = validated;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getValidated<T extends { body?: unknown; query?: unknown; params?: unknown }>(
  res: Response,
): T {
  return res.locals.validated as T;
}
