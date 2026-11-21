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
  /**
   * How the version relates to its numbers.
   *
   * WinGet sometimes cannot read the exact installed version and reports a bound instead, for
   * example "< 3.14.7" (the Python Launcher). That still carries information: the version is
   * *below* 3.14.7, which is enough to prove a 3.15.2 update applies, and not enough to order it
   * against 3.13.0.
   */
  bound: 'exact' | 'upper' | 'lower';
};

// A leading run of digits, optionally repeated as dot-separated groups. Anything after it is the
// pre-release part. A bracketed build suffix is stripped first, because it is not part of the version.
const BUILD_SUFFIX = /\s*\([^)]*\)\s*$/;
const VERSION_SHAPE = /^(<=|>=|<|>|=)?\s*(\d+(?:\.\d+)*)(?:[-+~]?([0-9A-Za-z][0-9A-Za-z.\-]*))?$/;

/** Returns null when the text has no usable version in it, such as "Unknown". */
export function parseVersion(value: string | null | undefined): ParsedVersion | null {
  if (!value) return null;
  const cleaned = value.trim().replace(BUILD_SUFFIX, '').trim();
  if (cleaned === '') return null;

  const match = VERSION_SHAPE.exec(cleaned);
  if (!match) return null;

  const numbers = match[2].split('.').map((part) => Number.parseInt(part, 10));
  if (numbers.some((part) => !Number.isFinite(part))) return null;

  // "<=" and ">=" are treated as strict: a bound is only ever used to prove a comparison, and
  // being strict keeps that proof valid.
  const bound: ParsedVersion['bound'] =
    match[1] === '<' || match[1] === '<='
      ? 'upper'
      : match[1] === '>' || match[1] === '>='
        ? 'lower'
        : 'exact';

  return { numbers, preRelease: match[3] ?? null, bound };
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

  // A bound only answers when the answer is certain. "< 3.14.7" is below 3.15.2, so the update
  // applies; it cannot be ordered against 3.13.0, so that answer is null.
  if (left.bound !== 'exact' || right.bound !== 'exact') {
    if (left.bound === right.bound) return null;
    const leftIsExact = left.bound === 'exact';
    const bounded = leftIsExact ? right : left;
    const exact = leftIsExact ? left : right;

    // The bound's own numbers compared with the exact version.
    const boundVsExact = compareExact(bounded, exact);
    if (boundVsExact === null) return null;

    if (bounded.bound === 'upper') {
      // bounded < boundVsExact's numbers, so the pair is ordered only when those numbers <= exact.
      if (boundVsExact > 0) return null;
      return leftIsExact ? 1 : -1;
    }

    // bounded > its numbers, so the pair is ordered only when those numbers >= exact.
    if (boundVsExact < 0) return null;
    return leftIsExact ? -1 : 1;
  }

  return compareExact(left, right);
}

/** Compares the numbers and pre-release of two exact versions. */
function compareExact(left: ParsedVersion, right: ParsedVersion): number | null {
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
