import type { ScannedApplication } from '@updatepilot/shared';
import { decodeWingetOutput } from './decode';

/**
 * Parsers for the two WinGet commands we depend on.
 *
 * They are pure functions over text: no child process, no Windows, no clock. That is what lets
 * the tests run on any machine and in CI, from recorded output.
 *
 * Column layout of both commands (WinGet 1.6+):
 *
 *   Name                     Id                        Version   Available  Source
 *   ------------------------------------------------------------------------------
 *   7-Zip 23.01 (x64)        7zip.7zip                 23.01     24.08      winget
 *
 * Only these columns are trusted. Publisher and architecture are NOT part of any WinGet table,
 * so they stay null here rather than being guessed (docs/agent-protocol.md §5).
 */

export type WingetRow = {
  displayName: string;
  packageId: string | null;
  version: string | null;
  availableVersion: string | null;
  source: string | null;
};

const HEADER = /^\s*Name\s+Id\s+Version/i;
const SEPARATOR = /^\s*-{5,}[\s-]*$/;
const TRAILING_SUMMARY = /^\s*(\d+\s+(upgrade|package)|the following|no installed package|no applicable)/i;
const SOURCE_VALUES = /^(winget|msstore)$/i;
const VERSION = /^(unknown|[<>=~^]?\s?v?\d[\w.+-]*)$/i;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]{1,127}$/;

function isNoise(line: string): boolean {
  return (
    line.trim() === '' ||
    HEADER.test(line) ||
    SEPARATOR.test(line) ||
    TRAILING_SUMMARY.test(line)
  );
}

function looksLikeVersion(cell: string): boolean {
  return VERSION.test(cell.trim());
}

/**
 * Turns the table into rows of cells, right-aligning the four known trailing columns.
 *
 * Cells are separated by two or more spaces, which is safe because a package ID, a version and
 * a source never contain a space, while the name often does ("Microsoft Visual Studio Code (User)").
 */
export function parseWingetTable(output: Buffer | string): WingetRow[] {
  const text = decodeWingetOutput(output);
  const rows: WingetRow[] = [];

  for (const line of text.split('\n')) {
    if (isNoise(line)) continue;

    const cells = line.trim().split(/\s{2,}/);
    if (cells.length < 2) continue;

    let source: string | null = null;
    if (cells.length >= 3 && SOURCE_VALUES.test(cells[cells.length - 1])) {
      source = cells.pop()!.toLowerCase();
    }

    let availableVersion: string | null = null;
    if (cells.length >= 3 && looksLikeVersion(cells[cells.length - 1])) {
      // The last version-shaped cell is "Available" only if another version precedes it.
      if (cells.length >= 3 && looksLikeVersion(cells[cells.length - 2])) {
        availableVersion = cells.pop()!;
      }
    }

    let version: string | null = null;
    if (cells.length >= 2 && looksLikeVersion(cells[cells.length - 1])) {
      version = cells.pop()!;
    }

    const displayName = cells.shift()?.trim();
    if (!displayName) continue;

    const idCell = cells.shift()?.trim() ?? '';
    const packageId = PACKAGE_ID.test(idCell) && idCell.includes('.') ? idCell : null;

    rows.push({ displayName, packageId, version, availableVersion, source });
  }

  return rows;
}

/** `winget list`: what is installed. Some rows have no package ID (unmatched apps). */
export function parseWingetList(output: Buffer | string): WingetRow[] {
  return parseWingetTable(output);
}

/** `winget upgrade`: the same table, but every row by definition has an available version. */
export function parseWingetUpgrade(output: Buffer | string): WingetRow[] {
  return parseWingetTable(output);
}

/**
 * Combines the two commands into what the API accepts.
 *
 * `winget upgrade` is the authority on available versions: `winget list` also carries an
 * Available column, but it can lag by a refresh cycle. Anything WinGet does not know is null,
 * never a guess.
 */
export function mergeScannedApplications(
  installed: WingetRow[],
  upgrades: WingetRow[],
): ScannedApplication[] {
  const availableById = new Map<string, string>();
  for (const row of upgrades) {
    if (row.packageId && row.availableVersion) {
      availableById.set(row.packageId.toLowerCase(), row.availableVersion);
    }
  }

  const seen = new Set<string>();
  const applications: ScannedApplication[] = [];

  for (const row of installed) {
    const installedVersion = row.version && row.version.trim() !== '' ? row.version : 'Unknown';
    const availableVersion =
      (row.packageId ? availableById.get(row.packageId.toLowerCase()) : undefined) ??
      row.availableVersion ??
      null;

    // The same package can appear twice (per-user and machine scope). Keep the first.
    const identity = (row.packageId ?? `${row.displayName}|${installedVersion}`).toLowerCase();
    if (seen.has(identity)) continue;
    seen.add(identity);

    applications.push({
      displayName: row.displayName,
      publisher: null,
      installedVersion,
      availableVersion,
      packageId: row.packageId,
      source: row.source,
      architecture: null,
    });
  }

  return applications;
}