/**
 * Which packages have a release source we can trust.
 *
 * A WinGet package ID is not a repository name, so this cannot be derived: it is a deliberate,
 * reviewed list. Adding an entry is a claim that the repository publishes releases for that
 * package, which is why it is small. Anything not listed simply has no release information, and the
 * UI says "Not available" instead of guessing.
 *
 * Case-insensitive: WinGet IDs vary in case between machines.
 */
export type ReleaseSource = { owner: string; repo: string };

const SOURCES: Record<string, ReleaseSource> = {
  '7zip.7zip': { owner: 'ip7z', repo: '7zip' },
  'git.git': { owner: 'git-for-windows', repo: 'git' },
  'notepad++.notepad++': {
    owner: 'notepad-plus-plus',
    repo: 'notepad-plus-plus',
  },
  'microsoft.visualstudiocode': { owner: 'microsoft', repo: 'vscode' },
  'microsoft.powertoys': { owner: 'microsoft', repo: 'PowerToys' },
};

/** The release source for a package, or null when we have none. */
export function repoForPackageId(packageId: string | null | undefined): ReleaseSource | null {
  if (!packageId) return null;
  return SOURCES[packageId.trim().toLowerCase()] ?? null;
}

/** The packages this build can fetch release notes for. Used by the docs and by tests. */
export function knownPackageIds(): string[] {
  return Object.keys(SOURCES).sort();
}
