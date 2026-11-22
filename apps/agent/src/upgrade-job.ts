import { AgentHttpError, type AgentApi } from './api-client';
import {
  buildUpgradeArgs,
  isRestartExitCode,
  readInstalledVersion,
  runUpgrade,
  sanitizeVersion,
  summarizeFailure,
  type UpgradeJob,
} from './winget/upgrade';

/**
 * Runs one confirmed update, end to end.
 *
 * The order is the point: report RUNNING before touching the machine, run the fixed command, report
 * VERIFYING, rescan the package, then submit the facts. The server decides whether it succeeded; the
 * agent never claims success on its own.
 */
export async function runUpgradeJob(api: AgentApi, job: UpgradeJob): Promise<void> {
  const args = buildUpgradeArgs(job);
  const startedAt = new Date();

  console.log(
    `Update ${job.jobId}: ${job.packageId} -> ${job.targetVersion} (winget upgrade --exact)`,
  );

  await api.reportProgress(job.jobId, 'RUNNING');

  const run = await runUpgrade(args);
  if (run.timedOut) console.warn(`Update ${job.jobId}: timed out and was stopped.`);

  const restartRequired = isRestartExitCode(run.exitCode);

  // Only a clean install can be verified now. A restart code means the version is checked after the
  // restart, and a failure has nothing to verify.
  let installedVersionAfter: string | null = null;
  if (run.exitCode === 0 && !restartRequired) {
    try {
      await api.reportProgress(job.jobId, 'VERIFYING');
    } catch (error) {
      // The job may already have been finalised elsewhere; the result below still tells the truth.
      if (!(error instanceof AgentHttpError && error.status === 409)) throw error;
    }
    installedVersionAfter = sanitizeVersion(
      await readInstalledVersion(job.packageId).catch(() => null),
    );
  }

  await api.submitUpdateResult(job.jobId, {
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: run.exitCode,
    restartRequired,
    installedVersionAfter,
    errorSummary: summarizeFailure(run),
  });

  const verdict = restartRequired
    ? 'restart required'
    : run.exitCode !== 0
      ? `failed (exit ${run.exitCode})`
      : installedVersionAfter
        ? `finished, version now ${installedVersionAfter}`
        : 'finished, version could not be read';

  console.log(`Update ${job.jobId}: ${verdict}.`);
}
