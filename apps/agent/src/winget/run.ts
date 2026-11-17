import { execFile } from 'node:child_process';
import type { ScannedApplication } from '@updatepilot/shared';
import { mergeScannedApplications, parseWingetList, parseWingetUpgrade } from './parse';

/**
 * Runs WinGet. Two rules from docs/agent-protocol.md §1 are enforced here:
 *   - an argument ARRAY, never a shell string, so no quoting or injection is possible;
 *   - no flag that skips hash or signature checks.
 */
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 20 * 1024 * 1024;

export function runWinget(args: readonly string[], timeoutMs = TIMEOUT_MS): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      'winget.exe',
      [...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_BUFFER, encoding: 'buffer' },
      (error, stdout) => {
        if (error) {
          if ('killed' in error && error.killed) {
            reject(new Error(`winget ${args.join(' ')} timed out after ${timeoutMs / 1000}s`));
            return;
          }
          reject(error);
          return;
        }
        resolve(stdout as unknown as Buffer);
      },
    );
  });
}

/** The full read: what is installed, merged with what has an upgrade available. */
export async function readInventory(): Promise<ScannedApplication[]> {
  const [list, upgrade] = await Promise.all([runWinget(['list']), runWinget(['upgrade'])]);
  return mergeScannedApplications(parseWingetList(list), parseWingetUpgrade(upgrade));
}
