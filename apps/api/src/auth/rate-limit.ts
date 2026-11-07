import type { Request } from 'express';

/** Rate-limit key from the submitted email, so one account cannot be guessed at from many IPs. */
export function emailKey(req: Request): string {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? `email:${email.trim().toLowerCase().slice(0, 254)}` : 'email:unknown';
}
