/**
 * Comparing the version strings WinGet reports.
 *
 * They are not semver and they are not consistent: "23.01", "2.56.1", "1.21.13002.0", "2025.1",
 * "5.17.11 (34827)", "1.0.0-beta.2" and plain "Unknown" all appear in real inventories.
 *
 * So the rules here are deliberately conservative:
 *   - numbers are compared numerically, and a missing segment counts as zero ("2.44" == "2.44.0");
 *   - a trailing build in brackets is ignored ("5.17.11 (34827)" == "5.17.11");
 *   - a pre-release suffix sorts before the release it belongs to ("1.0.0-beta" < "1.0.0");
 *   - anything without a number is NOT comparable, and the caller is told so (null) instead of
 *     being given a guess. A guessed version comparison is how a downgrade gets offered as an update.
 */

export type ParsedVersion = {
  /** Numeric segments, in order. Always at least one. */
  numbers: number[];
  /** Everything after the numbers, for example "beta.2". Null for a plain release. */
  preRelease: string | null;
};

// A leading run of digits, optionally repeated as dot-separated groups. Anything after it is the
// pre-release part. A bracketed build suffix is stripped first, because it is not part of the version.
const BUILD_SUFFIX = /\s*\([^)]*\)\s*$/;
const VERSION_SHAPE = /^(\d+(?:\.\d+)*)(?:[-+~]?([0-9A-Za-z][0-9A-Za-z.\-]*))?$/;

/** Returns null when the text has no usable version in it, such as "Unknown". */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null;
  const cleaned = value.trim().replace(BUILD_SUFFIX, '').trim();
  if (cleaned === '') return null;

  const match = VERSION_SHAPE.exec(cleaned);
  if (!match) return null;

  const numbers = match[1].split('.').map((part) => Number.parseInt(part, 10));
  if (numbers.some((part) => !Number.isFinite(part))) return null;

  return { numbers, preRelease: match[2] ?? null };
}

/** Numeric-aware comparison of two pre-release strings: "beta.2" < "beta.10". */
function comparePreRelease(a: string, b: string): number {
  const left = a.split(/[.\-_+~]/);
  const right = b.split(/[.\-_+~]/);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    const l = left[index];
    const r = right[index];
    if (l === undefined) return -1; // "beta" < "beta.1"
    if (r === undefined) return 1;
    if (l === r) continue;

    const ln = Number.parseInt(l, 10);
    const rn = Number.parseInt(r, 10);
    const bothNumeric = Number.isFinite(ln) && Number.isFinite(rn);

    if (bothNumeric) {
      if (ln !== rn) return ln < rn ? -1 : 1;
      continue;
    }
    return l < r ? -1 : 1;
  }
  return 0;
}

/**
 * Compares two versions. Negative when a is older, positive when a is newer, 0 when equal.
 * Returns null when either side cannot be parsed, so callers never act on a guess.
 */
export function compareVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;

  const length = Math.max(left.numbers.length, right.numbers.length);
  for (let index = 0; index < length; index++) {
    const l = left.numbers[index] ?? 0;
    const r = right.numbers[index] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }

  // Same numbers: a release beats its own pre-release.
  if (left.preRelease === null && right.preRelease === null) return 0;
  if (left.preRelease === null) return 1;
  if (right.preRelease === null) return -1;
  return comparePreRelease(left.preRelease, right.preRelease);
}

/**
 * True when `candidate` is strictly newer than `current`.
 *
 * null means "cannot tell" — used for the word Unknown, empty strings and anything unparseable.
 * Callers must treat null as unknown, never as true.
 */
export function isNewerVersion(
  candidate: string | null | undefined,
  current: string | null | undefined,
): boolean | null {
  const result = compareVersions(candidate, current);
  return result === null ? null : result > 0;
}

/** True when both sides are parseable and describe the same version. */
export function isSameVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean | null {
  const result = compareVersions(a, b);
  return result === null ? null : result === 0;
}
