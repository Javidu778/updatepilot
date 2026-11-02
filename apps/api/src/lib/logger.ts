import pino from 'pino';

/**
 * Structured JSON logs. Secrets are redacted so they can never reach log files.
 * See docs/threat-model.md (T-14).
 */
export function createLogger(level: string) {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.passwordHash',
        '*.token',
        '*.agentToken',
        '*.previewToken',
        '*.pairingCode',
      ],
      censor: '[redacted]',
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
