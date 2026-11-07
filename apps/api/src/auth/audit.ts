import { prisma } from '../lib/prisma';
import type { ActorType, AuditEventType } from '@updatepilot/shared';

/** Anything with an error(obj, msg) method, such as the request's pino logger (req.log). */
type AuditLogger = { error: (obj: object, msg?: string) => void };

type AuditInput = {
  actorType: ActorType;
  actorUserId?: string | null;
  deviceId?: string | null;
  eventType: AuditEventType;
  targetType?: string;
  targetId?: string;
  /** Safe metadata only. Never passwords, tokens, cookies, emails or file contents. */
  metadata?: Record<string, string | number | boolean | null>;
};

/**
 * Writes an audit event. A failure is logged but does not fail the user's request,
 * because the action has already happened by the time this runs.
 */
export async function writeAudit(input: AuditInput, log?: AuditLogger): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        actorType: input.actorType,
        actorUserId: input.actorUserId ?? null,
        deviceId: input.deviceId ?? null,
        eventType: input.eventType,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: input.metadata ?? {},
      },
    });
  } catch (err) {
    const detail = { event: input.eventType, error: err instanceof Error ? err.message : 'unknown' };
    if (log) log.error(detail, 'audit write failed');
    else console.error(JSON.stringify({ level: 'error', message: 'audit write failed', ...detail }));
  }
}
