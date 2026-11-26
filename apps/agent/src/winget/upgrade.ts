import { execFile } from 'node:child_process';
import {
  isSameVersion,
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

/**
 * Reads a version, retrying while it is not there yet.
 *
 * A successful installer returns before Windows has finished registering the new version, so an
 * immediate rescan can find nothing at all. The first real acceptance run hit exactly this: exit
 * code 0, Notepad++ went from 8.9.7 to 8.9.9.1, and the rescan read nothing a second later.
 *
 * A missing version is retried; a version that is present but wrong is returned at once, because
 * waiting cannot turn the wrong version into the right one.
 */
export async function readVersionWithRetry(
  read: () => Promise<string | null>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const attempts = Math.max(1, options.attempts ?? 5);
  const delayMs = Math.max(0, options.delayMs ?? 2000);

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const version = await read().catch(() => null);
    if (version) return version;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

/** The version printed on the machine right now, or null when it cannot be read. */
export async function readInstalledVersion(
  packageId: string,
  timeoutMs = 60_000,
): Promise<string | null> {
  const id = packageIdSchema.parse(packageId);

  const readOnce = async (): Promise<string | null> => {
    // The FULL list, not `--id ... --exact`.
    //
    // Filtered output collapses its columns to single spaces
    // ("Cursor (User) Anysphere.Cursor 3.31.15 winget"), which this parser cannot split safely,
    // while the unfiltered table is padded and parses correctly - it is what every scan already
    // uses. Three real acceptance runs failed to verify until this was found.
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        'winget.exe',
        ['list', '--accept-source-agreements'],
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
  };

  return readVersionWithRetry(readOnce);
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

/**
 * Waits until the machine reports the version we were asked to install.
 *
 * Two real acceptance runs showed why "read once, then decide" is wrong: Notepad++ and GitHub CLI
 * were both installed correctly, yet winget took 20-40 seconds to list the new version. Reading
 * once produced VERIFICATION_FAILED for a successful update.
 *
 * So the agent polls until the reported version matches the target, and gives up after a deadline.
 * If the deadline passes, it reports the last version it did see (or null), and the server says why.
 */
export async function waitForTargetVersion(
  read: () => Promise<string | null>,
  targetVersion: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<string | null> {
  const attempts = Math.max(1, options.attempts ?? 12);
  const delayMs = Math.max(0, options.delayMs ?? 5000);
  let lastSeen: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const version = await read().catch(() => null);
    if (version) lastSeen = version;
    if (version && isSameVersion(version, targetVersion) === true) return version;
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return lastSeen;
}
