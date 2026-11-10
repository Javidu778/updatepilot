import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  // SESSION_SECRET is the name used by the auth module and existing .env files.
  JWT_SECRET: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // Defaults to on outside production.
  ENABLE_API_DOCS: z.enum(['true', 'false']).optional(),
});

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  /** The single browser origin allowed by CORS, without a trailing slash. */
  webOrigin: string;
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  enableApiDocs: boolean;
  version: string;
  rateLimit: { windowMs: number; limit: number };
};

/**
 * Validates environment variables once, at startup. Throws a readable error
 * listing every problem so a misconfigured server never starts half-working.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const normalizedEnv = {
    ...env,
    ...(env.JWT_SECRET ? {} : { JWT_SECRET: env.SESSION_SECRET }),
  };
  const parsed = envSchema.safeParse(normalizedEnv);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (i) => `  - ${i.path.join('.') || 'env'}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${problems.join('\n')}`);
  }
  const values = parsed.data;
  const secret = values.JWT_SECRET;

  if (values.NODE_ENV === 'production') {
    const weak = secret.length < 32 || secret === 'replace-me';
    if (weak) {
      throw new Error(
        'Invalid environment configuration:\n  - JWT_SECRET: must be at least 32 characters in production',
      );
    }
  }

  return {
    nodeEnv: values.NODE_ENV,
    port: values.API_PORT,
    webOrigin: new URL(values.WEB_ORIGIN).origin,
    logLevel: values.LOG_LEVEL,
    enableApiDocs: values.ENABLE_API_DOCS
      ? values.ENABLE_API_DOCS === 'true'
      : values.NODE_ENV !== 'production',
    version: env.npm_package_version ?? '0.0.0',
    rateLimit: { windowMs: 60_000, limit: 300 },
  };
}
