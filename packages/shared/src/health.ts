import { z } from 'zod';
import { isoDateTime } from './api';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  time: isoDateTime,
  version: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const readinessResponseSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  checks: z.object({
    database: z.enum(['up', 'down']),
  }),
});
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
