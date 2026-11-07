import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

// Loads the repo-root .env when run from apps/api (npm workspace scripts). Existing variables win.
loadEnv({ path: '../../.env', quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
});

export type AuthConfig = {
  isProduction: boolean;
  /** Exact origin (scheme, host, port) the web app is served from. Used for the Origin check. */
  webOrigin: string;
  /** Key for CSRF token HMACs. Never sent to clients. */
  sessionSecret: string;
  cookieName: string;
  sessionTtlMs: number;
};

let cached: AuthConfig | undefined;

/** Reads and validates the environment once. Call it at startup so a bad config fails fast. */
export function getAuthConfig(): AuthConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid auth configuration: ${problems}`);
  }
  const env = parsed.data;
  cached = {
    isProduction: env.NODE_ENV === 'production',
    webOrigin: new URL(env.WEB_ORIGIN).origin,
    sessionSecret: env.SESSION_SECRET,
    cookieName: 'up_session',
    sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  };
  return cached;
}
