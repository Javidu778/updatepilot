/**
 * Where the browser sends API requests.
 *
 * Resolved at build time, because `NEXT_PUBLIC_*` values are inlined into the browser bundle.
 *
 * Two deployment shapes are supported:
 *
 * 1. **Same origin (recommended).** Nothing is set, so requests go to `/api/...` on the web app's own
 *    origin and `next.config.ts` proxies them to the API. The session cookie stays first-party, which
 *    is the only thing that makes `SameSite=Lax` work across two hosts.
 * 2. **A separate API host.** `NEXT_PUBLIC_API_URL` names that host. This only works when both hosts
 *    share a registrable domain (`app.example.com` + `api.example.com`); across unrelated sites the
 *    browser will not send the session cookie and every request after login is anonymous.
 *
 * Trailing slashes are stripped: the value is joined with paths that begin with `/`, and `host//api`
 * answers 404.
 */
export function resolveApiUrl(explicit: string | undefined, isProduction: boolean): string {
  const cleaned = explicit?.trim().replace(/\/+$/, '');
  if (cleaned) return cleaned;

  // Development runs the API on its own port; a production build with no value means same origin.
  return isProduction ? '' : 'http://localhost:4000';
}

export const API_URL = resolveApiUrl(
  process.env.NEXT_PUBLIC_API_URL,
  process.env.NODE_ENV === 'production',
);

/** Absolute URL for an API path, or the path itself when the API is same-origin. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`;
}
