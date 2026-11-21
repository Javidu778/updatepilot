import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { findSpendablePreviewToken } from './preview';

const ACTIVE_UPDATE_STATES = ['QUEUED', 'RUNNING', 'VERIFYING'] as const;

export type ExecutableApplication = {
  id: string;
  deviceId: string;
  displayName: string;
  packageId: string | null;
  source: string | null;
  installedVersion: string;
  availableVersion: string | null;
  updateStatus: string;
};

/**
 * Turns a confirmed preview into a queued update job.
 *
 * The preview token is the authorisation: it was issued for exactly this application, package,
 * source and both versions. Everything is re-checked here, because the database may have changed
 * since the user looked at the dialog — a new version published in between must not be installed
 * with a confirmation for the old one.
 *
 * The token is spent and the job created in one transaction, so a double click produces one job.
 */
export async function executeUpdate(args: {
  userId: string;
  application: ExecutableApplication;
  previewToken: string;
  now?: Date;
}) {
  const now = args.now ?? new Date();
  const application = args.application;

  if (!application.packageId || application.source !== 'winget' || !application.availableVersion) {
    throw new AppError('UNSUPPORTED_PACKAGE', 'This application has no supported update method.');
  }

  const token = await findSpendablePreviewToken(args.previewToken, args.userId, now);
  if (!token) {
    // Unknown, expired and already spent all read the same: review the update again.
    throw new AppError(
      'UPDATE_CHANGED',
      'That preview is no longer valid. Review the update and confirm again.',
    );
  }

  const matchesPreview =
    token.applicationId === application.id &&
    token.packageId === application.packageId &&
    token.source === application.source &&
    token.fromVersion === application.installedVersion &&
    token.targetVersion === application.availableVersion;

  if (!matchesPreview || application.updateStatus !== 'UPDATE_AVAILABLE') {
    throw new AppError(
      'UPDATE_CHANGED',
      'The update changed since it was reviewed. Review it again before confirming.',
    );
  }

  const active = await prisma.updateJob.findFirst({
    where: { applicationId: application.id, state: { in: [...ACTIVE_UPDATE_STATES] } },
    select: { id: true },
  });
  if (active) {
    throw new AppError('INVALID_STATE', 'An update for this application is already in progress.');
  }

  return prisma.$transaction(async (tx) => {
    // Compare-and-set on the token: two similtaneous confirmations cannot both create a job.
    const spent = await tx.previewToken.updateMany({
      where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
      data: { usedAt: now },
    });
    if (spent.count === 0) {
      throw new AppError(
        'UPDATE_CHANGED',
        'That preview is no longer valid. Review the update and confirm again.',
      );
    }

    return tx.updateJob.create({
      data: {
        applicationId: application.id,
        deviceId: application.deviceId,
        packageId: application.packageId!,
        initiatedById: args.userId,
        fromVersion: application.installedVersion,
        targetVersion: application.availableVersion!,
        state: 'QUEUED',
        confirmedAt: now,
      },
    });
  });
}
