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
const TRAILING_SUMMARY =
  /^\s*(\d+\s+(upgrade|package)|the following|no installed package|no applicable)/i;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9.+_-]{1,127}$/;

/**
 * A version token. WinGet versions are not tidy: "2.56.1", "1.21.13002.0",
 * "5.17.11 (34827)" (build in brackets) and the word "Unknown" all occur.
 */
const VERSION_TOKEN = String.raw`(?:[<>=~^]?\s?v?\d[\w.+\-]*(?:\s*\([^)]*\))?|Unknown)`;

/**
 * One or two version tokens at the end of the row: installed, then available.
 *
 * The lookbehind matters: without it, the "9" at the end of the ARP display name "Tomcat9" would
 * be read as a version. A version can only start after whitespace or at the start of the string.
 */
const VERSIONS = new RegExp(
  String.raw`(?<![\w.\-])(${VERSION_TOKEN})(?:\s+(${VERSION_TOKEN}))?$`,
  'i',
);

function isNoise(line: string): boolean {
  return (
    line.trim() === '' || HEADER.test(line) || SEPARATOR.test(line) || TRAILING_SUMMARY.test(line)
  );
}

/** A source column value, when the row ends with one. */
function splitSource(line: string): { text: string; source: string | null } {
  const match = /\s+(winget|msstore)\s*$/i.exec(line);
  if (!match) return { text: line.trim(), source: null };
  return { text: line.slice(0, match.index).trimEnd(), source: match[1].toLowerCase() };
}

export function parseWingetTable(output: Buffer | string): WingetRow[] {
  return splitRows(decodeWingetOutput(output));
}

/**
 * Parses one table.
 *
 * Rows cannot be split into five equal cells: WinGet does not pad a value that overflows its
 * column, so the identifier, the installed version and the available version sometimes share one
 * run of spaces ("Microsoft.SQLServerManagementStudio 19.1"), and an ARP identifier can itself
 * contain spaces ("ARP\Machine\X64\Apache Tomcat 9.0 Tomcat9").
 *
 * What is reliable is the END of the row: the source, then up to two version tokens. So the row is
 * read from the right, and the identifier is taken from the start of what is left.
 */
function splitRows(text: string): WingetRow[] {
  const rows: WingetRow[] = [];

  for (const rawLine of text.split('\n')) {
    if (isNoise(rawLine)) continue;

    const { text: line, source } = splitSource(rawLine);
    const cells = line.split(/\s{2,}/);
    const displayName = cells[0]?.trim();
    if (!displayName || cells.length < 2) continue;

    const trailing = cells.slice(1).join('  ').trim();
    const versions = VERSIONS.exec(trailing);
    const head = versions ? trailing.slice(0, versions.index).trim() : trailing;

    // The identifier is the first token after the name, when it is a usable package identity.
    // An ARP/MSIX registry key, or a truncated fragment, is not: those stay unmatched.
    const firstToken = /^(\S+)/.exec(head);
    const packageId =
      firstToken && PACKAGE_ID.test(firstToken[1]) && firstToken[1].includes('.')
        ? firstToken[1]
        : null;

    rows.push({
      displayName,
      packageId,
      version: versions?.[1]?.trim() ?? null,
      availableVersion: versions?.[2]?.trim() ?? null,
      source,
    });
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
