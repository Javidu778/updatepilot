/**
 * Development seed data.
 *
 * Everything created here is SAMPLE DATA, not a real scan:
 *  - the device is named "SAMPLE DEVICE" and has isSample = true
 *  - release metadata and security findings have isSample = true
 * The UI must show a visible "Sample data" banner for sample devices.
 *
 * Safe to re-run: it removes the previous sample device first.
 */
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';

const DEMO_EMAIL = 'demo@updatepilot.local';

type SampleApp = {
  displayName: string;
  publisher: string | null;
  installedVersion: string;
  packageId: string | null;
  source: string | null;
  matchStatus: 'MATCHED' | 'UNMATCHED' | 'UNSUPPORTED' | 'UNKNOWN';
  updateStatus: 'UP_TO_DATE' | 'UPDATE_AVAILABLE' | 'UNKNOWN';
  availableVersion: string | null;
};

const SAMPLE_APPS: SampleApp[] = [
  { displayName: '7-Zip', publisher: 'Igor Pavlov', installedVersion: '23.01', packageId: '7zip.7zip', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UPDATE_AVAILABLE', availableVersion: '24.08' },
  { displayName: 'Git', publisher: 'The Git Development Community', installedVersion: '2.44.0', packageId: 'Git.Git', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UPDATE_AVAILABLE', availableVersion: '2.45.1' },
  { displayName: 'Notepad++', publisher: 'Notepad++ Team', installedVersion: '8.7.5', packageId: 'Notepad++.Notepad++', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UP_TO_DATE', availableVersion: '8.7.5' },
  { displayName: 'Visual Studio Code', publisher: 'Microsoft Corporation', installedVersion: '1.90.0', packageId: 'Microsoft.VisualStudioCode', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UPDATE_AVAILABLE', availableVersion: '1.91.1' },
  { displayName: 'VLC media player', publisher: 'VideoLAN', installedVersion: '3.0.20', packageId: 'VideoLAN.VLC', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UP_TO_DATE', availableVersion: '3.0.20' },
  { displayName: 'Mozilla Firefox', publisher: 'Mozilla', installedVersion: '127.0', packageId: 'Mozilla.Firefox', source: 'winget', matchStatus: 'MATCHED', updateStatus: 'UPDATE_AVAILABLE', availableVersion: '128.0' },
  { displayName: 'Legacy Lab Tool', publisher: null, installedVersion: '1.0', packageId: null, source: null, matchStatus: 'UNMATCHED', updateStatus: 'UNKNOWN', availableVersion: null },
  { displayName: 'Vendor Updater App', publisher: 'Example Vendor', installedVersion: '5.2.1', packageId: null, source: null, matchStatus: 'UNSUPPORTED', updateStatus: 'UNKNOWN', availableVersion: null },
];

function appKeyFor(app: SampleApp): string {
  return app.packageId ?? `name:${app.displayName.toLowerCase()}|${(app.publisher ?? '').toLowerCase()}|x64`;
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample data when NODE_ENV=production.');
  }

  // Remove previous sample data so the seed can be re-run.
  await prisma.device.deleteMany({ where: { isSample: true } });
  await prisma.releaseMetadata.deleteMany({ where: { isSample: true } });
  await prisma.securityFinding.deleteMany({ where: { isSample: true } });

  const password = process.env.SEED_DEMO_PASSWORD ?? 'ChangeMe-Demo-123';
  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, passwordHash, settings: { theme: 'system' } },
  });

  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

  const device = await prisma.device.create({
    data: {
      ownerId: user.id,
      name: 'SAMPLE DEVICE (sample data)',
      osVersion: 'Windows 11 (sample)',
      agentVersion: '0.0.0-sample',
      status: 'ACTIVE',
      lastSeenAt: hoursAgo(0.1),
      isSample: true,
    },
  });

  const scan = await prisma.scanJob.create({
    data: {
      deviceId: device.id,
      requestedById: user.id,
      state: 'SUCCEEDED',
      startedAt: hoursAgo(2),
      finishedAt: hoursAgo(1.9),
      appCount: SAMPLE_APPS.length,
    },
  });

  const appIdByPackage = new Map<string, string>();
  for (const sample of SAMPLE_APPS) {
    const appKey = appKeyFor(sample);
    const app = await prisma.application.create({
      data: { deviceId: device.id, appKey, architecture: 'x64', ...sample, lastSeenAt: hoursAgo(1.9) },
    });
    if (sample.packageId) appIdByPackage.set(sample.packageId, app.id);
    await prisma.applicationSnapshot.create({
      data: {
        scanJobId: scan.id,
        applicationId: app.id,
        appKey,
        displayName: sample.displayName,
        publisher: sample.publisher,
        installedVersion: sample.installedVersion,
        packageId: sample.packageId,
        source: sample.source,
        matchStatus: sample.matchStatus,
      },
    });
  }

  // History: one verified success and one failure.
  const notepad = appIdByPackage.get('Notepad++.Notepad++')!;
  await prisma.updateJob.create({
    data: {
      applicationId: notepad,
      deviceId: device.id,
      initiatedById: user.id,
      packageId: 'Notepad++.Notepad++',
      fromVersion: '8.6.9',
      targetVersion: '8.7.5',
      state: 'SUCCEEDED',
      requestedAt: hoursAgo(26),
      confirmedAt: hoursAgo(26),
      startedAt: hoursAgo(25.9),
      finishedAt: hoursAgo(25.8),
      exitCode: 0,
      verification: 'VERIFIED',
      verifiedVersion: '8.7.5',
    },
  });

  const git = appIdByPackage.get('Git.Git')!;
  await prisma.updateJob.create({
    data: {
      applicationId: git,
      deviceId: device.id,
      initiatedById: user.id,
      packageId: 'Git.Git',
      fromVersion: '2.44.0',
      targetVersion: '2.45.1',
      state: 'FAILED',
      requestedAt: hoursAgo(5),
      confirmedAt: hoursAgo(5),
      startedAt: hoursAgo(4.9),
      finishedAt: hoursAgo(4.8),
      exitCode: 1603,
      verification: 'NOT_RUN',
      errorSummary: 'Installer exited with code 1603 (sample failure).',
    },
  });

  await prisma.auditEvent.createMany({
    data: [
      { actorType: 'USER', actorUserId: user.id, deviceId: device.id, eventType: 'DEVICE_PAIRED', targetType: 'Device', targetId: device.id, metadata: { sample: true }, createdAt: hoursAgo(48) },
      { actorType: 'AGENT', deviceId: device.id, eventType: 'SCAN_COMPLETED', targetType: 'ScanJob', targetId: scan.id, metadata: { sample: true, appCount: SAMPLE_APPS.length }, createdAt: hoursAgo(1.9) },
      { actorType: 'USER', actorUserId: user.id, deviceId: device.id, eventType: 'UPDATE_FAILED', targetType: 'Application', targetId: git, metadata: { sample: true, exitCode: 1603 }, createdAt: hoursAgo(4.8) },
    ],
  });

  await prisma.releaseMetadata.createMany({
    data: [
      { packageId: '7zip.7zip', version: '24.08', releaseDate: new Date('2024-08-11'), officialUrl: 'https://www.7-zip.org/', changelogUrl: 'https://www.7-zip.org/history.txt', source: 'sample', isSample: true },
      { packageId: 'Git.Git', version: '2.45.1', source: 'sample', isSample: true },
    ],
  });

  await prisma.securityFinding.create({
    data: {
      packageId: 'example.package',
      advisoryId: 'SAMPLE-0001',
      severity: 'MEDIUM',
      summary: 'Sample advisory used only to design the Security insights page.',
      affectedRange: '< 1.2.3',
      fixedVersion: '1.2.3',
      source: 'sample',
      lastVerifiedAt: hoursAgo(1),
      isSample: true,
    },
  });

  console.log(`Seeded sample data. Demo login: ${DEMO_EMAIL}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
