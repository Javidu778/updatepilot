import { execFile } from 'node:child_process';
import {
  packageIdSchema,
  packageSourceSchema,
  targetVersionSchema,
  type AgentJob,
} from '@updatepilot/shared';
import { parseWingetList } from './parse';

/**
 * Building and running the ONE command that changes a machine.
 *
 * Everything here is shaped by one rule from docs/agent-protocol.md: the agent never builds a shell
 * string and never accepts an argument from the server. The package id and target version are
 * re-validated with the same shared schemas the API used, then placed in a fixed argument array.
 *
 * What is deliberately NOT in the array: anything that skips a hash or signature check, any
 * installer path or URL, and any free-form text from the server.
 */

export type UpgradeJob = Extract<AgentJob, { kind: 'upgrade' }>;

const UPGRADE_TIMEOUT_MS = 30 * 60 * 1000;

/** Windows Installer codes that mean "done, restart needed". 3010 and 1641 are the documented pair. */
const RESTART_EXIT_CODES = new Set([3010, 1641]);

export function isRestartExitCode(exitCode: number): boolean {
  return RESTART_EXIT_CODES.has(exitCode);
}

/**
 * The fixed command. `--exact` makes WinGet match the package id literally rather than fuzzily,
 * and `--version` pins the update to the version the user confirmed.
 */
export function buildUpgradeArgs(
  job: Pick<UpgradeJob, 'packageId' | 'targetVersion' | 'source'>,
): string[] {
  const packageId = packageIdSchema.parse(job.packageId);
  const targetVersion = targetVersionSchema.parse(job.targetVersion);
  const source = packageSourceSchema.parse(job.source);

  return [
    'upgrade',
    '--id',
    packageId,
    '--exact',
    '--source',
    source,
    '--version',
    targetVersion,
    // Keep WinGet from prompting inside a console it does not own. This does NOT bypass UAC:
    // an installer that needs administrator rights still raises the Windows prompt.
    '--disable-interactivity',
    '--accept-package-agreements',
    '--accept-source-agreements',
  ];
}

export type UpgradeRun = {
  exitCode: number;
  timedOut: boolean;
  stdout: string;
  stderr: string;
};

/** Spawns WinGet with the argument array. A timeout kills the process instead of waiting for ever. */
export function runUpgrade(
  args: readonly string[],
  timeoutMs = UPGRADE_TIMEOUT_MS,
): Promise<UpgradeRun> {
  return new Promise((resolve) => {
    execFile(
      'winget.exe',
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ exitCode: 0, timedOut: false, stdout: stdout ?? '', stderr: stderr ?? '' });
          return;
        }

        const code = (error as { code?: unknown }).code;
        const timedOut = (error as { killed?: boolean }).killed === true || code === 'ETIMEDOUT';

        resolve({
          exitCode: typeof code === 'number' ? code : timedOut ? -1 : 1,
          timedOut,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}

/** The version printed on the machine right now, or null when it cannot be read. */
export async function readInstalledVersion(
  packageId: string,
  timeoutMs = 60_000,
): Promise<string | null> {
  const id = packageIdSchema.parse(packageId);
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      'winget.exe',
      ['list', '--id', id, '--exact', '--accept-source-agreements'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout ?? '');
      },
    );
  });

  const rows = parseWingetList(output);
  const row = rows.find((candidate) => candidate.packageId?.toLowerCase() === id.toLowerCase());
  return row?.version ?? null;
}

/** A version string the shared schema will accept, or null. */
export function sanitizeVersion(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, 128);
  return cleaned === '' ? null : cleaned;
}

/** A short, plain-text summary that fits the schema and contains no secrets or long dumps. */
export function summarizeFailure(run: UpgradeRun): string | null {
  if (run.timedOut) return 'The update timed out and was stopped.';
  if (run.exitCode === 0) return null;

  const text = `${run.stderr}\n${run.stdout}`.trim();
  const cleaned = text
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return `WinGet exited with code ${run.exitCode}.`;
  return cleaned.slice(0, 1000);
}
